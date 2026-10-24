import type { Page } from '@playwright/test'

export async function playCapture(page: Page, data: Buffer, mime: string) {
  const replay = await page.context().newPage()
  try {
    return await replay.evaluate(async ({ encoded, mime }) => {
      const video = document.createElement('video'); video.muted = true; document.body.append(video)
      video.src = `data:${mime};base64,${encoded}`
      await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Video did not decode')) })
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
      const ctx = canvas.getContext('2d')!, colors = new Set<string>()
      const audioTracks = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream().getAudioTracks().length
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Playback did not finish')), 10000)
        const poll = setInterval(() => { ctx.drawImage(video, video.videoWidth / 2, video.videoHeight / 2, 1, 1, 0, 0, 1, 1); const p = ctx.getImageData(0, 0, 1, 1).data; if (p[0]! > 180) colors.add('red'); if (p[2]! > 180) colors.add('blue') }, 30)
        video.onended = () => { clearInterval(poll); clearTimeout(timeout); resolve() }
        void video.play().catch(reject)
      })
      return { width: video.videoWidth, height: video.videoHeight, colors: [...colors], audioTracks }
    }, { encoded: data.toString('base64'), mime })
  } finally { await replay.close() }
}
