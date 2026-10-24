import { playCapture } from './helpers/capture.js'
import { readFile } from 'node:fs/promises'
import { test, expect, type Page, type Download } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'

let viewer: ViewerServer
async function connect(page: Page, rotate = false) {
  let landscape = false
  let color = 'red'
  class ColorPhone extends MockProvider {
    override async frame() { return { bytes: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${landscape ? 640 : 320}" height="${landscape ? 320 : 640}"><rect width="100%" height="100%" fill="${color}"/></svg>`), contentType: 'image/svg+xml' as const } }
    override async action() { color = 'blue'; landscape = rotate }
  }
  const config = resolveMirrorConfig({ viewerPort: 0, frameIntervalMs: 250, mockStartupDelayMs: 0 })
  const service = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => new ColorPhone(0) })
  viewer = new ViewerServer(config, { service, assistant: null, disposeServiceOnClose: true })
  await viewer.listen(); await page.goto(viewer.url)
  await expect(page.locator('#capture-screenshot')).toBeDisabled()
  await service.start({ provider: 'mock' })
  await expect(page.locator('#capture-screenshot')).toBeEnabled()
}
async function bytes(download: Download) { return readFile((await download.path())!) }
test.afterEach(async () => { await viewer?.close() })

test('exports a real PNG and playable changing video while controls and screenshot stay independent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await connect(page, true)
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#capture-record').click()
  await expect(page.locator('#capture-record')).toHaveText('结束录屏')
  await expect(page.locator('#capture-timer')).toContainText('00:01')
  await page.locator('#theme-button').click()
  await page.locator('#tap-button').click()
  await page.waitForTimeout(500)
  const pngEvent = page.waitForEvent('download'); await page.locator('#capture-screenshot').click()
  const png = await bytes(await pngEvent)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 320])
  await expect(page.locator('#capture-record')).toHaveText('结束录屏')
  await page.locator('#language-select').selectOption('en')
  await expect(page.locator('#capture-record')).toHaveText('Stop recording')
  await page.waitForTimeout(500)
  expect((await page.locator('.capture-results').boundingBox())!.height).toBeLessThan(80)
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-capture-recording.png' })
  const videoEvent = page.waitForEvent('download'); await page.locator('#capture-record').click()
  const download = await videoEvent, video = await bytes(download)
  expect(download.suggestedFilename()).toMatch(/\.webm$/)
  const replay = await playCapture(page, video, 'video/webm')
  expect(replay).toEqual({ width: 320, height: 640, colors: ['red', 'blue'], audioTracks: 0 })
  expect(viewer.service.state().lifecycle).toBe('streaming')
  await expect(page.locator('#capture-video')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const id of ['#capture-screenshot', '#capture-record', '#capture-video']) {
    const box = await page.locator(id).boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  }
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-capture-narrow.png', fullPage: true })
})

test('a screenshot click during image decode stays locally busy while encoding and unrelated controls stay usable', async ({ page }) => {
  await connect(page)
  const download = page.waitForEvent('download')
  await page.evaluate(() => {
    // Capture may already own a decoded ImageBitmap. Hold encoding explicitly,
    // rather than assuming the <img> decode gap controls the retained surface.
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      return encode.call(this, value => { setTimeout(() => callback(value), 1000) }, ...args)
    }
    const image = document.querySelector('#device-frame')!
    Object.defineProperty(image, 'naturalWidth', { configurable: true, get: () => 0 })
    ;(document.querySelector('#capture-screenshot') as HTMLButtonElement).click()
    setTimeout(() => { delete (image as unknown as Record<string, unknown>).naturalWidth }, 500)
  })
  await expect(page.locator('#capture-screenshot')).toBeDisabled()
  await page.locator('#theme-button').click()
  expect((await bytes(await download)).subarray(1, 4).toString()).toBe('PNG')
  await expect(page.locator('#capture-screenshot')).toBeEnabled()
})

test('stops on disconnect and keeps downloads when later PNG or recorder creation fails', async ({ page }) => {
  await connect(page)
  const pngEvent = page.waitForEvent('download'); await page.locator('#capture-screenshot').click(); await pngEvent
  const oldPng = await page.locator('#capture-png').getAttribute('href')
  await page.locator('#capture-record').click(); await page.waitForTimeout(1100)
  const videoEvent = page.waitForEvent('download'); await viewer.service.stop(); await expect(page.locator('#capture-video')).toBeVisible(); await page.locator('#capture-video').click(); await videoEvent
  await expect(page.locator('#capture-message')).toContainText('Connection changed')
  const oldVideo = await page.locator('#capture-video').getAttribute('href')
  await expect(page.locator('#capture-record')).toBeDisabled()
  await viewer.service.start({ provider: 'mock' }); await expect(page.locator('#capture-record')).toBeEnabled()
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = (callback) => { setTimeout(() => callback(null), 600) } })
  await page.locator('#capture-screenshot').click()
  await expect(page.locator('#capture-screenshot')).toHaveText('Saving PNG…')
  await page.locator('#theme-button').click()
  await expect(page.locator('#capture-message')).toContainText('Screenshot failed')
  expect(await page.locator('#capture-png').getAttribute('href')).toBe(oldPng)
  await page.evaluate(() => { HTMLCanvasElement.prototype.captureStream = () => { throw new Error('Encoder unavailable') } })
  await page.locator('#capture-record').click()
  await expect(page.locator('#capture-message')).toContainText('Recording failed')
  expect(await page.locator('#capture-video').getAttribute('href')).toBe(oldVideo)
})

