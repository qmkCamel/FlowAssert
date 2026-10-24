import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { IosWdaMjpegSource } from '../src/ios-wda-mjpeg-source.js'
import type { ViewerMediaPacket } from '../src/types.js'
import { jpegFixture } from './media-fixtures.js'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('IosWdaMjpegSource', () => {
  it('accepts only loopback multipart MJPEG and yields validated latest frames', async () => {
    const jpeg = jpegFixture(390, 844)
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary="wda-frame"' })
      const part = Buffer.concat([
        Buffer.from(`--wda-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`),
        jpeg,
        Buffer.from('\r\n--wda-frame--\r\n'),
      ])
      for (let offset = 0; offset < part.byteLength; offset += 3) response.write(part.subarray(offset, offset + 3))
      response.end()
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const source = new IosWdaMjpegSource('127.0.0.1', address.port)
    const frames: ViewerMediaPacket[] = []
    try {
      for await (const packet of source.open(AbortSignal.timeout(2_000))) frames.push(packet)
    } catch (error) {
      expect(error).toMatchObject({ code: 'viewer_media_stream_ended' })
    }
    expect(frames).toEqual([expect.objectContaining({ kind: 'jpeg', width: 390, height: 844 })])
  })

  it('rejects a non-MJPEG response without exposing the upstream URL', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('PRIVATE_STREAM_BODY')
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const source = new IosWdaMjpegSource('127.0.0.1', address.port)
    const error = await consume(source).then(
      () => new Error('Expected protocol failure'),
      (failure: unknown) => failure as Error & { code?: string },
    )
    expect(error).toMatchObject({ code: 'viewer_media_protocol_invalid' })
    expect(error.message).not.toContain(String(address.port))
    expect(error.message).not.toContain('PRIVATE_STREAM_BODY')
  })
})

async function consume(source: IosWdaMjpegSource): Promise<void> {
  for await (const _packet of source.open(AbortSignal.timeout(2_000))) {
    // consume
  }
}
