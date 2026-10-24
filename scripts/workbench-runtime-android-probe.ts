import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'
import { probeAndroidHealth, probeIosHealth } from '../src/workbench-health-probe.js'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const deviceId = process.env.MOBILE_MIRROR_DEVICE_ID
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE
if (!deviceId || !executable) throw new Error('Provide explicit DEVICE_ID and APPIUM_EXECUTABLE; install the dedicated runtime fixture first')
const appId = 'dev.mobilemirror.runtimefixture'
// Default remains Android for the already-recorded probe commands. iOS must
// explicitly select a device, signed local fixture and preinstalled WDA.
const platform = process.env.MOBILE_MIRROR_PLATFORM ?? 'android'
if (!['android', 'ios'].includes(platform)) throw new Error('Select android or ios explicitly')
const iosApp = process.env.MOBILE_MIRROR_RUNTIME_IOS_APP_PATH ?? ''
const iosWdaBundle = process.env.MOBILE_MIRROR_IOS_WDA_BUNDLE_ID ?? ''
const iosDerivedData = process.env.MOBILE_MIRROR_IOS_WDA_DERIVED_DATA ?? ''
if (platform === 'ios' && (!isAbsolute(iosApp) || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(iosWdaBundle))) throw new Error('iOS requires an absolute signed Fixture App path and explicit installed WDA bundle')
if (iosDerivedData && !isAbsolute(iosDerivedData)) throw new Error('Prebuilt WDA derived data must be absolute')
const mode = process.env.MOBILE_MIRROR_RUNTIME_PROBE_MODE ?? 'standard'
if (!['standard', 'disconnect'].includes(mode) || (mode === 'disconnect' && process.env.MOBILE_MIRROR_MANUAL_DISCONNECT !== '1')) throw new Error('Use standard mode or explicitly authorize a manual disconnect probe')
const root = resolve('artifacts/physical-validation', (platform === 'ios' ? 'runtime-gates-ios-' : 'runtime-gates-') + new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(root, { recursive: true, mode: 0o700 })
const fixtureName = platform === 'ios' ? 'iOS runtime fixture' : 'Android runtime fixture'
const header = 'name: ' + fixtureName + '\nplatform: ' + platform + '\nappId: ' + appId + '\n---\n'
const temporal = (mode: 'eventually' | 'stable', text: string, window: number) => ({ [mode === 'stable' ? 'assertStable' : 'assertEventually']: {
  predicate: { assertVisible: { text } }, [mode === 'stable' ? 'durationMs' : 'withinMs']: window, pollMs: 1000, maxSampleGapMs: 5000,
} })
const tap = (id: string) => ({ tap: { accessibilityId: id } })
const { stringify } = await import('yaml')
const cases = [
  { id: 'delayed-success', expected: 'pass', steps: ['launchApp', tap('runtime.delay'), temporal('eventually', 'Complete', 10000)] },
  { id: 'stable-counterexample', expected: 'fail', steps: [tap('runtime.blink'), temporal('stable', 'Complete', 8000)] },
  { id: 'restart-retains-fixed-value', expected: 'pass', steps: [tap('runtime.save'), temporal('stable', 'Saved 1200', 1000), { restartApp: { timeoutMs: 10000 } }, temporal('stable', 'Saved 1200', 1000)] },
  { id: 'restart-loses-value', expected: 'fail', steps: [tap('runtime.loss'), { restartApp: { timeoutMs: 10000 } }, temporal('stable', 'Saved 1200', 1000)] },
  { id: 'performance-positive', expected: 'pass', steps: [{ measure: { id: 'delayed-state', maxElapsedMs: 20000, steps: [tap('runtime.delay'), temporal('eventually', 'Complete', 10000)] } }] },
  { id: 'performance-negative', expected: 'fail', steps: [{ measure: { id: 'deadline', maxElapsedMs: 1000, steps: [{ wait: 3 }, { assertVisible: { text: 'Complete' } }] } }] },
]
const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, viewerMediaMode: 'polling', defaultProvider: 'appium',
  appiumUrl: 'http://127.0.0.1:4723', appiumRuntimeMode: 'managed', appiumExecutablePath: executable,
  appiumSessionStartupTimeoutMs: 120000, startupTimeoutMs: 30000, agentAppControlPolicy: 'session-app' }), { workbenchRoot: resolve(root, 'runs') })