test('finalizes on page hiding and releases tracks', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.captureStream
    Object.assign(window, { captureStreams: [] as MediaStream[] })
    HTMLCanvasElement.prototype.captureStream = function (...args) { const stream = original.apply(this, args); (window as unknown as { captureStreams: MediaStream[] }).captureStreams.push(stream); return stream }
  })
  await connect(page); await page.locator('#capture-record').click(); await page.waitForTimeout(1100)
  const event = page.waitForEvent('download')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await event
  await expect(page.locator('#capture-message')).toContainText('Page hidden')
  expect(await page.evaluate(() => (window as unknown as { captureStreams: MediaStream[] }).captureStreams.flatMap((s) => s.getTracks()).every((t) => t.readyState === 'ended'))).toBe(true)
})

test('explains unsupported recording and still exports screenshots', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { value: undefined }) })
  await connect(page)
  await expect(page.locator('#capture-record')).toBeDisabled()
  await expect(page.locator('#capture-message')).toContainText('not supported')
  const event = page.waitForEvent('download'); await page.locator('#capture-screenshot').click()
  expect((await bytes(await event)).subarray(1, 4).toString()).toBe('PNG')
})


test('preserves a nonempty partial recording on encoder error and enforces the duration limit', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = MediaRecorder
    window.MediaRecorder = class extends Original {
      constructor(...args: ConstructorParameters<typeof MediaRecorder>) { super(...args); Object.assign(window, { lastRecorder: this }) }
    }
  })
  await connect(page); await page.locator('#capture-record').click(); await page.waitForTimeout(1200)
  await page.evaluate(() => (window as unknown as { lastRecorder: MediaRecorder }).lastRecorder.dispatchEvent(new Event('error')))
  await expect(page.locator('#capture-video')).toHaveText('Download partial video')
  await expect(page.locator('#capture-message')).toContainText('incomplete')
  const previous = await page.locator('#capture-video').getAttribute('href')
  await page.locator('#capture-record').click(); await page.waitForTimeout(1200)
  await page.evaluate(() => { const now = performance.now.bind(performance); Object.defineProperty(performance, 'now', { value: () => now() + 600001 }) })
  await expect(page.locator('#capture-message')).toContainText('limit')
  await expect(page.locator('#capture-video')).toHaveText('Download video')
  expect(await page.locator('#capture-video').getAttribute('href')).not.toBe(previous)
  await expect(page.locator('#capture-timer')).toBeHidden()
})

test('ends the old recording when the session is replaced', async ({ page }) => {
  await connect(page); await page.locator('#capture-record').click(); await page.waitForTimeout(1100)
  await page.route('**/api/state', async (route) => {
    const response = await route.fetch(), state = await response.json()
    await route.fulfill({ response, json: { ...state, sessionId: 'replacement-session', revision: state.revision + 1000 } })
  })
  await expect(page.locator('#capture-message')).toContainText('Connection changed')
  await expect(page.locator('#capture-video')).toBeVisible()
  await expect(page.locator('#capture-timer')).toBeHidden()
})

test('exports the last decoded PNG during the next image decode gap without stopping recording', async ({ page }) => {
  await connect(page)
  await page.locator('#capture-record').click()
  await expect(page.locator('#capture-record')).toHaveText('Stop recording')
  // Simulate the live polling element losing dimensions between src assignment
  // and onload, exactly when the already-enabled Screenshot receives its click.
  await page.evaluate(() => {
    document.querySelector('#capture-screenshot')!.addEventListener('click', () => {
      for (const image of document.querySelectorAll('img')) {
        Object.defineProperty(image, 'naturalWidth', { configurable: true, get: () => 0 })
        Object.defineProperty(image, 'naturalHeight', { configurable: true, get: () => 0 })
      }
    }, { capture: true, once: true })
  })
  const event = page.waitForEvent('download', { predicate: download => download.suggestedFilename().endsWith('.png'), timeout: 5000 })
  await page.locator('#capture-screenshot').click()
  const png = await bytes(await event)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([320, 640])
  await page.locator('#theme-button').click()
  await expect(page.locator('#capture-record')).toHaveText('Stop recording')
  await expect(page.locator('#capture-png')).toBeVisible()
})
