import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { SaxesParser } from 'saxes'
import type { ScreenGeometry, ScreenRect } from './types.js'

export interface RecoveryVisual {
  mode: 'full-screen' | 'android-content'
  region: ScreenRect
  imageWidth: number
  imageHeight: number
  sha256: string
}

/** Use the native content container only; never infer bars from colours or fixed pixels. */
function contentRegion(xml: string, appId: string, viewport: ScreenRect): ScreenRect | undefined {
  const matches: ScreenRect[] = []
  let foreignWindow = false
  const parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', tag => {
    const attrs = tag.attributes as Record<string, string>
    if (attrs.package && attrs.package !== appId && attrs.displayed !== 'false') foreignWindow = true
    if (attrs['resource-id'] !== 'android:id/content' || attrs.package !== appId || attrs.displayed === 'false') return
    const bounds = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(attrs.bounds ?? '')
    if (!bounds) return
    const [x, y, right, bottom] = bounds.slice(1).map(Number) as [number, number, number, number]
    matches.push({ x, y, width: right - x, height: bottom - y })
  })
  try { parser.write(xml).close() } catch { return undefined }
  if (foreignWindow || matches.length !== 1 || viewport.x !== 0 || viewport.y !== 0) return undefined
  const r = matches[0]!
  // Only exclude narrow top/bottom system strips. Dialogs, keyboards and split windows
  // cannot turn an arbitrary small rectangle into the entire visual guard.
  if (r.x !== 0 || r.width !== viewport.width || r.y < 0 || r.y > viewport.height * .2
    || r.height <= 0 || r.y + r.height > viewport.height
    || viewport.height - r.y - r.height > viewport.height * .1) return undefined
  return r
}

export async function recoveryVisual(image: Uint8Array, xml: string, platform: 'android' | 'ios', appId: string, geometry: ScreenGeometry): Promise<RecoveryVisual> {
  const { data, info } = await sharp(image, { limitInputPixels: 32 * 1024 * 1024 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const content = platform === 'android' ? contentRegion(xml, appId, geometry.viewport) : undefined
  const region = content ?? geometry.viewport
  const sx = info.width / geometry.viewport.width, sy = info.height / geometry.viewport.height
  if (![sx, sy].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid recovery image geometry')
  const left = content ? Math.floor(content.x * sx) : 0
  const top = content ? Math.floor(content.y * sy) : 0
  const right = content ? Math.ceil((content.x + content.width) * sx) : info.width
  const bottom = content ? Math.ceil((content.y + content.height) * sy) : info.height
  const hash = createHash('sha256')
  for (let y = top; y < bottom; y++) hash.update(data.subarray((y * info.width + left) * info.channels, (y * info.width + right) * info.channels))
  return { mode: content ? 'android-content' : 'full-screen', region, imageWidth: info.width, imageHeight: info.height, sha256: hash.digest('hex') }
}
