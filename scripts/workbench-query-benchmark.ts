import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, platform, arch } from 'node:os'
import { WorkbenchStore, sha256 } from '../src/workbench-store.js'
import type { TestRun } from '../src/workbench-domain.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { MirrorService } from '../src/mirror-service.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { WorkbenchComparisonService, stableJson } from '../src/workbench-comparison.js'
import { WorkbenchTriageService } from '../src/workbench-triage-service.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'
import { triageJobSchema } from '../src/workbench-triage-contracts.js'

// Generated data only. Never accepts a user archive root. Each size gets a fresh store.
const counts = process.argv.slice(2).map(Number)
if (counts.some(count => ![100, 1000, 10000].includes(count))) throw new Error('Sizes must be 100, 1000 or 10000')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const rows: unknown[] = []
for (const count of counts.length ? counts : [100, 1000, 10000]) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-query-bench-'))
  const store = new WorkbenchStore(root), mirror = new MirrorService(resolveMirrorConfig({ viewerPort: 0 }), 'http://127.0.0.1')
  const workbench = new WorkbenchService(mirror, { store }), comparisons = new WorkbenchComparisonService(store), triage = new WorkbenchTriageService(store, comparisons)
  const timings: Record<string, unknown> = {}
  async function measure(name: string, operation: () => Promise<unknown>) {
    const heapBefore = process.memoryUsage().heapUsed, started = performance.now()
    let maxRss = process.memoryUsage().rss
    const sampler = setInterval(() => { maxRss = Math.max(maxRss, process.memoryUsage().rss) }, 10)
    try { await operation(); timings[name] = { ok: true } }
    catch (error) { timings[name] = { ok: false, error: error instanceof Error ? error.message : String(error) } }
    finally { clearInterval(sampler) }
    Object.assign(timings[name] as object, { elapsedMs: Math.round(performance.now() - started), heapDeltaMiB: Math.round((process.memoryUsage().heapUsed - heapBefore) / 1048576), sampledPeakRssMiB: Math.round(Math.max(maxRss, process.memoryUsage().rss) / 1048576) })
  }
  try {
    await store.init()
    const evidence = Buffer.from('deterministic benchmark evidence\n'), now = '2026-01-01T00:00:00.000Z'
    const file = { name: 'evidence.txt', bytes: evidence.length, sha256: sha256(evidence), contentType: 'text/plain; charset=utf-8' }
    const jobs = join(root, 'triage', 'jobs'), refs = join(root, 'references')
    await mkdir(jobs, { recursive: true }); await mkdir(refs, { recursive: true })
    let manifestBytes = 0
    for (let n = 1; n <= count; n++) {
      const runId = id(n), directory = join(root, runId); await mkdir(directory)
      const run: TestRun = { schemaVersion: 1, id: runId, name: `Fixture ${n}`, yaml: '', engine: 'fixture', phase: 'finished', verdict: 'pass', startedAt: now,
        sessionId: 'mock', deviceName: 'mock', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed', cleanup: 'session-retained', steps: [], evidence: [file] }
      const bytes = JSON.stringify(run); manifestBytes += Buffer.byteLength(bytes)
      await writeFile(join(directory, 'manifest.json'), bytes); await writeFile(join(directory, file.name), evidence)
      const request = { targetRunId: runId, comparisonId: null, rulesVersion: 1 }
      const job = triageJobSchema.parse({ schemaVersion: 1, jobId: runId, requestId: runId, requestDigest: sha256(stableJson(request)), targetRunId: runId,
        ownerGeneration: store.ownerGeneration, state: 'failed', progress: 'failed', createdAt: now, finishedAt: now, errorCode: 'fixture' })
      await writeFile(join(jobs, `${runId}.json`), JSON.stringify(job))
      await writeFile(join(refs, `${runId}.json`), JSON.stringify({ contractVersion: 3, refId: runId, consumerKind: 'benchmark:fixture', consumerId: runId,
        targetRunId: runId, sourceHash: sha256(bytes), evidenceRefs: [file.name], createdAt: now }))
    }
    const before = sha256(await readFile(join(root, id(count), 'manifest.json')))
    await measure('list-manifests', () => workbench.list())
    await measure('status-no-evidence-check', () => workbench.status(id(count)))
    await measure('detail-with-evidence-check', () => workbench.get(id(count)))
    await measure('triage-cold-init', () => triage.init())
    await measure('triage-idempotent-lookup', () => triage.start({ requestId: id(count), targetRunId: id(count) }))
    await measure('retention-full-snapshot', () => new WorkbenchRetention(store).snapshot())
    await writeFile(join(root, id(1), 'manifest.json'), '{')
    await measure('detail-corrupt-manifest', async () => {
      if ((await workbench.get(id(1))).recovery?.reason !== 'Manifest unavailable') throw new Error('Corrupt manifest not surfaced')
    })
    await rm(join(root, id(2), file.name))
    await measure('detail-missing-evidence', async () => {
      const run = await workbench.get(id(2))
      if (run.resultProjection?.evidenceAvailability !== 'unavailable') throw new Error('Missing evidence not surfaced')
    })
    rows.push({ count, manifestBytes, evidenceBytesPerRun: evidence.length, evidenceFilesPerRun: 1, stepsPerRun: 0, jobs: count, references: count,
      sourceUnchanged: before === sha256(await readFile(join(root, id(count), 'manifest.json'))), timings })
    process.stderr.write(`Measured ${count} runs\n`)
  } finally { await triage.close(); await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) }
}
process.stdout.write(JSON.stringify({ schemaVersion: 1, measuredAt: new Date().toISOString(), node: process.version, platform: `${platform()}-${arch()}`,
  methodology: 'One sequential pass per size, no forced OS cache eviction; sampled RSS is process-wide; synthetic metadata-heavy lower bound, not a video workload or production SLO.', rows }, null, 2) + '\n')
