import { z } from 'zod'
import { stableJson } from './workbench-comparison.js'
import { sha256 } from './workbench-store.js'

export const acceptanceId = z.string().uuid()
export const acceptanceDigest = z.string().regex(/^[a-f0-9]{64}$/)
const label = z.string().trim().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/.test(value) && !value.includes('://') && !value.includes('\\') && !value.startsWith('/') && !value.includes('../'), 'Public labels only')
const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/)
export const legacyAcceptanceDimensions = ['ui', 'business', 'visual', 'cleanup', 'evidence'] as const
export const acceptanceDimensions = [...legacyAcceptanceDimensions, 'health', 'performance'] as const
export const acceptanceDimensionsForVersion = (version: 1 | 2) => version === 1 ? legacyAcceptanceDimensions : acceptanceDimensions
const dimension = z.enum(acceptanceDimensions)
const dimensions = z.array(dimension).min(1).max(7).refine(values => new Set(values).size === values.length)
export const acceptanceInputSchema = z.object({
  contractVersion: z.union([z.literal(1), z.literal(2)]),
  repository: label,
  commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  pullRequest: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  declarationsReviewed: z.boolean(),
  cells: z.array(z.object({
    id: key, title: label, platform: z.enum(['android', 'ios']), appId: label,
    binarySha256: acceptanceDigest, build: label,
    logicalTestKey: z.string().min(1).max(160), inputDigest: acceptanceDigest,
    environment: z.object({ os: label, provider: label, driver: label, viewport: label, backendEnvironment: label }).strict(),
    required: dimensions,
    runId: acceptanceId.optional(),
    matrixCell: z.object({ matrixId: acceptanceId, cellId: key, attemptId: acceptanceId }).strict().optional(),
    historyRunIds: z.array(acceptanceId).max(10).default([]),
    externalResults: z.array(z.object({ assetId: acceptanceId, testId: acceptanceDigest }).strict()).max(10).optional(),
  }).strict()).min(1).max(100),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.cells.map(cell => cell.id)).size !== input.cells.length) ctx.addIssue({ code: 'custom', message: 'Duplicate coverage cell' })
  for (const cell of input.cells) {
    if (input.contractVersion === 1 && cell.required.some(d => d === 'health' || d === 'performance')) ctx.addIssue({ code: 'custom', message: 'Runtime dimensions require acceptance v2' })
    if (cell.matrixCell && cell.runId !== cell.matrixCell.attemptId) ctx.addIssue({ code: 'custom', message: 'Matrix attempt must match run identity' })
    if (new Set(cell.historyRunIds).size !== cell.historyRunIds.length || (cell.runId && cell.historyRunIds.includes(cell.runId)))
      ctx.addIssue({ code: 'custom', message: 'Duplicate run in acceptance chain' })
  }
})
export type AcceptanceInput = z.infer<typeof acceptanceInputSchema>
export const acceptanceCellSchema = z.object({
  id: key, title: label, platform: z.enum(['android', 'ios']), appId: label,
  runId: acceptanceId.optional(), manifestSha256: acceptanceDigest.optional(),
  matrixCell: z.object({ matrixId: acceptanceId, cellId: key, attemptId: acceptanceId }).strict().optional(),
  status: z.enum(['pass', 'fail', 'incomplete', 'cancelled']),
  outcome: z.enum(['first-pass', 'followup-pass', 'not-clean']),
  reportedVerdict: z.enum(['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated']).optional(),
  dimensions: z.object({
    ui: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']), business: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']),
    visual: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']), cleanup: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']),
    evidence: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']), health: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']).optional(),
    performance: z.enum(['pass', 'fail', 'inconclusive', 'not-performed']).optional(),
  }).strict(),
  required: dimensions,
  reasons: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,95}$/)).max(64),
  history: z.array(z.object({ runId: acceptanceId, manifestSha256: acceptanceDigest.optional(),
    verdict: z.enum(['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated', 'unavailable']),
  }).strict()).max(10),
  externalResults: z.array(z.object({ assetId: acceptanceId, testId: acceptanceDigest, digest: acceptanceDigest.optional(), reportedStatus: z.enum(['pass', 'fail', 'error', 'skipped', 'unknown']), availability: z.enum(['verified', 'unavailable']), source: z.literal('external-report-not-revalidated') }).strict()).max(10).optional(),
}).strict()
export type AcceptanceCell = z.infer<typeof acceptanceCellSchema>
export const acceptanceSummarySchema = z.object({
  contractVersion: z.union([z.literal(1), z.literal(2)]), policyVersion: z.union([z.literal(1), z.literal(2)]),
  status: z.enum(['pass', 'fail', 'incomplete', 'cancelled']), exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(130)]),
  repository: label, commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), pullRequest: z.number().int().positive().optional(),
  sourceAssociation: z.literal('declared-not-supply-chain-verified'),
  cells: z.array(acceptanceCellSchema).min(1).max(100),
}).strict().superRefine((summary, ctx) => {
  if (summary.contractVersion !== summary.policyVersion || summary.cells.some(cell => summary.contractVersion === 1
    ? cell.dimensions.health !== undefined || cell.dimensions.performance !== undefined || cell.required.some(d => d === 'health' || d === 'performance')
    : cell.dimensions.health === undefined || cell.dimensions.performance === undefined))
    ctx.addIssue({ code: 'custom', message: 'Acceptance result version mismatch' })
})
export type AcceptanceSummary = z.infer<typeof acceptanceSummarySchema>
export const acceptanceRevisionSchema = z.object({
  contractVersion: z.union([z.literal(1), z.literal(2)]), id: acceptanceId, revision: z.number().int().min(1).max(100),
  previousSha256: acceptanceDigest.nullable(), requestKey: acceptanceId, requestDigest: acceptanceDigest,
  inputDigest: acceptanceDigest, createdAt: z.string().datetime(),
  input: acceptanceInputSchema, summary: acceptanceSummarySchema,
  references: z.array(acceptanceId).max(1100),
}).strict().superRefine((revision, ctx) => {
  if (revision.contractVersion !== revision.input.contractVersion || revision.contractVersion !== revision.summary.contractVersion)
    ctx.addIssue({ code: 'custom', message: 'Acceptance revision version mismatch' })
})
export type AcceptanceRevision = z.infer<typeof acceptanceRevisionSchema>
export const acceptancePublishSchema = z.object({
  id: acceptanceId, expectedRevision: z.number().int().min(0).max(99),
  previewId: acceptanceId, previewDigest: acceptanceDigest, requestKey: acceptanceId, reviewed: z.literal(true),
}).strict()
export type AcceptancePublish = z.infer<typeof acceptancePublishSchema>
export function acceptanceHash(value: unknown): string { return sha256(stableJson(value)) }

