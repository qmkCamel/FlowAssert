import type { ViewerMediaPacket, ViewerMediaSource } from './types.js'
import { boundaryFromContentType, MjpegParser } from './mjpeg-parser.js'
import { viewerMediaError } from './viewer-media-error.js'

export class IosWdaMjpegSource implements ViewerMediaSource {
  readonly transport = 'wda-mjpeg' as const
  readonly #url: string
  #abort: AbortController | null = null

  constructor(host: '127.0.0.1', port: number) {
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw viewerMediaError('viewer_media_port_unavailable')
    this.#url = `http://${host}:${port}`
  }

  async *open(signal: AbortSignal): AsyncIterable<ViewerMediaPacket> {
    if (this.#abort) throw viewerMediaError('viewer_media_unavailable')
    this.#abort = new AbortController()
    const combined = AbortSignal.any([signal, this.#abort.signal])
    try {
      const response = await fetch(this.#url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        signal: combined,
      })
      if (!response.ok || !response.body) throw viewerMediaError('viewer_media_stream_ended')
      const parser = new MjpegParser(boundaryFromContentType(response.headers.get('content-type')))
      const reader = response.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          for (const frame of parser.push(value)) {
            yield { kind: 'jpeg', bytes: frame.bytes, width: frame.width, height: frame.height, receivedAt: Date.now() }
          }
        }
        for (const frame of parser.finish()) {
          yield { kind: 'jpeg', bytes: frame.bytes, width: frame.width, height: frame.height, receivedAt: Date.now() }
        }
        if (!combined.aborted) throw viewerMediaError('viewer_media_stream_ended')
      } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    } finally {
      this.#abort = null
    }
  }

  async close(): Promise<void> {
    this.#abort?.abort(viewerMediaError('viewer_media_stream_ended'))
  }
}
