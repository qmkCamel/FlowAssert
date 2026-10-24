import sharp from 'sharp'
import { z } from 'zod'
import { runOwnedWorker, WorkerTimeoutError, type WorkerFactory } from './workbench-worker-lifecycle.js'
import { sha256 } from './workbench-store.js'

export const WORKBENCH_VISUAL_WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? '../scripts/workbench-visual-worker.mjs' : './workbench-visual-worker.js', import.meta.url)

const rectSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict()
export const visualProfileSchema = z.object({
  rulesVersion: z.literal(1), revision: z.number().int().positive(), platform: z.enum(['android', 'ios']), appId: z.string().min(2).max(255), build: z.string().min(1).max(160), theme: z.enum(['any', 'light', 'dark']),
  approvedBy: z.string().min(1).max(160), approvedAt: z.string().datetime({ offset: true }), reference: z.string().min(1), referenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  regions: z.array(rectSchema).min(1).max(20).optional(), masks: z.array(rectSchema).max(20).default([]), channelDelta: z.number().int().min(0).max(255), maxDifferentRatio: z.number().min(0).max(1),
  allowedTargetBuilds: z.array(z.string().min(1).max(160)).min(1).max(10).optional(),
}).strict()
export type VisualProfileInput = z.input<typeof visualProfileSchema>
export type VisualProfile = z.output<typeof visualProfileSchema> & { referenceBase64: string; width: number; height: number }
export type VisualResult = { status: 'pass' | 'fail' | 'inconclusive'; message: string; comparedPixels: number; differentPixels: number; ratio?: number; rulesVersion: 1; revision: number; referenceSha256: string }

export async function registerVisualProfile(input: VisualProfileInput, bytes: Buffer): Promise<VisualProfile> {
  const profile = visualProfileSchema.parse(input)
  if (bytes.length > 4 * 1024 * 1024 || sha256(bytes) !== profile.referenceSha256) throw new Error('Approved visual reference has invalid size or SHA-256')
  const metadata = await sharp(bytes, { limitInputPixels: 16_777_216 }).metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) throw new Error('Visual reference must be a bounded PNG')
  for (const rect of [...(profile.regions ?? []), ...profile.masks]) if (rect.x + rect.width > metadata.width || rect.y + rect.height > metadata.height) throw new Error('Visual region or mask exceeds reference')
  return { ...profile, referenceBase64: bytes.toString('base64'), width: metadata.width, height: metadata.height }
}

export async function compareVisual(profile: VisualProfile, screenshot: Buffer, currentBuild: string, currentTheme: 'unknown' | 'light' | 'dark' = 'unknown', signal?: AbortSignal, budgetMs = 10_000, createWorker?: WorkerFactory): Promise<VisualResult> {
  const base = { rulesVersion: 1 as const, revision: profile.revision, referenceSha256: profile.referenceSha256 }
  const inconclusive = (message: string): VisualResult => ({ ...base, status: 'inconclusive', message, comparedPixels: 0, differentPixels: 0 })
  if (signal?.aborted) return inconclusive('Visual comparison cancelled')
  if (screenshot.length > 16 * 1024 * 1024) return inconclusive('Visual image exceeds budget')
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return inconclusive('Visual comparison budget is unavailable')
  try {
    return await runOwnedWorker(WORKBENCH_VISUAL_WORKER_URL, { execArgv: [], workerData: { profile, screenshot, currentBuild, currentTheme }, resourceLimits: { maxOldGenerationSizeMb: 128 } }, value => {
      const parsed = z.object({ status: z.enum(['pass', 'fail', 'inconclusive']), message: z.string().max(400), comparedPixels: z.number().int().nonnegative(), differentPixels: z.number().int().nonnegative(), ratio: z.number().finite().min(0).max(1).optional(), rulesVersion: z.literal(1), revision: z.number().int().positive(), referenceSha256: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(value)
      if (!parsed.success || parsed.data.revision !== profile.revision || parsed.data.referenceSha256 !== profile.referenceSha256) throw new Error('Visual comparison worker returned invalid result')
      const { ratio, ...result } = parsed.data
      return { ...result, ...(ratio === undefined ? {} : { ratio }) }
    }, signal, Math.min(10_000, budgetMs), 'Visual comparison', createWorker)
  } catch (error) {
    return inconclusive(signal?.aborted ? 'Visual comparison cancelled' : error instanceof WorkerTimeoutError ? 'Visual comparison exceeded time budget' : error instanceof Error ? error.message : 'Visual comparison failed')
  }
}
