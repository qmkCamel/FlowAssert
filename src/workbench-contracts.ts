import { z } from 'zod'
import type { TestRun, Verdict } from './workbench-domain.js'
import { runtimeFeaturesSchema, runtimeDimensionSchema, runtimeDimension, type RuntimeFeature } from './workbench-runtime-contracts.js'

export const WORKBENCH_PRODUCT_CONTRACT_VERSION = 1
export const WORKBENCH_SUMMARY_RULES_VERSION = 1

const timestampSchema = z.string().datetime({ offset: true })
const publicValueSchema = z.string().min(1).max(160).refine((value) => {
  return !/[\u0000-\u001f\u007f]/.test(value)
    && !value.includes('://')
    && !value.includes('\\')
    && !value.startsWith('/')
    && !value.includes('../')
}, 'Public provenance values must be labels, not URLs, paths, or control text')
const sourceCommitSchema = z.string().regex(/^[a-f0-9]{7,64}$/i)
const evidenceRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/)

const unknownValueSchema = z.object({
  source: z.literal('unknown'),
  value: z.literal('unknown'),
  capturedAt: timestampSchema,
}).strict()

export const attributedValueSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('observed'), value: publicValueSchema, capturedAt: timestampSchema }).strict(),
  z.object({ source: z.literal('declared'), value: publicValueSchema, capturedAt: timestampSchema }).strict(),
  unknownValueSchema,
])
export type AttributedValue = z.infer<typeof attributedValueSchema>

export const runProvenanceSchema = z.object({
  contractVersion: z.literal(WORKBENCH_PRODUCT_CONTRACT_VERSION),
  capturedAt: timestampSchema,
  app: z.object({
    id: attributedValueSchema,
    version: attributedValueSchema,
    build: attributedValueSchema,
    binarySha256: z.discriminatedUnion('source', [
      z.object({ source: z.literal('observed'), value: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: timestampSchema }).strict(),
      z.object({ source: z.literal('declared'), value: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: timestampSchema }).strict(),
      unknownValueSchema,
    ]),
  }).strict(),
  environment: z.object({
    platform: attributedValueSchema,
    os: attributedValueSchema,
    provider: attributedValueSchema,
    driver: attributedValueSchema,
    runtime: attributedValueSchema,
    viewport: attributedValueSchema,
  }).strict(),
  project: z.object({
    sourceCommit: z.discriminatedUnion('source', [
      z.object({ source: z.literal('declared'), value: sourceCommitSchema, capturedAt: timestampSchema }).strict(),
      unknownValueSchema,
    ]),
    backendEnvironment: attributedValueSchema,
    testDataVersion: attributedValueSchema,
    resetContractVersion: attributedValueSchema,
  }).strict(),
}).strict()
export type RunProvenance = z.infer<typeof runProvenanceSchema>

export const verificationDimensionSchema = z.object({
  required: z.boolean(),
  status: z.enum(['not-performed', 'pass', 'fail', 'inconclusive']),
  evidenceRefs: z.array(evidenceRefSchema).max(256),
}).strict()
export type VerificationDimension = z.infer<typeof verificationDimensionSchema>

export const runVerificationSchema = z.object({
  contractVersion: z.literal(WORKBENCH_PRODUCT_CONTRACT_VERSION),
  ui: verificationDimensionSchema,
  business: verificationDimensionSchema,
  visual: verificationDimensionSchema,
  cleanup: verificationDimensionSchema,
  evidence: verificationDimensionSchema,
}).strict()
const runtimeEvidenceDimensionSchema = verificationDimensionSchema.extend({ evidenceRefs: z.array(evidenceRefSchema).max(4096) }).strict()
export const runtimeVerificationSchema = runVerificationSchema.extend({
  contractVersion: z.literal(2), health: runtimeDimensionSchema, performance: runtimeDimensionSchema,
  ui: runtimeEvidenceDimensionSchema, business: runtimeEvidenceDimensionSchema, visual: runtimeEvidenceDimensionSchema,
  cleanup: runtimeEvidenceDimensionSchema, evidence: runtimeEvidenceDimensionSchema,
}).strict()
export type RunVerification = z.infer<typeof runVerificationSchema> | z.infer<typeof runtimeVerificationSchema>

