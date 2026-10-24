import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchComparisonService } from '../src/workbench-comparison.js'
import { runComparisonWorker } from '../src/workbench-comparison-worker.js'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'
import { Config } from '../src/config.js'
import type { TestRun } from '../src/workbench-domain.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const reply = { ok: true, result: { report: { steps: [], classifications: [], limitations: [], partial: false }, artifacts: [] } }
function fakeWorker(reject = false) {
  const gate = deferred()
  const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => {
    if (reject) throw new Error('synthetic termination failure')
    await gate.promise; worker.emit('exit', 1); return 1
  }) })
  return { worker, exit: () => { gate.resolve(); if (reject) worker.emit('exit', 1) }, factory: () => worker as unknown as Worker }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-comparison-lifecycle-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const store = new WorkbenchStore(root); await store.init(); cleanups.push(() => store.close())
  const runs: TestRun[] = []
  for (let i = 0; i < 2; i++) {
    const run: TestRun = { schemaVersion: 1, id: randomUUID(), name: 'Lifecycle fixture', yaml: '', engine: 'fixture', phase: 'finished', verdict: 'pass',
      startedAt: '2026-01-01T00:00:00.000Z', sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock',
      verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed', cleanup: 'session-retained', steps: [], evidence: [],
      comparison: { contractVersion: 1, logicalTestKey: 'same', inputDigest: 'same', inputKeyId: 'same', planDigest: 'same',
        executionContext: { platform: 'ios', provider: 'mock', deviceName: 'fixture', os: 'test', runtime: 'test', viewport: '1x1' },
        appContext: { appId: 'fixture.app', version: 'unknown', build: 'unknown' }, implementationDigest: 'same' } }
    await store.save(run); runs.push(run)
  }
  const ids = [runs[0]!.id, runs[1]!.id] as const
  const before = await Promise.all(ids.map(id => readFile(join(root, id, 'manifest.json'))))
  return { root, store, ids, unchanged: async () => expect(await Promise.all(ids.map(id => readFile(join(root, id, 'manifest.json'))))).toEqual(before) }
}

it('close waits for running Worker exit, cancels queued work, ignores late results and preserves refs', async () => {
  const { store, ids, unchanged } = await fixture(), fake = fakeWorker()
  const service = new WorkbenchComparisonService(store, undefined, fake.factory)
  cleanups.push(async () => { fake.exit(); await service.close() })
  const first = await service.start(...ids), second = await service.start(...ids, { slowerByMs: 2 })
  await vi.waitFor(() => expect(fake.worker.listenerCount('message')).toBe(1))
  const late = fake.worker.listeners('message')[0]!
  const closing = service.close(); expect(service.close()).toBe(closing)
  let closed = false; void closing.then(() => { closed = true })
  await vi.waitFor(() => expect(fake.worker.terminate).toHaveBeenCalledOnce())
  await expect(service.start(...ids)).rejects.toThrow('closed')
  expect(closed).toBe(false); expect(store.hasReadLease(ids[0])).toBe(true)
  late(reply); fake.exit(); await closing
  expect((await service.get(first.id)).state).toBe('cancelled')
  expect((await service.get(second.id)).state).toBe('cancelled')
  expect(store.hasReadLease(ids[0])).toBe(false)
  expect(await new WorkbenchReferences(store).list()).toHaveLength(4)
  expect(fake.worker.listenerCount('message')).toBe(0)
  await unchanged()
})

it('close tracks admission blocked after publication and refuses waiting/new requests', async () => {
  const { store, ids } = await fixture(), gate = deferred(), entered = deferred(), fake = fakeWorker()
  const service = new WorkbenchComparisonService(store, async name => { if (name === 'publication:after-reference') { entered.resolve(); await gate.promise } }, fake.factory)
  const starting = service.start(...ids); await entered.promise
  const waiting = service.start(...ids, { slowerByMs: 3 }), rejected = expect(waiting).rejects.toThrow('closed')
  const closing = service.close(); let closed = false; void closing.then(() => { closed = true })
  await Promise.resolve(); expect(closed).toBe(false)
  gate.resolve(); const accepted = await starting; await rejected; await closing
  expect((await service.get(accepted.id)).state).toBe('cancelled')
  expect(fake.worker.terminate).not.toHaveBeenCalled()
})

