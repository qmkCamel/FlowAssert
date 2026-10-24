import { z } from 'zod'
import { createHash } from 'node:crypto'

export const REPAIR_CONTRACT_VERSION = 1
export const REPAIR_JSON_LIMIT = 1024 * 1024
export const repairId = z.string().uuid()
export const repairDigest = z.string().regex(/^[a-f0-9]{64}$/)
export const repairName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
const timestamp = z.string().datetime({ offset: true })
const boundedStrings = z.array(z.string().min(1).max(192)).max(64)
export const repairRouteSchema = z.enum(['locator-maintenance', 'product-code'])
export const repairOutcomeSchema = z.enum(['candidate-only', 'software-verified', 'device-verified', 'not-fixed', 'blocked', 'inconclusive', 'cancelled', 'budget-exhausted'])
export const repairGradeSchema = z.enum(['proposal', 'software', 'device'])
export const repairPhaseSchema = z.enum(['planning', 'awaiting-approval', 'queued', 'preparing', 'patching', 'checking', 'building', 'installing', 'revalidating', 'regressing', 'finalizing', 'finished', 'blocked', 'cancelling'])
export const repairOperationSchema = z.enum(['share-evidence', 'generate-patch', 'software-check', 'build', 'install', 'baseline', 'revalidate', 'regress'])
export const repairErrorSchema = z.enum(['repair-evidence-unavailable', 'repair-ineligible', 'repair-project-changed', 'repair-approval-required', 'repair-stale-approval', 'repair-invalid-patch', 'repair-capability-unavailable', 'repair-not-reproduced', 'repair-install-identity-unverified', 'repair-unknown-mutation', 'repair-storage-insufficient', 'repair-budget-exhausted', 'repair-invalid-contract', 'repair-request-conflict', 'repair-revision-conflict', 'repair-busy', 'repair-not-found', 'repair-cancelled', 'repair-interrupted', 'repair-dependency-unresolved', 'repair-reference-invalid'])
export type RepairErrorCode = z.infer<typeof repairErrorSchema>
export class RepairError extends Error {
  constructor(readonly code: RepairErrorCode) { super(code); this.name = 'RepairError' }
}