export const evidenceLineageSchema = z.discriminatedUnion('kind', [
  z.object({
    contractVersion: z.literal(WORKBENCH_PRODUCT_CONTRACT_VERSION),
    kind: z.literal('original'),
    integrity: z.enum(['verified', 'unverified', 'failed']),
    sharing: z.enum(['private', 'metadata', 'content']),
  }).strict(),
  z.object({
    contractVersion: z.literal(WORKBENCH_PRODUCT_CONTRACT_VERSION),
    kind: z.literal('derived'),
    sourceRef: evidenceRefSchema,
    transformation: publicValueSchema,
    integrity: z.enum(['verified', 'unverified', 'failed']),
    sharing: z.enum(['private', 'metadata', 'content']),
  }).strict(),
])
export type EvidenceLineage = z.infer<typeof evidenceLineageSchema>

export const productTaskStatusSchema = z.object({
  contractVersion: z.literal(WORKBENCH_PRODUCT_CONTRACT_VERSION),
  taskId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/),
  kind: z.enum(['test-run', 'suite-run', 'comparison', 'export', 'retention', 'scheduled-run']),
  phase: z.enum(['accepted', 'running', 'cancelling', 'finished', 'interrupted']),
  acceptedAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  endedAt: timestampSchema.optional(),
  cancelRequested: z.boolean(),
  progress: z.object({
    stage: publicValueSchema,
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    message: publicValueSchema.optional(),
  }).strict(),
  result: z.object({
    verdict: z.enum(['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']).optional(),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(130)]).optional(),
    errorCode: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),
  }).strict().optional(),
}).strict()
export type ProductTaskStatus = z.infer<typeof productTaskStatusSchema>

export const runProductContractV1Schema = z.object({
  contractVersion: z.literal(WORKBENCH_PRODUCT_CONTRACT_VERSION),
  summaryRulesVersion: z.literal(WORKBENCH_SUMMARY_RULES_VERSION),
  provenance: runProvenanceSchema,
  verification: runVerificationSchema,
}).strict()
export const runProductContractV2Schema = z.object({
  contractVersion: z.literal(2), summaryRulesVersion: z.literal(2), requiredFeatures: runtimeFeaturesSchema,
  provenance: runProvenanceSchema, verification: runtimeVerificationSchema,
}).strict()
export const runProductContractSchema = z.discriminatedUnion('contractVersion', [runProductContractV1Schema, runProductContractV2Schema]).superRefine((contract, ctx) => {
  if (contract.contractVersion !== 2) return
  const features = contract.requiredFeatures, verification = contract.verification
  if (verification.health.required !== features.includes('app-health-v1') || verification.performance.required !== features.includes('e2e-measure-v1')
    || features.includes('step-business-v1') && !verification.business.required || !verification.ui.required)
    ctx.addIssue({ code: 'custom', message: 'Required runtime features cannot be downgraded' })
})
export type RunProductContract = z.infer<typeof runProductContractSchema>

export type ProductContractReadState = 'legacy' | 'supported' | 'unsupported'

export interface RunResultProjection {
  contractVersion: 1 | 2
  readState: ProductContractReadState
  runId: string
  suiteId?: string
  caseId?: string
  attempt?: number
  reportedVerdict?: Verdict
  verdict?: Verdict
  clean: boolean
  exitCode: 0 | 1 | 2 | 130
  evidenceAvailability: 'verified' | 'unavailable' | 'not-checked' | 'not-revalidated'
  reasons: Array<{ domain: string; code: string; evidenceRefs: string[] }>
  visualBaselines: Array<{ profile: string; revision: number; referenceSha256: string }>
  sourceReport?: { verdict: Verdict; verification: 'not-revalidated'; shareId: string }
  provenance: RunProvenance
  verification: RunVerification
}

export const projectProvenanceDeclarationSchema = z.object({
  sourceCommit: sourceCommitSchema.optional(),
  backendEnvironment: publicValueSchema.optional(),
  testDataVersion: publicValueSchema.optional(),
  resetContractVersion: publicValueSchema.optional(),
  appVersion: publicValueSchema.optional(),
  appBuild: publicValueSchema.optional(),
  appBinarySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  required: z.array(z.enum(['appVersion', 'appBuild', 'appBinarySha256', 'sourceCommit', 'backendEnvironment', 'testDataVersion', 'resetContractVersion', 'os', 'driver', 'viewport'])).max(10).default([]),
}).strict()
export type ProjectProvenanceDeclaration = z.infer<typeof projectProvenanceDeclarationSchema>

