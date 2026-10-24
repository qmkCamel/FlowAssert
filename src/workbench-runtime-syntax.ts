import { z } from 'zod'
import { temporalStepSchema, type TemporalStep } from './workbench-temporal.js'
import { parseWorkbenchFlow, type WorkbenchFlow } from './workbench-flow.js'
import { parseReadyStep, type ReadyStep } from './workbench-readiness.js'
import { stringify } from 'yaml'

export const RUNTIME_OPERATIONS = ['assertEventually', 'assertStable', 'restartApp', 'assertBusiness', 'measure'] as const
const ref = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
export const restartStepSchema = z.object({ timeoutMs: z.number().int().min(100).max(60000) }).strict()
export const businessStepSchema = z.discriminatedUnion('mode', [
  z.object({ ref, args: z.record(ref, z.unknown()).default({}), mode: z.literal('once'), withinMs: z.number().int().min(100).max(60000) }).strict(),
  z.object({ ref, args: z.record(ref, z.unknown()).default({}), mode: z.literal('eventually'), withinMs: z.number().int().min(100).max(60000),
    pollMs: z.number().int().min(100).max(5000), maxSampleGapMs: z.number().int().min(100).max(10000) }).strict(),
]).superRefine((step, ctx) => {
  if (step.mode === 'eventually' && (step.pollMs > step.maxSampleGapMs || Math.ceil(step.withinMs / step.pollMs) + 2 > 256))
    ctx.addIssue({ code: 'custom', message: 'business-sampling-budget' })
})
export type BusinessStep = z.infer<typeof businessStepSchema>
export function parseBusinessStep(raw: unknown): BusinessStep {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('business-step-invalid')
  return businessStepSchema.parse({ mode: 'once', ...raw })
}
export const measureStepSchema = z.object({ id: ref, maxElapsedMs: z.number().int().min(100).max(60000), steps: z.array(z.unknown()).min(1).max(100) }).strict()
export type TemporalPredicate = { native: WorkbenchFlow } | { ready: Extract<ReadyStep, { operation: 'assertReady' }> }
export async function parseTemporalStep(operation: string, body: unknown, header: { name: string; platform: string; appId: string }): Promise<{ step: TemporalStep; predicate: TemporalPredicate }> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || 'operation' in body) throw new Error('temporal-step-invalid')
  const step = temporalStepSchema.parse({ operation, ...body })
  const raw = step.predicate
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1) throw new Error('temporal-predicate-invalid')
  if ('assertReady' in raw) {
    const predicate = raw.assertReady
    if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate) || Object.keys(predicate).some(key => !['target', 'state'].includes(key))) throw new Error('temporal-ready-predicate-invalid')
    const ready = parseReadyStep({ operation: 'assertReady', ...predicate })
    if (ready.operation !== 'assertReady') throw new Error('temporal-ready-predicate-invalid')
    return { step, predicate: { ready } }
  }
  if (!['assert', 'assertVisible', 'assertNotVisible', 'assertCount'].includes(Object.keys(raw)[0]!)) throw new Error('temporal-predicate-invalid')
  const native = await parseWorkbenchFlow(`${stringify({ name: header.name, platform: header.platform, appId: header.appId })}---\n${stringify([raw])}`, true)
  if (native.parsed.steps.length !== 1 || native.parsed.steps[0]?.kind !== 'assert') throw new Error('temporal-predicate-invalid')
  return { step, predicate: { native } }
}
