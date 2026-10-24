import { describe, expect, it } from 'vitest'
import { MockProvider } from '../src/providers/mock-provider.js'

describe('MockProvider', () => {
  it('starts, renders a frame, accepts an action, and stops', async () => {
    const provider = new MockProvider(1)
    const session = await provider.start({ provider: 'mock' }, AbortSignal.timeout(1_000))
    expect(session.sessionId).toBe('mock-iphone-15')

    const first = await provider.frame()
    expect(first.contentType).toBe('image/svg+xml')
    expect(new TextDecoder().decode(first.bytes)).toContain('actions received')
    const firstPng = await provider.snapshot()
    expect([...firstPng.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(firstPng).toMatchObject({ contentType: 'image/png', width: 390, height: 844 })
    expect(firstPng.bytes.byteLength).toBeLessThan(32 * 1024 * 1024)
    expect(validatePngChunks(firstPng.bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(await provider.screenGeometry()).toMatchObject({
      viewport: { width: 390, height: 844 },
      orientation: 'portrait',
    })
    const firstSource = await provider.screenSource()
    expect(firstSource.kind).toBe('normalized')
    if (firstSource.kind === 'normalized') expect(firstSource.structure.nodes[2]?.name).toBe('0 actions received')

    await provider.action({ kind: 'tap', x: 100, y: 200 })
    const second = new TextDecoder().decode((await provider.frame()).bytes)
    expect(second).toContain('Tap at 100, 200')
    const secondPng = await provider.snapshot()
    expect(Buffer.compare(Buffer.from(firstPng.bytes), Buffer.from(secondPng.bytes))).not.toBe(0)
    const secondSource = await provider.screenSource()
    if (secondSource.kind === 'normalized') {
      expect(secondSource.structure.nodes[2]).toMatchObject({ name: '1 actions received', value: 'Tap at 100, 200' })
    }

    await provider.stop()
    await expect(provider.frame()).rejects.toThrow('not connected')
  })
})

function validatePngChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset)
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    const type = new TextDecoder().decode(typeBytes)
    const dataEnd = offset + 8 + length
    expect(dataEnd + 4).toBeLessThanOrEqual(bytes.byteLength)
    expect(view.getUint32(dataEnd)).toBe(crc32(bytes.subarray(offset + 4, dataEnd)))
    chunks.push(type)
    offset = dataEnd + 4
  }
  expect(offset).toBe(bytes.byteLength)
  return chunks
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
