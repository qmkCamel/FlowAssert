import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { sha256, type WorkbenchStore } from './workbench-store.js'
import type { EvidenceFile, TestRun, RunVideo, VideoRequest } from './workbench-domain.js'
export type { RunVideo, VideoRequest } from './workbench-domain.js'
export const VIDEO_MAX_BYTES = 136 * 1024 * 1024
const reasons = new Set(['run-finished', 'videoSaved', 'hidden', 'disconnected', 'limit', 'partial', 'run-start-failed'])
export function parseVideoRequest(value: unknown, sessionId: string | null | undefined): VideoRequest {
  const v = value as VideoRequest
  if (!v || typeof v !== 'object' || Object.keys(v).some((key) => !['captureId', 'sessionId', 'startedAt'].includes(key))
    || typeof v.captureId !== 'string' || !/^[0-9a-f-]{36}$/.test(v.captureId) || v.sessionId !== sessionId
    || typeof v.startedAt !== 'string' || !Number.isFinite(Date.parse(v.startedAt))
    || Math.abs(Date.now() - Date.parse(v.startedAt)) > 60_000) throw new Error('Invalid recording binding or start time')
  return { captureId: v.captureId, sessionId: v.sessionId, startedAt: v.startedAt }
}

/** Video has its own atomic index: uploads never race the executor's manifest writes. */
export class WorkbenchVideoArchive {
  readonly owner = randomUUID()
  #uploading = false
  #closed = false
  #request: IncomingMessage | null = null
  #idle: Promise<void> = Promise.resolve()
  constructor(readonly store: WorkbenchStore) {}
  async close(): Promise<void> {
    this.#closed = true
    if (this.#request && !this.#request.complete) this.#request.destroy(new Error('Video archive shutting down'))
    await this.#idle
  }
  async view(run: TestRun): Promise<RunVideo | undefined> {
    if (!run.video) return undefined
    try {
      const saved = await this.store.readVideoIndex(run.id)
      if (saved) {
        const file = saved.file
        if (saved.captureId !== run.video.captureId || saved.sessionId !== run.sessionId || saved.startedAt !== run.video.startedAt
          || !['complete', 'partial'].includes(saved.status) || !file || !['recording.webm', 'recording.mp4'].includes(file.name)
          || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > VIDEO_MAX_BYTES
          || !['video/webm', 'video/mp4'].includes(file.contentType) || !Number.isFinite(saved.durationMs) || saved.durationMs! < 0) throw new Error('Invalid video index')
        return saved
      }
      if (run.video.owner !== this.owner || (run.endedAt && Date.now() - Date.parse(run.endedAt) > 120_000)) {
        return { ...run.video, status: 'unavailable', reason: 'Recording not received; page or service may have been interrupted' }
      }
      return run.video
    } catch { return { ...run.video, status: 'unavailable', reason: 'Video index unavailable or invalid' } }
  }
  async upload(run: TestRun, request: IncomingMessage): Promise<RunVideo> {
    if (this.#closed) throw new Error('Video archive is closed')
    if (this.#uploading) throw new Error('Another video upload is in progress')
    const binding = run.video
    if (!binding || request.headers['x-capture-id'] !== binding.captureId) throw new Error('Recording binding mismatch')
    const mime = request.headers['content-type']?.split(';')[0]
    if (mime !== 'video/webm' && mime !== 'video/mp4') throw new Error('Unsupported video format')
    const durationMs = Number(request.headers['x-video-duration-ms'])
    const reason = request.headers['x-video-reason']
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 660_000 || typeof reason !== 'string' || !reasons.has(reason)) throw new Error('Invalid recording metadata')
    if (reason === 'run-finished' && (run.phase !== 'finished' || Date.parse(binding.startedAt) + durationMs < Date.parse(run.endedAt!))) throw new Error('Recording does not cover the finished run')
    this.#uploading = true; this.#request = request
    let release!: () => void
    this.#idle = new Promise<void>((resolve) => { release = resolve })
    try {
      const bytes = await readVideoBody(request)
      const webm = bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      const mp4 = bytes.subarray(4, 8).toString() === 'ftyp'
      if (mime === 'video/webm' ? !webm : !mp4) throw new Error('Invalid video container')
      const previous = await this.view(run)
      if (previous?.file) {
        if (previous.file.sha256 !== sha256(bytes) || previous.durationMs !== durationMs || previous.reason !== reason || previous.file.contentType !== mime) throw new Error('Cannot overwrite archived recording')
        await this.store.readEvidence(run.id, previous.file)
        return previous
      }
      const name = mime === 'video/webm' ? 'recording.webm' : 'recording.mp4'
      // A previous failed index write may have already committed these immutable bytes.
      let file: EvidenceFile = { name, bytes: bytes.length, sha256: sha256(bytes), contentType: mime }
      try { await this.store.readEvidence(run.id, file) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        file = await this.store.put(run.id, name, bytes, mime)
      }
      const video: RunVideo = { ...binding, status: reason === 'run-finished' ? 'complete' : 'partial', durationMs, reason, file }
      await this.store.saveVideoIndex(run.id, video)
      return video
    } finally { this.#uploading = false; this.#request = null; release() }
  }
}

async function readVideoBody(request: IncomingMessage): Promise<Buffer> {
  const length = request.headers['content-length']
  if (length && (!/^\d+$/.test(length) || Number(length) > VIDEO_MAX_BYTES)) throw new Error('Video exceeds upload limit')
  const chunks: Buffer[] = []; let size = 0
  const timer = setTimeout(() => request.destroy(new Error('Video upload timed out')), 30_000)
  try {
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk); size += bytes.length
      if (size > VIDEO_MAX_BYTES) throw new Error('Video exceeds upload limit')
      chunks.push(bytes)
    }
    if (!size) throw new Error('Empty video upload')
    return Buffer.concat(chunks, size)
  } finally { clearTimeout(timer) }
}

/** Hash verification happens before calling this, including for partial responses. */
export function sendVideo(response: ServerResponse, request: IncomingMessage, bytes: Buffer, file: EvidenceFile): void {
  const headers = { 'content-type': file.contentType, 'cache-control': 'no-store', 'accept-ranges': 'bytes', 'content-disposition': `inline; filename="${file.name}"` }
  const range = request.headers.range
  if (!range) { response.writeHead(200, { ...headers, 'content-length': bytes.length }); response.end(bytes); return }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  let start = Number(match?.[1] || 0), end = Number(match?.[2] || bytes.length - 1)
  if (match?.[1] === '' && match[2]) { start = Math.max(0, bytes.length - Number(match[2])); end = bytes.length - 1 }
  end = Math.min(end, bytes.length - 1)
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${bytes.length}` }); response.end(); return
  }
  response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': end - start + 1 })
  response.end(bytes.subarray(start, end + 1))
}
