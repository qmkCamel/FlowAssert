import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchStore, sha256 } from '../src/workbench-store.js'
import { WorkbenchAcceptance, type AcceptanceIdentity, type AcceptanceChannel, type AcceptanceWritePoint } from '../src/workbench-acceptance.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function journal(): AcceptanceIdentity { return { executionId: randomUUID(), requestKey: sha256('request'), requestHash: sha256('input'), phase: 'accepted' } }
async function fixture(available = Number.MAX_SAFE_INTEGER) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-acceptance-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const store = new WorkbenchStore(root, async () => available), service = new WorkbenchAcceptance(store)
  cleanups.push(() => store.close()); cleanups.push(() => service.close())
  return { root, store, service }
}
function channel(service: WorkbenchAcceptance, name: 'agent' | 'authoring', writeHook?: (point: AcceptanceWritePoint) => void) {
  let value: AcceptanceChannel<AcceptanceIdentity>
  value = service.channel(name, {
    parse: input => input as AcceptanceIdentity,
    recover: async entry => { entry.phase = 'finished'; await value.persist(entry) },
    drain: async () => {}, ...(writeHook ? { writeHook } : {}),
  })
  return value
}

describe('shared durable acceptance', () => {
  it('is lazy and isolates namespaces without assigning device ownership', async () => {
    const { root, service } = await fixture()
    const agent = channel(service, 'agent'), authoring = channel(service, 'authoring')
    expect(await readdir(root)).toEqual([])
    await Promise.all([agent.init(), authoring.init()])
    const a = journal(), b = { ...a, executionId: randomUUID(), requestHash: sha256('viewer input') }
    await agent.persist(a); agent.remember(a)
    await authoring.persist(b); authoring.remember(b)
    expect(agent.lookup(a.requestKey, a.requestHash)?.executionId).toBe(a.executionId)
    expect(authoring.lookup(b.requestKey, b.requestHash)?.executionId).toBe(b.executionId)
    expect(agent.records.has(b.executionId)).toBe(false)
    expect(authoring.records.has(a.executionId)).toBe(false)
    expect(() => agent.lookup(a.requestKey, b.requestHash)).toThrow('acceptance-request-conflict')
    expect(() => channel(service, 'agent')).toThrow('acceptance-channel-owned')
  })

  it.each(['temporary-synced', 'renamed', 'directory-synced'] as const)('fences uncertain %s responses and only recovers durable facts', async point => {
    const { root, store, service } = await fixture()
    let once = false
    const original = channel(service, 'authoring', current => { if (!once && current === point) { once = true; throw new Error('injected') } })
    await original.init()
    const input = journal()
    await expect(original.persist(input)).rejects.toThrow('injected')
    expect(() => original.lookup(input.requestKey, input.requestHash)).toThrow('acceptance-outcome-unknown')
    await service.close(); await store.close()
    const restartedStore = new WorkbenchStore(root), restarted = new WorkbenchAcceptance(restartedStore)
    cleanups.push(() => restartedStore.close()); cleanups.push(() => restarted.close())
    const restored = channel(restarted, 'authoring'); await restored.init()
    if (point === 'temporary-synced') expect(restored.lookup(input.requestKey, input.requestHash)).toBeUndefined()
    else expect(restored.lookup(input.requestKey, input.requestHash)).toMatchObject({ executionId: input.executionId, phase: 'finished' })
  })

  it('rejects insufficient or unknown capacity without publishing acceptance', async () => {
    for (const available of [256 * 1024 * 1024, NaN]) {
      const { root, service } = await fixture(available), scope = channel(service, 'authoring')
      await scope.init()
      await expect(scope.persist(journal())).rejects.toThrow(/storage-(insufficient|capacity-unknown)/)
      expect(await readdir(join(root, 'authoring-executions'))).toEqual([])
    }
  })

  it('rejects symlink journals without following or overwriting their target', async () => {
    const { root, service } = await fixture(), scope = channel(service, 'authoring')
    await scope.init()
    const input = journal(), outside = join(root, 'outside.json')
    await writeFile(outside, 'untouched')
    await symlink(outside, join(root, 'authoring-executions', `${input.executionId}.json`))
    await expect(scope.persist(input)).rejects.toThrow('acceptance-unsafe-journal')
    expect(await readFile(outside, 'utf8')).toBe('untouched')
  })

  it('keeps existing identities queryable at the entry budget', async () => {
    const { service } = await fixture()
    const scope = service.channel('authoring', { parse: input => input as AcceptanceIdentity, recover: async () => {}, drain: async () => {}, maxEntries: 1 })
    await scope.init()
    const input = journal(); await scope.persist(input); scope.remember(input)
    await expect(scope.persist({ ...input, executionId: randomUUID(), requestKey: sha256('second') })).rejects.toThrow('acceptance-entry-budget')
    expect(scope.lookup(input.requestKey, input.requestHash)).toBe(input)
    input.phase = 'finished'; await scope.persist(input)
  })

  it('serializes requests, rejects queued work at close, and drains once', async () => {
    const { service } = await fixture(), drain = vi.fn(async () => {})
    const scope = service.channel('authoring', { parse: input => input as AcceptanceIdentity, recover: async () => {}, drain })
    let unblock!: () => void
    const gate = new Promise<void>(resolve => { unblock = resolve })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const first = scope.serialized(async () => { entered(); await gate; scope.assertAccepting() })
    const firstRejected = expect(first).rejects.toThrow('acceptance-closed')
    await started
    const next = vi.fn(async () => {})
    const secondRejected = expect(scope.serialized(next)).rejects.toThrow('acceptance-closed')
    const closing = service.close(); unblock()
    await Promise.all([firstRejected, secondRejected, closing, service.close()])
    expect(next).not.toHaveBeenCalled(); expect(drain).toHaveBeenCalledTimes(1)
    await expect(scope.serialized(next)).rejects.toThrow('acceptance-closed')
  })
})
