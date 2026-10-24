import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

if (process.argv.length !== 4) throw new Error('Usage: authoring-compatibility-probe candidate/application.js previous/application.js')
const current = await import(pathToFileURL(resolve(process.argv[2])).href)
const previous = await import(pathToFileURL(resolve(process.argv[3])).href)
const root = await mkdtemp(join(tmpdir(), 'mirror-authoring-compat-')), runtimes = []
function runtime(module) {
  const value = new module.LocalDeviceRuntime(module.Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  runtimes.push(value); return value
}
async function until(operation, test) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const result = await operation(); if (test(result)) return result
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Probe timed out')
}
try {
  const candidate = runtime(current)
  await candidate.commands.execute('mobile_mirror_start', { provider: 'mock' })
  const yaml = 'name: Authoring compatibility\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- wait: 30\n- assertVisible: {text: "Hello, harness."}\n- done\n'
  const saved = await candidate.application.cases.save(null, { requestId: randomUUID(), expectedRevision: null, publicData: true,
    content: { name: 'Authoring compatibility', tags: ['compatibility'], platform: 'ios', appId: 'com.example.mobilemirror.mock', yaml, publicParams: {} } })
  const revision = await candidate.application.cases.revision(saved.caseId, saved.revisionId)
  const validation = await candidate.application.authoring.validate({ yaml, params: {}, target: {
    platform: 'ios', appId: 'com.example.mobilemirror.mock', sessionId: candidate.service.state().sessionId,
  } })
  assert.equal(validation.valid, true)
  const request = { requestId: 'compatibility', receipt: validation.receipt.token, inputDigest: validation.receipt.inputDigest, localEvidence: true,
    caseRevision: { caseId: saved.caseId, revisionId: saved.revisionId, inputDigest: revision.contentDigest } }
  const accepted = await candidate.application.authoring.run(request)
  await until(async () => candidate.application.workbench.activeId, id => id === accepted.runId)
  await candidate.application.authoring.cancel(accepted.executionId)
  await until(() => candidate.application.authoring.status(request.requestId), status => status.phase === 'finished')
  const journalPath = join(root, 'authoring-executions', `${accepted.executionId}.json`)
  const bytes = await readFile(journalPath), manifest = await readFile(join(root, accepted.runId, 'manifest.json'))
  assert.deepEqual(JSON.parse(manifest).authoringOrigin, request.caseRevision)
  await candidate.application.cases.archive(saved.caseId, { requestId: randomUUID(), expectedRevision: saved.revisionId, archived: true })
  const catalog = await readFile(join(root, 'cases', 'catalog.json')), revisionBytes = await readFile(join(root, 'cases', saved.caseId, `${saved.revisionId}.json`))
  assert.equal(JSON.parse(bytes).source, 'viewer-authoring')
  // Terminal cancellation can legitimately freeze verified evidence and retire
  // its reference. Model a *different*, interrupted publisher after ledger
  // publication but before journal commit; such protective orphans must survive
  // rollback even though the prior reader has no authoring adapter.
  const orphanId = randomUUID()
  await new current.WorkbenchReferences(candidate.application.workbench.store).publish({
    contractVersion: 3, refId: randomUUID(), consumerKind: 'workbench:authoring', consumerId: orphanId,
    targetRunId: accepted.runId, evidenceRefs: [], sourceHash: createHash('sha256').update(manifest).digest('hex'), createdAt: new Date().toISOString(),
  })
  await candidate.close()
  const old = runtime(previous)
  const snapshot = await old.application.retention.snapshot()
  assert(snapshot.runs.find(run => run.id === accepted.runId).protectedBy.includes('workbench:authoring'))
  assert(!(await old.application.retention.plan(0)).candidates.some(run => run.id === accepted.runId))
  await old.close()
  assert.deepEqual(await readFile(journalPath), bytes)
  assert.deepEqual(await readFile(join(root, accepted.runId, 'manifest.json')), manifest)
  assert.deepEqual(await readFile(join(root, 'cases', 'catalog.json')), catalog)
  assert.deepEqual(await readFile(join(root, 'cases', saved.caseId, `${saved.revisionId}.json`)), revisionBytes)
  const reopened = runtime(current)
  const retry = await reopened.application.authoring.run(request)
  assert.equal(retry.executionId, accepted.executionId)
  assert.equal(retry.phase, 'finished')
  assert.equal(reopened.application.workbench.activeId, null)
  assert.equal((await reopened.application.cases.revision(saved.caseId, saved.revisionId)).yaml, yaml)
  await reopened.close()
  process.stdout.write(JSON.stringify({ device: 'mock', legacyReader: 'protective-orphan-fixture', journal: 'unchanged', manifest: 'unchanged', caseRevision: 'unchanged-and-readable', archivedCase: 'run-preserved', restart: 'no-replay' }) + '\n')
} finally {
  for (const value of runtimes.reverse()) await value.close()
  await rm(root, { recursive: true, force: true })
}
