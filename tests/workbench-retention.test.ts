import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchRetention } from '../src/workbench-retention.js'
import { WorkbenchStore, type TestRun } from '../src/workbench-store.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { evidenceReferenceSchema, evidenceReferenceReadSchema, operationRecordSchema, operationRecordReadSchema } from '../src/workbench-evidence-contracts.js'

const roots: string[] = [], stores: WorkbenchStore[] = []
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const ids = ['91853cb6-caf3-4f8c-8cf9-5f6ee84aa8d1', '04ca59a4-a493-469f-a7f7-b4aa792e7ed7', '9ebf76d6-d247-4721-b09d-2559a28bdb19']
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-retention-')); roots.push(root)
  const store = new WorkbenchStore(root); stores.push(store); await store.init()
  const now = '2024-01-01T00:00:00.000Z'
  for (const [index, id] of ids.entries()) {
    const evidence = await store.put(id!, 'flow.yaml', `name: fixture-${index}`, 'text/yaml; charset=utf-8')
    const run: TestRun = { schemaVersion: 1, id: id!, ...(index === 1 ? { parentRunId: ids[0] } : {}), name: `fixture-${index}`, yaml: `name: fixture-${index}`, engine: 'fixture', phase: 'finished', verdict: 'fail',
      startedAt: now, endedAt: now, sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
      steps: [], evidence: [evidence], cleanup: 'session-retained' }
    await store.save(run)
  }
  return { root, store, retention: new WorkbenchRetention(store) }
}

