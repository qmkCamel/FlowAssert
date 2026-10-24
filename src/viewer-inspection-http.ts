import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MirrorService } from './mirror-service.js'
import { screenErrorCode } from './screen-errors.js'

export class ViewerInspectionHttp {
  #busy = false
  async capture(request: IncomingMessage, response: ServerResponse, origin: string, service: MirrorService, timeoutMs: number) {
    let owns = false, bytes: Uint8Array | undefined
    const controller = new AbortController()
    const abort = () => controller.abort()
    response.once('close', abort)
    const timer = setTimeout(() => { controller.abort(new DOMException('Timeout', 'TimeoutError')); if (response.headersSent) response.destroy(); if (!request.complete) request.destroy() }, Math.min(timeoutMs, 10_000))
    const reject = (code: string, status: number): never => { throw Object.assign(new Error('Inspection request failed.'), { code, status }) }
    try {
      if (request.headers.origin !== origin) reject('viewer_inspection_origin_rejected', 403)
      if (new URL(request.url!, origin).search || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) reject('mobile_mirror_invalid_arguments', 400)
      if (Number(request.headers['content-length'] ?? 0) > 1024) reject('mobile_mirror_invalid_arguments', 400)
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of request) { controller.signal.throwIfAborted(); const b = Buffer.from(chunk); size += b.length; if (size > 1024) reject('mobile_mirror_invalid_arguments', 400); chunks.push(b) }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reject('mobile_mirror_invalid_arguments', 400) }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) reject('mobile_mirror_invalid_arguments', 400)
      if (this.#busy) reject('screen_observation_in_progress', 409)
      this.#busy = true; owns = true
      const snapshot = await service.captureViewerInspection(controller.signal)
      bytes = snapshot.image.bytes
      controller.signal.throwIfAborted()
      const { image, ...metadata } = snapshot
      const png = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (png.length < 24 || png.length > 8 * 1024 * 1024 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || png.toString('ascii', 12, 16) !== 'IHDR') reject('screen_observation_too_large', 400)
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
      if (!width || !height || width > 16384 || height > 16384 || width * height > 16777216 || width !== image.width || height !== image.height
        || Buffer.byteLength(JSON.stringify(metadata.structure)) > 256 * 1024) reject('screen_observation_too_large', 400)
      const payload = JSON.stringify({ ...metadata, image: { contentType: 'image/png', width, height, base64: png.toString('base64') } })
      if (Buffer.byteLength(payload) > 12 * 1024 * 1024) reject('screen_observation_too_large', 400)
      const context = service.viewerInspectionContext()
      if (!context || context.generationToken !== metadata.generationToken || context.screenEpoch !== metadata.screenEpoch) reject('screen_observation_session_mismatch', 410)
      controller.signal.throwIfAborted()
      await new Promise<void>((resolve, fail) => {
        response.once('finish', resolve); response.once('close', resolve); response.once('error', fail)
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' })
        response.end(payload)
      })
    } catch (error) {
      if (!response.destroyed && !response.headersSent) {
        const code = controller.signal.reason?.name === 'TimeoutError' ? 'viewer_inspection_timeout' : screenErrorCode(error) ?? (error as { code?: string })?.code
        const allowed = ['mobile_mirror_invalid_arguments', 'viewer_inspection_origin_rejected', 'viewer_inspection_timeout', 'screen_observation_in_progress', 'screen_observation_too_large', 'screen_observation_session_mismatch']
        const safe = screenErrorCode(error) ?? (code && allowed.includes(code) ? code : 'screen_capture_failed')
        const status = safe === 'viewer_inspection_timeout' ? 504 : safe === 'viewer_inspection_origin_rejected' ? 403 : safe === 'screen_observation_in_progress' ? 409 : /session_mismatch|geometry_changed|expired/.test(safe) ? 410 : /invalid_arguments|too_large/.test(safe) ? 400 : 503
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ code: safe, message: 'The local inspection could not be captured.' }))
      }
    } finally {
      clearTimeout(timer); response.removeListener('close', abort); bytes?.fill(0); if (owns) this.#busy = false
    }
  }
}
