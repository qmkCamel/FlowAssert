import { Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { doctorOcr, runOcrProcess } from './workbench-ocr-helper.js'
import { decideOcr, ocrHash, ocrLimits, ocrOutputSchema, ocrProfileSchema, type OcrProfile } from './workbench-ocr-contracts.js'

export async function cropOcrImage(image: Buffer, profile: OcrProfile, signal: AbortSignal): Promise<{ crop: Buffer; imageSha256: string; cropSha256: string }> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../scripts/workbench-ocr-image-worker.mjs', import.meta.url), { workerData: { image, profile }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128 } })
    let done = false
    const finish = (error?: Error, result?: { crop: Uint8Array; imageSha256: string; cropSha256: string }) => {
      if (done) return; done = true; signal.removeEventListener('abort', abort)
      void worker.terminate().then(() => { if (error) reject(error); else if (result) resolve({ ...result, crop: Buffer.from(result.crop) }); else reject(new Error('ocr-worker-failed')) }, () => reject(new Error('ocr-worker-failed')))
    }
    const abort = () => finish(new Error('ocr-cancelled')); signal.addEventListener('abort', abort, { once: true })
    worker.once('message', reply => reply?.ok ? finish(undefined, reply.result) : finish(new Error(/^ocr-[a-z-]+$/.test(reply?.code) ? reply.code : 'ocr-worker-failed')))
    worker.once('error', () => finish(new Error('ocr-worker-failed'))); worker.once('exit', () => { if (!done) finish(new Error('ocr-worker-failed')) })
    if (signal.aborted) abort()
  })
}
export class WorkbenchOcr {
  #active = 0; #closed = false
  #queue: Array<{ enter(): void; reject(error: Error): void; signal: AbortSignal; abort(): void }> = []
  #operations = new Set<Promise<unknown>>(); #controllers = new Set<AbortController>()
  constructor(readonly cache: string) {}
  get capacity() { return { active: this.#active, queued: this.#queue.length } }
  async #acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted(); if (this.#closed) throw new Error('ocr-closed')
    if (this.#active < ocrLimits.processes) this.#active++
    else {
      if (this.#queue.length >= ocrLimits.queued) throw new Error('ocr-queue-budget')
      await new Promise<void>((resolve, reject) => {
        const entry = { enter: resolve, reject, signal, abort: () => { this.#queue = this.#queue.filter(e => e !== entry); reject(new Error('ocr-cancelled')) } }
        this.#queue.push(entry); signal.addEventListener('abort', entry.abort, { once: true })
      })
    }
    let released = false
    return () => { if (released) return; released = true
      const next = this.#queue.shift()
      if (next) { next.signal.removeEventListener('abort', next.abort); next.enter() } else this.#active--
    }
  }
  /** Read-only candidate preview. No production verdict or device capability is exposed here. */
  preview(image: Buffer, profileValue: unknown, signal = new AbortController().signal) {
    const work = async () => {
      const profile = ocrProfileSchema.parse(profileValue)
      if (!image.length || image.length > ocrLimits.imageBytes) throw new Error('ocr-image-budget')
      const controller = new AbortController(), abort = () => controller.abort(new Error('ocr-cancelled'))
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); this.#controllers.add(controller)
      // Includes queue wait, preflight, decoding and recognition; no unbounded queue residency.
      const started = performance.now(), timer = setTimeout(() => controller.abort(new Error('ocr-timeout')), ocrLimits.durationMs)
      let release: (() => void) | undefined
      try {
        release = await this.#acquire(controller.signal)
        const helper = await doctorOcr(this.cache, controller.signal)
        if (ocrHash(helper.identity) !== ocrHash(profile.identity)) throw new Error('ocr-profile-version-changed')
        const source = await cropOcrImage(image, profile, controller.signal)
        const output = ocrOutputSchema.parse(JSON.parse((await runOcrProcess(helper.binary, [], Buffer.from(JSON.stringify({ contractVersion: 1, png: source.crop.toString('base64'), revision: profile.requestRevision, languages: profile.languages })), controller.signal)).toString('utf8')))
        controller.signal.throwIfAborted()
        if (createHash('sha256').update(source.crop).digest('hex') !== source.cropSha256) throw new Error('ocr-crop-integrity')
        return { contractVersion: 1 as const, candidate: true as const, productionEnabled: false as const, decision: decideOcr(profile, output), output,
          identity: helper.identity, profileDigest: ocrHash(profile), imageSha256: source.imageSha256, cropSha256: source.cropSha256, region: profile.region, durationMs: performance.now() - started, completedAt: new Date().toISOString(), crop: source.crop }
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); this.#controllers.delete(controller); release?.() }
    }
    const promise = work(); this.#operations.add(promise); void promise.finally(() => this.#operations.delete(promise)).catch(() => {}); return promise
  }
  async close() { this.#closed = true; for (const c of this.#controllers) c.abort(new Error('ocr-closed')); await Promise.allSettled([...this.#operations]) }
}
