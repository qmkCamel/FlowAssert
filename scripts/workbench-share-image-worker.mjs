import { parentPort, workerData } from 'node:worker_threads'
import sharp from 'sharp'

async function transform() {
  const input = Buffer.from(workerData.input)
  const masks = workerData.masks
  if (input.length > 4 * 1024 * 1024 || !Array.isArray(masks) || masks.length > 64) throw new Error('Share image exceeds input budget')
  const image = sharp(input, { limitInputPixels: 16_777_216 })
  const metadata = await image.metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) throw new Error('Unsupported screenshot dimensions')
  const overlays = masks.map(mask => {
    if (!mask || ![mask.x, mask.y, mask.width, mask.height].every(Number.isSafeInteger)
      || mask.x < 0 || mask.y < 0 || mask.width <= 0 || mask.height <= 0
      || mask.x + mask.width > metadata.width || mask.y + mask.height > metadata.height) throw new Error('Image mask is outside screenshot')
    return { input: { create: { width: mask.width, height: mask.height, channels: 4, background: '#000000' } }, left: mask.x, top: mask.y }
  })
  const bytes = await image.composite(overlays).png().toBuffer()
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Share image exceeds output budget')
  parentPort.postMessage({ bytes })
}

transform().catch(error => parentPort.postMessage({ error: error instanceof Error ? error.message : 'Share image failed' }))