describe('reference-aware recoverable retention', () => {
  it('protects child/pin/lease references, rejects stale plans, and restores without overwrite', async () => {
    const { root, store, retention } = await fixture()
    await retention.pin(ids[2]!, true)
    const plan = await retention.plan(30)
    expect(plan.candidates.map(item => item.id)).toEqual([ids[1]])
    expect(plan.protected).toEqual(expect.arrayContaining([{ id: ids[0], reasons: ['child-run'] }, { id: ids[2], reasons: ['pin'] }]))
    const release = await store.lease([ids[1]!])
    await expect(retention.confirm(plan)).rejects.toThrow(/stale/)
    release()
    const fresh = await retention.plan(30)
    expect(fresh.physicallyFreedBytes).toBe(0)
    const moved = await retention.confirm(fresh)
    expect(moved.moved).toEqual([ids[1]])
    expect(moved.physicallyFreedBytes).toBe(0)
    expect((await retention.snapshot()).trash).toMatchObject([{ id: ids[1], state: 'trashed' }])
    await expect(retention.restore(ids[1]!)).resolves.toBeUndefined()
    expect((await store.get(ids[1]!)).name).toBe('fixture-1')
    await expect(retention.restore(ids[1]!)).rejects.toThrow(/not in recoverable trash/)
    expect((await readFile(join(root, ids[1]!, 'flow.yaml'), 'utf8'))).toBe('name: fixture-1')
  })

  it('purges only a specifically confirmed trash identity while keeping journals', async () => {
    const { root, store, retention } = await fixture()
    await retention.pin(ids[2]!, true)
    const plan = await retention.plan(30)
    await retention.confirm(plan)
    await expect(retention.purge(ids[1]!, 'PURGE')).rejects.toThrow(/confirmation/)
    const freed = await retention.purge(ids[1]!, `PURGE ${ids[1]}`)
    expect(freed).toBeGreaterThan(0)
    expect((await retention.snapshot()).trash).toEqual([])
    expect((await readFile(join(root, 'retention', 'journals', `${ids[1]}.json`), 'utf8'))).toContain('purged')
    expect((await store.get(ids[0]!)).name).toBe('fixture-0')
  })

  it('refuses purge when a late durable reference names a trashed identity', async () => {
    const { root, retention } = await fixture()
    const target = ids[1]!
    await retention.confirm(await retention.plan(30))
    await mkdir(join(root, 'shares'))
    await writeFile(join(root, 'shares', '3dc337b1-7c6d-4719-9996-1992983b66d7.json'), JSON.stringify({ sourceRunId: target }))
    await expect(retention.purge(target, `PURGE ${target}`)).rejects.toThrow(/referenced or leased/)
    expect(await exists(join(root, 'retention', 'trash', target))).toBe(true)
  })

  it('fails closed on new external references, unsafe entries and unreadable indexes', async () => {
    const { root, retention } = await fixture()
    const plan = await retention.plan(30)
    await mkdir(join(root, 'agent-executions'))
    await writeFile(join(root, 'agent-executions', '3dc337b1-7c6d-4719-9996-1992983b66d7.json'), JSON.stringify({ schemaVersion: 1,
      requestKey: 'a'.repeat(64), requestHash: 'b'.repeat(64), phase: 'finished', runId: ids[1] }))
    await expect(retention.confirm(plan)).rejects.toThrow(/stale/)
    const second = await retention.plan(30)
    expect(second.protected).toEqual(expect.arrayContaining([{ id: ids[1], reasons: ['agent-request'] }]))
    await writeFile(join(root, 'agent-executions', '3dc337b1-7c6d-4719-9996-1992983b66d7.json'), JSON.stringify({ schemaVersion: 1,
      requestKey: 'a'.repeat(64), requestHash: 'b'.repeat(64), phase: 'finished', runId: ids[1],
      summary: { resultProjection: { contractVersion: 1, runId: ids[0], evidenceAvailability: 'verified',
        verification: { evidence: { status: 'pass' } }, clean: false, verdict: 'fail' } } }))
    expect((await retention.plan(30)).protected).toEqual(expect.arrayContaining([{ id: ids[1], reasons: ['agent-request'] }]))
    await symlink(join(root, ids[0]!, 'flow.yaml'), join(root, ids[2]!, 'unsafe.txt'))
    const third = await retention.plan(30)
    expect(third.protected.find(item => item.id === ids[2])?.reasons).toContain('unsafe-directory-entry')
    await writeFile(join(root, 'agent-executions', '3dc337b1-7c6d-4719-9996-1992983b66d7.json'), '{')
    await expect(retention.plan(30)).rejects.toThrow()
    expect((await readFile(join(root, ids[1]!, 'flow.yaml'), 'utf8'))).toBe('name: fixture-1')
  })

  it('atomically publishes an immutable source reference and protects it from cleanup', async () => {
    const { root, store, retention } = await fixture()
    const registry = new WorkbenchReferences(store)
    const source = await store.readOnlySnapshot(ids[1]!)
    const reference = { contractVersion: 1 as const, refId: '11111111-1111-4111-8111-111111111111',
      consumerKind: 'baseline' as const, consumerId: 'home-screen', revision: 1,
      targetRunId: ids[1]!, evidenceRefs: ['flow.yaml'], sourceHash: source.manifestSha256,
      createdAt: new Date().toISOString() }
    await registry.publish(reference)
    await expect(registry.publish(reference)).resolves.toMatchObject(reference)
    expect((await retention.plan(30)).protected).toEqual(expect.arrayContaining([{ id: ids[1], reasons: ['baseline'] }]))
    await expect(registry.publish({ ...reference, refId: '22222222-2222-4222-8222-222222222222', sourceHash: '0'.repeat(64) })).rejects.toThrow(/source changed/)
    await writeFile(join(root, 'references', `${reference.refId}.json`), '{')
    await expect(retention.plan(30)).rejects.toThrow()
  })

  it.each(['baseline', 'share-map', 'pin', 'read-lease'] as const)('rejects a stale plan after a %s protection appears', async kind => {
    const { root, store, retention } = await fixture()
    const target = ids[1]!
    const plan = await retention.plan(30)
    let release: (() => void) | undefined
    if (kind === 'pin') await retention.pin(target, true)
    else if (kind === 'read-lease') release = await store.lease([target], 'retention-race-test')
    else {
      const source = await store.readOnlySnapshot(target)
      await new WorkbenchReferences(store).publish({ contractVersion: 1, refId: kind === 'baseline'
        ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
      consumerKind: kind, consumerId: `retention-${kind}`, targetRunId: target, evidenceRefs: ['flow.yaml'],
      sourceHash: source.manifestSha256, createdAt: new Date().toISOString() })
    }
    try {
      await expect(retention.confirm(plan)).rejects.toThrow(/stale|reference|lease/)
      expect(await exists(join(root, target))).toBe(true)
      expect(await exists(join(root, 'retention', 'trash', target))).toBe(false)
    } finally { release?.() }
  })

  it('serializes a new reader behind cleanup commit, so it cannot lease a moved identity', async () => {
    const { root, store } = await fixture()
    let entered!: () => void, resume!: () => void
    const atCutpoint = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { resume = resolve })
    const retention = new WorkbenchRetention(store, () => null, async point => {
      if (point === 'move:before-intent') { entered(); await gate }
    })
    const plan = await retention.plan(30)
    const moving = retention.confirm(plan)
    await atCutpoint
    let readerSettled = false
    const reader = store.lease([ids[1]!], 'reader-after-cleanup').finally(() => { readerSettled = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(readerSettled).toBe(false)
    resume()
    expect((await moving).moved).toContain(ids[1])
    await expect(reader).rejects.toThrow(/directory|ENOENT|run/i)
    expect(await exists(join(root, 'retention', 'trash', ids[1]!))).toBe(true)
  })

  it('invalidates a preview across store ownership and rejects a path replacement', async () => {
    const { root, store, retention } = await fixture()
    const stale = await retention.plan(30)
    await store.close(); stores.splice(stores.indexOf(store), 1)
    const restarted = new WorkbenchStore(root); stores.push(restarted); await restarted.init()
    const next = new WorkbenchRetention(restarted)
    await expect(next.confirm(stale)).rejects.toThrow(/expired|previewed/)
    const current = await next.plan(30)
    const target = ids[1]!
    await symlink(join(root, ids[0]!, 'flow.yaml'), join(root, target, 'replaced.txt'))
    await expect(next.confirm(current)).rejects.toThrow(/coverage incomplete|stale/)
    expect(await exists(join(root, 'retention', 'trash', target))).toBe(false)
  })

  it('dual-reads v1/v2 references while old and future readers fail closed', async () => {
    const { root, store, retention } = await fixture()
    const source = await store.readOnlySnapshot(ids[1]!)
    const ref = { contractVersion: 2 as const, refId: '37f7ea4e-9765-488b-a046-c03b66c0f447', consumerKind: 'triage' as const,
      consumerId: '37f7ea4e-9765-488b-a046-c03b66c0f447', targetRunId: ids[1]!, evidenceRefs: ['flow.yaml'],
      sourceHash: source.manifestSha256, createdAt: new Date().toISOString() }
    expect(evidenceReferenceSchema.safeParse(ref).success).toBe(false)
    expect(evidenceReferenceReadSchema.parse(ref).contractVersion).toBe(2)
    const operation = { contractVersion: 2, kind: 'triage', jobId: ref.refId, requestDigest: '0'.repeat(64),
      ownerGeneration: ref.refId, phase: 'queued', progress: 'queued', createdAt: ref.createdAt }
    expect(operationRecordSchema.safeParse(operation).success).toBe(false)
    expect(operationRecordReadSchema.parse(operation).kind).toBe('triage')
    expect(operationRecordReadSchema.safeParse({ ...operation, contractVersion: 3 }).success).toBe(false)
    const registry = new WorkbenchReferences(store)
    await expect(registry.publish({ ...ref, contractVersion: 3 } as never)).rejects.toThrow()
    await registry.publish(ref)
    expect((await retention.plan(30)).protected.find(item => item.id === ids[1])?.reasons).toContain('triage')
    const future = { ...ref, contractVersion: 3, refId: '1502bd28-d6ca-4285-a44e-0790a16ae30c' }
    await writeFile(join(root, 'references', `${future.refId}.json`), JSON.stringify(future))
    await expect(retention.plan(30)).rejects.toThrow()
    await expect(new WorkbenchReferences(store).list()).rejects.toThrow()
    expect((await readFile(join(root, ids[1]!, 'flow.yaml'), 'utf8'))).toContain('fixture-1')
  })

  it('reconciles interrupted move and restore from the journal and filesystem', async () => {
    const { root, store, retention } = await fixture()
    const target = ids[1]!
    const plan = await retention.plan(30)
    const journalPath = join(root, 'retention', 'journals', `${target}.json`)
    await retention.confirm(plan)
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    await writeFile(journalPath, JSON.stringify({ ...journal, state: 'restore-intent' }))
    await rename(join(root, 'retention', 'trash', target), join(root, target))
    await new WorkbenchRetention(store).recover()
    expect(JSON.parse(await readFile(journalPath, 'utf8')).state).toBe('restored')

    await writeFile(journalPath, JSON.stringify({ ...journal, state: 'moving' }))
    const restarted = new WorkbenchRetention(store)
    await restarted.recover()
    expect(JSON.parse(await readFile(journalPath, 'utf8')).state).toBe('move-interrupted')
    expect((await restarted.plan(30)).protected).toEqual(expect.arrayContaining([{ id: target, reasons: ['lifecycle-interrupted'] }]))
  })

  it('keeps an interrupted purge visible and requires a fresh explicit confirmation', async () => {
    const { root, store, retention } = await fixture()
    const target = ids[1]!
    await retention.confirm(await retention.plan(30))
    const journalPath = join(root, 'retention', 'journals', `${target}.json`)
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    await writeFile(journalPath, JSON.stringify({ ...journal, state: 'purge-intent' }))
    const restarted = new WorkbenchRetention(store)
    await restarted.recover()
    expect(JSON.parse(await readFile(journalPath, 'utf8')).state).toBe('purge-interrupted')
    expect((await restarted.snapshot()).trash).toEqual(expect.arrayContaining([expect.objectContaining({ id: target, state: 'interrupted' })]))
    await expect(restarted.purge(target, 'PURGE')).rejects.toThrow(/confirmation/)
    await expect(restarted.purge(target, `PURGE ${target}`)).resolves.toBeGreaterThan(0)
  })

  it('refuses cleanup when a directory exceeds the versioned scan depth', async () => {
    const { root, retention } = await fixture()
    await mkdir(join(root, ids[1]!, ...Array.from({ length: 9 }, (_, index) => `level-${index}`)), { recursive: true })
    await expect(retention.plan(30)).rejects.toThrow(/coverage incomplete/)
    expect(await readFile(join(root, ids[1]!, 'flow.yaml'), 'utf8')).toBe('name: fixture-1')
  })

  it('reports a committed first move, refused EXDEV second move, and no copy/delete fallback', async () => {
    const { root, store } = await fixture()
    let seen = 0
    const retention = new WorkbenchRetention(store, () => null, async point => {
      if (point === 'move:before-rename' && ++seen === 2) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
    })
    const result = await retention.confirm(await retention.plan(30))
    expect(result.moved).toEqual([ids[1]])
    expect(result.failed).toEqual([{ id: ids[2], reason: 'cross-device-rename-refused' }])
    expect(await exists(join(root, 'retention', 'trash', ids[1]!))).toBe(true)
    expect(await exists(join(root, ids[2]!))).toBe(true)
    expect(await exists(join(root, 'retention', 'trash', ids[2]!))).toBe(false)
    await retention.recover()
    expect((await retention.plan(30)).protected).toEqual(expect.arrayContaining([{ id: ids[2], reasons: ['lifecycle-interrupted'] }]))
  })

  it('keeps a trashed child parent protected after purge removes the child manifest', async () => {
    const { root, store, retention } = await fixture()
    await retention.pin(ids[2]!, true)
    await retention.confirm(await retention.plan(30))
    let deleted = 0
    const interrupted = new WorkbenchRetention(store, () => null, async point => { if (point === 'purge:after-unlink' && ++deleted === 2) throw new Error('fixture interrupted purge') })
    await expect(interrupted.purge(ids[1]!, `PURGE ${ids[1]}`)).rejects.toThrow(/fixture interrupted/)
    expect(await exists(join(root, 'retention', 'trash', ids[1]!, 'manifest.json'))).toBe(false)
    const recovery = new WorkbenchRetention(store); await recovery.recover()
    expect((await recovery.plan(30)).protected.find(item => item.id === ids[0])?.reasons).toContain('trashed-child')
  })

  it.each(['both', 'neither', 'hash'])('protects ambiguous move recovery with %s filesystem state', async state => {
    const { root, store, retention } = await fixture()
    await retention.pin(ids[2]!, true)
    await retention.confirm(await retention.plan(30))
    const target = ids[1]!, trashPath = join(root, 'retention', 'trash', target)
    const journalPath = join(root, 'retention', 'journals', `${target}.json`)
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    await writeFile(journalPath, JSON.stringify({ ...journal, state: 'moving' }))
    if (state === 'both') await mkdir(join(root, target))
    if (state === 'neither') await rm(trashPath, { recursive: true })
    if (state === 'hash') await writeFile(join(trashPath, 'manifest.json'), '{}')
    await new WorkbenchRetention(store).recover()
    expect(JSON.parse(await readFile(journalPath, 'utf8')).state).toBe('recovery-required')
    if (state === 'hash') await expect(new WorkbenchRetention(store).purge(target, `PURGE ${target}`)).rejects.toThrow(/not in trash/)
  })

  it.each(['move:before-intent', 'move:after-intent', 'move:before-rename', 'move:after-rename', 'move:before-fsync', 'move:after-fsync', 'move:before-commit', 'move:after-commit'])('recovers a SIGKILL at %s without losing a run', async cutpoint => {
    const { root, store } = await fixture()
    await store.close(); stores.splice(stores.indexOf(store), 1)
    await killAt(root, 'move', ids[1]!, cutpoint)
    const restarted = new WorkbenchStore(root); stores.push(restarted); await restarted.init()
    const retention = new WorkbenchRetention(restarted)
    await retention.recover()
    const live = await exists(join(root, ids[1]!)), trash = await exists(join(root, 'retention', 'trash', ids[1]!))
    expect(Number(live) + Number(trash)).toBe(1)
    if (live) expect((await restarted.get(ids[1]!)).name).toBe('fixture-1')
    else expect((await retention.snapshot()).trash).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids[1] })]))
  })

  it.each(['restore:before-intent', 'restore:after-intent', 'restore:before-rename', 'restore:after-rename', 'restore:before-fsync', 'restore:after-fsync', 'restore:before-commit', 'restore:after-commit'])('recovers a SIGKILL at %s without overwriting an identity', async cutpoint => {
    const { root, store, retention } = await fixture()
    await retention.confirm(await retention.plan(30))
    await store.close(); stores.splice(stores.indexOf(store), 1)
    await killAt(root, 'restore', ids[1]!, cutpoint)
    const restarted = new WorkbenchStore(root); stores.push(restarted); await restarted.init()
    const recovery = new WorkbenchRetention(restarted); await recovery.recover()
    const live = await exists(join(root, ids[1]!)), trash = await exists(join(root, 'retention', 'trash', ids[1]!))
    expect(Number(live) + Number(trash)).toBe(1)
  })

  it.each(['purge:before-intent', 'purge:after-intent', 'purge:before-unlink', 'purge:after-unlink', 'purge:before-file-commit', 'purge:after-file-commit', 'purge:before-root-remove', 'purge:after-root-remove', 'purge:after-fsync', 'purge:before-commit', 'purge:after-commit'])('requires re-confirmation after a SIGKILL at %s', async cutpoint => {
    const { root, store, retention } = await fixture()
    await retention.confirm(await retention.plan(30))
    await store.close(); stores.splice(stores.indexOf(store), 1)
    await killAt(root, 'purge', ids[1]!, cutpoint)
    const restarted = new WorkbenchStore(root); stores.push(restarted); await restarted.init()
    const recovery = new WorkbenchRetention(restarted); await recovery.recover()
    const journal = JSON.parse(await readFile(join(root, 'retention', 'journals', `${ids[1]}.json`), 'utf8'))
    expect(['trashed', 'purge-interrupted', 'purged']).toContain(journal.state)
    if (journal.state === 'purge-interrupted' || journal.state === 'trashed') {
      if (journal.state === 'purge-interrupted') { expect(journal.purgeAuthorizedAt).toBeTruthy(); expect(journal.purgeInventorySha256).toMatch(/^[a-f0-9]{64}$/); expect(Array.isArray(journal.purgeRemaining)).toBe(true) }
      await expect(recovery.purge(ids[1]!, 'PURGE')).rejects.toThrow(/confirmation/)
      await expect(recovery.purge(ids[1]!, `PURGE ${ids[1]}`)).resolves.toBeGreaterThanOrEqual(0)
    }
    expect(await exists(join(root, 'retention', 'trash', ids[1]!))).toBe(false)
  })
})

async function exists(path: string): Promise<boolean> { try { await import('node:fs/promises').then(fs => fs.lstat(path)); return true } catch { return false } }
async function killAt(root: string, action: string, target: string, cutpoint: string): Promise<void> {
  const child = spawn(process.execPath, ['--import', 'tsx', join(process.cwd(), 'tests/fixtures/workbench-retention-kill-child.ts'), root, action, target, cutpoint], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const reached = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Timed out at ${cutpoint}: ${output}`)) }, 15_000)
    child.stdout.on('data', (bytes: Buffer) => { output += bytes.toString(); if (output.includes(`CUTPOINT ${cutpoint}`)) { clearTimeout(timer); resolve() } })
    child.stderr.on('data', (bytes: Buffer) => { output += bytes.toString() })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Child exited at ${cutpoint} (${code}): ${output}`)) })
  })
  await reached
  child.kill('SIGKILL')
  await new Promise<void>(resolve => child.once('close', () => resolve()))
}
