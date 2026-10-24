import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ocrHash, ocrLimits, ocrProfileSchema } from './workbench-ocr-contracts.js'
import type { OcrRuntime } from './workbench-service.js'

const inputSchema = z.object({ profile: ocrProfileSchema, image: z.string().min(1).max(Math.ceil(ocrLimits.imageBytes * 4 / 3) + 4).regex(/^[A-Za-z0-9+/]+={0,2}$/), localOnly: z.literal(true) }).strict()
export interface OcrPreviewJob {
  id: string; inputDigest: string; phase: 'running' | 'cancelling' | 'cancelled' | 'failed' | 'succeeded';
  startedAt: string; completedAt?: string; error?: string;
  result?: Omit<Awaited<ReturnType<OcrRuntime['preview']>>, 'crop'>;
}
export class WorkbenchOcrPreviews {
  #closed = false
  #jobs = new Map<string, { view: OcrPreviewJob; abort: AbortController; done: Promise<void> }>()
  constructor(readonly runtime: OcrRuntime) {}
  start(value: unknown): OcrPreviewJob {
    if (this.#closed) throw new Error('ocr-preview-closed')
    if ([...this.#jobs.values()].filter(j => ['running', 'cancelling'].includes(j.view.phase)).length >= 2) throw new Error('ocr-preview-busy')
    const input = inputSchema.parse(value), image = Buffer.from(input.image, 'base64')
    if (!image.length || image.length > ocrLimits.imageBytes || image.toString('base64') !== input.image) throw new Error('ocr-preview-image-budget')
    // Bound retained history without evicting running jobs.
    if (this.#jobs.size >= 32) { const old = [...this.#jobs].find(([, j]) => !['running', 'cancelling'].includes(j.view.phase)); if (old) this.#jobs.delete(old[0]) }
    const view: OcrPreviewJob = { id: randomUUID(), inputDigest: ocrHash(input), phase: 'running', startedAt: new Date().toISOString() }
    const job = { view, abort: new AbortController(), done: Promise.resolve() }; this.#jobs.set(view.id, job)
    job.done = Promise.resolve().then(async () => {
      try {
        const { crop: _crop, ...result } = await this.runtime.preview(image, input.profile, job.abort.signal)
        job.abort.signal.throwIfAborted(); view.result = result; view.phase = 'succeeded'
      } catch { view.phase = job.abort.signal.aborted ? 'cancelled' : 'failed'; if (view.phase === 'failed') view.error = 'ocr-preview-unavailable' }
      finally { view.completedAt = new Date().toISOString() }
    })
    return structuredClone(view)
  }
  get(id: string): OcrPreviewJob { const job = this.#jobs.get(z.string().uuid().parse(id)); if (!job) throw new Error('ocr-preview-not-found'); return structuredClone(job.view) }
  async cancel(id: string): Promise<OcrPreviewJob> {
    this.get(id); const job = this.#jobs.get(id)!
    if (['running', 'cancelling'].includes(job.view.phase)) { job.view.phase = 'cancelling'; job.abort.abort(); await job.done }
    return this.get(id)
  }
  async close() { this.#closed = true; await Promise.all([...this.#jobs.keys()].map(id => this.cancel(id))) }
}
