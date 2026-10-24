export function jpegFixture(width = 3, height = 2): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

export function scrcpyStreamFixture(): Buffer {
  const codec = Buffer.alloc(4)
  codec.writeUInt32BE(0x68323634)
  const session = scrcpySession(390, 844)
  const config = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1e, 0xaa, 0, 0, 0, 1, 0x68, 0xbb])
  const key = Buffer.from([0, 0, 0, 1, 0x65, 0x88, 0x84])
  const delta = Buffer.from([0, 0, 0, 1, 0x41, 0x9a])
  return Buffer.concat([
    codec,
    session,
    scrcpyMedia(1n << 62n, config),
    scrcpyMedia((1n << 61n) | 123n, key),
    scrcpyMedia(124n, delta),
  ])
}

export function scrcpySession(width: number, height: number, resized = false): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt32BE(0x8000_0000 + (resized ? 1 : 0), 0)
  header.writeUInt32BE(width, 4)
  header.writeUInt32BE(height, 8)
  return header
}

export function scrcpyMedia(flagsAndPts: bigint, payload: Uint8Array): Buffer {
  const header = Buffer.alloc(12)
  header.writeBigUInt64BE(flagsAndPts, 0)
  header.writeUInt32BE(payload.byteLength, 8)
  return Buffer.concat([header, Buffer.from(payload)])
}
