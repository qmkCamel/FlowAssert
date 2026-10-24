import { createHash } from 'node:crypto'
import { z } from 'zod'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const time = z.string().datetime()
export const sourceStepSchema = z.object({
  version: z.literal(1), documentSha256: digest, path: z.string().min(1).max(1024),
  stepSha256: digest, line: z.number().int().nonnegative(), topLevel: z.boolean(), static: z.boolean(),
}).strict()
export type SourceStepIdentity = z.infer<typeof sourceStepSchema>
export function factDigest(value: string): string { return createHash('sha256').update(value).digest('hex') }
export function stepDigest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, canonical(item)])) : v
  return factDigest(JSON.stringify(canonical(value)))
}
export const tapResolutionSchema = z.object({
  version: z.literal(1), selectorSha256: digest, observationSha256: digest, observedAt: time,
  code: z.enum(['resolved', 'target-not-found', 'ambiguous-target']), matches: z.number().int().min(0).max(500),
}).strict().refine(v => v.code === 'resolved' ? v.matches === 1 : v.code === 'target-not-found' ? v.matches === 0 : v.matches > 1)
export type TapResolution = z.infer<typeof tapResolutionSchema>
export const tapFactSchema = z.object({
  version: z.literal(1), producer: z.literal('local-navigation-tap'), runId: z.string().uuid(), stepIndex: z.number().int().positive(),
  source: sourceStepSchema, sessionId: z.string().min(1), sessionGeneration: z.number().int().nonnegative(),
  resolution: tapResolutionSchema,
  dispatchStart: z.number().int().nonnegative(), dispatchEnd: z.number().int().nonnegative(),
  dispatch: z.enum(['not-dispatched', 'settled', 'unknown']),
  outcome: z.enum(['passed', 'target-not-found', 'ambiguous-target', 'blocked', 'cancelled', 'unknown']),
  observationFile: z.string().regex(/^step-\d+-tap-source\.xml$/),
  resolutionFile: z.string().regex(/^step-\d+-tap-resolution\.json$/),
  startedAt: time, completedAt: time,
}).strict().superRefine((v, ctx) => {
  if (v.dispatchEnd < v.dispatchStart || (v.dispatch === 'not-dispatched' && v.dispatchEnd !== v.dispatchStart
      && !(v.resolution.code === 'resolved' && ['blocked', 'cancelled'].includes(v.outcome)))
    || (v.outcome === 'passed' && (v.dispatch !== 'settled' || v.resolution.code !== 'resolved'))
    || (['target-not-found', 'ambiguous-target'].includes(v.outcome) && (v.dispatch !== 'not-dispatched' || v.resolution.code !== v.outcome)))
    ctx.addIssue({ code: 'custom', message: 'Inconsistent local tap fact' })
})
export type TapFact = z.infer<typeof tapFactSchema>

/** Only the local producer throws this; Worker messages cannot instantiate it. */
export class LocalTapFailure extends Error {
  constructor(readonly code: 'target-not-found' | 'ambiguous-target' | 'tap-not-ready') { super(code) }
}
