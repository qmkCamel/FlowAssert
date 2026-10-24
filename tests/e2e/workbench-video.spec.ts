import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'
import { playCapture } from './helpers/capture.js'
let viewer: ViewerServer, root: string
const demo = (await readFile(new URL('../../examples/flows/demo.yaml', import.meta.url), 'utf8')).replace('- tap:', '- wait: 1\n- tap:')
test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'mirror-video-ui-'))
  viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await viewer.service.start({ provider: 'mock' }); await page.goto(viewer.url)
  await expect(page.locator('#capture-record')).toBeEnabled()
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#workbench-toggle').click(); await page.locator('#wb-yaml').fill(demo)
  await page.locator('#wb-record-video').check()
})
test.afterEach(async () => { await viewer?.close(); await rm(root, { recursive: true, force: true }) })

test('archives a real video, decodes it, restarts and seeks to a step in history', async ({ page }) => {
  await page.locator('#wb-run').click()
  await expect(page.locator('#capture-record')).toHaveText('结束录屏')
  await page.locator('#theme-button').click()
  await expect(page.locator('#wb-video-progress')).toContainText('完整录像', { timeout: 20000 })
  const id = (await page.locator('.wb-run-id').textContent())!
  const run = await viewer.workbench.get(id)
  expect(run).toMatchObject({ verdict: 'pass', video: { status: 'complete', sessionId: run.sessionId } })
  const file = run.video!.file!
  const downloadEvent = page.waitForEvent('download'); await page.locator('.wb-video a[download]').click()
  expect(await readFile((await (await downloadEvent).path())!)).toEqual(await readFile(join(root, id, file.name)))
  const replay = await playCapture(page, await readFile(join(root, id, file.name)), file.contentType)
  expect(replay.width).toBeGreaterThan(0); expect(replay.audioTracks).toBe(0)
  await viewer.close()
  viewer = new ViewerServer(Config({ viewerPort: 0 }), { workbenchRoot: root }); await viewer.listen()
  await page.goto(viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
  await expect(page.locator('.wb-run-id')).toHaveText(id)
  const player = page.locator('.wb-video-player')
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)
  const step = page.locator('.wb-step').nth(3); await step.locator('summary').click()
  await step.getByRole('button', { name: /查看步骤录像/ }).click()
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(0.8)
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).seeking)).toBe(false)
  await expect.poll(() => player.evaluate((v) => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await player.evaluate((v) => (v as HTMLVideoElement).pause())
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.locator('.wb-video').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-video-history.png' })
  await page.setViewportSize({ width: 390, height: 844 }); await player.scrollIntoViewIfNeeded()
  const box = await player.boundingBox(); expect(box!.width).toBeLessThan(390)
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-video-narrow.png', fullPage: true })
  await writeFile(join(root, id, file.name), Buffer.from('corrupted'))
  await page.reload(); if (!await page.locator('#workbench-panel').isVisible()) await page.locator('#workbench-toggle').click()
  await expect(page.locator('.wb-video .wb-error')).toBeVisible()
  await expect(page.locator('.wb-video-status')).toHaveText('录像不可用')
})

test('keeps controls independent during slow saving and retries failed upload without losing the local download', async ({ page }) => {
  let attempts = 0, saving = false
  await page.route('**/api/runs/*/video', async (route) => {
    attempts++; saving = true
    await new Promise((resolve) => setTimeout(resolve, 1300))
    if (attempts === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary save failure' }) })
    else await route.continue()
  })
  await page.locator('#wb-run').click()
  await expect.poll(() => saving).toBe(true)
  await expect(page.locator('#wb-video-progress')).toContainText('正在保存')
  await page.locator('#theme-button').click()
  await page.locator('#capture-screenshot').click()
  await expect(page.locator('#wb-video-retry')).toBeVisible()
  await expect(page.locator('#capture-video')).toBeVisible()
  const href = await page.locator('#capture-video').getAttribute('href')
  await page.locator('#language-select').selectOption('en')
  await page.locator('#wb-video-retry').click()
  await expect(page.locator('#wb-video-progress')).toContainText('Complete recording')
  expect(await page.locator('#capture-video').getAttribute('href')).toBe(href)
  expect(attempts).toBe(2)
})

test('archives an early manual stop as partial while the run finishes normally', async ({ page }) => {
  await page.locator('#wb-yaml').fill(demo.replace('- wait: 1', '- wait: 3'))
  await page.locator('#wb-run').click(); await page.waitForTimeout(800)
  await page.locator('#capture-record').click()
  await expect(page.locator('#wb-video-progress')).toContainText('部分录像')
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 15000 })
  const id = (await page.locator('.wb-run-id').textContent())!
  const run = await viewer.workbench.get(id)
  expect(run.video?.status).toBe('partial')
  const last = page.locator('.wb-step').last(); await last.locator('summary').click()
  await expect(last.getByRole('button', { name: /查看步骤录像/ })).toBeDisabled()
})

test('saves partial video on hiding even when the workbench panel is closed', async ({ page }) => {
  await page.locator('#wb-yaml').fill(demo.replace('- wait: 1', '- wait: 3'))
  await page.locator('#wb-run').click(); await page.waitForTimeout(900)
  const id = (await page.locator('.wb-run-id').textContent())!
  await page.locator('#workbench-toggle').click()
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(async () => (await viewer.workbench.get(id)).video?.status).toBe('partial')
  await viewer.workbench.wait()
  expect((await viewer.workbench.get(id)).verdict).toBe('pass')
})

test('does not dispatch a video-requested flow when encoding is unsupported; opt-out still runs', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'MediaRecorder', { value: undefined }) })
  await page.reload(); if (!await page.locator('#workbench-panel').isVisible()) await page.locator('#workbench-toggle').click()
  await page.locator('#wb-yaml').fill(demo); await page.locator('#wb-record-video').check()
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-error')).toBeVisible()
  expect(await viewer.workbench.list()).toHaveLength(0)
  await page.locator('#wb-record-video').uncheck(); await page.locator('#wb-run').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 15000 })
  expect((await viewer.workbench.list())[0]!.video).toBeUndefined()
})
