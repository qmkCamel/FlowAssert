import { expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { WorkbenchOcr } from '../src/workbench-ocr.js'
import { ocrProfileSchema } from '../src/workbench-ocr-contracts.js'
import { doctorOcr, runOcrProcess } from '../src/workbench-ocr-helper.js'
vi.mock('../src/workbench-ocr-helper.js', () => ({ doctorOcr: vi.fn(), runOcrProcess: vi.fn() }))
const identity = { sourceSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), capabilities: { contractVersion: 1, helperVersion: '1', osVersion: 'test', arch: 'arm64', revisions: [{ revision: 3, languages: ['en-US'] }] } }
const profile = ocrProfileSchema.parse({ contractVersion: 1, id: 'title', revision: 1, appId: 'com.example.app', platform: 'ios', builds: ['1'], pageKey: 'home', width: 100, height: 200, orientation: 'portrait', region: { x: 10, y: 10, width: 80, height: 60 }, identity, requestRevision: 3, languages: ['en-US'], expected: 'Hello', blockers: [], normalization: { nfc: true, trim: true }, minimumConfidence: .9 })
it('validates actual image bytes, crop lineage, malformed helper output and version drift', async () => {
  vi.mocked(doctorOcr).mockResolvedValue({ identity: profile.identity, binary: 'trusted-fixture' })
  const image = await sharp({ create: { width: 100, height: 200, channels: 3, background: 'white' } }).png().toBuffer(), service = new WorkbenchOcr('unused')
  const response = { contractVersion: 1, helperVersion: '1', osVersion: 'test', arch: 'arm64', requestRevision: 3, languages: ['en-US'], boxes: [{ text: 'Hello', confidence: 1, box: { x: .1, y: .1, width: .8, height: .6 } }] }
  vi.mocked(runOcrProcess).mockResolvedValue(Buffer.from(JSON.stringify(response)))
  try {
    const result = await service.preview(image, profile)
    expect(result.decision.status).toBe('pass'); expect(result.productionEnabled).toBe(false)
    expect(result.cropSha256).not.toBe(result.imageSha256); expect(await sharp(result.crop).metadata()).toMatchObject({ width: 80, height: 60 })
    for (const invalid of [Buffer.from('bad'), await sharp(image).resize(50, 100).png().toBuffer()]) await expect(service.preview(invalid, profile)).rejects.toThrow()
    for (const value of ['invalid-json', JSON.stringify({ ...response, toolCall: 'upload' })]) { vi.mocked(runOcrProcess).mockResolvedValue(Buffer.from(value)); await expect(service.preview(image, profile)).rejects.toThrow() }
    vi.mocked(doctorOcr).mockResolvedValue({ identity: { ...profile.identity, binarySha256: 'c'.repeat(64) }, binary: 'fixture' })
    await expect(service.preview(image, profile)).rejects.toThrow('version-changed')
    expect(service.capacity).toEqual({ active: 0, queued: 0 })
  } finally { await service.close() }
})
it('holds two slots until their operations settle, bounds queue and drains all work on close', async () => {
  let releases = 0
  vi.mocked(doctorOcr).mockImplementation((_cache, signal) => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => { releases++; reject(new Error('aborted')) }, { once: true })))
  const service = new WorkbenchOcr('unused'), jobs = Array.from({ length: 6 }, () => service.preview(Buffer.from('small'), profile))
  const settled = Promise.allSettled(jobs)
  await expect.poll(() => service.capacity).toEqual({ active: 2, queued: 4 })
  await expect(service.preview(Buffer.from('x'), profile)).rejects.toThrow('queue-budget')
  await service.close(); expect((await settled).every(r => r.status === 'rejected')).toBe(true)
  expect(releases).toBe(2); expect(service.capacity).toEqual({ active: 0, queued: 0 })
})
