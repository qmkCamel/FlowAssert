import { describe, expect, it } from 'vitest'
import { codecFromAnnexB, encodeH264Envelope, ScrcpyVideoParser } from '../src/scrcpy-protocol.js'
import { scrcpyMedia, scrcpySession, scrcpyStreamFixture } from './media-fixtures.js'

describe('scrcpy 4.1 framed H.264 protocol', () => {
  it('parses arbitrary fragmentation and prepends SPS/PPS to key frames', () => {
    const parser = new ScrcpyVideoParser()
    const packets = [...scrcpyStreamFixture()].flatMap((byte) => parser.push(Uint8Array.of(byte)))
    parser.finish()
    expect(packets.map((packet) => packet.kind)).toEqual(['metadata', 'session', 'config', 'key', 'delta'])
    expect(packets[1]).toMatchObject({ width: 390, height: 844 })
    expect(packets[2]?.codec).toBe('avc1.42001e')
    expect(Buffer.from(packets[3]!.bytes).includes(Buffer.from([0x67, 0x42, 0x00, 0x1e]))).toBe(true)
  })

  it('handles rotation session packets and requires a new valid config', () => {
    const base = scrcpyStreamFixture()
    const parser = new ScrcpyVideoParser()
    parser.push(base)
    const rotated = parser.push(scrcpySession(844, 390, true))
    expect(rotated).toEqual([expect.objectContaining({ kind: 'session', width: 844, height: 390 })])
    expect(() => parser.push(scrcpyMedia(1n << 61n, Buffer.from([0, 0, 0, 1, 0x65, 1]))))
      .toThrow(expect.objectContaining({ code: 'viewer_media_protocol_invalid' }))
    expect(() => codecFromAnnexB(Buffer.from([0, 0, 1, 0x68, 1]))).toThrow(expect.objectContaining({ code: 'viewer_media_protocol_invalid' }))
  })

  it('rejects unsupported codecs and oversized media packets', () => {
    const codec = Buffer.alloc(4)
    codec.writeUInt32BE(0x68323635)
    expect(() => new ScrcpyVideoParser().push(codec)).toThrow(expect.objectContaining({ code: 'viewer_media_protocol_invalid' }))

    const validCodec = Buffer.alloc(4)
    validCodec.writeUInt32BE(0x68323634)
    const oversized = Buffer.alloc(12)
    oversized.writeUInt32BE(8 * 1024 * 1024 + 1, 8)
    const parser = new ScrcpyVideoParser()
    parser.push(validCodec)
    expect(() => parser.push(oversized)).toThrow(expect.objectContaining({ code: 'viewer_media_frame_too_large' }))
  })

  it('encodes a bounded big-endian Viewer envelope without device identifiers', () => {
    const bytes = encodeH264Envelope({
      kind: 'key',
      bytes: scrcpyMedia(1n << 61n, Buffer.from([1, 2, 3])).subarray(12),
      ptsUs: 42n,
      width: 390,
      height: 844,
      codec: 'avc1.42001e',
      receivedAt: 1000,
    }, 'opaque-generation')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(Buffer.from(bytes.subarray(0, 4)).toString('ascii')).toBe('MMV1')
    expect(view.getUint8(5)).toBe(1)
    const metadataLength = view.getUint32(8)
    const sessionOffset = 36 + metadataLength
    const session = new DataView(bytes.buffer, bytes.byteOffset + sessionOffset, bytes.byteLength - sessionOffset)
    expect(session.getUint8(5)).toBe(2)
    expect(session.getUint32(12)).toBe(390)
    const keyOffset = sessionOffset + 36
    const key = new DataView(bytes.buffer, bytes.byteOffset + keyOffset, bytes.byteLength - keyOffset)
    expect(key.getUint8(5)).toBe(4)
    expect(key.getBigUint64(20)).toBe(42n)
    expect(Buffer.from(bytes).toString('utf8')).not.toContain('device')
  })
})
