import { parentPort, workerData } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function crop() {
  const { profile } = workerData, image = Buffer.from(workerData.image)
  if (!image.length || image.length > 16 * 1024 * 1024) throw new Error('ocr-image-budget')
  const decoder = sharp(image, { limitInputPixels: 4096 * 4096, failOn: 'warning' }), meta = await decoder.metadata()
  if (meta.format !== 'png' || meta.width !== profile.width || meta.height !== profile.height || (meta.orientation ?? 1) !== 1 || (meta.pages ?? 1) !== 1) throw new Error('ocr-image-geometry')
  const region = await decoder.extract({ left: profile.region.x, top: profile.region.y, width: profile.region.width, height: profile.region.height }).png().toBuffer()
  if (region.length > 4 * 1024 * 1024) throw new Error('ocr-crop-budget')
  return { crop: region, imageSha256: hash(image), cropSha256: hash(region) }
}
crop().then(result => parentPort.postMessage({ ok: true, result })).catch(error => parentPort.postMessage({ ok: false, code: /^ocr-[a-z-]+$/.test(error.message) ? error.message : 'ocr-image-invalid' }))
