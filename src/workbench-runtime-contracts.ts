import { z } from 'zod'

export const RUNTIME_FEATURES = ['temporal-ui-v1', 'app-restart-v1', 'step-business-v1', 'app-health-v1', 'e2e-measure-v1'] as const
export type RuntimeFeature = typeof RUNTIME_FEATURES[number]
export const runtimeFeaturesSchema = z.array(z.enum(RUNTIME_FEATURES)).min(1).max(5)
  .refine(features => new Set(features).size === features.length, 'Duplicate required feature')
export const runtimeDimensionSchema = z.object({
  required: z.boolean(), status: z.enum(['not-performed', 'pass', 'fail', 'inconclusive']),
  reason: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/).optional(),
  evidenceRefs: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/)).max(256),
}).strict()
export type RuntimeDimension = z.infer<typeof runtimeDimensionSchema>
export const runtimeGatesSchema = z.object({ health: z.object({
  signals: z.array(z.enum(['crash', 'anr', 'hang'])).min(1).max(3).refine(values => new Set(values).size === values.length),
  tailMs: z.number().int().min(0).max(10000).default(2000),
}).strict().optional() }).strict()
export type RuntimeGates = z.infer<typeof runtimeGatesSchema>
export const measurementSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/), path: z.string().max(512),
  metric: z.literal('automation-observed-e2e'), maxElapsedMs: z.number().int().min(100).max(60000),
  elapsedMs: z.number().finite().nonnegative(), startedAt: z.string().datetime(), endedAt: z.string().datetime(),
  status: z.enum(['pass', 'fail', 'inconclusive']), reason: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/),
  startStep: z.number().int().nonnegative(), endStep: z.number().int().nonnegative(),
  assertions: z.number().int().nonnegative(), evidenceRefs: z.array(z.string().max(192)).max(4096),
}).strict()
export type Measurement = z.infer<typeof measurementSchema>
export function runtimeDimension(required = false): RuntimeDimension {
  return { required, status: 'not-performed', evidenceRefs: [] }
}
