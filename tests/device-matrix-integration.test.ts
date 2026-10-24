import { expect, it } from 'vitest'
import { chmod, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { matrixFixture } from './fixtures/matrix-fixture.js'
import { acceptanceFixture } from './fixtures/acceptance-fixture.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { runMatrixCli } from '../src/device-matrix-cli.js'
import { MatrixAcceptanceSources } from '../src/device-matrix-sources.js'
import { NativeAcceptanceSources } from '../src/workbench-change-source.js'
import { WorkbenchChangeAcceptance } from '../src/workbench-change-acceptance.js'
import { freezeMatrixArtifacts, bindMatrixArtifacts } from '../src/device-matrix-artifacts.js'
import { matrixRunStatus, matrixSafeSummary } from '../src/device-matrix-contracts.js'

it('missing evidence is incomplete, not a product failure; the safe projection cannot keep a green evidence dimension', () => {
  expect(matrixRunStatus(acceptanceFixture().run, 'unavailable')).toBe('incomplete')
  const summary = matrixSafeSummary({ slots: [], cells: [{ attempts: [{ reason: 'matrix-current-evidence-unavailable', projection: { verification: { evidence: { status: 'pass' } } } }] }] } as any)
  expect(summary.cells[0]!.attempts[0]!.verification.evidence).toBe('fail')
})

it('freezes explicit local binaries, ignores later source edits, and rejects altered retained artifacts or remote paths', async () => {
  const f = await matrixFixture()
  try {
    const apk = join(f.root, 'app.apk'), directory = join(f.root, 'artifacts'); await mkdir(directory)
    await writeFile(apk, 'frozen binary fixture'); f.registry.slots[0]!.capabilities['appium:app'] = apk
    const artifacts = await freezeMatrixArtifacts(f.registry, directory)
    await writeFile(apk, 'changed source')
    const runtime = await bindMatrixArtifacts(f.registry, directory, artifacts)
    expect(await readFile(runtime.slots[0]!.capabilities['appium:app'] as string, 'utf8')).toBe('frozen binary fixture')
    const retained = runtime.slots[0]!.capabilities['appium:app'] as string
    await chmod(retained, 0o600); await writeFile(retained, 'tampered')
    await expect(bindMatrixArtifacts(f.registry, directory, artifacts)).rejects.toThrow('changed')
    f.registry.slots[0]!.capabilities['appium:app'] = 'https://example.com/app.apk'
    await expect(freezeMatrixArtifacts(f.registry, directory)).rejects.toThrow('explicit-local')
  } finally { await f.close() }
})

it('matrix sources stay per-run facts; missing provenance is incomplete and missing receipts invalidate preview', async () => {
  const f = await matrixFixture(), resolver = new MatrixAcceptanceSources(new NativeAcceptanceSources(f.store), f.matrix), service = new WorkbenchChangeAcceptance(f.store, { resolver })
  try {
    const start = await f.matrix.start('smoke', 'START smoke'); await f.matrix.wait()
    const state = await f.matrix.get(start.id), cell = state.cells[0]!, attempt = cell.attempts[0]!, input = acceptanceFixture().input
    input.cells[0]!.runId = attempt.id; input.cells[0]!.matrixCell = { matrixId: start.id, cellId: cell.id, attemptId: attempt.id }
    const lease = await resolver.acquire(input)
    expect(lease.sources.get(attempt.id)?.storage).toBe('matrix'); await lease.sources.get(attempt.id)!.recheck!(); lease.release()
    const preview = await service.preview(input); expect(preview.summary.status).toBe('incomplete')
    await rm(join(f.matrix.root, start.id, 'stores', attempt.storeId, 'references', `${attempt.referenceId}.json`))
    const missing = await resolver.acquire(input); expect(missing.sources.has(attempt.id)).toBe(false); missing.release()
    expect((await f.matrix.get(start.id)).exitCode).toBe(2)
    const job = await service.publish({ id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true })
    await expect.poll(async () => (await service.getJob(job.jobId)).phase).toBe('failed')
  } finally { await service.close(); await f.close() }
}, 60000)

it('Viewer/CLI require explicit confirmation and same-origin, and agent access is readonly and current-project scoped', async () => {
  const f = await matrixFixture(), runtime = new LocalDeviceRuntime(resolveMirrorConfig({ viewerPort: 0, agentTestControl: { enabled: true, projectPath: f.projectPath, allowedFlows: ['example', 'reset'], allowedSuites: [], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: [] } }), { workbenchRoot: f.store.root, matrixRegistryPath: f.registryPath })
  let stdout = ''; const io = { stdout: { write: (s: string) => { stdout += s } }, stderr: { write: (_s: string) => {} } }
  try {
    await runtime.listen(); const origin = runtime.viewer.url
    const rejected = await fetch(`${origin}/api/workbench/matrices`, { method: 'POST', headers: { origin: 'https://example.org', 'content-type': 'application/json' }, body: JSON.stringify({ planId: 'smoke', confirm: 'START smoke', localEvidence: true }) })
    expect(rejected.status).toBe(400)
    expect(await runMatrixCli(['start', 'smoke', '--url', origin], io)).toBe(2)
    expect(await runMatrixCli(['start', 'smoke', '--url', origin, '--confirm', 'START smoke'], io)).toBe(0)
    const result = JSON.parse(stdout), summary = await runtime.coordinator.matrixStatus(result.id)
    expect(summary.exitCode).toBe(0); expect(JSON.stringify(summary)).not.toMatch(/storeId|processIdentity|base64|mock-/)
    expect(runtime.service.state().lifecycle).toBe('idle')
    await writeFile(join(f.root, 'flow.yaml'), (await readFile(join(f.root, 'flow.yaml'), 'utf8')).replace('Matrix fixture', 'Changed project'))
    await expect(runtime.coordinator.matrixStatus(result.id)).rejects.toThrow('unavailable')
    expect(await runMatrixCli(['status', '../private', '--url', 'https://example.org'], io)).toBe(2)
  } finally { await runtime.close(); await f.close() }
}, 60000)
