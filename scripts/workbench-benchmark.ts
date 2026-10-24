/** Serial physical repetitions with unchanged YAML/capabilities/evidence policy. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { RunTiming } from '../src/workbench-timing.js'

const count = Number(process.env.MOBILE_MIRROR_REPEAT_COUNT ?? 3)
const output = process.env.MOBILE_MIRROR_BENCHMARK_OUTPUT ?? ''
const flowPath = process.env.MOBILE_MIRROR_FLOW_PATH ?? '', capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const budget = process.env.MOBILE_MIRROR_MAX_RUN_MS ? Number(process.env.MOBILE_MIRROR_MAX_RUN_MS) : undefined
if (!Number.isInteger(count) || count < 3 || count > 30) throw new Error('REPEAT_COUNT must be 3–30')
if (![output, flowPath, capsPath].every(isAbsolute)) throw new Error('Explicit absolute BENCHMARK_OUTPUT, FLOW_PATH and CAPABILITIES_PATH required')
if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0)) throw new Error('MAX_RUN_MS must be positive')
const fingerprint = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex')
const flowSha256 = await fingerprint(flowPath), capabilitiesSha256 = await fingerprint(capsPath)
interface Sample { runId: string; verdict: string; durationMs: number; timings: RunTiming[]; sameSession: boolean; historyRestored: boolean; deviceStopped: boolean; runtimeStopped: boolean | null; runtimeMode: 'managed' | 'external'; framesDuringRun: number; independentControlResponsive: boolean; verifiedArtifacts: number; root: string }
const samples: Sample[] = []
let activeChild: ChildProcess | undefined, interrupted = false
const interrupt = () => { interrupted = true; activeChild?.kill('SIGTERM') }
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
await mkdir(dirname(output), { recursive: true, mode: 0o700 })
const report = { sampledAt: new Date().toISOString(), flowSha256, capabilitiesSha256, evidencePolicy: 'fresh-png-xml-every-step', sessionPolicy: 'new-session-per-repetition', samples, complete: false, summary: {} as Record<string, unknown> }
try {
  for (let index = 0; index < count; index++) {
    if (interrupted) throw new Error('Benchmark interrupted; retained completed repetitions')
    if (await fingerprint(flowPath) !== flowSha256 || await fingerprint(capsPath) !== capabilitiesSha256) throw new Error('Benchmark input changed between repetitions')
    process.stdout.write(`Physical repetition ${index + 1}/${count}\n`)
    const result = await new Promise<string>((resolveResult, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/workbench-physical-probe.ts')], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      activeChild = child
      let stdout = '', stderr = ''
      child.stdout.on('data', (data: Buffer) => { stdout = (stdout + data.toString()).slice(-2_000_000) })
      child.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-64_000) })
      child.once('error', reject)
      child.once('exit', (code) => { activeChild = undefined; code === 0 && !interrupted ? resolveResult(stdout) : reject(new Error(`Physical repetition failed or interrupted (${code}); ${stderr}`)) })
    })
    const sample = JSON.parse(result) as Sample
    if (!sample.sameSession || !sample.historyRestored || !sample.deviceStopped || (sample.runtimeMode === 'managed' && !sample.runtimeStopped) || sample.framesDuringRun < 2 || !sample.independentControlResponsive || !sample.timings?.length) throw new Error('Incomplete physical acceptance; not a valid timing baseline')
    samples.push(sample)
    await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 })
  }
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return { samples: sorted.length, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) }
  }
  const duration = stats(samples.map((sample) => sample.durationMs))
  const phases = Object.fromEntries([...new Set(samples.flatMap((s) => s.timings.map((t) => t.phase)))].map((phase) => [phase, stats(samples.map((s) => s.timings.filter((t) => t.phase === phase).reduce((sum, t) => sum + t.durationMs, 0)))]))
  report.complete = true
  report.summary = { duration, phases, sampleBudgetMs: Math.ceil(duration.p95Ms! * 1.2), sampleBudgetStatus: 'calibration-only-not-a-production-SLO', ...(budget ? { configuredBudgetMs: budget, withinBudget: samples.every((s) => s.durationMs <= budget) } : {}) }
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 })
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`)
  if (budget && samples.some((s) => s.durationMs > budget)) process.exitCode = 1
} catch (error) {
  report.summary = { error: error instanceof Error ? error.message : String(error) }
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 })
  throw error
} finally {
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
}