it('keeps lease on rejected termination until actual exit, then reports close failure', async () => {
  const { store, ids } = await fixture(), fake = fakeWorker(true)
  const service = new WorkbenchComparisonService(store, undefined, fake.factory)
  const first = await service.start(...ids)
  await vi.waitFor(() => expect(fake.worker.listenerCount('message')).toBe(1))
  const closing = service.close(), failure = expect(closing).rejects.toThrow('Comparison cleanup failed')
  await vi.waitFor(() => expect(fake.worker.terminate).toHaveBeenCalledOnce())
  expect(store.hasReadLease(ids[0])).toBe(true)
  fake.exit(); await failure
  expect(store.hasReadLease(ids[0])).toBe(false)
  expect((await service.get(first.id)).error).toContain('termination failed')
  expect(service.close()).toBe(closing)
})

it('surfaces terminal write failures, releases runtime resources and recovers with a new owner', async () => {
  const { root, store, ids, unchanged } = await fixture(), fake = fakeWorker()
  const service = new WorkbenchComparisonService(store, async name => { if (name === 'report:before-cancelled') throw new Error('ENOSPC injected') }, fake.factory)
  const first = await service.start(...ids), queued = await service.start(...ids, { slowerByMs: 4 })
  await vi.waitFor(() => expect(fake.worker.listenerCount('message')).toBe(1))
  const closing = service.close(), failure = expect(closing).rejects.toThrow('cleanup failed')
  fake.exit(); await failure
  expect(store.hasReadLease(ids[0])).toBe(false)
  expect((await service.get(first.id)).state).toBe('running')
  const previousOwner = store.ownerGeneration; await store.close()
  const reopened = new WorkbenchStore(root); await reopened.init(); cleanups.push(() => reopened.close())
  expect(reopened.ownerGeneration).not.toBe(previousOwner)
  const recovering = new WorkbenchComparisonService(reopened, async name => { if (name === 'report:before-interrupted') throw new Error('recovery write failed') })
  await expect(recovering.init()).rejects.toThrow('recovery write failed')
  const recovered = new WorkbenchComparisonService(reopened); await recovered.init(); await recovered.close()
  expect((await recovered.get(first.id)).state).toBe('interrupted')
  expect((await recovered.get(queued.id)).state).toBe('interrupted')
  expect(await new WorkbenchReferences(reopened).list()).toHaveLength(4)
  await unchanged()
})

it('application waits for comparison before releasing owner, even if another closer fails', async () => {
  const { root, store } = await fixture(); await store.close()
  const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0 } as Config), { workbenchRoot: root })
  await runtime.application.workbench.store.init()
  const gate = deferred()
  vi.spyOn(runtime.application.comparisons, 'close').mockImplementation(() => gate.promise)
  vi.spyOn(runtime.application.shareJobs, 'close').mockRejectedValue(new Error('share failure'))
  const closing = runtime.close(), failure = expect(closing).rejects.toThrow('Runtime cleanup failed')
  const contender = new WorkbenchStore(root)
  await expect(contender.init()).rejects.toThrow('owns this evidence directory')
  gate.resolve(); await failure
  const reopened = new WorkbenchStore(root); await reopened.init(); await reopened.close()
})

it.each(['success', 'error', 'exit', 'timeout'] as const)('awaits exit on Worker %s', async kind => {
  const fake = fakeWorker(), abort = new AbortController()
  const pending = runComparisonWorker({}, abort.signal, fake.factory, kind === 'timeout' ? 1 : 1000)
  const expected = kind === 'success' ? expect(pending).resolves.toEqual(reply.result) : expect(pending).rejects.toThrow()
  if (kind === 'success') fake.worker.emit('message', reply)
  if (kind === 'error') fake.worker.emit('error', new Error('worker failed'))
  if (kind === 'exit') fake.worker.emit('exit', 0)
  else { await vi.waitFor(() => expect(fake.worker.terminate).toHaveBeenCalledOnce()); fake.exit() }
  await expected; expect(fake.worker.listenerCount('message')).toBe(0)
})

it('does not create an already-cancelled Worker and awaits a real Node Worker shutdown', async () => {
  const abort = new AbortController(); abort.abort(new Error('cancelled'))
  const factory = vi.fn(); await expect(runComparisonWorker({}, abort.signal, factory)).rejects.toThrow('cancelled'); expect(factory).not.toHaveBeenCalled()
  const live = new AbortController(); let worker!: Worker
  const pending = runComparisonWorker({}, live.signal, () => worker = new Worker('setInterval(() => {}, 1000)', { eval: true }))
  const rejected = expect(pending).rejects.toThrow('cancelled')
  live.abort(new Error('cancelled')); await rejected; expect(worker.threadId).toBe(-1)
})
