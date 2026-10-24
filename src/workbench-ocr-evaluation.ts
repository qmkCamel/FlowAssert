import { z } from 'zod'
import { createHash } from 'node:crypto'
import { decideOcr, ocrHash, ocrLimits, ocrOutputSchema, ocrProfileSchema, type OcrProfile } from './workbench-ocr-contracts.js'
import type { WorkbenchOcr } from './workbench-ocr.js'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const label = z.string().min(1).max(160)
const verdict = z.enum(['pass', 'fail', 'inconclusive'])
export const ocrSafetyTags = ['unreadable', 'truncated', 'ambiguous', 'rotated', 'scope-mismatch', 'prompt-injection'] as const
export const ocrCaseSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), profileId: label, split: z.enum(['development', 'frozen']),
  group: z.enum(['admitted', 'safety']), source: z.enum(['synthetic', 'authorized-real']),
  authorization: label, imageSha256: digest, nearDuplicateGroup: label,
  expected: verdict, tags: z.array(z.enum([...ocrSafetyTags, 'similar-glyph', 'light', 'dark', 'blocker'])).max(10),
}).strict().superRefine((item, ctx) => {
  if (item.group === 'admitted' && item.expected === 'inconclusive' || item.group === 'safety' && item.expected === 'pass')
    ctx.addIssue({ code: 'custom', message: 'ocr-invalid-group-label' })
})
export const ocrDatasetSchema = z.object({ contractVersion: z.literal(1), frozenAt: z.string().datetime(),
  profiles: z.array(ocrProfileSchema).min(1).max(20), cases: z.array(ocrCaseSchema).min(1).max(256),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.profiles.map(p => p.id)).size !== data.profiles.length || new Set(data.cases.map(c => c.id)).size !== data.cases.length
    || data.cases.some(c => !data.profiles.some(p => p.id === c.profileId))) ctx.addIssue({ code: 'custom', message: 'ocr-dataset-identity' })
})
export type OcrDataset = z.infer<typeof ocrDatasetSchema>
export const ocrEvaluationRowSchema = z.object({ id: label, output: ocrOutputSchema.optional(),
  status: verdict, reason: label, durationMs: z.number().finite().nonnegative().max(120_000),
}).strict()
export const ocrEvaluationSchema = z.object({ contractVersion: z.literal(1), dataset: ocrDatasetSchema, datasetDigest: digest,
  completedAt: z.string().datetime(), rows: z.array(ocrEvaluationRowSchema).min(1).max(256),
}).strict()
export type OcrEvaluation = z.infer<typeof ocrEvaluationSchema>
const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Freeze labels and byte identities before invoking any recognizer. No device or production authority. */
export function freezeOcrDataset(value: unknown): { dataset: OcrDataset; digest: string } {
  const dataset = ocrDatasetSchema.parse(value)
  return { dataset, digest: ocrHash(dataset) }
}

export async function evaluateOcrDataset(value: unknown, expectedDigest: string, images: ReadonlyMap<string, Buffer>,
  recognizer: Pick<WorkbenchOcr, 'preview'>, signal = new AbortController().signal): Promise<OcrEvaluation> {
  const frozen = freezeOcrDataset(value)
  if (Date.parse(frozen.dataset.frozenAt) > Date.now()) throw new Error('ocr-freeze-time-in-future')
  if (frozen.digest !== expectedDigest) throw new Error('ocr-frozen-dataset-changed')
  // Capture all input bytes before starting, preventing mutation or relabelling during evaluation.
  const bytes = new Map<string, Buffer>(); let total = 0
  for (const item of frozen.dataset.cases) {
    const image = images.get(item.id)
    if (!image || !image.length || image.length > ocrLimits.imageBytes || (total += image.length) > 128 * 1024 * 1024 || hashBytes(image) !== item.imageSha256)
      throw new Error('ocr-evaluation-image-integrity-or-budget')
    bytes.set(item.id, Buffer.from(image))
  }
  const rows: OcrEvaluation['rows'] = []
  for (const item of frozen.dataset.cases) {
    signal.throwIfAborted(); const started = performance.now()
    const profile = frozen.dataset.profiles.find(p => p.id === item.profileId)!
    try {
      const result = await recognizer.preview(bytes.get(item.id)!, profile, signal)
      signal.throwIfAborted()
      if (result.imageSha256 !== item.imageSha256 || result.profileDigest !== ocrHash(profile) || ocrHash(result.identity) !== ocrHash(profile.identity)) throw new Error('ocr-evaluation-source-mismatch')
      const output = ocrOutputSchema.parse(result.output), decision = decideOcr(profile, output)
      rows.push({ id: item.id, output, ...decision, durationMs: performance.now() - started })
    } catch (error) {
      signal.throwIfAborted()
      const rejection = error instanceof Error && ['ocr-image-geometry', 'ocr-profile-version-changed'].includes(error.message) ? error.message : 'ocr-recognition-unavailable'
      rows.push({ id: item.id, status: 'inconclusive', reason: rejection, durationMs: performance.now() - started })
    }
  }
  return ocrEvaluationSchema.parse({ contractVersion: 1, dataset: frozen.dataset, datasetDigest: frozen.digest, rows, completedAt: new Date().toISOString() })
}