export const repairBudgetSchema = z.object({
  maxAttempts: z.number().int().min(1).max(2).default(2),
  baselineRuns: z.literal(1).default(1),
  candidateRuns: z.literal(2).default(2),
  maxRegressionCases: z.number().int().min(1).max(20).default(20),
  executionMs: z.number().int().min(1).max(1_800_000).default(600_000),
  approvalMs: z.number().int().min(1).max(1_800_000).default(1_800_000),
  lifetimeMs: z.number().int().min(1).max(86_400_000).default(86_400_000),
  evidenceBytes: z.number().int().min(1).max(64 * 1024 * 1024).default(64 * 1024 * 1024),
}).strict()
const sourceSchema = z.object({ runId: repairId, manifestSha256: repairDigest }).strict()
export const repairCheckSchema = z.object({
  id: repairName, kind: z.enum(['software', 'baseline', 'candidate', 'regression']),
  inputDigest: repairDigest,
}).strict()
export const repairPlanSchema = z.object({
  contractVersion: z.literal(1), id: repairId, caseId: repairId, projectId: repairName, projectRevision: repairDigest,
  route: repairRouteSchema, sourceSnapshot: sourceSchema, baselineSnapshot: sourceSchema.optional(),
  protectedAssertionsDigest: repairDigest, dependencyDigest: repairDigest, paramsDigest: repairDigest,
  environmentDigest: repairDigest, resetDigest: repairDigest, baselineBuild: repairDigest,
  platform: z.enum(['android', 'ios']), appId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  target: z.enum(['mock', 'simulator', 'physical']), targetDeviceBinding: repairDigest,
  requiredChecks: z.array(repairCheckSchema).min(1).max(24), budget: repairBudgetSchema,
  createdAt: timestamp, digest: repairDigest,
}).strict().superRefine((plan, ctx) => {
  const { digest, ...body } = plan
  if (digest !== createHash('sha256').update(JSON.stringify(body)).digest('hex'))
    ctx.addIssue({ code: 'custom', message: 'Frozen plan digest is invalid' })
  const checks = plan.requiredChecks
  if (new Set(checks.map(check => check.id)).size !== checks.length) ctx.addIssue({ code: 'custom', message: 'Duplicate required check' })
  if (checks.filter(check => check.kind === 'baseline').length !== 1
    || checks.filter(check => check.kind === 'candidate').length !== 2
    || (plan.route === 'locator-maintenance' && checks.filter(check => check.kind === 'regression').length < 1)
    || checks.filter(check => check.kind === 'regression').length > plan.budget.maxRegressionCases)
    ctx.addIssue({ code: 'custom', message: 'Invalid frozen baseline, candidate or mobile regression checks' })
  if (plan.route === 'locator-maintenance' && (!plan.baselineSnapshot || plan.budget.executionMs > 600_000))
    ctx.addIssue({ code: 'custom', message: 'Locator repair needs an anchor and a bounded execution budget' })
  if (plan.route === 'product-code' && !checks.some(check => check.kind === 'software'))
    ctx.addIssue({ code: 'custom', message: 'Code repair needs independent software checks' })
})
export const repairApprovalSchema = z.object({
  contractVersion: z.literal(1), id: repairId, caseId: repairId, principal: repairName,
  channel: z.enum(['local-viewer', 'interactive-cli']), level: z.enum(['scope', 'execution', 'installation']),
  planDigest: repairDigest, projectRevision: repairDigest, patchDigest: repairDigest.optional(), artifactDigest: repairDigest.optional(),
  targetDeviceBinding: repairDigest, allowedOperations: z.array(repairOperationSchema).min(1).max(8),
  issuedAt: timestamp, expiresAt: timestamp,
}).strict().superRefine((approval, ctx) => {
  const ops = approval.allowedOperations
  if (new Set(ops).size !== ops.length || Date.parse(approval.expiresAt) <= Date.parse(approval.issuedAt)
    || Date.parse(approval.expiresAt) - Date.parse(approval.issuedAt) > 1_800_000)
    ctx.addIssue({ code: 'custom', message: 'Invalid approval range' })
  if (approval.level === 'scope' && (ops.some(op => !['share-evidence', 'generate-patch'].includes(op)) || approval.patchDigest || approval.artifactDigest))
    ctx.addIssue({ code: 'custom', message: 'Scope approval does not authorize execution' })
  if (approval.level !== 'scope' && !approval.patchDigest) ctx.addIssue({ code: 'custom', message: 'Exact patch required' })
  if (ops.includes('install') && (approval.level !== 'installation' || !approval.artifactDigest))
    ctx.addIssue({ code: 'custom', message: 'Installation requires the exact artifact' })
  if (approval.level === 'installation' && (!approval.artifactDigest || !ops.includes('install')))
    ctx.addIssue({ code: 'custom', message: 'Invalid installation approval' })
})
const repairLocator = z.object({ key: z.enum(['id', 'accessibilityId']), value: z.string().min(1).max(256) }).strict()
export const repairCandidateSchema = z.object({
  status: z.literal('candidate'), sourceRunId: repairId, baselineRunId: repairId, sourcePlanDigest: repairDigest,
  sourceManifestSha256: repairDigest, baselineManifestSha256: repairDigest,
  failureEvidence: z.object({ name: z.string().min(1).max(192), sha256: repairDigest }).strict(),
  baselineEvidence: z.object({ name: z.string().min(1).max(192), sha256: repairDigest }).strict(),
  stepIndex: z.number().int().positive(), sourceLine: z.number().int().nonnegative(),
  before: repairLocator, after: repairLocator, semanticDiff: z.string().min(1).max(1024),
  yaml: z.string().min(1).refine(value => Buffer.byteLength(value) <= 64 * 1024), digest: repairDigest,
}).strict().superRefine((value, ctx) => {
  const { digest, ...body } = value
  if (value.before.key !== value.after.key || value.before.value === value.after.value
    || digest !== createHash('sha256').update(JSON.stringify(body)).digest('hex'))
    ctx.addIssue({ code: 'custom', message: 'Candidate digest or locator diff is invalid' })
})
export const repairAttemptSchema = z.object({
  contractVersion: z.literal(1), id: repairId, caseId: repairId, generation: z.number().int().positive(),
  parentAttemptId: repairId.optional(), requestDigest: repairDigest, patchDigest: repairDigest,
  planDigest: repairDigest, createdAt: timestamp, finishedAt: timestamp.optional(),
  childRunIds: z.array(repairId).max(23), commandReceipts: boundedStrings, artifactRefs: boundedStrings,
  baselineRuns: z.number().int().min(0).max(1), candidateRuns: z.number().int().min(0).max(2),
  regressionRuns: z.number().int().min(0).max(20), executionMs: z.number().int().min(0).max(1_800_000),
  outcome: repairOutcomeSchema.optional(), reason: repairErrorSchema.optional(),
}).strict().superRefine((attempt, ctx) => {
  if (Boolean(attempt.finishedAt) !== Boolean(attempt.outcome)) ctx.addIssue({ code: 'custom', message: 'Attempt terminal fields must agree' })
})
export const repairResetSchema = z.object({
  contractVersion: z.literal(1), id: repairId, caseId: repairId, attemptId: repairId,
  generation: z.number().int().positive(), checkId: repairName, requestedAt: timestamp,
  status: z.enum(['prepared', 'completed', 'unknown']),
  receipt: z.object({ namespaceId: repairId, initialStateSha256: repairDigest,
    sessionId: z.string().min(1).max(128), observedAt: timestamp }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.status === 'completed') !== Boolean(value.receipt))
    ctx.addIssue({ code: 'custom', message: 'Only a completed reset has an attested receipt' })
})
export const repairCheckReceiptSchema = z.object({
  checkId: repairName, inputDigest: repairDigest, planDigest: repairDigest, patchDigest: repairDigest,
  status: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']),
  origin: z.enum(['mock', 'simulator', 'physical', 'software']),
  evidenceRefs: boundedStrings, evidenceVerified: z.boolean(), cleanupPassed: z.boolean(), recovered: z.boolean(),
  runId: repairId.optional(), namespaceDigest: repairDigest.optional(), artifactDigest: repairDigest.optional(),
  targetDeviceBinding: repairDigest.optional(), failureFingerprint: repairDigest.optional(),
  checkedAt: timestamp,
}).strict()
export const repairVerificationSchema = z.object({
  contractVersion: z.literal(1), id: repairId, caseId: repairId, attemptId: repairId,
  planDigest: repairDigest, patchDigest: repairDigest, artifactDigest: repairDigest.optional(),
  checks: z.array(repairCheckReceiptSchema).max(24), gaps: z.array(repairErrorSchema).max(32),
  grade: repairGradeSchema, outcome: repairOutcomeSchema, checkedAt: timestamp,
}).strict().superRefine((record, ctx) => {
  const expected = record.outcome === 'device-verified' ? 'device' : record.outcome === 'software-verified' ? 'software' : 'proposal'
  if (record.grade !== expected || (record.grade !== 'proposal' && record.gaps.length > 0))
    ctx.addIssue({ code: 'custom', message: 'Verification grade conflicts with outcome or gaps' })
  if (new Set(record.checks.map(check => check.checkId)).size !== record.checks.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate check receipt' })
})
export const repairCaseSchema = z.object({
  contractVersion: z.literal(1), id: repairId, requestId: repairId, requestDigest: repairDigest,
  projectId: repairName, projectRevision: repairDigest, owner: repairName, sourceSnapshot: sourceSchema,
  route: repairRouteSchema, planId: repairId, planDigest: repairDigest, phase: repairPhaseSchema,
  resumePhase: z.literal('installing').optional(), outcome: repairOutcomeSchema.optional(), reason: repairErrorSchema.optional(),
  revision: z.number().int().positive(), generation: z.number().int().nonnegative(),
  attempts: z.array(repairId).max(2), approvals: z.array(repairId).max(8), verificationIds: z.array(repairId).max(2),
  budget: repairBudgetSchema, spentExecutionMs: z.number().int().min(0).max(1_800_000),
  createdAt: timestamp, updatedAt: timestamp, expiresAt: timestamp, cancelRequestedAt: timestamp.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.attempts.length > value.budget.maxAttempts || value.spentExecutionMs > value.budget.executionMs
    || Date.parse(value.expiresAt) <= Date.parse(value.createdAt)
    || Date.parse(value.expiresAt) - Date.parse(value.createdAt) > value.budget.lifetimeMs)
    ctx.addIssue({ code: 'custom', message: 'Case exceeds its frozen budget' })
  if (value.phase === 'finished' && !value.outcome) ctx.addIssue({ code: 'custom', message: 'Finished case needs an outcome' })
  if (value.phase !== 'finished' && ['software-verified', 'device-verified'].includes(value.outcome ?? ''))
    ctx.addIssue({ code: 'custom', message: 'Unfinished case cannot be verified' })
  if (value.cancelRequestedAt && ['software-verified', 'device-verified'].includes(value.outcome ?? ''))
    ctx.addIssue({ code: 'custom', message: 'Cancelled case cannot become verified' })
})

