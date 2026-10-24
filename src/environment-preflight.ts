import { z } from 'zod'

export const featureNames = ['media', 'ocr', 'ai-recovery', 'recording'] as const
export type PreflightFeature = typeof featureNames[number]
export const featurePolicySchema = z.enum(['off', 'preferred', 'required'])
export type FeaturePolicy = z.infer<typeof featurePolicySchema>
export const preflightInputSchema = z.object({
  entry: z.enum(['viewer', 'mcp', 'codex', 'dsh', 'cli']).optional(),
  operation: z.enum(['runtime', 'report', 'mock', 'connect', 'test']).optional(),
  provider: z.enum(['none', 'mock', 'appium']).optional(),
  platform: z.enum(['none', 'android', 'ios', 'all']).optional(),
  features: z.object({ media: featurePolicySchema.optional(), ocr: featurePolicySchema.optional(),
    'ai-recovery': featurePolicySchema.optional(), recording: featurePolicySchema.optional() }).strict().optional(),
  testRef: z.string().regex(/^(flow|suite):[A-Za-z][A-Za-z0-9_-]{0,63}$/).optional(),
}).strict()
export type PreflightInput = z.infer<typeof preflightInputSchema>
export interface EnvironmentPreflightContext {
  entry: 'viewer' | 'mcp' | 'dsh' | 'cli'
  operation: 'runtime' | 'report' | 'mock' | 'connect' | 'test'
  provider: 'none' | 'mock' | 'appium'
  platform: 'none' | 'android' | 'ios' | 'all'
  features: Record<PreflightFeature, FeaturePolicy>
  testRef?: string
  revision?: string
}
export type CheckStatus = 'pass' | 'warning' | 'blocked' | 'manual' | 'skipped'
export interface PreflightCheck {
  id: string; status: CheckStatus; code: string; suggestion: string
  version?: string; counts?: Record<string, number>
}
export interface PlannedCheck { id: string; role: 'required' | 'preferred'; feature?: PreflightFeature }
export interface PreflightReport {
  schemaVersion: 2
  context: EnvironmentPreflightContext
  platform: EnvironmentPreflightContext['platform']
  overall: 'ready' | 'blocked' | 'incomplete'
  checkedAt: string
  checks: (PreflightCheck & { role: PlannedCheck['role'] })[]
  capabilities: Partial<Record<PreflightFeature, { policy: FeaturePolicy; status: 'ready' | 'unavailable' | 'unverified' }>>
  scope: 'environment-prerequisites-only'
}

export class PreflightInputError extends Error {
  constructor() { super('preflight_input_invalid') }
}

/** Pure: validation must finish before file access, host discovery or network I/O. */
export function normalizePreflight(input: unknown = {}): EnvironmentPreflightContext {
  const parsed = preflightInputSchema.safeParse(input)
  if (!parsed.success) throw new PreflightInputError()
  const value = parsed.data
  const entry = value.entry === 'codex' ? 'mcp' : value.entry ?? 'cli'
  const operation = value.operation ?? (value.platform && value.platform !== 'none' ? 'connect' : 'runtime')
  const provider = value.provider ?? (operation === 'connect' ? 'appium' : operation === 'mock' ? 'mock' : 'none')
  const platform = value.platform ?? 'none'
  const features = Object.fromEntries(featureNames.map(key => [key, value.features?.[key] ?? 'off'])) as EnvironmentPreflightContext['features']
  if (['runtime', 'report'].includes(operation) && (provider !== 'none' || platform !== 'none' || Object.values(features).some(x => x !== 'off'))
    || operation === 'mock' && (provider !== 'mock' || platform !== 'none')
    || operation === 'connect' && (provider !== 'appium' || platform === 'none')
    || operation === 'test' && !value.testRef
    || operation !== 'test' && value.testRef
    || entry !== 'viewer' && features.recording === 'required') throw new PreflightInputError()
  return { entry, operation, provider, platform, features, ...(value.testRef ? { testRef: value.testRef } : {}) }
}

