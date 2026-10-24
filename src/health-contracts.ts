import { z } from 'zod'
import { createHash } from 'node:crypto'

export type HealthSignal = 'crash' | 'anr' | 'hang'
export interface HealthCapability {
  schemaVersion: 1; platform: 'android' | 'ios' | 'mock' | 'unknown'; source: string; sourceVersion: string
  signals: Partial<Record<HealthSignal, { supported: boolean; reason: string }>>
  completeness?: { processIdentity: boolean; windowCursors: boolean; detectableLoss: boolean; monotonicMapping: boolean; drainAcknowledgement: boolean }
}
export interface HealthBinding { runId: string; sessionId: string; sessionGeneration: number; appId: string; attempt: number }
const label = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,191}$/)
export const healthEventSchema = z.object({
  signal: z.enum(['crash', 'anr', 'hang', 'normal-exit', 'unexpected-exit']), appId: label, processGeneration: label,
  sequence: z.number().int().nonnegative(), atMs: z.number().finite().nonnegative(), operationId: z.string().uuid().optional(),
  attribution: z.enum(['confirmed', 'uncertain']), bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type HealthEvent = z.infer<typeof healthEventSchema>
export interface HealthWindow {
  schemaVersion: 1; bindingDigest: string; startMs: number; endMs: number; startCursor: string; endCursor: string
  ready: boolean; drained: boolean; dropped: number; rawBytes: number; gaps: string[]; events: HealthEvent[]
  maxQueueDepth: number; clockMapping: 'verified' | 'uncertain'
  processes: { generation: string; fromMs: number; toMs: number }[]
}
export interface HealthCollector {
  /** Trusted adapters must settle on abort; late observations are not evidence. */
  ready(signal: AbortSignal): Promise<void>
  stopAndDrain(signal: AbortSignal): Promise<HealthWindow>
  /** On budget expiry, force-reap owned children and await exit before settling.
   * Never reclaim an external process or release ownership with a child alive. */
  close(signal: AbortSignal): Promise<void>
}
export interface HealthReport {
  schemaVersion: 1; status: 'pass' | 'fail' | 'inconclusive'; reason: string; source: string; sourceVersion: string
  signals: HealthSignal[]; bindingDigest: string; durationMs: number; coverage: 'complete' | 'incomplete'; gaps: string[]
  violations: { signal: HealthSignal; atMs: number }[]; expectedExits: number; unexpectedExits: number
  windowSha256?: string
}
export const healthBindingDigest = (binding: HealthBinding) => createHash('sha256').update(JSON.stringify(binding)).digest('hex')
export function requireHealthCapability(capability: HealthCapability | undefined, signals: HealthSignal[]): HealthCapability {
  if (!capability || capability.schemaVersion !== 1 || !/^[a-zA-Z0-9._-]{1,96}$/.test(capability.source)
    || !/^[a-zA-Z0-9._-]{1,96}$/.test(capability.sourceVersion) || signals.some(signal => !capability.signals[signal]?.supported)
    || !capability.completeness || ['processIdentity', 'windowCursors', 'detectableLoss', 'monotonicMapping', 'drainAcknowledgement']
      .some(key => capability.completeness![key as keyof NonNullable<HealthCapability['completeness']>] !== true))
    throw new Error('health-source-unsupported')
  return capability
}
export function evaluateHealthWindow(capability: HealthCapability, signals: HealthSignal[], binding: HealthBinding, window: HealthWindow,
  expectedOperations: string[] = []): HealthReport {
  requireHealthCapability(capability, signals)
  const digest = healthBindingDigest(binding), gaps = new Set(window.gaps.filter(reason => /^[a-z][a-z0-9-]{0,95}$/.test(reason)))
  if (window.gaps.length !== gaps.size) gaps.add('health-invalid-gaps')
  if (window.schemaVersion !== 1 || window.bindingDigest !== digest || !window.ready || !window.startCursor || !window.endCursor
    || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || window.startMs < 0 || window.endMs < window.startMs) gaps.add('health-window-unconfirmed')
  if (!window.drained) gaps.add('health-drain-unconfirmed')
  if (window.clockMapping !== 'verified') gaps.add('health-time-mapping-uncertain')
  if (!Number.isInteger(window.maxQueueDepth) || window.maxQueueDepth < 0 || window.maxQueueDepth > 256) gaps.add('health-queue-overflow')
  if (window.endMs - window.startMs > 600000) gaps.add('health-window-budget')
  const processes = window.processes ?? []
  if (!processes.length || processes.length > 64 || !processes.some(process => process.fromMs <= window.endMs && process.toMs >= window.startMs)
    || new Set(processes.map(process => process.generation)).size !== processes.length
    || processes.some(process => !label.safeParse(process.generation).success || !Number.isFinite(process.fromMs) || !Number.isFinite(process.toMs) || process.fromMs < 0 || process.toMs < process.fromMs))
    gaps.add('health-process-generation-unconfirmed')
  if (!Number.isInteger(window.dropped) || window.dropped !== 0) gaps.add('health-source-loss')
  if (!Number.isFinite(window.rawBytes) || window.rawBytes < 0 || window.rawBytes > 16 * 1024 * 1024
    || window.events.length > 10000 || Buffer.byteLength(JSON.stringify(window.events)) > 2 * 1024 * 1024) gaps.add('health-source-overflow')
  const violations: HealthReport['violations'] = [], seen = new Map<number, string>()
  let expectedExits = 0, unexpectedExits = 0
  // Parse only the bounded prefix; overflow is explicitly untrustworthy, not clean.
  for (const raw of window.events.slice(0, 10000)) {
    const parsed = healthEventSchema.safeParse(raw)
    if (!parsed.success) { gaps.add('health-event-invalid'); continue }
    const event = parsed.data
    if (event.appId !== binding.appId) continue
    if (event.attribution !== 'confirmed') { gaps.add('health-attribution-uncertain'); continue }
    if (event.atMs < window.startMs || event.atMs > window.endMs) continue
    if (event.bindingDigest !== digest || !processes.some(process => process.generation === event.processGeneration && event.atMs >= process.fromMs && event.atMs <= process.toMs)) { gaps.add('health-attribution-uncertain'); continue }
    const serialized = JSON.stringify(event), prior = seen.get(event.sequence)
    if (prior) { if (prior !== serialized) gaps.add('health-sequence-conflict'); continue }
    seen.set(event.sequence, serialized)
    if (event.signal === 'normal-exit') {
      if (event.operationId && expectedOperations.includes(event.operationId)) expectedExits++
      else { unexpectedExits++; gaps.add('health-unexpected-exit') }
    } else if (event.signal === 'unexpected-exit') { unexpectedExits++; gaps.add('health-unexpected-exit') }
    else if (signals.includes(event.signal)) violations.push({ signal: event.signal, atMs: event.atMs - window.startMs })
  }
  return { schemaVersion: 1, status: violations.length ? 'fail' : gaps.size ? 'inconclusive' : 'pass',
    reason: violations.length ? 'health-violation' : gaps.size ? [...gaps][0]! : 'health-window-clean',
    source: capability.source, sourceVersion: capability.sourceVersion, signals, bindingDigest: digest,
    durationMs: Number.isFinite(window.endMs - window.startMs) ? Math.max(0, window.endMs - window.startMs) : 0,
    coverage: gaps.size ? 'incomplete' : 'complete', gaps: [...gaps], violations, expectedExits, unexpectedExits }
}
