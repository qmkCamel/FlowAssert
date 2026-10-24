import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { acceptanceHash } from './workbench-change-contracts.js'
import { runResultProjection } from './workbench-contracts.js'
import type { TestRun } from './workbench-domain.js'

export const matrixKey = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), matrixId = z.string().uuid(), matrixDigest = z.string().regex(/^[a-f0-9]{64}$/)
const port = z.number().int().min(1024).max(65535)
export const matrixSlotSchema = z.object({ id: matrixKey, configId: matrixKey, platform: z.enum(['ios', 'android']),
  udid: z.string().trim().min(1).max(512), provider: z.enum(['mock', 'appium']),
  config: z.record(z.string(), z.unknown()), capabilities: z.record(z.string(), z.unknown()),
  ports: z.object({ driver: port, mjpeg: port, webview: port.optional() }).strict(),
  derivedDataPath: z.string().refine(isAbsolute).optional(),
}).strict().superRefine((s, ctx) => {
  if (s.provider === 'mock' && s.platform !== 'ios') ctx.addIssue({ code: 'custom', message: 'matrix-mock-ios-only' })
  if (s.provider === 'appium' && s.platform === 'ios' && !s.derivedDataPath) ctx.addIssue({ code: 'custom', message: 'matrix-ios-derived-directory-required' })
  if (Object.values(s.ports).some((p, i, a) => a.indexOf(p) !== i)) ctx.addIssue({ code: 'custom', message: 'matrix-port-conflict' })
})
export type MatrixSlot = z.infer<typeof matrixSlotSchema>
export const matrixCellSchema = z.object({ id: matrixKey, slotId: matrixKey, flow: matrixKey, params: z.record(z.string(), z.unknown()).default({}),
  fixture: z.object({ parallelSafe: z.boolean(), namespace: matrixKey, resourceKeys: z.array(matrixKey).max(20), reset: matrixKey.optional() }).strict(),
}).strict()
export const matrixRegistrySchema = z.object({ contractVersion: z.literal(1), slots: z.array(matrixSlotSchema).min(1).max(2),
  plans: z.record(matrixKey, z.object({ cells: z.array(matrixCellSchema).min(1).max(100) }).strict()),
}).strict().superRefine((r, ctx) => {
  const udids = r.slots.map(s => s.udid.normalize('NFKC').trim().toLowerCase()), ports = r.slots.flatMap(s => Object.values(s.ports)), directories = r.slots.flatMap(s => s.derivedDataPath ? [s.derivedDataPath] : [])
  if (new Set(r.slots.map(s => s.id)).size !== r.slots.length || new Set(udids).size !== udids.length || new Set(ports).size !== ports.length || new Set(directories).size !== directories.length) ctx.addIssue({ code: 'custom', message: 'matrix-resource-conflict' })
  for (const plan of Object.values(r.plans)) {
    if (new Set(plan.cells.map(c => c.id)).size !== plan.cells.length || plan.cells.some(c => !r.slots.some(s => s.id === c.slotId))) ctx.addIssue({ code: 'custom', message: 'matrix-cell-identity' })
    const slots = new Set(plan.cells.map(c => c.slotId))
    if (slots.size > 1 && plan.cells.some(c => !c.fixture.parallelSafe)) ctx.addIssue({ code: 'custom', message: 'matrix-parallel-fixture-unsafe' })
    for (const c of plan.cells) if (plan.cells.some(other => other.slotId !== c.slotId && other.fixture.namespace === c.fixture.namespace)) ctx.addIssue({ code: 'custom', message: 'matrix-fixture-namespace-conflict' })
  }
})
export type MatrixRegistry = z.infer<typeof matrixRegistrySchema>
export type MatrixCell = z.infer<typeof matrixCellSchema>
export const matrixAttemptSchema = z.object({ id: matrixId, runId: matrixId.optional(), storeId: matrixId,
  phase: z.enum(['queued', 'claimed', 'running', 'terminal']), status: z.enum(['pending', 'pass', 'fail', 'incomplete', 'cancelled', 'blocked']),
  startedAt: z.string().datetime().optional(), endedAt: z.string().datetime().optional(),
  manifestSha256: matrixDigest.optional(), referenceId: matrixId.optional(),
  projection: z.unknown().optional(), reason: z.string().max(160).optional(),
}).strict()
export type MatrixAttempt = z.infer<typeof matrixAttemptSchema>
export const matrixStateSchema = z.object({ contractVersion: z.literal(1), id: matrixId, planId: matrixKey, generation: matrixId,
  revision: z.number().int().positive(), phase: z.enum(['accepted', 'preparing', 'running', 'cancelling', 'finalizing', 'finished']),
  createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(), inputDigest: matrixDigest,
  projectDigest: matrixDigest, registryDigest: matrixDigest,
  slots: z.array(z.object({ id: matrixKey, storeId: matrixId, platform: z.enum(['ios', 'android']), phase: z.enum(['preparing', 'ready', 'running', 'cancelling', 'closed', 'quarantined']),
    pid: z.number().int().positive().optional(), processIdentity: z.string().optional(), generation: matrixId, cleanupConfirmed: z.boolean().optional() }).strict()).max(2),
  cells: z.array(z.object({ id: matrixKey, slotId: matrixKey, attempts: z.array(matrixAttemptSchema).min(1).max(10) }).strict()).min(1).max(100),
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(130)]).optional(), error: z.string().max(160).optional(),
}).strict()
export type MatrixState = z.infer<typeof matrixStateSchema>

