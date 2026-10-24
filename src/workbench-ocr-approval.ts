import { z } from 'zod'
import { ocrApprovalSchema, ocrHash, ocrProfileSchema, type OcrIdentity } from './workbench-ocr-contracts.js'
import { evaluatedOcrProfile, ocrEvaluationSchema, summarizeOcrEvaluation } from './workbench-ocr-evaluation.js'

export const ocrRegistrationSchema = z.object({ profile: ocrProfileSchema, evaluation: ocrEvaluationSchema,
  approval: ocrApprovalSchema.optional(), page: z.unknown(),
}).strict()
export type OcrRegistration = z.infer<typeof ocrRegistrationSchema>

export function ocrScopeDigest(projectDigest: string, registration: Pick<OcrRegistration, 'profile' | 'page'>): string {
  if (!/^[a-f0-9]{64}$/.test(projectDigest) || !registration.page) throw new Error('ocr-scope-required')
  return ocrHash({ projectDigest, page: registration.page, profileDigest: ocrHash(registration.profile) })
}

/** Host-local explicit approval only. Candidate-go by itself never grants authority. */
export function approveOcrRegistration(value: unknown, projectDigest: string, approver: string, confirmed: boolean): OcrRegistration {
  if (confirmed !== true) throw new Error('ocr-explicit-approval-required')
  const registration = ocrRegistrationSchema.parse(value)
  const summary = summarizeOcrEvaluation(registration.evaluation)
  if (summary.gate !== 'candidate-go' || !evaluatedOcrProfile(registration.evaluation, registration.profile)) throw new Error('ocr-evaluation-not-approved')
  return { ...registration, approval: ocrApprovalSchema.parse({ contractVersion: 1,
    profileDigest: ocrHash(registration.profile), identityDigest: ocrHash(registration.profile.identity),
    evaluationDigest: summary.evaluationDigest, scopeDigest: ocrScopeDigest(projectDigest, registration),
    approver, approvedAt: new Date().toISOString(), enabled: true }) }
}

export function requireOcrApproval(value: unknown, projectDigest: string, currentIdentity?: OcrIdentity): OcrRegistration {
  const registration = ocrRegistrationSchema.parse(value), { approval, profile, evaluation } = registration
  const summary = summarizeOcrEvaluation(evaluation)
  if (!approval || summary.gate !== 'candidate-go' || !evaluatedOcrProfile(evaluation, profile)
    || approval.profileDigest !== ocrHash(profile) || approval.identityDigest !== ocrHash(profile.identity)
    || approval.evaluationDigest !== summary.evaluationDigest || approval.scopeDigest !== ocrScopeDigest(projectDigest, registration)
    || currentIdentity && ocrHash(currentIdentity) !== approval.identityDigest) throw new Error('ocr-approval-missing-or-stale')
  return registration
}
