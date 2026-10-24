import { describe, expect, it } from 'vitest'
import { boundaryFromContentType, MjpegParser } from '../src/mjpeg-parser.js'
import { jpegFixture } from './media-fixtures.js'

describe('WDA MJPEG parser', () => {
  it('parses quoted boundaries, randomized chunking, and content-length parts', () => {
    const jpeg = jpegFixture(390, 844)
    const body = Buffer.concat([
      Buffer.from('--random-boundary\r\nContent-Type: image/jpeg\r\nContent-Length: '),
      Buffer.from(String(jpeg.byteLength)),
      Buffer.from('\r\nX-Ignored: bounded\r\n\r\n'),
      jpeg,
      Buffer.from('\r\n--random-boundary--\r\n'),
    ])
    const parser = new MjpegParser(boundaryFromContentType('multipart/x-mixed-replace; boundary="random-boundary"'))
    const frames = [...body].flatMap((byte) => parser.push(Uint8Array.of(byte)))
    frames.push(...parser.finish())
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ width: 390, height: 844 })
    expect(Buffer.from(frames[0]!.bytes)).toEqual(jpeg)
  })

  it('parses parts without content-length by the next boundary', () => {
    const first = jpegFixture(3, 2)
    const second = jpegFixture(4, 5)
    const parser = new MjpegParser('frame')
    const frames = parser.push(Buffer.concat([
      Buffer.from('--frame\r\nContent-Type: image/jpeg\r\n\r\n'), first,
      Buffer.from('\r\n--frame\r\nContent-Type: image/jpeg\r\n\r\n'), second,
      Buffer.from('\r\n--frame--\r\n'),
    ]))
    frames.push(...parser.finish())
    expect(frames.map(({ width, height }) => [width, height])).toEqual([[3, 2], [4, 5]])
  })

  it('rejects invalid content types, JPEG payloads, and oversized lengths with stable codes', () => {
    expect(() => boundaryFromContentType('text/plain')).toThrow(expect.objectContaining({ code: 'viewer_media_protocol_invalid' }))
    const invalid = new MjpegParser('frame')
    expect(() => invalid.push(Buffer.from('--frame\r\nContent-Length: 4\r\n\r\nnope\r\n--frame--\r\n')))
      .toThrow(expect.objectContaining({ code: 'viewer_media_protocol_invalid' }))
    const oversized = new MjpegParser('frame')
    expect(() => oversized.push(Buffer.from('--frame\r\nContent-Length: 8388609\r\n\r\n')))
      .toThrow(expect.objectContaining({ code: 'viewer_media_frame_too_large' }))
  })
})