export function matrixRunStatus(run: TestRun, evidence: 'verified' | 'unavailable') {
  const p = runResultProjection(run, evidence)
  if (run.verdict === 'fail' || Object.entries(p.verification).some(([key, v]) => ['ui', 'business', 'visual'].includes(key) && typeof v === 'object' && v.status === 'fail')) return 'fail' as const
  if (evidence !== 'verified' || run.phase !== 'finished' || run.cleanup !== 'session-retained' || run.resourceCleanup === 'failed' || run.resourceCleanup === 'pending') return 'incomplete' as const
  if (run.verdict === 'cancelled') return 'cancelled' as const
  if (run.verdict !== 'pass' || p.readState !== 'supported' || Object.entries(p.verification).some(([key, v]) => typeof v === 'object' && (v.required || ['ui', 'cleanup', 'evidence'].includes(key)) && v.status !== 'pass')) return 'incomplete' as const
  return 'pass' as const
}
export function matrixExitCode(state: MatrixState): 0 | 1 | 2 | 130 {
  const attempts = state.cells.flatMap(c => c.attempts)
  if (attempts.some(a => a.status === 'fail')) return 1
  if (!attempts.length || state.error || state.slots.some(s => s.phase !== 'closed') || attempts.some(a => ['pending', 'blocked', 'incomplete'].includes(a.status))) return 2
  if (attempts.some(a => a.status === 'cancelled')) return 130
  return 0
}
export function matrixSafeSummary(state: MatrixState) {
  const verification = (attempt: MatrixAttempt) => {
    const projection = attempt.projection as { verification?: Record<string, { status?: unknown }> } | undefined
    return Object.fromEntries(['ui', 'business', 'visual', 'cleanup', 'evidence'].map(key => {
      const value = key === 'evidence' && attempt.reason === 'matrix-current-evidence-unavailable' ? 'fail' : projection?.verification?.[key]?.status
      return [key, typeof value === 'string' && ['pass', 'fail', 'inconclusive', 'not-performed', 'pending', 'unknown'].includes(value) ? value : 'unknown']
    }))
  }
  return { contractVersion: 1, id: state.id, revision: state.revision, phase: state.phase, createdAt: state.createdAt, completedAt: state.completedAt,
    exitCode: state.exitCode, error: state.error, slots: state.slots.map(s => ({ id: s.id, platform: s.platform, phase: s.phase })),
    cells: state.cells.map(c => ({ id: c.id, slotId: c.slotId, attempts: c.attempts.map(a => ({ id: a.id, runId: a.runId, phase: a.phase, status: a.status, reason: a.reason, verification: verification(a) })) })) }
}
export const matrixHash = acceptanceHash
export const matrixMessageSchema = z.object({ version: z.literal(1), matrixId, slotId: matrixKey, generation: matrixId, attemptId: matrixId,
  sequence: z.number().int().positive(), requestId: matrixId, operation: z.enum(['prepare', 'connect', 'run', 'cancel', 'read', 'preview', 'close']), payload: z.unknown(),
}).strict()
export type MatrixMessage = z.infer<typeof matrixMessageSchema>