export type RepairPlan = z.infer<typeof repairPlanSchema>
export type RepairApproval = z.infer<typeof repairApprovalSchema>
export type RepairCandidate = z.infer<typeof repairCandidateSchema>
export type RepairAttempt = z.infer<typeof repairAttemptSchema>
export type RepairReset = z.infer<typeof repairResetSchema>
export type RepairCase = z.infer<typeof repairCaseSchema>
export type RepairVerification = z.infer<typeof repairVerificationSchema>
export type RepairCheckReceipt = z.infer<typeof repairCheckReceiptSchema>
export type RepairOutcome = z.infer<typeof repairOutcomeSchema>
export type RepairOperation = z.infer<typeof repairOperationSchema>

/** All persisted/transport objects pass the same size and strict versioned schema. */
export function parseRepair<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  try {
    const text = JSON.stringify(value)
    if (!text || Buffer.byteLength(text) > REPAIR_JSON_LIMIT) throw new Error('budget')
    return schema.parse(value)
  } catch { throw new RepairError('repair-invalid-contract') }
}

/** Projection only, never turns a caller-supplied report into a trusted receipt. */
export function repairExitCode(outcome: RepairOutcome, requiredGrade: 'software' | 'device' = 'device'): 0 | 1 | 130 {
  if (outcome === 'cancelled') return 130
  return outcome === 'device-verified' || (requiredGrade === 'software' && outcome === 'software-verified') ? 0 : 1
}
