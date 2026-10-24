import type { ViewerMediaPacket } from './types.js'
import { MAX_MEDIA_FRAME_BYTES } from './mjpeg-parser.js'
import { viewerMediaError } from './viewer-media-error.js'

const H264_CODEC_ID = 0x68323634
const SESSION_FLAG = 1n << 63n
const CONFIG_FLAG = 1n << 62n
const KEY_FLAG = 1n << 61n
const PTS_MASK = (1n << 61n) - 1n

export class ScrcpyVideoParser {
  #buffer = Buffer.alloc(0)
  #codecRead = false
  #codec = ''
  #config: Uint8Array | null = null

  push(chunk: Uint8Array): ViewerMediaPacket[] {
    if (chunk.byteLength === 0) return []
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)])
    if (this.#buffer.byteLength > MAX_MEDIA_FRAME_BYTES + 16) throw viewerMediaError('viewer_media_frame_too_large')
    const packets: ViewerMediaPacket[] = []

    if (!this.#codecRead) {
      if (this.#buffer.byteLength < 4) return packets
      const codecId = this.#buffer.readUInt32BE(0)
      if (codecId !== H264_CODEC_ID) throw viewerMediaError('viewer_media_protocol_invalid')
      this.#codecRead = true
      this.#codec = 'avc1.42001e'
      this.#buffer = this.#buffer.subarray(4)
      packets.push({ kind: 'metadata', bytes: new Uint8Array(), codec: this.#codec, receivedAt: Date.now() })
    }

    while (this.#buffer.byteLength >= 12) {
      const flagsAndPts = this.#buffer.readBigUInt64BE(0)
      if ((flagsAndPts & SESSION_FLAG) !== 0n) {
        const sessionFlags = this.#buffer.readUInt32BE(0)
        if ((sessionFlags & 0x7fff_fffe) !== 0) throw viewerMediaError('viewer_media_protocol_invalid')
        const width = this.#buffer.readUInt32BE(4)
        const height = this.#buffer.readUInt32BE(8)
        if (width <= 0 || height <= 0 || width > 16_384 || height > 16_384) {
          throw viewerMediaError('viewer_media_protocol_invalid')
        }
        this.#buffer = this.#buffer.subarray(12)
        this.#config = null
        packets.push({ kind: 'session', bytes: new Uint8Array(), width, height, codec: this.#codec, receivedAt: Date.now() })
        continue
      }

      const size = this.#buffer.readUInt32BE(8)
      if (size > MAX_MEDIA_FRAME_BYTES) throw viewerMediaError('viewer_media_frame_too_large')
      if (size === 0) throw viewerMediaError('viewer_media_protocol_invalid')
      if (this.#buffer.byteLength < 12 + size) break
      const config = (flagsAndPts & CONFIG_FLAG) !== 0n
      const key = (flagsAndPts & KEY_FLAG) !== 0n
      if (config && key) throw viewerMediaError('viewer_media_protocol_invalid')
      const ptsUs = flagsAndPts & PTS_MASK
      let bytes = new Uint8Array(this.#buffer.subarray(12, 12 + size))
      this.#buffer = this.#buffer.subarray(12 + size)

      if (config) {
        this.#codec = codecFromAnnexB(bytes)
        this.#config = bytes
        packets.push({ kind: 'config', bytes, ptsUs, codec: this.#codec, receivedAt: Date.now() })
        continue
      }
      if (!this.#config) throw viewerMediaError('viewer_media_protocol_invalid')
      if (key && this.#config && !startsWithAnnexBConfig(bytes)) {
        if (this.#config.byteLength + bytes.byteLength > MAX_MEDIA_FRAME_BYTES) {
          throw viewerMediaError('viewer_media_frame_too_large')
        }
        const combined = new Uint8Array(this.#config.byteLength + bytes.byteLength)
        combined.set(this.#config)
        combined.set(bytes, this.#config.byteLength)
        bytes = combined
      }
      packets.push({ kind: key ? 'key' : 'delta', bytes, ptsUs, codec: this.#codec, receivedAt: Date.now() })
    }
    return packets
  }

  finish(): void {
    if (!this.#codecRead || this.#buffer.byteLength !== 0) throw viewerMediaError('viewer_media_protocol_invalid')
  }
}

export function codecFromAnnexB(bytes: Uint8Array): string {
  for (const nal of annexBNalUnits(bytes)) {
    if ((nal[0]! & 0x1f) !== 7 || nal.byteLength < 4) continue
    return `avc1.${hex(nal[1]!)}${hex(nal[2]!)}${hex(nal[3]!)}`
  }
  throw viewerMediaError('viewer_media_protocol_invalid')
}

export function startsWithAnnexBConfig(bytes: Uint8Array): boolean {
  const first = annexBNalUnits(bytes)[0]
  return Boolean(first && (first[0]! & 0x1f) === 7)
}

function annexBNalUnits(bytes: Uint8Array): Uint8Array[] {
  const starts: Array<{ index: number; length: number }> = []
  for (let index = 0; index + 3 < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0 || bytes[index + 1] !== 0) continue
    if (bytes[index + 2] === 1) {
      starts.push({ index, length: 3 })
      index += 2
    } else if (bytes[index + 2] === 0 && bytes[index + 3] === 1) {
      starts.push({ index, length: 4 })
      index += 3
    }
  }
  return starts.map((start, position) => {
    const end = starts[position + 1]?.index ?? bytes.byteLength
    return bytes.subarray(start.index + start.length, end)
  }).filter((unit) => unit.byteLength > 0)
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

const ENVELOPE_MAGIC = Buffer.from('MMV1', 'ascii')
const ENVELOPE_HEADER_BYTES = 36

const PACKET_TYPES: Record<ViewerMediaPacket['kind'], number> = {
  metadata: 1,
  session: 2,
  config: 3,
  key: 4,
  delta: 5,
  jpeg: 6,
}

export function encodeH264Envelope(packet: ViewerMediaPacket, generation: string): Uint8Array {
  if (packet.kind === 'key') {
    if (!packet.codec || !packet.width || !packet.height) throw viewerMediaError('viewer_media_protocol_invalid')
    const receivedAt = packet.receivedAt === undefined ? {} : { receivedAt: packet.receivedAt }
    return Buffer.concat([
      encodeSingleH264Envelope({ kind: 'metadata', bytes: new Uint8Array(), codec: packet.codec, ...receivedAt }, generation),
      encodeSingleH264Envelope({ kind: 'session', bytes: new Uint8Array(), width: packet.width, height: packet.height, ...receivedAt }, generation),
      encodeSingleH264Envelope(packet, generation),
    ])
  }
  return encodeSingleH264Envelope(packet, generation)
}

function encodeSingleH264Envelope(packet: ViewerMediaPacket, generation: string): Uint8Array {
  let payload = packet.bytes
  if (packet.kind === 'metadata') {
    const metadata = JSON.stringify({ generation, codec: packet.codec ?? 'avc1.42001e' })
    if (Buffer.byteLength(metadata) > 4096) throw viewerMediaError('viewer_media_protocol_invalid')
    payload = Buffer.from(metadata, 'utf8')
  }
  const bytes = Buffer.allocUnsafe(ENVELOPE_HEADER_BYTES + payload.byteLength)
  ENVELOPE_MAGIC.copy(bytes, 0)
  bytes.writeUInt8(1, 4)
  bytes.writeUInt8(PACKET_TYPES[packet.kind], 5)
  bytes.writeUInt16BE(0, 6)
  bytes.writeUInt32BE(payload.byteLength, 8)
  bytes.writeUInt32BE(packet.width ?? 0, 12)
  bytes.writeUInt32BE(packet.height ?? 0, 16)
  bytes.writeBigUInt64BE(packet.ptsUs ?? 0n, 20)
  bytes.writeBigUInt64BE(BigInt(packet.receivedAt ?? Date.now()), 28)
  bytes.set(payload, ENVELOPE_HEADER_BYTES)
  return bytes
}

export const H264_ENVELOPE_HEADER_BYTES = ENVELOPE_HEADER_BYTES
