import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import type { TestRun } from '../src/workbench-domain.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { syncBuiltinReferences, validateBuiltinReferences } from '../src/workbench-builtin-references.js'
import type { ReferencePublications } from '../src/workbench-evidence-contracts.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-builtin-refs-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const store = new WorkbenchStore(root); await store.init(); cleanups.push(() => store.close())
  const run: TestRun = { schemaVersion: 1, id: randomUUID(), name: 'source', yaml: '', engine: 'fixture', phase: 'finished', verdict: 'fail',
    startedAt: '2020-01-01T00:00:00.000Z', endedAt: '2020-01-01T00:00:00.000Z', sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock',
    verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed', cleanup: 'session-retained', steps: [], evidence: [] }
  await store.save(run)
  return { root, store, run, ledger: new WorkbenchReferences(store), retention: new WorkbenchRetention(store) }
}

it.each(['suite', 'baseline', 'agent', 'pin', 'child'])('%s interrupted publication stays protective across owner restart without changing source', async kind => {
  const { store, root, run, ledger } = await fixture(), before = await readFile(join(root, run.id, 'manifest.json'))
  await expect(store.withMutationGate(() => syncBuiltinReferences(store, `workbench:${kind}`, 'fixture', undefined, [run.id], async () => { throw new Error('ENOSPC fixture') }))).rejects.toThrow('ENOSPC')
  expect(await ledger.list()).toHaveLength(1)
  await store.close()
  const reopened = new WorkbenchStore(root); await reopened.init(); cleanups.push(() => reopened.close())
  expect((await new WorkbenchRetention(reopened).plan(0)).candidates).toEqual([])
  expect(await readFile(join(root, run.id, 'manifest.json'))).toEqual(before)
})

it('retirement commits before revoke, retries after restart, and cannot revoke a different owner', async () => {
  const { root, store, run, ledger, retention } = await fixture(), path = join(root, 'consumer-fixture.json')
  let marker: ReferencePublications | undefined
  const commit = async (value: ReferencePublications) => { await writeFile(path, JSON.stringify(value)); marker = value }
  await store.withMutationGate(() => syncBuiltinReferences(store, 'workbench:suite', 'suite', marker, [run.id], commit))
  await expect(store.withMutationGate(() => syncBuiltinReferences(store, 'workbench:suite', 'suite', marker, [], commit,
    async phase => { if (phase === 'retirement:after-tombstone') throw new Error('cutpoint') }))).rejects.toThrow('cutpoint')
  expect(marker![run.id]!.retiredAt).toBeTruthy(); expect(await ledger.list()).toHaveLength(1)
  expect((await retention.plan(0)).candidates).toEqual([])
  await store.close(); const reopened = new WorkbenchStore(root); await reopened.init(); cleanups.push(() => reopened.close())
  marker = JSON.parse(await readFile(path, 'utf8'))
  await expect(reopened.withMutationGate(() => syncBuiltinReferences(reopened, 'workbench:pin', 'other', marker, [], commit))).rejects.toThrow('target mismatch')
  await reopened.withMutationGate(() => syncBuiltinReferences(reopened, 'workbench:suite', 'suite', marker, [], commit))
  expect(await new WorkbenchReferences(reopened).list()).toEqual([])
  expect((await new WorkbenchRetention(reopened).plan(0)).candidates.map(item => item.id)).toContain(run.id)
})

it('rejects missing ledger, mismatched active sets, duplicate targets and corrupt markers', async () => {
  const { store, run, ledger } = await fixture()
  let marker: ReferencePublications = {}
  await store.withMutationGate(() => syncBuiltinReferences(store, 'workbench:suite', 'suite', undefined, [run.id], async value => { marker = value }))
  const refs = new Map((await ledger.list()).map(ref => [ref.refId, ref]))
  expect(() => validateBuiltinReferences(marker, 'workbench:suite', 'suite', [run.id], new Map())).toThrow('missing')
  expect(() => validateBuiltinReferences(marker, 'workbench:suite', 'suite', [], refs)).toThrow('retirement mismatch')
  expect(() => validateBuiltinReferences({}, 'workbench:suite', 'suite', [run.id], refs)).toThrow('missing')
  expect(() => validateBuiltinReferences({ [run.id]: null }, 'workbench:suite', 'suite', [run.id], refs)).toThrow()
  const changed = structuredClone(marker); changed[run.id]!.references[0]!.consumerId = 'other'
  expect(() => validateBuiltinReferences(changed, 'workbench:suite', 'suite', [run.id], refs)).toThrow('target mismatch')
})

it('pin write/revoke failures retain protection, and retry/reactivation preserve owner identity', async () => {
  const { store, run, root, ledger } = await fixture()
  let fail = true
  const retention = new WorkbenchRetention(store, undefined, async phase => { if (fail && phase === 'retirement:after-tombstone') throw new Error('revocation interrupted') })
  await retention.pin(run.id, true)
  const original = (await ledger.list())[0]!
  await retention.pin(run.id, true); expect((await ledger.list())[0]!.refId).toBe(original.refId)
  await expect(retention.pin(run.id, false)).rejects.toThrow('interrupted')
  expect((await retention.plan(0)).candidates).toEqual([])
  fail = false; await retention.pin(run.id, false); expect(await ledger.list()).toEqual([])
  await retention.pin(run.id, true); expect((await ledger.list())[0]!.refId).not.toBe(original.refId)
  const path = join(root, 'references', `${(await ledger.list())[0]!.refId}.json`)
  const bytes = await readFile(path); await rm(path)
  await expect(retention.snapshot()).rejects.toThrow('missing')
  await writeFile(path, bytes)
  expect((await retention.plan(0)).candidates).toEqual([])
})

it('new child references survive trash and restore, and retire only after durable purge, including restart', async () => {
  const { store, root, run, ledger } = await fixture()
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => new MockProvider(0) })
  const workbench = new WorkbenchService(mirror, { store })
  cleanups.push(async () => { await workbench.close(); await mirror.dispose() })
  await mirror.start({ provider: 'mock' })
  const child = await workbench.start('name: Child\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n', run.id)
  await workbench.wait()
  expect(child.referencePublications?.[run.id]).toBeTruthy()
  let fail = true
  const retention = new WorkbenchRetention(store, undefined, async phase => { if (fail && phase === 'retirement:after-tombstone') throw new Error('after child tombstone') })
  expect((await ledger.list()).filter(ref => ref.consumerKind === 'workbench:child')).toHaveLength(1)
  expect((await retention.plan(0)).candidates.map(item => item.id)).toEqual([child.id])
  await retention.confirm(await retention.plan(0)); await retention.restore(child.id)
  expect((await ledger.list()).filter(ref => ref.consumerKind === 'workbench:child')).toHaveLength(1)
  await retention.confirm(await retention.plan(0))
  await expect(retention.purge(child.id, `PURGE ${child.id}`)).rejects.toThrow('tombstone')
  expect(await ledger.list()).toHaveLength(1)
  fail = false; await workbench.close()
  const reopened = new WorkbenchStore(root); await reopened.init(); cleanups.push(() => reopened.close())
  const recovered = new WorkbenchRetention(reopened); await recovered.recover()
  expect(await recovered.purge(child.id, `PURGE ${child.id}`)).toBe(0)
  expect(await new WorkbenchReferences(reopened).list()).toEqual([])
  expect((await recovered.plan(0)).candidates.map(item => item.id)).toEqual([run.id])
})