/** All consumers use this aggregation. Missing coverage cannot be a vacuous success. */
export function summarizeAcceptance(input: AcceptanceInput, cells: AcceptanceCell[]): AcceptanceSummary {
  if (!cells.length || cells.length !== input.cells.length || cells.some((cell, index) => cell.id !== input.cells[index]!.id)) throw new Error('acceptance-coverage-mismatch')
  const status = cells.some(cell => cell.status === 'fail') ? 'fail'
    : cells.some(cell => cell.status === 'incomplete') ? 'incomplete'
      : cells.some(cell => cell.status === 'cancelled') ? 'cancelled' : 'pass'
  return acceptanceSummarySchema.parse({ contractVersion: input.contractVersion, policyVersion: input.contractVersion, status,
    exitCode: { pass: 0, fail: 1, incomplete: 2, cancelled: 130 }[status], repository: input.repository,
    commit: input.commit, ...(input.pullRequest ? { pullRequest: input.pullRequest } : {}),
    sourceAssociation: 'declared-not-supply-chain-verified', cells })
}

/** No raw errors, YAML, params, provenance dumps, paths or media cross this boundary. */
export function acceptanceMarkdown(summary: AcceptanceSummary, createdAt: string): string {
  acceptanceSummarySchema.parse(summary)
  z.string().datetime().parse(createdAt)
  const escape = (value: string) => value.replace(/[&<>"'\\`*_[\]{}()|!#~:+.\-]/g, char => `&#${char.codePointAt(0)};`)
  return [ '# 变更验收 / Change acceptance', '',
    `仓库 / Repository: ${escape(summary.repository)}`, `Commit: ${summary.commit}`,
    ...(summary.pullRequest ? [`PR: ${summary.pullRequest}`] : []),
    `结果 / Result: ${summary.status}; exitCode=${summary.exitCode}`, `生成时间 / Generated: ${createdAt}`, '',
    '来源为声明关联，未验证制品供应链。只覆盖下面明确声明的范围；材料此后可能变化。',
    'Declared association, not supply-chain verification. Only the declared scope is covered; evidence can change after generation.', '',
    '| 场景 / Scenario | 平台 / Platform | 结果 / Result | UI | Business | Visual | Cleanup | Evidence |' + (summary.contractVersion === 2 ? ' Health | Performance |' : '') + ' 缺口 / Gaps |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |' + (summary.contractVersion === 2 ? ' --- | --- |' : '') + ' --- |',
    ...summary.cells.map(cell => `| ${escape(cell.title)} | ${cell.platform} | ${cell.status} (${cell.outcome}) | ${acceptanceDimensionsForVersion(summary.contractVersion).map(d => cell.dimensions[d]).join(' | ')} | ${cell.reasons.join(', ')} |`), '',
    ...summary.cells.flatMap(cell => [`${escape(cell.id)}: ${cell.runId ?? 'unselected'}; manifest=${cell.manifestSha256 ?? 'unavailable'}`,
      ...cell.history.map(item => `  ${item.runId}: ${item.verdict}; manifest=${item.manifestSha256 ?? 'unavailable'}`),
      ...(cell.externalResults ?? []).map(item => `  external-result ${item.assetId}/${item.testId}: reported-${item.reportedStatus}; ${item.availability}; ${item.source}; digest=${item.digest ?? 'unavailable'}`)]), '',
  ].join('\n')
}