/** Recompute all gates from frozen labels and raw outputs, never trust an imported gate flag. */
export function summarizeOcrEvaluation(value: unknown) {
  const report = ocrEvaluationSchema.parse(value), { dataset, rows } = report
  if (report.datasetDigest !== ocrHash(dataset) || rows.length !== dataset.cases.length || new Set(rows.map(r => r.id)).size !== rows.length)
    throw new Error('ocr-evaluation-integrity')
  const reasons = new Set<string>()
  if (Date.parse(dataset.frozenAt) > Date.parse(report.completedAt) || Date.parse(report.completedAt) > Date.now()) reasons.add('invalid-freeze-timeline')
  const splits = new Map<string, string>()
  for (const c of dataset.cases) {
    const row = rows.find(r => r.id === c.id)
    if (!row) throw new Error('ocr-evaluation-missing-row')
    if (row.output) {
      const decision = decideOcr(dataset.profiles.find(p => p.id === c.profileId)!, row.output)
      if (decision.status !== row.status || decision.reason !== row.reason) throw new Error('ocr-evaluation-output-mismatch')
    } else if (row.status !== 'inconclusive' || !['ocr-recognition-unavailable', 'ocr-image-geometry', 'ocr-profile-version-changed'].includes(row.reason)) throw new Error('ocr-evaluation-output-missing')
    if (!row.output && row.reason !== 'ocr-recognition-unavailable' && !(c.group === 'safety' && c.tags.some(t => ['rotated', 'scope-mismatch'].includes(t)))) reasons.add('rejection-outside-declared-safety-scope')
    for (const key of [`image:${c.imageSha256}`, `near:${c.nearDuplicateGroup}`]) {
      if (splits.has(key) && splits.get(key) !== c.split) reasons.add('development-frozen-overlap')
      splits.set(key, c.split)
    }
  }
  const frozen = dataset.cases.filter(c => c.split === 'frozen'), admitted = frozen.filter(c => c.group === 'admitted'), safety = frozen.filter(c => c.group === 'safety')
  if (admitted.length < 20 || admitted.filter(c => c.expected === 'pass').length < 5 || admitted.filter(c => c.expected === 'fail').length < 5) reasons.add('insufficient-admitted-cases')
  if (new Set(admitted.map(c => { const p = dataset.profiles.find(p => p.id === c.profileId)!; return `${p.appId}:${p.pageKey}` })).size < 2) reasons.add('insufficient-page-groups')
  if (frozen.some(c => c.source !== 'authorized-real')) reasons.add('real-authorized-images-required')
  if (new Set(frozen.map(c => c.imageSha256)).size !== frozen.length) reasons.add('duplicate-frozen-images')
  for (const tag of ['similar-glyph', 'light', 'dark', 'blocker']) if (!admitted.some(c => c.tags.includes(tag as typeof c.tags[number]))) reasons.add(`missing-admitted-${tag}`)
  for (const tag of ocrSafetyTags) if (!safety.some(c => c.tags.includes(tag))) reasons.add(`missing-safety-${tag}`)
  const stats = (cases: typeof admitted) => {
    const selected = cases.map(c => ({ c, r: rows.find(r => r.id === c.id)! })), n = selected.length
    const errors = selected.filter(({ c, r }) => c.expected !== r.status).length
    const latencies = selected.map(({ r }) => r.durationMs).sort((a, b) => a - b)
    const rejection = selected.filter(({ r }) => r.status === 'inconclusive').length
    // Wilson interval for observed disagreement, not a claim of general OCR accuracy.
    const p = n ? errors / n : 0, z2 = 1.96 ** 2, denom = 1 + z2 / (n || 1)
    const center = (p + z2 / (2 * (n || 1))) / denom, half = 1.96 * Math.sqrt(p * (1 - p) / (n || 1) + z2 / (4 * (n || 1) ** 2)) / denom
    return { cases: n, errors, falsePass: selected.filter(({ c, r }) => c.expected !== 'pass' && r.status === 'pass').length,
      falseFail: selected.filter(({ c, r }) => c.expected === 'pass' && r.status === 'fail').length, inconclusive: rejection,
      rejectionRate: n ? rejection / n : null, p50Ms: n ? latencies[Math.ceil(n * .5) - 1]! : null, p95Ms: n ? latencies[Math.ceil(n * .95) - 1]! : null,
      disagreement95: n ? [Math.max(0, center - half), Math.min(1, center + half)] : [0, 1] }
  }
  const admittedStats = stats(admitted), safetyStats = stats(safety)
  if (admittedStats.errors || admittedStats.inconclusive) reasons.add('admitted-not-confirmed')
  if (safetyStats.errors) reasons.add('safety-rejection-mismatch')
  // A broken recognizer must not "pass" the entire safety set through infrastructure errors.
  if (frozen.some(c => rows.find(r => r.id === c.id)?.reason === 'ocr-recognition-unavailable')) reasons.add('recognizer-unavailable')
  const groups = Object.fromEntries([...new Set(frozen.map(c => c.profileId))].map(id => [id, stats(frozen.filter(c => c.profileId === id))]))
  return { contractVersion: 1 as const, gate: reasons.size ? 'no-go' as const : 'candidate-go' as const, defaultProductionEnabled: false as const,
    datasetDigest: report.datasetDigest, evaluationDigest: ocrHash(report), admitted: admittedStats, safety: safetyStats, groups,
    reasons: [...reasons].sort(), limitation: 'Frozen sample only; confidence interval measures labelled disagreement, not universal accuracy.' }
}

export function evaluatedOcrProfile(report: OcrEvaluation, profile: OcrProfile): boolean {
  return report.dataset.profiles.some(p => ocrHash(p) === ocrHash(profile)) && report.dataset.cases.some(c => c.split === 'frozen' && c.group === 'admitted' && c.profileId === profile.id)
}