export function planEnvironmentChecks(context: EnvironmentPreflightContext): PlannedCheck[] {
  const plan: PlannedCheck[] = ['node', 'package', 'configuration'].map(id => ({ id, role: 'required' }))
  const add = (id: string, feature?: PreflightFeature) => plan.push({ id,
    role: feature && context.features[feature] === 'preferred' ? 'preferred' : 'required', ...(feature ? { feature } : {}) })
  if (context.entry === 'mcp') add('mcp-configuration')
  if (context.entry === 'dsh') { add('dsh-version'); add('dsh-profile') }
  if (context.operation === 'report') add('report-store')
  if (context.operation === 'mock' || context.provider === 'mock') add('mock-configuration')
  if (context.operation === 'test') add('registered-test')
  if ((context.operation === 'connect' || context.operation === 'test') && context.provider === 'appium') {
    if (context.platform === 'none') throw new PreflightInputError()
    add('appium-endpoint'); add('appium-command')
    if (context.platform !== 'ios') add('android')
    if (context.platform !== 'android') add('ios')
  }
  for (const feature of featureNames) if (context.features[feature] !== 'off') add(feature, feature)
  if (plan.length > 32 || new Set(plan.map(x => x.id)).size !== plan.length) throw new PreflightInputError()
  return plan
}

/** The same scheduler is used by all doctor entry points. It never grants runtime authority. */
export class EnvironmentPreflightService {
  constructor(private readonly execute: (item: PlannedCheck, signal: AbortSignal) => Promise<PreflightCheck[]>,
    private readonly timeoutMs = 60_000, private readonly now = () => new Date().toISOString()) {}

  async run(context: EnvironmentPreflightContext, signal?: AbortSignal): Promise<PreflightReport> {
    const plan = planEnvironmentChecks(context), controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), Math.min(60_000, Math.max(1, this.timeoutMs)))
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const results = new Map<string, PreflightCheck[]>()
    let index = 0
    try {
      await Promise.all(Array.from({ length: Math.min(3, plan.length) }, async () => {
        while (index < plan.length && !combined.aborted) {
          const item = plan[index++]!
          try {
            const checks = await abortable(this.execute(item, combined), combined)
            if (!checks.length) throw new Error('preflight_empty_result')
            results.set(item.id, checks)
          }
          catch { results.set(item.id, [{ id: item.id, status: 'manual', code: combined.aborted ? 'preflight_timeout' : 'preflight_check_unverified', suggestion: 'Retry the selected read-only check.' }]) }
        }
      }))
      signal?.throwIfAborted()
      const checks = plan.flatMap(item => (results.get(item.id) ?? [{ id: item.id, status: 'skipped' as const,
        code: 'preflight_not_completed', suggestion: 'Retry the selected read-only check.' }]).map(check => ({ ...check,
        status: item.role === 'preferred' && check.status !== 'pass' ? 'warning' as const : check.status, role: item.role })))
      const required = checks.filter(x => x.role === 'required')
      const overall = required.some(x => x.status === 'blocked') ? 'blocked'
        : required.some(x => x.status === 'manual' || x.status === 'skipped') ? 'incomplete' : 'ready'
      const capabilities: PreflightReport['capabilities'] = {}
      for (const item of plan) if (item.feature) {
        const raw = results.get(item.id)
        capabilities[item.feature] = { policy: context.features[item.feature], status: raw?.every(x => x.status === 'pass') ? 'ready'
          : raw?.some(x => x.status === 'blocked') ? 'unavailable' : 'unverified' }
      }
      return { schemaVersion: 2, context, platform: context.platform, overall, checkedAt: this.now(), checks, capabilities, scope: 'environment-prerequisites-only' }
    } finally { clearTimeout(deadline); controller.abort() }
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    abort = () => reject(new Error('preflight_aborted')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
  })]) } finally { signal.removeEventListener('abort', abort) }
}
