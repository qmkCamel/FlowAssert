import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

if (process.argv.length !== 4) throw new Error('Usage: evidence-compatibility-probe <candidate/application.js> <previous/application.js>')
const candidate = await import(pathToFileURL(resolve(process.argv[2])).href)
const previous = await import(pathToFileURL(resolve(process.argv[3])).href)
const root = await mkdtemp(join(tmpdir(), 'mirror-reference-compat-'))
const current = new candidate.LocalDeviceRuntime(candidate.Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
let old, reopened
try {
  await current.listen()
  await current.commands.execute('mobile_mirror_start', { provider: 'mock' })
  const yaml = 'name: Reference compatibility\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n'
  const runs = []
  for (let n = 0; n < 2; n++) {
    const accepted = await current.application.workbench.start(yaml)
    await current.application.workbench.wait()
    const run = await current.application.workbench.get(accepted.id)
    assert.equal(run.verdict, 'pass'); runs.push(run)
  }
  const before = await Promise.all(runs.map(run => readFile(join(root, run.id, 'manifest.json'))))
  const comparison = await current.application.comparisons.start(runs[0].id, runs[1].id)
  const deadline = Date.now() + 15_000
  let report
  do {
    report = await current.application.comparisons.get(comparison.id)
    if (['completed', 'partial'].includes(report.state) && !current.application.workbench.store.hasReadLease(runs[0].id)) break
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < deadline)
  assert.equal(report.state, 'completed')
  const options = { files: [{ name: runs[0].steps.flatMap(step => step.evidence).find(file => file.name.endsWith('.xml')).name }] }
  const preview = await current.application.share.preview(runs[0].id, options)
  const archive = await current.application.share.export(runs[0].id, options, preview.digest, true)
  const snapshot = await current.application.retention.snapshot()
  assert(snapshot.runs.every(run => run.protectedBy.includes('workbench:comparison')))
  await current.application.comparisons.retire(report.id)
  await current.application.share.retire(archive.sharing.shareId)
  await current.close()
  old = new previous.LocalDeviceRuntime(previous.Config({ viewerPort: 0 }), { workbenchRoot: root })
  // The previous reader conservatively retains these new-format retired consumers.
  const rollback = await old.application.retention.snapshot()
  assert(rollback.runs.every(run => run.protectedBy.includes('comparison')))
  await old.close()
  reopened = new candidate.LocalDeviceRuntime(candidate.Config({ viewerPort: 0 }), { workbenchRoot: root })
  assert((await reopened.application.retention.snapshot()).runs.every(run => !run.protectedBy.length))
  for (const [index, run] of runs.entries()) assert.deepEqual(await readFile(join(root, run.id, 'manifest.json')), before[index])
  process.stdout.write(JSON.stringify({ candidate: process.argv[2], previous: process.argv[3], device: 'mock', runs: 2,
    publishedProtection: 'passed', retirement: 'passed', rollback: 'conservative-protection', sourceManifests: 'unchanged', reopen: 'passed' }) + '\n')
} finally {
  await current.close(); await old?.close(); await reopened?.close()
  await rm(root, { recursive: true, force: true })
}
