import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'

export const samplingBoundsSchema = z.object({
  pollMs: z.number().int().min(100).max(5000),
  maxSampleGapMs: z.number().int().min(100).max(10000),
}).strict()
const bounds = { predicate: z.unknown(), ...samplingBoundsSchema.shape }
export const temporalStepSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('assertEventually'), ...bounds, withinMs: z.number().int().min(100).max(60000) }).strict(),
  z.object({ operation: z.literal('assertStable'), ...bounds, durationMs: z.number().int().min(100).max(60000) }).strict(),
]).superRefine((step, ctx) => {
  if (step.maxSampleGapMs < step.pollMs) ctx.addIssue({ code: 'custom', message: 'sample-gap-smaller-than-poll' })
  if (temporalWorstSamples(step) > 256) ctx.addIssue({ code: 'custom', message: 'temporal-sample-budget' })
})
export type TemporalStep = z.infer<typeof temporalStepSchema>
export function temporalWorstSamples(step: { operation: string; durationMs?: number; withinMs?: number; pollMs: number; maxSampleGapMs: number }): number {
  return Math.ceil(((step.durationMs ?? step.withinMs ?? 0) + (step.operation === 'assertStable' ? 2 * step.maxSampleGapMs : 0)) / step.pollMs) + 2
}
export interface SampleClock { now(): number; wait(ms: number, signal: AbortSignal): Promise<void> }
export const monotonicClock: SampleClock = { now: () => performance.now(), wait: async (ms, signal) => { await sleep(ms, undefined, { signal }) } }
export interface TemporalSample {
  index: number; startedMs: number; endedMs: number; matched: boolean; evidenceRefs: string[]
}
export interface TemporalResult {
  schemaVersion: 1; status: 'pass' | 'fail' | 'inconclusive'; reason: string
  mode: 'eventually' | 'stable'; windowMs: number; pollMs: number; maxSampleGapMs: number
  elapsedMs: number; samples: TemporalSample[]; coverage: 'complete' | 'incomplete'
}

/** Serial, bounded polling. A sample only describes its actual capture interval. */
export async function evaluateTemporal(step: TemporalStep, observe: (signal: AbortSignal, index: number) => Promise<{ matched: boolean; evidenceRefs: string[] }>,
  signal: AbortSignal, options: { clock?: SampleClock; progress?: (result: TemporalResult) => Promise<void> } = {}): Promise<TemporalResult> {
  const clock = options.clock ?? monotonicClock
  const started = clock.now(), stable = step.operation === 'assertStable'
  const windowMs = stable ? step.durationMs : step.withinMs
  const budget = windowMs + (stable ? 2 * step.maxSampleGapMs : 0)
  const samples: TemporalSample[] = []
  const result: TemporalResult = { schemaVersion: 1, status: 'inconclusive', reason: 'temporal-incomplete', mode: stable ? 'stable' : 'eventually',
    windowMs, pollMs: step.pollMs, maxSampleGapMs: step.maxSampleGapMs, elapsedMs: 0, samples, coverage: 'incomplete' }
  const finish = (status: TemporalResult['status'], reason: string, complete = false) => {
    result.status = status; result.reason = reason; result.coverage = complete ? 'complete' : 'incomplete'; result.elapsedMs = clock.now() - started; return result
  }
  let firstEnd: number | undefined
  try {
    for (let index = 1; index <= 256; index++) {
      signal.throwIfAborted()
      const before = clock.now() - started, remaining = budget - before
      if (remaining <= 0) {
        const last = samples.at(-1)
        return !stable && last && !last.matched && last.endedMs >= windowMs - Math.min(step.pollMs, step.maxSampleGapMs)
          ? finish('fail', 'temporal-deadline-unmatched', true) : finish('inconclusive', 'temporal-deadline')
      }
      const combined = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(remaining)))])
      const value = await observe(combined, index)
      signal.throwIfAborted()
      const after = clock.now() - started
      if (combined.aborted || after > budget) return finish('inconclusive', 'temporal-late-sample')
      if (typeof value.matched !== 'boolean') return finish('inconclusive', 'temporal-invalid-sample')
      const prior = samples.at(-1)
      samples.push({ index, startedMs: before, endedMs: after, matched: value.matched, evidenceRefs: value.evidenceRefs })
      if (after - before > step.maxSampleGapMs || (prior && after - prior.endedMs > step.maxSampleGapMs)
        || (!prior && after > step.maxSampleGapMs)) return finish('inconclusive', 'temporal-sampling-gap')
      firstEnd ??= after
      await options.progress?.(structuredClone(result))
      signal.throwIfAborted()
      if (stable) {
        if (!value.matched) return finish('fail', 'temporal-counterexample', true)
        if (samples.length >= 2 && after - firstEnd >= windowMs) return finish('pass', 'sampled-window-satisfied', true)
      } else {
        if (value.matched && after <= windowMs) return finish('pass', 'eventually-satisfied', true)
        // A valid last negative sample covers the deadline neighborhood; no cached sample fills a gap.
        if (after === windowMs)
          return finish('fail', 'temporal-deadline-unmatched', true)
      }
      const target = stable ? firstEnd + windowMs : windowMs
      const wait = Math.min(step.pollMs, Math.max(1, target - after))
      await clock.wait(wait, signal)
    }
    return finish('inconclusive', 'temporal-sample-budget')
  } catch (error) {
    signal.throwIfAborted()
    return finish('inconclusive', error instanceof Error && /^[a-z][a-z0-9-]{0,95}$/.test(error.message) ? error.message : 'temporal-observation-failed')
  }
}

/** Replays timing/matching facts; callers independently recompute predicates from saved sources. */
export function verifyTemporalFacts(step: TemporalStep, report: TemporalResult): boolean {
  if (report.schemaVersion !== 1 || !report.samples.length || report.samples.length > 256 || report.status !== 'pass' || report.coverage !== 'complete') return false
  const stable = step.operation === 'assertStable', window = stable ? step.durationMs : step.withinMs
  if (report.mode !== (stable ? 'stable' : 'eventually') || report.windowMs !== window
    || report.pollMs !== step.pollMs || report.maxSampleGapMs !== step.maxSampleGapMs) return false
  for (const [index, sample] of report.samples.entries()) {
    const prior = report.samples[index - 1]
    if (sample.index !== index + 1 || !Number.isFinite(sample.startedMs) || !Number.isFinite(sample.endedMs)
      || sample.startedMs < 0 || sample.endedMs < sample.startedMs || sample.endedMs - sample.startedMs > step.maxSampleGapMs
      || (prior ? sample.startedMs < prior.endedMs || sample.endedMs - prior.endedMs > step.maxSampleGapMs : sample.endedMs > step.maxSampleGapMs)) return false
  }
  const last = report.samples.at(-1)!
  if (!Number.isFinite(report.elapsedMs) || report.elapsedMs < last.endedMs || report.samples.some(sample => typeof sample.matched !== 'boolean' || !Array.isArray(sample.evidenceRefs))) return false
  return stable ? report.samples.every(sample => sample.matched) && report.samples.length >= 2
    && last.endedMs - report.samples[0]!.endedMs >= window && last.endedMs <= window + 2 * step.maxSampleGapMs
    : last.matched && last.endedMs <= window
}
