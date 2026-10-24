import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const current = await import(pathToFileURL(resolve(process.argv[2])).href)
const previous = await import(pathToFileURL(resolve(process.argv[3])).href)
const root = await mkdtemp(join(tmpdir(), 'mirror-builtin-compat-'))
const runtimes = []
function runtime(module) {
  const value = new module.LocalDeviceRuntime(module.Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  runtimes.push(value); return value
}
try {
  const first = runtime(current)
  await first.commands.execute('mobile_mirror_start', { provider: 'mock' })
  const yaml = 'name: Builtin compatibility\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n'
  const parent = await first.application.workbench.start(yaml); await first.application.workbench.wait()
  const parentBefore = await readFile(join(root, parent.id, 'manifest.json'))
  const child = await first.application.workbench.start(yaml, parent.id); await first.application.workbench.wait()
  await first.application.retention.pin(child.id, true)
  await first.close()
  const old = runtime(previous)
  const legacy = await old.application.retention.plan(0)
  assert.equal(legacy.candidates.length, 0, 'Prior reader must retain both new consumers')
  // Simulate an old writer removing its legacy pin without understanding the marker.
  await old.application.retention.pin(child.id, false)
  assert.equal((await old.application.retention.plan(0)).candidates.length, 0, 'Ledger keeps old unpin conservative')
  await old.close()
  const next = runtime(current)
  await assert.rejects(next.application.retention.plan(0), /retirement mismatch/, 'Mixed writer metadata fails closed')
  await next.application.retention.pin(child.id, true)
  await next.application.retention.pin(child.id, false)
  const plan = await next.application.retention.plan(0)
  assert.deepEqual(plan.candidates.map(item => item.id), [child.id])
  await next.application.retention.confirm(plan)
  assert.equal((await next.application.retention.plan(0)).candidates.length, 0, 'Trashed child retains parent')
  await next.application.retention.purge(child.id, `PURGE ${child.id}`)
  assert.deepEqual((await next.application.retention.plan(0)).candidates.map(item => item.id), [parent.id])
  assert.deepEqual(await readFile(join(root, parent.id, 'manifest.json')), parentBefore)
  await next.close()
  process.stdout.write(JSON.stringify({ device: 'mock', priorReader: 'protective', mixedWriter: 'fail-closed', retry: 'passed', childPurge: 'retired', sourceUnchanged: true }) + '\n')
} finally {
  for (const value of runtimes.reverse()) await value.close()
  await rm(root, { recursive: true, force: true })
}
