import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, type Config as MirrorConfig } from '../src/config.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'
import { WorkbenchStore, sha256 } from '../src/workbench-store.js'
import type { TestRun } from '../src/workbench-domain.js'
import { WorkbenchComparisonService, stableJson } from '../src/workbench-comparison.js'
import { WorkbenchTriageService } from '../src/workbench-triage-service.js'
import { defaultTriageAnalyzer, TriageAnalyzerRunner, type TriageAnalyzer } from '../src/workbench-triage-analyzer.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'
import { WorkbenchShareJobs } from '../src/workbench-share-jobs.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const analyzer = (config: Record<string, unknown> = {}): TriageAnalyzer => ({ id: 'example.analyzer', version: '2.0.0',
  moduleUrl: new URL('./fixtures/triage-extension.mjs', import.meta.url), config })
function run(): TestRun {
  return { schemaVersion: 1, id: randomUUID(), name: 'Extension fixture', yaml: 'fixture', engine: 'fixture',
    phase: 'finished', verdict: 'fail', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z',
    sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions',
    visualVerification: 'not-performed', businessVerification: 'fail', cleanup: 'session-retained', steps: [], evidence: [] }
}
async function fixture(selected: TriageAnalyzer | null = analyzer()) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-modules-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const store = new WorkbenchStore(root); await store.init()
  cleanups.push(() => store.close())
  const input = run(); await store.save(input)
  const service = new WorkbenchTriageService(store, new WorkbenchComparisonService(store), { analyzer: selected })
  cleanups.push(() => service.close())
  return { root, store, input, service }
}
async function waitFor(service: WorkbenchTriageService, id: string, states: string[]) {
  await vi.waitFor(async () => expect(states).toContain((await service.getJob(id)).state), { timeout: 4000, interval: 10 })
  return service.getJob(id)
}

describe('plugin-friendly composition', () => {
  it('shares all services and drains background work before store and device disposal', async () => {
    const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0 } as MirrorConfig))
    cleanups.push(() => runtime.close())
    expect(runtime.viewer.application).toBe(runtime.application)
    expect(runtime.coordinator.application).toBe(runtime.application)
    expect(runtime.viewer.triage).toBe(runtime.coordinator.triage)
    expect(runtime.viewer.shareJobs).toBe(runtime.application.shareJobs)
    const order: string[] = []
    vi.spyOn(runtime.application.triage, 'close').mockImplementation(async () => { order.push('triage') })
    vi.spyOn(runtime.application.shareJobs, 'close').mockImplementation(async () => { order.push('share') })
    vi.spyOn(runtime.application.comparisons, 'close').mockImplementation(async () => { order.push('comparison') })
    vi.spyOn(runtime.application.suites, 'close').mockImplementation(async () => { order.push('suite') })
    vi.spyOn(runtime.application.workbench, 'close').mockImplementation(async () => { order.push('store') })
    vi.spyOn(runtime.service, 'dispose').mockImplementation(async () => { order.push('device') })
    await Promise.all([runtime.close(), runtime.close()])
    expect(order).toEqual(['triage', 'share', 'comparison', 'suite', 'store', 'device'])
  })

  it('continues cleanup after a component fails and reports the failure', async () => {
    const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0 } as MirrorConfig))
    const dispose = vi.spyOn(runtime.service, 'dispose')
    vi.spyOn(runtime.application.shareJobs, 'close').mockRejectedValue(new Error('synthetic-close-failure'))
    await expect(runtime.close()).rejects.toThrow('Runtime cleanup failed')
    await expect(runtime.close()).rejects.toThrow('Runtime cleanup failed')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('rolls back resources on listener startup failure', async () => {
    const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0 } as MirrorConfig))
    const close = vi.spyOn(runtime.application, 'close')
    const dispose = vi.spyOn(runtime.service, 'dispose')
    vi.spyOn(runtime.viewer, 'listen').mockRejectedValue(new Error('listen-failed'))
    await expect(runtime.listen()).rejects.toThrow('listen-failed')
    expect(close).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('does not leave a listener behind when close overlaps startup', async () => {
    const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0 } as MirrorConfig))
    const listening = runtime.listen()
    const rejected = expect(listening).rejects.toThrow('closed')
    await runtime.close()
    await rejected
    await expect(fetch(runtime.viewer.url)).rejects.toThrow()
  })
})

