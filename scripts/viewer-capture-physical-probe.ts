/** Explicit local phone inputs; preserves app data and validates manual exports alongside YAML. */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const flowPath = process.env.MOBILE_MIRROR_FLOW_PATH ?? ''
const appium = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (![capsPath, flowPath, appium].every(isAbsolute)) throw new Error('Explicit absolute capabilities, YAML and managed Appium executable required')
const supplied = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
if (!supplied['appium:udid'] || supplied['appium:fullReset'] || supplied['appium:app']) throw new Error('Select a physical phone without installing/resetting the app')
const caps = { ...supplied, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false, 'appium:allowProvisioningDeviceRegistration': false }
const root = resolve('artifacts/physical-validation', `viewer-capture-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: appium, appiumUrl: process.env.MOBILE_MIRROR_APPIUM_URL ?? 'http://127.0.0.1:4723', androidScrcpyPath: process.env.MOBILE_MIRROR_SCRCPY_PATH ?? '', androidScrcpyServerPath: process.env.MOBILE_MIRROR_SCRCPY_SERVER_PATH ?? '', appiumSessionStartupTimeoutMs: 120000 }), { workbenchRoot: resolve(root, 'runs') })
const browser = await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
try {
  await viewer.listen(); await viewer.service.start({ provider: 'appium', capabilities: caps })
  const sessionId = viewer.service.state().sessionId
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }); await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('zh-CN')
  await expect(page.locator('#capture-record')).toBeEnabled({ timeout: 20000 })
  await page.locator('#capture-record').click()
  await page.locator('#workbench-toggle').click()
  await page.locator('#wb-yaml').fill(await readFile(flowPath, 'utf8')); await page.locator('#wb-run').click()
  await expect(page.locator('#wb-detail .wb-run-id')).toBeVisible()
  const runId = (await page.locator('#wb-detail .wb-run-id').textContent())!
  await page.waitForTimeout(4000)
  await page.locator('#theme-button').click()
  const pngEvent = page.waitForEvent('download'); await page.locator('#capture-screenshot').click()
  await (await pngEvent).saveAs(resolve(root, 'phone.png'))
  await expect(page.locator('#capture-record')).toHaveText('结束录屏')
  await page.screenshot({ path: resolve(root, 'recording.png') })
  await page.waitForTimeout(4000)
  const videoEvent = page.waitForEvent('download'); await page.locator('#capture-record').click()
  const download = await videoEvent
  const extension = download.suggestedFilename().endsWith('.mp4') ? 'mp4' : 'webm'
  await download.saveAs(resolve(root, `phone.${extension}`))
  while (viewer.workbench.activeId) await page.waitForTimeout(500)
  const run = await viewer.workbench.get(runId)
  const sameSession = viewer.service.state().sessionId === sessionId && run.sessionId === sessionId
  const media = await page.evaluate(() => (window as unknown as { __mobileMirrorMediaMetrics: { snapshot(): unknown } }).__mobileMirrorMediaMetrics.snapshot())
  await expect(page.locator('#capture-video')).toBeVisible()
  await page.screenshot({ path: resolve(root, 'completed.png') })
  await viewer.service.stop()
  const stopped = viewer.service.state().lifecycle === 'idle' && !viewer.service.state().appiumRuntime.owned
  const report = { root, runId, verdict: run.verdict, steps: run.steps.length, sameSession, stopped, media, screenshot: 'phone.png', recording: `phone.${extension}` }
  await writeFile(resolve(root, 'probe.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  if (run.verdict !== 'pass' || !sameSession || !stopped) throw new Error('Capture/automation acceptance failed; inspect private evidence')
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} catch (error) {
  await writeFile(resolve(root, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2), { mode: 0o600 })
  process.stderr.write(`Capture evidence: ${root}\n`); throw error
} finally {
  try { await viewer.closeWorkbench(); await viewer.service.stop(); await viewer.close() }
  finally { await browser.close() }
}