export interface ObservedRunProvenance {
  appId?: string
  appVersion?: string
  appBuild?: string
  appBinarySha256?: string
  os?: string
  provider?: string
  driver?: string
  viewport?: string
}

function attributed(value: string | undefined, source: 'observed' | 'declared', capturedAt: string): AttributedValue {
  return value === undefined || value.trim() === ''
    ? { source: 'unknown', value: 'unknown', capturedAt }
    : attributedValueSchema.parse({ source, value, capturedAt })
}

function declaredCommit(value: string | undefined, capturedAt: string): RunProvenance['project']['sourceCommit'] {
  return value === undefined || value.trim() === ''
    ? { source: 'unknown', value: 'unknown', capturedAt }
    : { source: 'declared', value: sourceCommitSchema.parse(value), capturedAt }
}

function binaryHash(observed: string | undefined, declared: string | undefined, capturedAt: string): RunProvenance['app']['binarySha256'] {
  if (observed) return { source: 'observed', value: z.string().regex(/^[a-f0-9]{64}$/).parse(observed), capturedAt }
  if (declared) return { source: 'declared', value: z.string().regex(/^[a-f0-9]{64}$/).parse(declared), capturedAt }
  return { source: 'unknown', value: 'unknown', capturedAt }
}

export function createRunProvenance(input: {
  capturedAt: string
  appId?: string
  platform: string
  runtime: string
  observed?: ObservedRunProvenance
  declared?: ProjectProvenanceDeclaration
}): RunProvenance {
  const { capturedAt, observed = {}, declared } = input
  return runProvenanceSchema.parse({
    contractVersion: WORKBENCH_PRODUCT_CONTRACT_VERSION,
    capturedAt,
    app: {
      id: observed.appId ? attributed(observed.appId, 'observed', capturedAt) : attributed(input.appId, 'declared', capturedAt),
      version: observed.appVersion ? attributed(observed.appVersion, 'observed', capturedAt) : attributed(declared?.appVersion, 'declared', capturedAt),
      build: observed.appBuild ? attributed(observed.appBuild, 'observed', capturedAt) : attributed(declared?.appBuild, 'declared', capturedAt),
      binarySha256: binaryHash(observed.appBinarySha256, declared?.appBinarySha256, capturedAt),
    },
    environment: {
      platform: attributed(input.platform, 'observed', capturedAt),
      os: attributed(observed.os, 'observed', capturedAt),
      provider: attributed(observed.provider, 'observed', capturedAt),
      driver: attributed(observed.driver, 'observed', capturedAt),
      runtime: attributed(input.runtime, 'observed', capturedAt),
      viewport: attributed(observed.viewport, 'observed', capturedAt),
    },
    project: {
      sourceCommit: declaredCommit(declared?.sourceCommit, capturedAt),
      backendEnvironment: attributed(declared?.backendEnvironment, 'declared', capturedAt),
      testDataVersion: attributed(declared?.testDataVersion, 'declared', capturedAt),
      resetContractVersion: attributed(declared?.resetContractVersion, 'declared', capturedAt),
    },
  })
}

export function assertRequiredProvenance(provenance: RunProvenance, required: ProjectProvenanceDeclaration['required']): void {
  const values: Record<ProjectProvenanceDeclaration['required'][number], AttributedValue | RunProvenance['app']['binarySha256']> = {
    appVersion: provenance.app.version,
    appBuild: provenance.app.build,
    appBinarySha256: provenance.app.binarySha256,
    sourceCommit: provenance.project.sourceCommit,
    backendEnvironment: provenance.project.backendEnvironment,
    testDataVersion: provenance.project.testDataVersion,
    resetContractVersion: provenance.project.resetContractVersion,
    os: provenance.environment.os,
    driver: provenance.environment.driver,
    viewport: provenance.environment.viewport,
  }
  const missing = required.filter((field) => values[field].source === 'unknown')
  if (missing.length) throw new Error(`Required run provenance is unavailable: ${missing.join(', ')}`)
}