describe('analyzer extension contract', () => {
  it('runs a second analyzer, freezes provenance, and cannot rewrite execution verdicts', async () => {
    const selected = analyzer({ label: 'original' })
    const { service, input, store } = await fixture(selected)
    ;(selected.config as Record<string, unknown>).label = 'changed'
    const before = await readFile(join(store.root, input.id, 'manifest.json'))
    const job = await service.start({ requestId: randomUUID(), targetRunId: input.id })
    const terminal = await waitFor(service, job.jobId, ['succeeded'])
    const { report } = await service.getReport(terminal.reportId!)
    expect(report.analyzer).toEqual(new TriageAnalyzerRunner(analyzer({ label: 'original' })).identity)
    expect(report.limitations).toContain('extension-fixture')
    expect(report.reportedVerdict).toBe('fail')
    expect(report.effectiveVerdict).not.toBe('pass')
    expect(await readFile(join(store.root, input.id, 'manifest.json'))).toEqual(before)
  })

  it.each(['invalid', 'exit', 'busy'])('contains %s analyzer failures', async mode => {
    const { service, input } = await fixture({ ...analyzer({ mode }), timeoutMs: 100 })
    const job = await service.start({ requestId: randomUUID(), targetRunId: input.id })
    expect((await waitFor(service, job.jobId, ['failed'])).errorCode).toMatch(/invalid-analysis|analysis-interrupted|analysis-timeout/)
  })

  it('rejects disabled analysis without affecting source data', async () => {
    const { service, input, store } = await fixture(null)
    await expect(service.start({ requestId: randomUUID(), targetRunId: input.id })).rejects.toMatchObject({ code: 'analyzer-disabled' })
    expect((await store.get(input.id)).verdict).toBe('fail')
  })

  it('reads existing reports when disabled and treats changed analyzer versions as request conflicts', async () => {
    const { service, input, store } = await fixture()
    const request = { requestId: randomUUID(), targetRunId: input.id }
    const job = await service.start(request)
    const terminal = await waitFor(service, job.jobId, ['succeeded'])
    await service.close()
    const disabled = new WorkbenchTriageService(store, new WorkbenchComparisonService(store), { analyzer: null })
    expect((await disabled.getReport(terminal.reportId!)).report.analyzer?.version).toBe('2.0.0')
    await disabled.close()
    const updated = new WorkbenchTriageService(store, new WorkbenchComparisonService(store), { analyzer: { ...analyzer(), version: '3.0.0' } })
    await expect(updated.start(request)).rejects.toMatchObject({ code: 'request-conflict' })
    await updated.close()
  })

  it('reads legacy reports and reuses legacy request identities without rerunning analysis', async () => {
    const { service, input, store, root } = await fixture(defaultTriageAnalyzer())
    const request = { requestId: randomUUID(), targetRunId: input.id }
    const job = await service.start(request)
    const done = await waitFor(service, job.jobId, ['succeeded'])
    await service.close()
    const path = join(root, 'triage', 'reports', `${done.reportId}.json`)
    const report = JSON.parse(await readFile(path, 'utf8'))
    delete report.analyzer; delete report.digest
    report.digest = sha256(stableJson(report))
    await writeFile(path, JSON.stringify(report))
    const legacyJob = { ...done, requestDigest: sha256(stableJson({ targetRunId: input.id, comparisonId: null, rulesVersion: 1 })) }
    delete legacyJob.analyzer
    await writeFile(join(root, 'triage', 'jobs', `${job.jobId}.json`), JSON.stringify(legacyJob))
    const restarted = new WorkbenchTriageService(store, new WorkbenchComparisonService(store))
    expect((await restarted.getReport(done.reportId!)).report.analyzer).toBeUndefined()
    expect((await restarted.start(request)).jobId).toBe(job.jobId)
    await restarted.close()
  })

  it('cancels active and queued analysis before close resolves, and refuses new work', async () => {
    const { service, input, store } = await fixture(analyzer({ mode: 'busy' }))
    const first = await service.start({ requestId: randomUUID(), targetRunId: input.id })
    await waitFor(service, first.jobId, ['transforming'])
    const queued = await service.start({ requestId: randomUUID(), targetRunId: input.id })
    await Promise.all([service.close(), service.close()])
    expect((await service.getJob(first.jobId)).state).toBe('cancelled')
    expect((await service.getJob(queued.jobId)).state).toBe('cancelled')
    expect(store.hasReadLease(input.id)).toBe(false)
    await expect(service.start({ requestId: randomUUID(), targetRunId: input.id })).rejects.toMatchObject({ code: 'triage-closed' })
  })

  it('waits for admission that has already begun before shutting down', async () => {
    const { service, input, store } = await fixture()
    const original = store.readOnlySnapshot.bind(store)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let entered = false
    vi.spyOn(store, 'readOnlySnapshot').mockImplementationOnce(async id => { entered = true; await gate; return original(id) })
    const start = service.start({ requestId: randomUUID(), targetRunId: input.id })
    await vi.waitFor(() => expect(entered).toBe(true))
    let closed = false
    const closing = service.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 20)); expect(closed).toBe(false)
    release()
    const job = await start; await closing
    expect((await service.getJob(job.jobId)).state).toBe('cancelled')
  })
})

