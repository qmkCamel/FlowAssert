import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

// Accept an unpacked candidate path to verify the shipped entry and worker, not TS source.
const { LocalDeviceRuntime, Config } = await import(pathToFileURL(resolve(process.argv[2] ?? 'lib/application.js')).href)
const root = await mkdtemp(join(tmpdir(), 'mirror-plugin-probe-'))
const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
try {
  await runtime.listen()
  assert.equal(runtime.viewer.application, runtime.coordinator.application)
  await runtime.commands.execute('mobile_mirror_start', { provider: 'mock' })
  const run = await runtime.application.workbench.start('name: Module probe\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- fillReady: {target: {testId: public-input}, text: public}\n- assertReady: {target: {testId: public-input}}\n- done\n')
  await runtime.application.workbench.wait()
  const store = runtime.application.workbench.store
  const before = await readFile(join(root, run.id, 'manifest.json'))
  const accepted = await runtime.application.triage.start({ requestId: randomUUID(), targetRunId: run.id })
  let job
  const deadline = Date.now() + 15_000
  do {
    job = await runtime.application.triage.getJob(accepted.jobId)
    if (['succeeded', 'failed', 'cancelled'].includes(job.state)) break
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  assert.equal(job.state, 'succeeded', JSON.stringify(job))
  const report = await runtime.application.triage.getReport(job.reportId)
  assert.equal(report.report.analyzer.id, 'builtin.evidence-rules')
  const investigation = await runtime.application.investigation.inspect(run.id)
  assert.equal(investigation.plan.projection.clean, true)
  assert.equal(investigation.plan.checks.length, 0)
  const fixture = await fetch(`${runtime.viewer.url}/api/workbench/acceptance/fixture-template`, { method: 'POST', headers: { origin: runtime.viewer.url, 'content-type': 'application/json' }, body: JSON.stringify({ reviewed: true }) })
  assert.equal(fixture.status, 200)
  const template = Buffer.from(await fixture.arrayBuffer())
  assert.ok(template.includes(Buffer.from('mobile-mirror.project.json')))
  assert.ok(template.includes(Buffer.from('registerCleanup')))
  assert.deepEqual(await readFile(join(root, run.id, 'manifest.json')), before)
  const second = await runtime.application.workbench.start('name: Close comparison probe\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n', run.id)
  await runtime.application.workbench.wait()
  assert.equal(second.referencePublications[run.id].references[0].consumerKind, 'workbench:child')
  await runtime.application.retention.pin(second.id, true)
  assert((await runtime.application.retention.snapshot()).runs.find(item => item.id === second.id).protectedBy.includes('pin'))
  await runtime.application.retention.pin(second.id, false)
  const secondBefore = await readFile(join(root, second.id, 'manifest.json'))
  const comparison = await runtime.application.comparisons.start(run.id, second.id)
  await runtime.close()
  assert.equal(store.hasReadLease(run.id), false)
  assert.equal(store.hasReadLease(second.id), false)
  assert(['cancelled', 'completed', 'partial'].includes((await runtime.application.comparisons.get(comparison.id)).state))
  await assert.rejects(runtime.application.comparisons.start(run.id, second.id), /closed/)
  const reopened = new LocalDeviceRuntime(Config({ viewerPort: 0 }), { workbenchRoot: root })
  try { await reopened.application.workbench.store.init() } finally { await reopened.close() }
  assert.deepEqual(await readFile(join(root, run.id, 'manifest.json')), before)
  assert.deepEqual(await readFile(join(root, second.id, 'manifest.json')), secondBefore)
  await assert.rejects(fetch(runtime.viewer.url))
  process.stdout.write(JSON.stringify({ entry: 'application', device: 'mock', analyzer: report.report.analyzer,
    verdict: report.report.reportedVerdict, readiness: 'pass', investigation: 'pass', fixtureDownload: 'pass', unchangedSource: true, shutdown: 'complete', comparisonShutdown: 'drained', storeReopen: 'passed', builtinReferences: 'child-and-pin-pass' }) + '\n')
} finally {
  await runtime.close()
  await rm(root, { recursive: true, force: true })
}
