import { z } from 'zod'
import { acceptanceDigest, acceptanceHash } from './workbench-change-contracts.js'

export const ocrLimits = { imageBytes: 16 * 1024 * 1024, cropBytes: 4 * 1024 * 1024, outputBytes: 256 * 1024, boxes: 256, durationMs: 10_000, processes: 2, queued: 4 } as const
const label = z.string().min(1).max(160), language = z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/)
const singleLine = z.string().min(1).max(256).refine(value => value.trim().length > 0 && !/[\r\n\u0000]/.test(value), 'ocr-single-line-required')
export const ocrCapabilitiesSchema = z.object({ contractVersion: z.literal(1), helperVersion: z.literal('1'), osVersion: label, arch: z.enum(['arm64', 'x64']), revisions: z.array(z.object({ revision: z.number().int().positive(), languages: z.array(language).min(1).max(100) }).strict()).min(1).max(10) }).strict()
export type OcrCapabilities = z.infer<typeof ocrCapabilitiesSchema>
export const ocrIdentitySchema = z.object({ sourceSha256: acceptanceDigest, binarySha256: acceptanceDigest, capabilities: ocrCapabilitiesSchema }).strict()
export type OcrIdentity = z.infer<typeof ocrIdentitySchema>
export const ocrProfileSchema = z.object({ contractVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/), revision: z.number().int().positive(),
  appId: label, platform: z.enum(['ios', 'android']), builds: z.array(label).min(1).max(20), pageKey: label,
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096), orientation: z.enum(['portrait', 'landscape']),
  region: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  identity: ocrIdentitySchema, requestRevision: z.number().int().positive(), languages: z.array(language).min(1).max(4),
  expected: singleLine, blockers: z.array(singleLine).max(10),
  normalization: z.object({ nfc: z.boolean(), trim: z.boolean() }).strict(), minimumConfidence: z.number().min(0.5).max(1),
}).strict().superRefine((p, ctx) => {
  if (p.region.x + p.region.width > p.width || p.region.y + p.region.height > p.height) ctx.addIssue({ code: 'custom', message: 'ocr-region-outside-image' })
  if ((p.orientation === 'portrait') !== (p.height >= p.width)) ctx.addIssue({ code: 'custom', message: 'ocr-orientation-mismatch' })
  const supported = p.identity.capabilities.revisions.find(r => r.revision === p.requestRevision)
  if (!supported || new Set(p.languages).size !== p.languages.length || p.languages.some(l => !supported.languages.includes(l))) ctx.addIssue({ code: 'custom', message: 'ocr-unsupported-language-or-revision' })
})
export type OcrProfile = z.infer<typeof ocrProfileSchema>
export const ocrBoxSchema = z.object({ text: z.string().max(4096), confidence: z.number().finite().min(0).max(1),
  // Normalized crop coordinates, top-left origin. Edge-touching boxes are not complete matches.
  box: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict(),
}).strict().superRefine((v, ctx) => { if (v.box.x + v.box.width > 1.000001 || v.box.y + v.box.height > 1.000001) ctx.addIssue({ code: 'custom', message: 'ocr-box-outside-region' }) })
export const ocrOutputSchema = z.object({ contractVersion: z.literal(1), helperVersion: z.literal('1'), osVersion: label, arch: z.enum(['arm64', 'x64']), requestRevision: z.number().int().positive(), languages: z.array(language).min(1).max(4), boxes: z.array(ocrBoxSchema).max(256) }).strict()
export type OcrOutput = z.infer<typeof ocrOutputSchema>
export const ocrApprovalSchema = z.object({ contractVersion: z.literal(1), profileDigest: acceptanceDigest, identityDigest: acceptanceDigest, evaluationDigest: acceptanceDigest, scopeDigest: acceptanceDigest, approver: label, approvedAt: z.string().datetime(), enabled: z.literal(true) }).strict()
export type OcrApproval = z.infer<typeof ocrApprovalSchema>
export const ocrHash = acceptanceHash

/** Candidate decision only. Production activation additionally requires a verified frozen evaluation and approval. */
export function decideOcr(profileValue: unknown, outputValue: unknown): { status: 'pass' | 'fail' | 'inconclusive'; reason: string } {
  const profile = ocrProfileSchema.parse(profileValue), output = ocrOutputSchema.parse(outputValue)
  const result = (status: 'pass' | 'fail' | 'inconclusive', reason: string) => ({ status, reason })
  const caps = profile.identity.capabilities
  if (output.osVersion !== caps.osVersion || output.arch !== caps.arch || output.helperVersion !== caps.helperVersion || output.requestRevision !== profile.requestRevision || ocrHash(output.languages) !== ocrHash(profile.languages)) return result('inconclusive', 'ocr-identity-mismatch')
  const normalize = (value: string) => { if (profile.normalization.nfc) value = value.normalize('NFC'); return profile.normalization.trim ? value.trim() : value }
  const complete = (b: OcrOutput['boxes'][number]) => b.box.x > .001 && b.box.y > .001 && b.box.x + b.box.width < .999 && b.box.y + b.box.height < .999
  if (output.boxes.some(b => complete(b) && b.confidence >= profile.minimumConfidence && profile.blockers.some(text => normalize(text) === normalize(b.text)))) return result('fail', 'ocr-explicit-blocker')
  if (output.boxes.length !== 1) return result('inconclusive', output.boxes.length ? 'ocr-ambiguous' : 'ocr-empty')
  const candidate = output.boxes[0]!
  if (!complete(candidate) || candidate.confidence < profile.minimumConfidence || !normalize(candidate.text) || /[\r\n\u0000]/.test(candidate.text)) return result('inconclusive', 'ocr-low-confidence-or-truncated')
  return normalize(candidate.text) === normalize(profile.expected) ? result('pass', 'ocr-exact-match') : result('fail', 'ocr-readable-mismatch')
}
