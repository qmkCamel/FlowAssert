import { z } from 'zod'
import { acceptanceDigest, acceptanceId } from './workbench-change-contracts.js'

export const externalLimits = { report: 5 * 1024 * 1024, attachment: 16 * 1024 * 1024, total: 64 * 1024 * 1024, count: 32, tests: 1000, depth: 16, field: 4096 } as const
export const externalLabel = z.string().min(1).max(160).refine(v => !/[\u0000-\u001f\u007f]/.test(v) && !v.includes('://') && !v.startsWith('/') && !v.includes('\\') && !v.includes('../'), 'Public label required')
export const externalKey = z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/)
const encoded = (max: number) => z.string().min(4).max(Math.ceil(max / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
export const externalMedia = z.enum(['image/png', 'image/jpeg', 'text/plain', 'application/json', 'application/xml'])
export const externalDeclaration = z.object({ commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional(), appId: externalLabel.optional(),
  platform: z.enum(['android', 'ios']).optional(), binarySha256: acceptanceDigest.optional(), build: externalLabel.optional() }).strict()
export const externalInputSchema = z.object({ contractVersion: z.literal(1), requestKey: acceptanceId, adapter: externalKey,
  engine: externalLabel, engineVersion: externalLabel, declaration: externalDeclaration.default({}), report: encoded(externalLimits.report),
  attachments: z.array(z.object({ label: externalLabel, contentType: externalMedia, bytes: encoded(externalLimits.attachment), testId: acceptanceDigest.optional() }).strict()).max(32).default([]),
  bindings: z.array(z.object({ testId: acceptanceDigest, logicalTestKey: z.string().min(1).max(160), inputDigest: acceptanceDigest }).strict()).max(1000).default([]),
}).strict()
export type ExternalInput = z.infer<typeof externalInputSchema>
export const externalTestSchema = z.object({ id: acceptanceDigest, path: z.string().max(512), name: z.string().max(4096), classname: z.string().max(4096),
  reportedStatus: z.enum(['pass', 'fail', 'error', 'skipped', 'unknown']), durationMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  logicalTestKey: z.string().min(1).max(160).optional(), inputDigest: acceptanceDigest.optional(),
}).strict()
export const externalParsedSchema = z.object({ tests: z.array(externalTestSchema).max(1000), warnings: z.array(externalKey).max(64),
  reportedStatus: z.enum(['reported-pass', 'reported-fail', 'incomplete']), generatedAt: z.string().datetime().optional(),
}).strict()
export type ExternalParsed = z.infer<typeof externalParsedSchema>
export const externalAssetSchema = z.object({ contractVersion: z.literal(1), id: acceptanceId, jobId: acceptanceId, requestKey: acceptanceId, inputDigest: acceptanceDigest,
  importedAt: z.string().datetime(), adapter: z.object({ id: externalKey, version: externalLabel }).strict(), engine: externalLabel, engineVersion: externalLabel,
  declaration: externalDeclaration, sourceDigest: acceptanceDigest, reportBytes: z.number().int().min(1).max(externalLimits.report), parsed: externalParsedSchema,
  attachments: z.array(z.object({ id: acceptanceId, label: externalLabel, contentType: externalMedia, sha256: acceptanceDigest, bytes: z.number().int().min(1).max(externalLimits.attachment), testId: acceptanceDigest.optional() }).strict()).max(32),
}).strict()
export type ExternalAsset = z.infer<typeof externalAssetSchema>
export const externalJobSchema = z.object({ contractVersion: z.literal(1), id: acceptanceId, assetId: acceptanceId, requestKey: acceptanceId, inputDigest: acceptanceDigest,
  phase: z.enum(['accepted', 'parsing', 'preview', 'committing', 'finished', 'cancelled', 'failed', 'interrupted']), createdAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(), expiresAt: z.string().datetime(), previewDigest: acceptanceDigest.optional(), error: externalKey.optional(),
}).strict()
export type ExternalJob = z.infer<typeof externalJobSchema>
export const externalProjectSchema = z.object({ identity: acceptanceDigest, revision: acceptanceDigest }).strict()
export type ExternalProject = z.infer<typeof externalProjectSchema>
export function externalResult(tests: ExternalParsed['tests'], warnings: string[]): ExternalParsed['reportedStatus'] {
  return tests.some(t => ['fail', 'error'].includes(t.reportedStatus)) ? 'reported-fail' : !tests.length || warnings.length || tests.some(t => t.reportedStatus !== 'pass') ? 'incomplete' : 'reported-pass'
}
export function externalSafeSummary(asset: ExternalAsset) {
  return { contractVersion: 1, id: asset.id, importedAt: asset.importedAt, sourceDigest: asset.sourceDigest, adapter: asset.adapter,
    reportedStatus: asset.parsed.reportedStatus, warnings: asset.parsed.warnings,
    tests: asset.parsed.tests.map(test => ({ id: test.id, reportedStatus: test.reportedStatus })),
    verification: { ui: 'reported', business: 'not-provided', visual: 'not-provided', cleanup: 'not-provided', evidence: 'locally-verified-bytes-only' },
    boundary: 'external-report-not-revalidated', attachments: asset.attachments.map(file => ({ id: file.id, sha256: file.sha256, bytes: file.bytes, ...(file.testId ? { testId: file.testId } : {}) })) }
}
