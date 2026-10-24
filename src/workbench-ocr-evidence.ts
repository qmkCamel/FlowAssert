import type { TestRun, RunStep } from './workbench-domain.js'
import type { WorkbenchStore } from './workbench-store.js'
import { decideOcr, ocrHash, ocrProfileSchema } from './workbench-ocr-contracts.js'
import { cropOcrImage, type WorkbenchOcr } from './workbench-ocr.js'

export type OcrPreview = Awaited<ReturnType<WorkbenchOcr['preview']>>

/** Only an existing step checkpoint may be promoted to run evidence. Never use a Viewer frame. */
export async function persistOcrEvidence(store: WorkbenchStore, run: TestRun, step: RunStep, profileValue: unknown,
  result: OcrPreview, signal = new AbortController().signal) {
  const profile = ocrProfileSchema.parse(profileValue)
  const screenshot = step.evidence.find(file => file.name === `step-${step.index}.png` && file.contentType === 'image/png')
  const capture = step.captures?.find(c => c.kind === 'png')
  const times = [step.startedAt, step.captureStartedAt, step.captureEndedAt, capture?.startedAt, capture?.endedAt, result.completedAt].map(t => Date.parse(t ?? ''))
  if (!run.steps.includes(step) || !screenshot || !capture || !step.captureStartedAt || !step.captureEndedAt
    || times.some(t => !Number.isFinite(t)) || Date.parse(result.completedAt) < Date.parse(capture.endedAt)
    || Date.parse(capture.startedAt) < Date.parse(step.startedAt) || Date.parse(capture.endedAt) > Date.parse(step.captureEndedAt)
    || screenshot.sha256 !== result.imageSha256 || result.profileDigest !== ocrHash(profile) || ocrHash(result.identity) !== ocrHash(profile.identity)) throw new Error('ocr-checkpoint-source-mismatch')
  const image = await store.readEvidence(run.id, screenshot)
  const source = await cropOcrImage(image, profile, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))
  if (source.imageSha256 !== result.imageSha256 || source.cropSha256 !== result.cropSha256 || !source.crop.equals(result.crop)) throw new Error('ocr-crop-source-mismatch')
  const decision = decideOcr(profile, result.output)
  if (ocrHash(decision) !== ocrHash(result.decision)) throw new Error('ocr-decision-mismatch')
  signal.throwIfAborted()
  const crop = await store.put(run.id, `ocr-${step.index}-crop.png`, source.crop, 'image/png')
  step.evidence.push(crop)
  const metadata = { contractVersion: 1, runId: run.id, stepIndex: step.index, capturedAt: capture.endedAt,
    completedAt: result.completedAt, durationMs: result.durationMs, original: screenshot, crop, profile,
    profileDigest: result.profileDigest, identity: result.identity, output: result.output, decision }
  step.evidence.push(await store.put(run.id, `ocr-${step.index}.json`, JSON.stringify(metadata), 'application/json'))
  await store.save(run)
  return metadata
}