export function createRunVerification(businessRequired: boolean): z.infer<typeof runVerificationSchema> {
  return runVerificationSchema.parse({
    contractVersion: WORKBENCH_PRODUCT_CONTRACT_VERSION,
    ui: { required: true, status: 'not-performed', evidenceRefs: [] },
    business: { required: businessRequired, status: 'not-performed', evidenceRefs: [] },
    visual: { required: false, status: 'not-performed', evidenceRefs: [] },
    cleanup: { required: true, status: 'not-performed', evidenceRefs: [] },
    evidence: { required: true, status: 'not-performed', evidenceRefs: [] },
  })
}

export function enableRuntimeContract(run: TestRun, features: RuntimeFeature[], healthRequired: boolean, performanceRequired: boolean): void {
  const previous = run.productContract
  if (!previous) throw new Error('runtime-contract-provenance-missing')
  run.productContract = runProductContractV2Schema.parse({
    contractVersion: 2, summaryRulesVersion: 2, requiredFeatures: [...new Set(features)], provenance: previous.provenance,
    verification: { ...previous.verification, contractVersion: 2, business: { ...previous.verification.business, required: previous.verification.business.required || features.includes('step-business-v1') },
      health: runtimeDimension(healthRequired), performance: runtimeDimension(performanceRequired) },
  })
}

export function syncRunVerification(run: TestRun): void {
  if (!run.productContract || ![1, 2].includes(run.productContract.contractVersion)) return
  const verification = run.productContract.verification
  const uiAssertions = run.steps.filter((step) => step.kind === 'assert' || step.kind === 'assertEventually' || step.kind === 'assertStable')
  verification.ui.status = uiAssertions.some((step) => step.status === 'failed' && step.temporal?.result.status !== 'inconclusive')
    ? 'fail'
    : uiAssertions.some(step => step.temporal?.result.status === 'inconclusive') ? 'inconclusive'
    : uiAssertions.some((step) => step.status === 'passed') ? 'pass'
      : run.phase === 'finished' ? 'inconclusive' : 'not-performed'
  verification.ui.evidenceRefs = uniqueEvidence(uiAssertions.flatMap((step) => step.temporal ? [step.temporal.report] : step.evidence.map((file) => file.name)))
  verification.business.status = run.businessVerification
  verification.business.required ||= run.steps.some(step => step.kind === 'assertBusiness')
  verification.business.evidenceRefs = uniqueEvidence([...(run.extensionResults ?? []).flatMap((entry, index) => entry.role === 'verify' ? [`extension-${index + 1}.json`] : []),
    ...run.steps.flatMap(step => step.business ? [step.business.report] : [])])
  const visualSteps = run.steps.filter((step) => step.kind === 'assertVisual')
  verification.visual.required ||= visualSteps.length > 0
  verification.visual.status = run.visualVerification
  verification.visual.evidenceRefs = uniqueEvidence(visualSteps.flatMap((step) => step.evidence.map((file) => file.name)))
  verification.cleanup.status = run.cleanup === 'failed' || run.resourceCleanup === 'failed'
    ? 'fail'
    : run.phase === 'finished' && run.cleanup === 'session-retained' && run.resourceCleanup !== 'pending' ? 'pass'
      : run.phase === 'finished' ? 'inconclusive' : 'not-performed'
  const files = [...run.evidence, ...run.steps.flatMap((step) => step.evidence)]
  verification.evidence.evidenceRefs = uniqueEvidence(files.map((file) => file.name))
  verification.evidence.status = verification.evidence.status === 'fail' || files.some((file) => file.incomplete || file.lineage?.integrity === 'failed')
    ? 'fail'
    : run.phase === 'finished' && files.length > 0 ? 'pass'
      : run.phase === 'finished' ? 'inconclusive' : 'not-performed'
  runProductContractSchema.parse(run.productContract)
}

export function legacyVerification(run: TestRun): RunVerification {
  const verification = createRunVerification(run.businessVerification !== 'not-performed')
  const copy: TestRun = { ...run, productContract: { contractVersion: 1, summaryRulesVersion: 1, provenance: legacyProvenance(run), verification } }
  syncRunVerification(copy)
  return copy.productContract!.verification
}

export function legacyProvenance(run: Pick<TestRun, 'startedAt' | 'platform' | 'provider' | 'runtime'>): RunProvenance {
  const capturedAt = timestampSchema.safeParse(run.startedAt).success ? run.startedAt : new Date(0).toISOString()
  return createRunProvenance({ capturedAt, platform: run.platform, runtime: run.runtime?.workbenchVersion ?? 'unknown', observed: { provider: run.provider } })
}