it('drains a share admission already writing its durable record', async () => {
  const { store, input } = await fixture()
  let release!: () => void, entered = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const jobs = new WorkbenchShareJobs(store, async point => { if (point === 'submit:after-record') { entered = true; await gate } })
  cleanups.push(() => jobs.close())
  const start = jobs.submit('share-preview', 'admission-race', { runId: input.id, options: { files: [{ name: 'step-1.xml' }] } })
  await vi.waitFor(() => expect(entered).toBe(true))
  const closing = jobs.close()
  release(); const job = await start; await closing
  expect((await jobs.get(job.jobId)).phase).toBe('cancelled')
})

it('keeps namespaced references protective without the extension and rejects damaged versions', async () => {
  const { store, input, root, service } = await fixture()
  const refs = new WorkbenchReferences(store), snapshot = await store.readOnlySnapshot(input.id)
  const ref = { contractVersion: 3 as const, refId: randomUUID(), consumerKind: 'example:report', consumerId: 'report-1',
    targetRunId: input.id, evidenceRefs: [], sourceHash: snapshot.manifestSha256, createdAt: input.startedAt }
  await refs.publish(ref)
  await expect(refs.revoke(ref.refId, 'other:report', ref.consumerId)).rejects.toThrow('ownership')
  await service.close(); await store.close()
  const reopened = new WorkbenchStore(root); await reopened.init(); cleanups.push(() => reopened.close())
  const retention = new WorkbenchRetention(reopened)
  expect((await retention.snapshot()).runs.find(run => run.id === input.id)?.protectedBy).toContain('example:report')
  await writeFile(join(root, 'references', `${ref.refId}.json`), JSON.stringify({ ...ref, contractVersion: 99 }))
  await expect(retention.snapshot()).rejects.toThrow()
})

it('does not publish a late share preview after shutdown requests cancellation', async () => {
  const { store, input } = await fixture()
  const file = await store.put(input.id, 'step-1.xml', '<AppiumAUT><XCUIElementTypeButton x="0" y="0" width="2" height="2" visible="true"/></AppiumAUT>', 'application/xml; charset=utf-8')
  input.evidence = [file]; await store.save(input)
  let release!: () => void, entered = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const jobs = new WorkbenchShareJobs(store, async point => { if (point === 'preview:after-transform') { entered = true; await gate } })
  cleanups.push(() => jobs.close())
  const job = await jobs.submit('share-preview', 'late-preview', { runId: input.id, options: { files: [{ name: file.name }] } })
  await vi.waitFor(() => expect(entered).toBe(true))
  const closing = jobs.close()
  await vi.waitFor(async () => expect((await jobs.get(job.jobId)).phase).toBe('cancelling'))
  release(); await closing
  expect((await jobs.get(job.jobId)).phase).toBe('cancelled')
})
