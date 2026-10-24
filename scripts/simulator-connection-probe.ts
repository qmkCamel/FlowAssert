/** Explicit simulator-only acceptance. Boot the selected simulator before running. */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'

const platform = process.env.MOBILE_MIRROR_SIMULATOR_PLATFORM
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if ((platform !== 'android' && platform !== 'ios') || !isAbsolute(executable)) throw new Error('Explicit simulator platform (android/ios) and absolute Appium executable required')
const root = resolve('artifacts/simulator-validation', `${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const viewer = new ViewerServer(resolveMirrorConfig({
  viewerPort: 0, defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: executable,
  appiumUrl: process.env.MOBILE_MIRROR_APPIUM_URL ?? 'http://127.0.0.1:4799',
  appiumSessionStartupTimeoutMs: 180000, startupTimeoutMs: 30000, viewerMediaMode: 'polling',
  agentScreenContentPolicy: 'image-and-structure',
}), { workbenchRoot: resolve(root, 'runs') })
const browser = await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
try {
  await viewer.listen()
  await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('zh-CN')
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId(`platform-${platform}`).click()
  await page.getByTestId('assistant-device-kind').selectOption('simulator')
  for (const target of ['current-screen', 'settings']) {
    await page.getByTestId('assistant-check-button').click()
    await expect(page.getByTestId('assistant-report')).toBeVisible({ timeout: 65000 })
    await expect(page.locator('#assistant-progress')).toBeHidden({ timeout: 65000 })
    await expect(page.getByTestId('assistant-connect-button')).toBeEnabled({ timeout: 65000 })
    // Never choose implicitly when several simulators are running.
    await expect(page.getByTestId('assistant-device').locator('option')).toHaveCount(1)
    await page.getByTestId('assistant-target').selectOption(target)
    if (platform === 'android') await page.locator('#android-helper-confirmation').check()
    await page.screenshot({ path: resolve(root, `${target}-ready.png`), fullPage: true })
    await page.getByTestId('assistant-connect-button').click()
    await expect(page.locator('#assistant-progress')).toBeVisible()
    await page.screenshot({ path: resolve(root, `${target}-connecting.png`), fullPage: true })
    await expect.poll(() => viewer.service.state().lifecycle, { timeout: 210000 }).toBe('streaming')
    const frame = await viewer.service.frame()
    await writeFile(resolve(root, `${target}-device.png`), frame.bytes, { mode: 0o600 })
    const observation = await viewer.service.observe({ image: false, structure: true })
    if (!observation.structure) throw new Error('Missing simulator structure')
    await writeFile(resolve(root, `${target}-structure.json`), JSON.stringify(observation.structure, null, 2), { mode: 0o600 })
    await page.screenshot({ path: resolve(root, `${target}-viewer.png`), fullPage: true })
    await viewer.service.stop()
    if (viewer.service.state().appiumRuntime.owned) throw new Error('Managed runtime was not released')
    process.stdout.write(`${platform} ${target}: screenshot, structure and owned cleanup passed\n`)
  }
  await writeFile(resolve(root, 'probe.json'), JSON.stringify({ platform, target: 'simulator', currentScreen: 'pass', settings: 'pass', stopped: true }, null, 2))
  process.stdout.write(`Simulator evidence: ${root}\n`)
} catch (error) {
  await page.screenshot({ path: resolve(root, 'failure.png'), fullPage: true }).catch(() => undefined)
  await writeFile(resolve(root, 'failure.json'), JSON.stringify({ state: viewer.service.state(), error: String(error) }, null, 2), { mode: 0o600 })
  process.stderr.write(`Simulator evidence: ${root}\n`)
  throw error
} finally {
  try { await viewer.close() } finally { await browser.close() }
}
