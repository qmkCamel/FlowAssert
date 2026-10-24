import { parentPort, workerData } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const contains = (rect, x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height

async function compare() {
  const { profile, screenshot, currentBuild, currentTheme } = workerData
  const base = { rulesVersion: 1, revision: profile.revision, referenceSha256: profile.referenceSha256 }
  const inconclusive = message => ({ ...base, status: 'inconclusive', message, comparedPixels: 0, differentPixels: 0 })
  if (!(profile.allowedTargetBuilds ?? [profile.build]).includes(currentBuild) || currentBuild === 'unknown') return inconclusive('App build is not comparable to the approved visual baseline')
  if (profile.theme !== 'any' && profile.theme !== currentTheme) return inconclusive('Theme is not comparable to the approved visual baseline')
  let actual, reference
  try {
    const image = Buffer.from(screenshot), expected = Buffer.from(profile.referenceBase64, 'base64')
    if (image.length > 16 * 1024 * 1024 || expected.length > 4 * 1024 * 1024) return inconclusive('Visual image exceeds budget')
    const metadata = await sharp(image, { limitInputPixels: 16_777_216 }).metadata()
    if (metadata.format !== 'png' || metadata.width !== profile.width || metadata.height !== profile.height) return inconclusive('Screenshot orientation or dimensions differ from the approved baseline')
    if (hash(expected) !== profile.referenceSha256) return inconclusive('Approved visual baseline failed integrity verification')
    actual = await sharp(image, { limitInputPixels: 16_777_216 }).ensureAlpha().raw().toBuffer()
    reference = await sharp(expected, { limitInputPixels: 16_777_216 }).ensureAlpha().raw().toBuffer()
  } catch { return inconclusive('Screenshot or approved visual baseline cannot be decoded') }
  if (actual.length !== reference.length || actual.length !== profile.width * profile.height * 4) return inconclusive('Visual pixel buffers are not comparable')
  const included = profile.regions ?? [{ x: 0, y: 0, width: profile.width, height: profile.height }]
  let comparedPixels = 0, differentPixels = 0
  for (let y = 0; y < profile.height; y++) for (let x = 0; x < profile.width; x++) {
    if (!included.some(rect => contains(rect, x, y)) || profile.masks.some(rect => contains(rect, x, y))) continue
    comparedPixels++
    const index = (y * profile.width + x) * 4
    if ([0, 1, 2, 3].some(channel => Math.abs(actual[index + channel] - reference[index + channel]) > profile.channelDelta)) differentPixels++
  }
  if (!comparedPixels) return inconclusive('Visual rules contain no comparable pixels')
  const ratio = differentPixels / comparedPixels
  return { ...base, status: ratio <= profile.maxDifferentRatio ? 'pass' : 'fail',
    message: `${differentPixels}/${comparedPixels} pixels differ (threshold ${profile.maxDifferentRatio})`, comparedPixels, differentPixels, ratio }
}

compare().then(result => parentPort.postMessage(result)).catch(() => parentPort.postMessage({ status: 'inconclusive', message: 'Visual comparison worker failed',
  comparedPixels: 0, differentPixels: 0, rulesVersion: 1, revision: workerData.profile.revision, referenceSha256: workerData.profile.referenceSha256 }))
