import { viewerMediaError } from './viewer-media-error.js'

export const MAX_MEDIA_FRAME_BYTES = 8 * 1024 * 1024
const MAX_PART_HEADERS_BYTES = 4 * 1024

export interface MjpegFrame {
  bytes: Uint8Array
  width: number
  height: number
}

export function boundaryFromContentType(contentType: string | null): string {
  if (!contentType || !/^multipart\/x-mixed-replace\b/i.test(contentType)) {
    throw viewerMediaError('viewer_media_protocol_invalid')
  }
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  const boundary = match?.[1] ?? match?.[2]
  if (!boundary || boundary.length > 70 || /[^\x21-\x7e]/.test(boundary)) {
    throw viewerMediaError('viewer_media_protocol_invalid')
  }
  return boundary.startsWith('--') ? boundary.slice(2) : boundary
}

export class MjpegParser {
  readonly #boundary: Buffer
  readonly #delimiter: Buffer
  #buffer = Buffer.alloc(0)
  #headers: Record<string, string> | null = null
  #awaitingHeaders = false
  #sawClosingBoundary = false
  #ended = false

  constructor(boundary: string) {
    if (!boundary || boundary.length > 70 || /[^\x21-\x7e]/.test(boundary)) {
      throw viewerMediaError('viewer_media_protocol_invalid')
    }
    this.#boundary = Buffer.from(`--${boundary}`, 'ascii')
    this.#delimiter = Buffer.from(`\r\n--${boundary}`, 'ascii')
  }

  push(chunk: Uint8Array): MjpegFrame[] {
    if (this.#ended || chunk.byteLength === 0) return []
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)])
    if (this.#buffer.byteLength > MAX_MEDIA_FRAME_BYTES + MAX_PART_HEADERS_BYTES + this.#delimiter.byteLength) {
      throw viewerMediaError('viewer_media_frame_too_large')
    }
    return this.#drain(false)
  }

  finish(): MjpegFrame[] {
    if (this.#ended) return []
    const frames = this.#drain(true)
    this.#ended = true
    if (this.#headers !== null || this.#awaitingHeaders || this.#buffer.some((value) => !isWhitespace(value))) {
      throw viewerMediaError('viewer_media_protocol_invalid')
    }
    return frames
  }

  #drain(eof: boolean): MjpegFrame[] {
    const frames: MjpegFrame[] = []
    while (true) {
      if (this.#sawClosingBoundary) break
      if (this.#headers === null) {
        if (!this.#awaitingHeaders) {
          const boundaryIndex = this.#buffer.indexOf(this.#boundary)
          if (boundaryIndex < 0) {
            if (this.#buffer.byteLength > this.#boundary.byteLength + 4 || eof) {
              throw viewerMediaError('viewer_media_protocol_invalid')
            }
            break
          }
          if (boundaryIndex > 0 && this.#buffer.subarray(0, boundaryIndex).some((value) => !isWhitespace(value))) {
            throw viewerMediaError('viewer_media_protocol_invalid')
          }
          if (this.#buffer.byteLength < boundaryIndex + this.#boundary.byteLength + 2) {
            if (eof) throw viewerMediaError('viewer_media_protocol_invalid')
            break
          }
          this.#buffer = this.#buffer.subarray(boundaryIndex + this.#boundary.byteLength)
          if (this.#buffer.subarray(0, 2).equals(Buffer.from('--'))) {
            this.#buffer = this.#buffer.subarray(2)
            this.#sawClosingBoundary = true
            break
          }
          if (!this.#buffer.subarray(0, 2).equals(Buffer.from('\r\n'))) {
            throw viewerMediaError('viewer_media_protocol_invalid')
          }
          this.#buffer = this.#buffer.subarray(2)
          this.#awaitingHeaders = true
        }
        const headerEnd = this.#buffer.indexOf(Buffer.from('\r\n\r\n'))
        if (headerEnd < 0) {
          if (this.#buffer.byteLength > MAX_PART_HEADERS_BYTES || eof) throw viewerMediaError('viewer_media_protocol_invalid')
          break
        }
        if (headerEnd > MAX_PART_HEADERS_BYTES) throw viewerMediaError('viewer_media_protocol_invalid')
        this.#headers = parseHeaders(this.#buffer.subarray(0, headerEnd).toString('latin1'))
        this.#buffer = this.#buffer.subarray(headerEnd + 4)
        this.#awaitingHeaders = false
      }

      const declaredLength = this.#headers['content-length'] === undefined
        ? null
        : parseContentLength(this.#headers['content-length'])
      if (declaredLength !== null) {
        if (this.#buffer.byteLength < declaredLength) {
          if (eof) throw viewerMediaError('viewer_media_protocol_invalid')
          break
        }
        frames.push(validateJpeg(this.#buffer.subarray(0, declaredLength)))
        this.#buffer = this.#buffer.subarray(declaredLength)
        if (this.#buffer.subarray(0, 2).equals(Buffer.from('\r\n'))) this.#buffer = this.#buffer.subarray(2)
        this.#headers = null
        continue
      }

      const nextBoundary = this.#buffer.indexOf(this.#delimiter)
      if (nextBoundary < 0) {
        if (this.#buffer.byteLength > MAX_MEDIA_FRAME_BYTES || eof) throw viewerMediaError('viewer_media_protocol_invalid')
        break
      }
      frames.push(validateJpeg(this.#buffer.subarray(0, nextBoundary)))
      this.#buffer = this.#buffer.subarray(nextBoundary + 2)
      this.#headers = null
    }
    return frames
  }
}

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split('\r\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) throw viewerMediaError('viewer_media_protocol_invalid')
    const name = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (!/^[a-z0-9-]+$/.test(name) || value.length > 1024) throw viewerMediaError('viewer_media_protocol_invalid')
    headers[name] = value
  }
  const contentType = headers['content-type']?.toLowerCase()
  if (contentType && contentType !== 'image/jpeg') throw viewerMediaError('viewer_media_protocol_invalid')
  return headers
}

function parseContentLength(value: string): number {
  if (!/^\d+$/.test(value)) throw viewerMediaError('viewer_media_protocol_invalid')
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length <= 0) throw viewerMediaError('viewer_media_protocol_invalid')
  if (length > MAX_MEDIA_FRAME_BYTES) throw viewerMediaError('viewer_media_frame_too_large')
  return length
}

function validateJpeg(bytes: Uint8Array): MjpegFrame {
  if (bytes.byteLength < 4 || bytes.byteLength > MAX_MEDIA_FRAME_BYTES
    || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.byteLength - 2] !== 0xff || bytes[bytes.byteLength - 1] !== 0xd9) {
    throw viewerMediaError(bytes.byteLength > MAX_MEDIA_FRAME_BYTES ? 'viewer_media_frame_too_large' : 'viewer_media_protocol_invalid')
  }
  const { width, height } = jpegSize(bytes)
  return { bytes: new Uint8Array(bytes), width, height }
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    offset += 2
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.byteLength) break
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (length < 2 || offset + length > bytes.byteLength) break
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      if (width > 0 && height > 0) return { width, height }
      break
    }
    offset += length
  }
  throw viewerMediaError('viewer_media_protocol_invalid')
}

function isWhitespace(value: number): boolean {
  return value === 0x0d || value === 0x0a || value === 0x20 || value === 0x09
}
