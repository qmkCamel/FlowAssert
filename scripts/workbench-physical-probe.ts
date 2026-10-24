/**
 * Run only against an explicitly selected connected phone and Appium.
 * Required: MOBILE_MIRROR_FLOW_PATH (absolute YAML), MOBILE_MIRROR_CAPABILITIES_PATH
 * (absolute JSON with platformName and appium:udid), MOBILE_MIRROR_APPIUM_URL.
 * Optional: MOBILE_MIRROR_SCRCPY_PATH / MOBILE_MIRROR_SCRCPY_SERVER_PATH for Android.
 * MOBILE_MIRROR_APPIUM_EXECUTABLE explicitly opts into owned managed Appium/descendant cleanup.
 * Capabilities may point at an existing signed prebuilt WDA. No guessed device,
 * no new Appium process, no provisioning or application data reset.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'
import { parseWorkbenchFlow } from '../src/workbench-flow.js'

const flowPath = process.env.MOBILE_MIRROR_FLOW_PATH ?? ''
const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const appiumUrl = process.env.MOBILE_MIRROR_APPIUM_URL ?? ''
const appiumExecutable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (appiumExecutable && !isAbsolute(appiumExecutable)) throw new Error('APPIUM_EXECUTABLE must be absolute')
const expectedVerdict = process.env.MOBILE_MIRROR_EXPECTED_VERDICT ?? 'pass'
if (!['pass', 'fail'].includes(expectedVerdict)) throw new Error('EXPECTED_VERDICT must be pass or fail')
if (!isAbsolute(flowPath) || !isAbsolute(capsPath) || !appiumUrl) throw new Error('Provide explicit absolute FLOW_PATH, CAPABILITIES_PATH and APPIUM_URL')
const yaml = await readFile(flowPath, 'utf8')
const flow = await parseWorkbenchFlow(yaml)
const supplied = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
if (typeof supplied['appium:udid'] !== 'string' || supplied['appium:udid'].includes('simulator')) throw new Error('Explicit physical device UDID required')
if (String(supplied.platformName).toLowerCase() !== flow.parsed.meta.platform) throw new Error('Flow and device platforms differ')
if (supplied['appium:fullReset'] || supplied['appium:app']) throw new Error('The probe does not install or reset apps')
const caps = { ...supplied, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false, 'appium:allowProvisioningDeviceRegistration': false }
const root = resolve('artifacts/physical-validation', `workbench-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const config = resolveMirrorConfig({
  defaultProvider: 'appium', appiumUrl, viewerPort: 0, viewerMediaMode: 'auto',
  androidScrcpyPath: process.env.MOBILE_MIRROR_SCRCPY_PATH ?? '',
  androidScrcpyServerPath: process.env.MOBILE_MIRROR_SCRCPY_SERVER_PATH ?? '',
  startupTimeoutMs: 30_000, appiumSessionStartupTimeoutMs: 120_000,
  ...(appiumExecutable ? { appiumRuntimeMode: 'managed', appiumExecutablePath: appiumExecutable } : {}),
})
let viewer = new ViewerServer(config, { workbenchRoot: resolve(root, 'runs') })
const bundled = chromium.executablePath()
const browser = await chromium.launch({ headless: true, ...(!existsSync(bundled) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
let interrupted = false
const interrupt = () => {
  if (interrupted) return
  interrupted = true
  // Keep the host alive while its owned cleanup drains; the main probe then
  // fails and retains its partial report instead of starting another flow.
  void (async () => {
    await viewer.closeWorkbench()
    await viewer.service.stop()
    await viewer.close()
    await browser.close()
  })().catch(() => { process.exitCode = 1 })
}
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
try {
  await viewer.listen()
  if (interrupted) throw new Error('Physical probe interrupted')
  await viewer.service.start({ provider: 'appium', capabilities: caps })
  const sessionId = viewer.service.state().sessionId
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator(flow.parsed.meta.platform === 'ios' ? '#device-mjpeg' : '#device-video').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForFunction(() => (window as Window & { __mobileMirrorMediaMetrics?: { snapshot(): { mediaVisible: boolean } } }).__mobileMirrorMediaMetrics?.snapshot().mediaVisible, undefined, { timeout: 15000 })
  const before = viewer.mediaDiagnostics()
  await page.locator('#workbench-toggle').click()
  await page.locator('#wb-yaml').fill(yaml)
  if (interrupted) throw new Error('Physical probe interrupted')
  await page.locator('#wb-run').click()
  await page.waitForFunction(() => document.querySelector('#wb-detail .wb-run-id')?.textContent, undefined, { timeout: 15000 })
  const runId = (await page.locator('.wb-run-id').textContent())!
  let duringScreenshot = false
  while (viewer.workbench.activeId) {
    if (!duringScreenshot && (await viewer.workbench.get(runId)).steps.length > 0) {
      // Exercise an independent local control while device commands are active.
      await page.locator('#theme-button').click()
      await expect(page.locator('body')).toHaveClass(/light-stage/)
      await page.locator('#wb-refresh').click()
      await page.screenshot({ path: resolve(root, 'running.png') }); duringScreenshot = true
    }
    await page.waitForTimeout(500)
  }
  const run = await viewer.workbench.get(runId)
  const after = viewer.mediaDiagnostics()
  const browserMetrics = await page.evaluate(() => (window as Window & { __mobileMirrorMediaMetrics?: { snapshot(): Record<string, unknown> } }).__mobileMirrorMediaMetrics?.snapshot() ?? null)
  const sameSession = viewer.service.state().sessionId === sessionId && run.sessionId === sessionId
  await page.locator('#wb-refresh').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText(run.verdict === 'pass' ? '通过' : run.verdict === 'fail' ? '失败' : /.+/)
  await expect(page.locator('#wb-run')).toBeEnabled()
  await page.locator('#workbench-panel').evaluate((el) => { el.scrollTop += el.querySelector('#wb-detail')!.getBoundingClientRect().top - el.getBoundingClientRect().top - 20; window.scrollTo(0, 0) })
  await page.screenshot({ path: resolve(root, 'result.png'), fullPage: true })
  const result = { runId, verdict: run.verdict, expectedVerdict, sameSession, framesDuringRun: after.frameCount - before.frameCount, before, after, browserMetrics, independentControlResponsive: duringScreenshot, steps: run.steps.length, durationMs: Date.parse(run.endedAt!) - Date.parse(run.startedAt), timings: run.timings, executionMs: run.steps.map((step) => ({ step: step.index, kind: step.kind, durationMs: step.executionMs })), cleanup: run.cleanup, runtimeMode: appiumExecutable ? 'managed' : 'external', runtimeStopped: null as boolean | null, historyRestored: false, verifiedArtifacts: 0, deviceStopped: false, root }
  await writeFile(resolve(root, 'probe.json'), JSON.stringify(result, null, 2), { mode: 0o600 })
  // Restart the server and read every immutable artifact through the public API.
  await viewer.service.stop()
  result.deviceStopped = viewer.service.state().lifecycle === 'idle'
  result.runtimeStopped = appiumExecutable ? viewer.service.state().appiumRuntime.phase === 'idle' && !viewer.service.state().appiumRuntime.owned : null
  await viewer.close()
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0 }), { workbenchRoot: resolve(root, 'runs') })
  await viewer.listen()
  await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#workbench-toggle').click()
  await expect(page.locator('.wb-run-id')).toHaveText(runId)
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText(run.verdict === 'pass' ? '通过' : run.verdict === 'fail' ? '失败' : /.+/)
  const restored = await viewer.workbench.get(runId)
  result.historyRestored = JSON.stringify(restored) === JSON.stringify(run)
  for (const file of [...run.evidence, ...run.steps.flatMap((step) => step.evidence)]) {
    const response = await fetch(`${viewer.url}/api/runs/${runId}/artifacts/${file.name}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!response.ok || bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Artifact verification failed: ${file.name}`)
    result.verifiedArtifacts++
  }
  const step = page.locator('.wb-step').filter({ has: page.locator('img') }).last()
  if (await step.count()) {
    await step.evaluate((el) => (el as HTMLDetailsElement).open = true)
    await step.locator('img').scrollIntoViewIfNeeded()
    await expect.poll(() => step.locator('img').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  }
  await page.screenshot({ path: resolve(root, 'history-restored.png') })
  await writeFile(resolve(root, 'probe.json'), JSON.stringify(result, null, 2), { mode: 0o600 })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!sameSession || result.framesDuringRun < 2 || !result.historyRestored || !result.deviceStopped || run.verdict !== expectedVerdict) throw new Error('Physical shared-session workbench acceptance failed; inspect saved evidence')
} catch (error) {
  await writeFile(resolve(root, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.message : String(error), state: viewer.service.state(), media: viewer.mediaDiagnostics() }, null, 2), { mode: 0o600 })
  process.stderr.write(`Physical probe evidence: ${root}\n`)
  throw error
} finally {
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
  try { await viewer.closeWorkbench(); await viewer.service.stop() }
  finally { try { await viewer.close() } finally { await browser.close() } }
}