const browser = await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
const results: Record<string, unknown>[] = []
try {
  await viewer.listen()
  await viewer.service.start({ provider: 'appium', capabilities: { 'appium:udid': deviceId,
    'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false, 'appium:newCommandTimeout': 180,
    ...(platform === 'ios' ? { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:bundleId': appId,
      ...(iosDerivedData ? { 'appium:usePrebuiltWDA': true, 'appium:derivedDataPath': iosDerivedData }
        : { 'appium:usePreinstalledWDA': true }),
      'appium:useNewWDA': false, 'appium:updatedWDABundleId': iosWdaBundle, 'appium:wdaStartupRetries': 1,
      'appium:allowProvisioningDeviceRegistration': false, 'appium:wdaLaunchTimeout': 60000, 'appium:wdaConnectionTimeout': 10000 }
      : { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:appPackage': appId,
        'appium:appActivity': '.MainActivity', 'appium:adbExecTimeout': 30000 }) } })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  const pending = new Map<import('@playwright/test').Request, { path: string; startedMs: number }>()
  page.on('request', request => { if (request.url().startsWith(viewer.url + '/api/')) pending.set(request, { path: new URL(request.url()).pathname, startedMs: performance.now() }) })
  page.on('requestfinished', request => pending.delete(request))
  page.on('requestfailed', request => pending.delete(request))
  await page.goto(viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
  const capability = platform === 'ios' ? { ...probeIosHealth(), facts: {
    physicalSessionEstablished: true, targetSessionBound: true,
    liveDiagnosticSourceChecked: false, release: 'not-performed-no-approved-source' } }
    : await probeAndroidHealth({ deviceId, appId, adbPath: process.env.MOBILE_MIRROR_ADB_PATH ?? 'adb' }, AbortSignal.timeout(25000))
  await writeFile(resolve(root, 'source-probe.json'), JSON.stringify(capability, null, 2), { mode: 0o600 })
  const fixtureSha256 = createHash('sha256').update(await readFile(platform === 'ios' ? resolve(iosApp, 'RuntimeFixture') : resolve('artifacts/fixture/runtime-android/fixture.apk'))).digest('hex')
  await writeFile(resolve(root, 'identity.json'), JSON.stringify({ scope: 'synthetic-' + platform + '-physical', appId, fixtureSha256,
    artifactKind: platform === 'ios' ? 'local-signed-mach-o-not-installed-binary-readback' : 'apk', mode,
    runtime: viewer.service.state().appiumRuntime }, null, 2), { mode: 0o600 })
  const unsupported = header.replace('---', 'runtimeGates: { health: { signals: ' + (platform === 'ios' ? '[crash, hang]' : '[crash, anr]') + ' } }\n---') + stringify([tap('runtime.loss'), { assertVisible: { text: 'Data lost' } }])
  await expect(viewer.workbench.start(unsupported)).rejects.toThrow('health-source-unsupported')
  if (viewer.workbench.activeId || viewer.service.runOwner !== null) throw new Error('Unsupported health retained device ownership')
  results.push({ id: 'health-unsupported-before-actions', expected: 'rejected', actual: 'rejected', ownerReleased: true })
  if (mode === 'standard') {
  for (const test of cases) {
    const yaml = header.replace(fixtureName, test.id) + stringify(test.steps)
    await page.locator('#wb-yaml').fill(yaml); await page.locator('#wb-run').click()
    await expect.poll(() => viewer.workbench.activeId, { timeout: 15000 }).not.toBeNull()
    const id = viewer.workbench.activeId!
    if (test.id === 'delayed-success') {
      await expect(page.locator('.wb-stage')).toHaveText('正在等待条件成立', { timeout: 20000 })
      await expect(page.locator('#wb-run')).toBeDisabled()
      await page.locator('#theme-button').click(); await page.locator('#wb-refresh').click()
      if (!viewer.workbench.activeId) throw new Error('Unrelated UI interaction was not observed during execution')
      await page.locator('#workbench-panel').evaluate(panel => { panel.scrollTop += panel.querySelector('#wb-detail')!.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20 })
      await page.screenshot({ path: resolve(root, 'running.png') })
    }
    await viewer.workbench.wait()
    const run = await viewer.workbench.get(id)
    results.push({ id: test.id, runId: id, expected: test.expected, actual: run.verdict, cleanup: run.cleanup, error: run.error,
      temporal: run.steps.flatMap(step => step.temporal ? [{ status: step.temporal.result.status, reason: step.temporal.result.reason, samples: step.temporal.result.samples.length, matched: step.temporal.result.samples.map(sample => sample.matched) }] : []),
      measurements: run.measurements ?? [] })
    console.log(JSON.stringify(results.at(-1)))
    try { await page.locator('#wb-refresh').click() }
    catch (error) {
      console.log(JSON.stringify({ id: test.id, pendingHttp: [...pending.values()].map(request => ({ path: request.path, elapsedMs: performance.now() - request.startedMs })) }))
      await page.screenshot({ path: resolve(root, 'ui-failure.png'), fullPage: true })
      throw error
    }
    await expect(page.locator('#wb-run')).toBeEnabled({ timeout: 15000 })
    if (test.id === 'performance-positive') {
      await expect(page.locator('.wb-measurement')).toContainText('automation-observed-e2e')
      await page.locator('#workbench-panel').evaluate(panel => { panel.scrollTop += panel.querySelector('#wb-detail')!.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20 })
      await page.screenshot({ path: resolve(root, 'performance.png'), fullPage: true })
    }
    if (run.verdict !== test.expected) throw new Error('Fixture verdict mismatch: ' + test.id + '; retained private evidence at ' + root)
    const samples = run.steps.flatMap(step => step.temporal?.result.samples ?? [])
    if (test.id === 'delayed-success' && (!samples.some(sample => !sample.matched) || !samples.at(-1)?.matched)) throw new Error('Delayed transition was not actually sampled')
    if (test.id === 'stable-counterexample' && (!samples[0]?.matched || !samples.some(sample => !sample.matched))) throw new Error('Stable counterexample was not observed after an initial match')
  }
  await page.locator('#wb-yaml').fill(header + stringify([temporal('stable', 'Complete', 20000), tap('runtime.loss')]))
  await page.locator('#wb-run').click()
  await expect.poll(() => viewer.workbench.activeId, { timeout: 15000 }).not.toBeNull()
  const cancelledId = viewer.workbench.activeId!
  await expect.poll(async () => (await viewer.workbench.get(cancelledId)).steps.some(step => step.message?.includes('samples')), { timeout: 20000 }).toBe(true)
  await page.locator('#wb-cancel').click(); await viewer.workbench.wait()
  const result = await viewer.workbench.get(cancelledId)
  results.push({ id: 'cancel', runId: cancelledId, actual: result.verdict, ownerReleased: viewer.service.runOwner === null, nextActionDispatched: result.dispatches?.some(dispatch => dispatch.operation === 'tap') ?? false })
  if (result.verdict !== 'cancelled' || viewer.service.runOwner !== null || result.dispatches?.some(dispatch => dispatch.operation === 'tap')
    || !result.steps.some(step => (step.temporal?.result.samples.length ?? 0) > 0)) throw new Error('Cancellation did not retain samples/drain or allowed the following tap')
  await expect(page.locator('#wb-run')).toBeEnabled({ timeout: 15000 })
  // Pause only this probe host, never Appium/ADB or another service. Its own
  // helper resumes the exact parent PID and must exit before final cleanup.
  const paused = await viewer.workbench.start(header + stringify([{ measure: { id: 'host-pause', maxElapsedMs: 60000, steps: [tap('runtime.save'), temporal('stable', 'Saved 1200', 20000)] } }]))
  await expect.poll(async () => (await viewer.workbench.get(paused.id)).steps.some(step => step.message?.includes('samples')), { timeout: 20000 }).toBe(true)
  const resume = spawn(process.execPath, ['-e', `setTimeout(()=>{process.kill(${process.pid},'SIGCONT')},8000)`], { stdio: 'ignore' })
  const resumed = once(resume, 'exit')
  try { process.kill(process.pid, 'SIGSTOP'); await resumed }
  finally { if (resume.exitCode === null && resume.signalCode === null) { resume.kill('SIGTERM'); await resumed } }
  await viewer.workbench.wait()
  const stalled = await viewer.workbench.get(paused.id)
  results.push({ id: 'owned-host-pause', runId: paused.id, actual: stalled.verdict, temporal: stalled.steps.flatMap(step => step.temporal ? [step.temporal.result.reason] : []), measurements: stalled.measurements ?? [] })
  if (stalled.verdict !== 'inconclusive' || stalled.measurements?.some(report => report.status === 'pass')) throw new Error('Host pause hid a sampling gap')
  }
  // USB interruption requires an explicit human fault injection, not a global
  // adb kill-server, network reconfiguration or terminating external services.
  if (process.env.MOBILE_MIRROR_MANUAL_DISCONNECT === '1') {
    const disconnected = await viewer.workbench.start(header + stringify(['launchApp', tap('runtime.save'), { measure: { id: 'disconnect', maxElapsedMs: 60000, steps: [temporal('stable', 'Saved 1200', 30000)] } }]))
    await expect.poll(async () => (await viewer.workbench.get(disconnected.id)).steps.some(step => step.message?.includes('samples')), { timeout: 20000 }).toBe(true)
    console.log('Disconnect only the selected synthetic-test phone now; reconnect after the result is retained.')
    await viewer.workbench.wait()
    const lost = await viewer.workbench.get(disconnected.id)
    results.push({ id: 'manual-usb-disconnect', runId: disconnected.id, actual: lost.verdict, temporal: lost.steps.flatMap(step => step.temporal ? [step.temporal.result.reason] : []), measurements: lost.measurements ?? [] })
    if (lost.verdict !== 'inconclusive') throw new Error('Expected an observed interruption; check manual USB fault injection')
  } else results.push({ id: 'manual-usb-disconnect', actual: 'not-performed', reason: 'explicit-human-fault-injection-required' })
} catch (error) {
  await writeFile(resolve(root, 'failure.json'), JSON.stringify({ scope: 'synthetic-' + platform + '-physical',
    error: error instanceof Error ? error.message : String(error),
    lifecycle: viewer.service.state().lifecycle, activeRun: viewer.workbench.activeId,
    runOwnerRetained: viewer.service.runOwner !== null }, null, 2), { mode: 0o600 })
  throw error
} finally {
  await writeFile(resolve(root, 'probe.json'), JSON.stringify({ scope: 'synthetic-' + platform + '-physical', root, results }, null, 2), { mode: 0o600 })
  try { await viewer.closeWorkbench(); await viewer.service.stop() } finally { await viewer.close(); await browser.close() }
  await writeFile(resolve(root, 'cleanup.json'), JSON.stringify({ runOwnerReleased: viewer.service.runOwner === null, lifecycle: viewer.service.state().lifecycle, runtimeOwned: viewer.service.state().appiumRuntime?.owned ?? false }), { mode: 0o600 })
  console.log('Private evidence: ' + root)
}
