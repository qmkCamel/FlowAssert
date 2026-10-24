import { z } from 'zod'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const uuid = z.string().uuid()
const safeCode = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const evidenceRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/)
export const triageAnalyzerIdentitySchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
  version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,63}$/), configDigest: digest }).strict()

export const triageDirectionSchema = z.enum(['product-behavior', 'locator-change', 'environment', 'evidence-gap'])
export type TriageDirection = z.infer<typeof triageDirectionSchema>

export const triageFactSchema = z.object({
  id: digest,
  source: z.enum(['run', 'comparison']),
  domain: safeCode,
  code: safeCode,
  phase: z.string().max(80),
  stepKey: z.string().max(160).optional(),
  stepIndex: z.number().int().positive().optional(),
  templateKey: safeCode,
  evidenceRefs: z.array(evidenceRef).max(64),
}).strict()

export const triageRouteSchema = z.object({
  direction: triageDirectionSchema,
  basis: z.enum(['supported', 'hypothesis', 'undetermined']),
  supportFactIds: z.array(digest).max(48),
  counterFactIds: z.array(digest).max(48),
  missingRequirements: z.array(safeCode).max(16),
  limitations: z.array(safeCode).max(16),
  nextCheckIds: z.array(safeCode).max(3),
}).strict()

export const triageReportSchema = z.object({
  schemaVersion: z.literal(1),
  rulesVersion: z.literal(1),
  analyzer: triageAnalyzerIdentitySchema.optional(),
  reportId: uuid,
  targetRunId: uuid,
  comparisonId: uuid.optional(),
  createdAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  input: z.object({ targetManifestSha256: digest, comparisonSha256: digest.optional(),
    evidence: z.array(z.object({ name: evidenceRef, sha256: digest }).strict()).max(64),
    origin: z.enum(['local-original', 'imported-original', 'derived', 'legacy-unknown']),
  }).strict(),
  reportedVerdict: z.enum(['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']).optional(),
  effectiveVerdict: z.enum(['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']).optional(),
  verification: z.object({ ui: z.enum(['pass', 'fail', 'not-performed', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']),
    business: z.enum(['pass', 'fail', 'not-performed', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']),
    visual: z.enum(['pass', 'fail', 'not-performed', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']),
    cleanup: z.enum(['pass', 'fail', 'not-performed', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']),
    evidence: z.enum(['pass', 'fail', 'not-performed', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']) }).strict(),
  focus: z.object({ kind: z.enum(['recorded-failure', 'confirmed-difference', 'observed-with-prior-gap']),
    stepKey: z.string().max(160).optional(), stepIndex: z.number().int().positive().optional(),
    phase: z.string().max(80).optional(),
  }).strict().optional(),
  facts: z.array(triageFactSchema).max(48),
  routes: z.array(triageRouteSchema).max(4),
  disposition: z.enum(['actionable', 'unknown', 'not-applicable']),
  limitations: z.array(safeCode).max(32),
  omitted: z.object({ facts: z.number().int().nonnegative(), evidence: z.number().int().nonnegative() }).strict(),
  state: z.enum(['complete', 'partial']),
  semanticDigest: digest,
  digest,
}).strict()
export type TriageReport = z.infer<typeof triageReportSchema>
export const triageAnalysisSchema = triageReportSchema.pick({ reportedVerdict: true, effectiveVerdict: true, verification: true,
  facts: true, routes: true, disposition: true, limitations: true, focus: true, omitted: true, state: true })
export type TriageAnalysis = z.infer<typeof triageAnalysisSchema>
export type TriageFact = z.infer<typeof triageFactSchema>
export type TriageRoute = z.infer<typeof triageRouteSchema>

export const triageJobSchema = z.object({
  schemaVersion: z.literal(1), jobId: uuid, requestId: uuid, requestDigest: digest,
  analyzer: triageAnalyzerIdentitySchema.optional(),
  targetRunId: uuid, comparisonId: uuid.optional(), ownerGeneration: uuid,
  state: z.enum(['queued', 'preparing', 'transforming', 'committing', 'succeeded', 'cancelling', 'cancelled', 'failed', 'interrupted']),
  progress: safeCode, createdAt: z.string().datetime({ offset: true }),
  startedAt: z.string().datetime({ offset: true }).optional(),
  finishedAt: z.string().datetime({ offset: true }).optional(),
  reportId: uuid.optional(), errorCode: safeCode.optional(),
}).strict()
export type TriageJob = z.infer<typeof triageJobSchema>

export const triageReviewSchema = z.object({
  schemaVersion: z.literal(1), reviewId: uuid, reportId: uuid, reportDigest: digest,
  revision: z.number().int().positive(), supersedes: uuid.optional(),
  reviewer: z.string().min(1).max(80), note: z.string().max(2000),
  directions: z.array(triageDirectionSchema).max(4), evidenceRefs: z.array(evidenceRef).max(16),
  createdAt: z.string().datetime({ offset: true }),
}).strict()
export type TriageReview = z.infer<typeof triageReviewSchema>

export const TRIAGE_CHECKS: Record<TriageDirection, readonly string[]> = {
  'product-behavior': ['check-expectation', 'inspect-verifier', 'inspect-app-change'],
  'locator-change': ['compare-hierarchy', 'check-page-build', 'open-repair-draft'],
  environment: ['inspect-typed-event', 'check-host-readiness', 'check-service-status'],
  'evidence-gap': ['inspect-missing-evidence', 'check-capture-permission', 'improve-observability'],
}
