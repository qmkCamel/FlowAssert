/** Explicit local phone inputs; preserves app data and validates run-bound recording, restart and history replay. */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { chromium, expect, type Page } from '@playwright/test'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const flowPath = process.env.MOBILE_MIRROR_FLOW_PATH ?? ''
const appium = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (![capsPath, flowPath, appium].every(isAbsolute)) throw new Error('Explicit absolute capabilities, YAML and managed Appium executable required')
if (!existsSync(new URL('../lib/viewer/report-presentation.js', import.meta.url))) throw new Error('Run pnpm build before the physical Viewer probe; required browser projection is missing')
const supplied = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
if (!supplied['appium:udid'] || supplied['appium:fullReset'] || supplied['appium:app']) throw new Error('Select a physical phone without installing/resetting the app')
const caps = { ...supplied, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false, 'appium:allowProvisioningDeviceRegistration': false }
const root = resolve('artifacts/physical-validation', `workbench-video-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
let viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: appium, appiumUrl: process.env.MOBILE_MIRROR_APPIUM_URL ?? 'http://127.0.0.1:4723', androidScrcpyPath: process.env.MOBILE_MIRROR_SCRCPY_PATH ?? '', androidScrcpyServerPath: process.env.MOBILE_MIRROR_SCRCPY_SERVER_PATH ?? '', appiumSessionStartupTimeoutMs: 120000 }), { workbenchRoot: resolve(root, 'runs') })
const browser = await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
let page: Page | undefined
const pageErrors: string[] = []
try {
  await viewer.listen(); await viewer.service.start({ provider: 'appium', capabilities: caps })
  const sessionId = viewer.service.state().sessionId
  // For the synthetic acceptance app, establish its page before any browser
  // recording. A successful later assertion does not redact an earlier home screen.
  const fixtureSelected = supplied['appium:bundleId'] === 'dev.mobilemirror.fixture' || supplied['appium:appPackage'] === 'dev.mobilemirror.fixture'
  if (fixtureSelected) {
    const prepared = await viewer.workbench.start(`name: Fixture capture readiness\nplatform: ${String(supplied.platformName).toLowerCase()}\nappId: dev.mobilemirror.fixture\n---\n- launchApp\n- assertVisible: {text: "Mirror Fixture · Test Order"}\n`)
    await viewer.workbench.wait()
    if ((await viewer.workbench.get(prepared.id)).verdict !== 'pass') throw new Error('Synthetic Fixture is not ready; refuse recording another screen')
  }
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('pageerror', error => { if (pageErrors.length < 20) pageErrors.push(error.message.slice(0, 2048)) })
  await page.goto(`${viewer.url}#/devices`)
  await page.locator('#language-select').selectOption('zh-CN')
  await expect(page.locator('#capture-record')).toBeEnabled({ timeout: 20000 })
  await page.locator('#workbench-toggle').click()
  await page.locator('#wb-record-video').check()
  await page.locator('#wb-yaml').fill(await readFile(flowPath, 'utf8')); await page.locator('#wb-run').click()
  await expect.poll(() => viewer.workbench.activeId, { timeout: 15000 }).not.toBeNull()
  const runId = viewer.workbench.activeId!
  await expect(page.locator('#wb-detail .wb-run-id')).toHaveText(runId)
  await expect(page.locator('#capture-record')).toHaveText('结束录屏')
  await page.locator('#theme-button').click()
  const pngEvent = page.waitForEvent('download'); await page.locator('#capture-screenshot').click()
  await (await pngEvent).saveAs(resolve(root, 'phone.png'))
  await page.screenshot({ path: resolve(root, 'recording.png') })
  await expect(page.locator('#wb-video-progress')).toContainText('完整录像', { timeout: 180000 })
  const run = await viewer.workbench.get(runId)
  const sameSession = viewer.service.state().sessionId === sessionId && run.sessionId === sessionId
  if (!run.video?.file || run.video.status !== 'complete') throw new Error('Video was not archived')
  const file = run.video.file
  const media = await page.evaluate(() => (window as unknown as { __mobileMirrorMediaMetrics: { snapshot(): unknown } }).__mobileMirrorMediaMetrics.snapshot())
  await viewer.workbench.store.readEvidence(runId, file)
  await page.locator('.wb-video').scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(root, 'completed.png') })
  await viewer.service.stop()
  const stopped = viewer.service.state().lifecycle === 'idle' && !viewer.service.state().appiumRuntime.owned
  await viewer.close()
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0 }), { workbenchRoot: resolve(root, 'runs') })
  await viewer.listen(); await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
  await expect(page.locator('.wb-run-id')).toHaveText(runId)
  const player = page.locator('.wb-video-player')
  await expect.poll(() => player.evaluate((el) => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  const step = page.locator('.wb-step').nth(1)
  await step.locator('summary').click(); await step.getByRole('button', { name: /查看步骤录像/ }).click()
  await expect.poll(() => player.evaluate((el) => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
  await expect.poll(() => player.evaluate((el) => (el as HTMLVideoElement).seeking)).toBe(false)
  await player.evaluate((el) => (el as HTMLVideoElement).pause())
  await page.locator('.wb-video').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(root, 'restored.png') })
  const restored = await viewer.workbench.get(runId)
  const report = { root, runId, verdict: run.verdict, steps: run.steps.length, fixturePreparedBeforeCapture: fixtureSelected, sameSession, stopped, media, video: run.video, restored: restored.video?.file?.sha256 === file.sha256, replayTime: await player.evaluate((el) => (el as HTMLVideoElement).currentTime) }
  await writeFile(resolve(root, 'probe.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  if (run.verdict !== 'pass' || !sameSession || !stopped || !report.restored) throw new Error('Video history acceptance failed')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} catch (error) {
  // Keep bounded diagnostics private; never expose phone frames/capabilities in public summaries.
  let ui: unknown = null
  if (page && !page.isClosed()) {
    try {
      ui = await page.evaluate(() => ({
        hash: location.hash,
        capture: document.querySelector('#capture-message')?.textContent,
        media: document.querySelector('#meta-media')?.textContent,
        frames: [...document.querySelectorAll('img,video,canvas')].slice(0, 20).map(el => ({
          tag: el.tagName, id: el.id, hidden: (el as HTMLElement).hidden,
          width: (el as HTMLImageElement).naturalWidth ?? (el as HTMLCanvasElement).width,
          height: (el as HTMLImageElement).naturalHeight ?? (el as HTMLCanvasElement).height,
        })),
      }))
      await page.screenshot({ path: resolve(root, 'failed-viewer.png') })
    } catch { /* preserve the first failure even if Viewer is already unavailable */ }
  }
  await writeFile(resolve(root, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.message : String(error), state: viewer.service.state(), ui, pageErrors }, null, 2), { mode: 0o600 })
  process.stderr.write(`Capture evidence: ${root}\n`); throw error
} finally {
  try { await viewer.closeWorkbench(); await viewer.service.stop(); await viewer.close() }
  finally { await browser.close() }
}