export function productContractReadState(run: TestRun): ProductContractReadState {
  if (!run.productContract) return 'legacy'
  return runProductContractSchema.safeParse(run.productContract).success ? 'supported' : 'unsupported'
}

export function runResultProjection(run: TestRun, evidenceAvailability: 'verified' | 'unavailable' | 'not-checked' = 'not-checked'): RunResultProjection {
  const readState = productContractReadState(run)
  const supported = readState === 'supported' ? runProductContractSchema.safeParse(run.productContract) : undefined
  const safeState = supported?.success === false ? 'unsupported' : readState
  const availability = run.share ? 'not-revalidated' : evidenceAvailability
  const verification = supported?.success ? structuredClone(supported.data.verification) : legacyVerification(run)
  if (availability === 'unavailable') verification.evidence.status = 'fail'
  const dimensions = [verification.ui, verification.business, verification.visual, verification.cleanup, verification.evidence,
    ...(verification.contractVersion === 2 ? [verification.health, verification.performance] : [])]
  const verificationConflict = availability !== 'unavailable' && run.verdict === 'pass' && dimensions.some(dimension =>
    dimension.status === 'fail' || (safeState === 'supported' && dimension.required && dimension.status !== 'pass'))
  const verdict = availability === 'unavailable' || safeState === 'unsupported' || run.share || verificationConflict
    || (run.source === 'import' && verification.contractVersion === 2) ? 'inconclusive' : run.verdict
  const clean = verdict === 'pass'
  const reasons = (run.diagnostics ?? []).slice(0, 16).filter(item => /^[a-z][a-z0-9-]{0,63}$/.test(item.code)).map(item => ({
    domain: item.domain, code: item.code, evidenceRefs: uniqueEvidence(item.evidenceRefs).slice(0, 16),
  }))
  if (availability === 'unavailable') reasons.push({ domain: 'evidence', code: 'evidence-unavailable', evidenceRefs: [] })
  if (safeState === 'unsupported') reasons.push({ domain: 'policy', code: 'unsupported-contract', evidenceRefs: [] })
  if (run.share) reasons.push({ domain: 'evidence', code: 'not-revalidated', evidenceRefs: [] })
  if (run.source === 'import' && verification.contractVersion === 2) reasons.push({ domain: 'evidence', code: 'import-not-revalidated', evidenceRefs: [] })
  if (verificationConflict) reasons.push({ domain: 'policy', code: 'verification-conflict', evidenceRefs: [] })
  const visualBaselines = run.steps.filter(step => step.visual).slice(0, 32).map(step => ({ profile: step.visual!.profile,
    revision: step.visual!.revision, referenceSha256: step.visual!.referenceSha256 }))
  return {
    contractVersion: supported?.success ? supported.data.contractVersion : WORKBENCH_PRODUCT_CONTRACT_VERSION,
    readState: safeState,
    runId: run.id,
    ...(run.suiteId ? { suiteId: run.suiteId } : {}),
    ...(run.caseId ? { caseId: run.caseId } : {}),
    ...(run.attempt ? { attempt: run.attempt } : {}),
    ...(run.verdict ? { reportedVerdict: run.verdict } : {}),
    ...(verdict ? { verdict } : {}),
    clean,
    exitCode: clean ? 0 : verdict === 'cancelled' ? 130 : verdict === 'fail' || verdict === 'recovered' || verdict === 'evidence-conflict' || verdict === 'evidence-contaminated' ? 1 : 2,
    evidenceAvailability: availability,
    reasons,
    visualBaselines,
    ...(run.share ? { sourceReport: { verdict: run.share.reportedVerdict, verification: run.share.verification, shareId: run.share.shareId } } : {}),
    provenance: supported?.success ? supported.data.provenance : legacyProvenance(run),
    verification,
  }
}

export function validateProductContractForWrite(run: TestRun): void {
  if (!run.productContract) return
  runProductContractSchema.parse(run.productContract)
}

export function markEvidenceVerificationFailure(run: TestRun): void {
  if (run.productContract && [1, 2].includes(run.productContract.contractVersion)) run.productContract.verification.evidence.status = 'fail'
}

function uniqueEvidence(values: string[]): string[] {
  return [...new Set(values.filter((value) => evidenceRefSchema.safeParse(value).success))]
}
