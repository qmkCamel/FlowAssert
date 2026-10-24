import { expect, it } from 'vitest'
import sharp from 'sharp'
import { recoveryVisual } from '../src/recovery-visual.js'
import type { ScreenGeometry } from '../src/types.js'

const geometry: ScreenGeometry = { viewport: { x: 0, y: 0, width: 100, height: 200 }, orientation: 'portrait', orientationSource: 'provider' }
const content = '<node package="fixture" resource-id="android:id/content" bounds="[0,20][100,190]" displayed="true"/>'
const xml = `<hierarchy>${content}</hierarchy>`
async function png(x = -1, y = -1, compressionLevel = 6) {
  const bytes = Buffer.alloc(100 * 200 * 4, 255)
  if (x >= 0) bytes[(y * 100 + x) * 4] = 0
  return sharp(bytes, { raw: { width: 100, height: 200, channels: 4 } }).png({ compressionLevel }).toBuffer()
}
it('ignores system strips only with a unique native App content container', async () => {
  const a = await recoveryVisual(await png(), xml, 'android', 'fixture', geometry)
  expect(a.mode).toBe('android-content')
  expect(a.region).toEqual({ x: 0, y: 20, width: 100, height: 170 })
  expect(await recoveryVisual(await png(50, 8), xml, 'android', 'fixture', geometry)).toEqual(a)
  expect(await recoveryVisual(await png(50, 195), xml, 'android', 'fixture', geometry)).toEqual(a)
})
it('detects a single changed App pixel, including an overlay or the content boundary', async () => {
  const a = await recoveryVisual(await png(), xml, 'android', 'fixture', geometry)
  for (const y of [20, 90, 189]) expect((await recoveryVisual(await png(50, y), xml, 'android', 'fixture', geometry)).sha256).not.toBe(a.sha256)
})
it.each([
  '<hierarchy/>', `<hierarchy>${content}${content}</hierarchy>`,
  `<hierarchy>${content}<node package="com.android.systemui" displayed="true"/></hierarchy>`,
  xml.replace('[0,20][100,190]', '[0,20][100,120]'),
  xml.replace('[0,20][100,190]', '[20,20][100,190]'),
  xml.replace('[0,20][100,190]', '[0,60][100,190]'), '<broken',
])('keeps the whole screen when content bounds are not trustworthy: %s', async source => {
  const a = await recoveryVisual(await png(), source, 'android', 'fixture', geometry)
  expect(a.mode).toBe('full-screen')
  expect((await recoveryVisual(await png(50, 8), source, 'android', 'fixture', geometry)).sha256).not.toBe(a.sha256)
})
it('compares decoded pixels, so PNG compression cannot fabricate a page change', async () => {
  expect(await recoveryVisual(await png(-1, -1, 0), xml, 'android', 'fixture', geometry)).toEqual(await recoveryVisual(await png(-1, -1, 9), xml, 'android', 'fixture', geometry))
})
it('keeps iOS full-screen checks and includes dimensions and region in the fingerprint', async () => {
  const a = await recoveryVisual(await png(), xml, 'ios', 'fixture', geometry)
  expect(a.mode).toBe('full-screen')
  expect((await recoveryVisual(await png(50, 8), xml, 'ios', 'fixture', geometry)).sha256).not.toBe(a.sha256)
  const resized = await sharp(await png()).resize(200, 400).png().toBuffer()
  expect(await recoveryVisual(resized, xml, 'ios', 'fixture', geometry)).not.toEqual(a)
})
