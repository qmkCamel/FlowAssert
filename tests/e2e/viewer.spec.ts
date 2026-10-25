import { readFile } from 'node:fs/promises'
import { playCapture } from './helpers/capture.js'
import { expect, test, type Page } from '@playwright/test'
import type { Config } from '../../src/config.js'
import { ConnectionAssistantError, type ConnectionAssistantApi, type ConnectionAssistantPlatform, type ConnectionAssistantReport } from '../../src/connection-assistant.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import type { MirrorState, ViewerMediaPacket, ViewerMediaSubscription, ViewerMediaTransport } from '../../src/types.js'
import { ViewerServer } from '../../src/viewer-server.js'
import { WdaStartError } from '../../src/wda-errors.js'

let viewer: ViewerServer | undefined

const config: Config = {
  defaultProvider: 'mock',
  agentScreenContentPolicy: 'mock-only',
  agentTextInputPolicy: 'mock-only',
  agentAppControlPolicy: 'disabled',
  agentAllowedAppIds: [],
  appiumUrl: 'http://127.0.0.1:4723',
  appiumRuntimeMode: 'external',
  appiumExecutablePath: '',
  viewerHost: '127.0.0.1',
  viewerPort: 0,
  frameIntervalMs: 250,
  viewerMediaMode: 'auto',
  androidScrcpyPath: '',
  androidScrcpyServerPath: '',
  androidScrcpyMaxSize: 1280,
  androidScrcpyMaxFps: 30,
  androidScrcpyVideoBitRate: 4_000_000,
  iosMjpegPort: 0,
  iosMjpegFramerate: 15,
  iosMjpegScalingFactor: 50,
  iosMjpegScreenshotQuality: 40,
  startupTimeoutMs: 2_000,
  appiumSessionStartupTimeoutMs: 2_000,
  mockStartupDelayMs: 800,
  allowHostDeviceDiscovery: false,
  adbPath: 'adb',
  xcrunPath: 'xcrun',
  androidIgnoreHiddenApiPolicyError: true,
  iosWdaXcodeOrgId: '',
  iosWdaXcodeSigningId: 'Apple Development',
  iosWdaUpdatedBundleId: '',
  iosWdaXcodeConfigFile: '',
  iosWdaAllowProvisioningDeviceRegistration: true,
  allowHostSigningDiagnostics: false,
}

test.beforeEach(async ({ page }) => {
  viewer = new ViewerServer(config, { workbenchRoot: test.info().outputPath('workbench') })
  await viewer.listen()
  await page.goto(viewer.url)
})

test.afterEach(async () => {
  await viewer?.close()
  viewer = undefined
})

test('simulator selection hides signing, invalidates previous checks and remains interactive', async ({ page }) => {
  const harness = createGuidedHarness({ androidDelayMs: 700, connectDelayMs: 500 })
  await replaceViewer(page, harness.service, harness.assistant)
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('platform-ios').click()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.locator('#ios-assistant-fields')).toBeVisible()
  await page.locator('#ios-team-id').fill('ABCDE12345')
  await page.getByTestId('assistant-device-kind').selectOption('simulator')
  await expect(page.getByTestId('assistant-connect-button')).toBeDisabled()
  await expect(page.locator('#ios-assistant-fields')).toBeHidden()
  await expect(page.locator('#ios-team-id')).toHaveValue('')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-device')).toContainText('iPhone Simulator')
  await page.screenshot({ path: 'artifacts/screenshots/simulator-ios-ready.png', fullPage: true })
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByTestId('assistant-device-kind')).toBeDisabled()
  await expect.poll(() => harness.connectPayload()).toMatchObject({ targetPreset: 'ios-current-screen' })
  expect(harness.connectPayload()).not.toHaveProperty('signing')
  await expect(page.getByTestId('assistant-device-kind')).toBeEnabled()
  await page.getByTestId('platform-android').click()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.locator('#assistant-progress')).toBeVisible()
  await page.locator('#language-select').selectOption('zh-CN')
  await expect(page.locator('#assistant-simulator-hint')).toContainText('模拟器')
  await page.getByTestId('assistant-device-kind').selectOption('physical')
  await expect(page.locator('#assistant-progress')).toBeHidden()
  await expect(page.locator('#assistant-simulator-hint')).toBeHidden()
  await page.waitForTimeout(800)
  await expect(page.getByTestId('assistant-report')).toBeHidden()
  await page.getByTestId('assistant-device-kind').selectOption('simulator')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-device')).toContainText('Android Simulator')
  await expect(page.locator('#android-assistant-fields .manual-boundary')).toBeHidden()
  await page.screenshot({ path: 'artifacts/screenshots/simulator-android-ready.png', fullPage: true })
})

test('shows progress, remains interactive, completes, acts, and stops', async ({ page }) => {
  await expect(page.getByText('See the device.')).toBeVisible()
  await page.getByTestId('provider-select').selectOption('appium')
  await expect(page.getByTestId('assistant-panel')).toBeVisible()
  await expect(page.getByTestId('advanced-appium')).not.toHaveAttribute('open', '')
  await page.getByTestId('advanced-appium').locator('summary').click()
  await expect(page.getByTestId('android-policy-warning')).toBeVisible()
  await expect(page.getByTestId('provisioning-warning')).toBeHidden()
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-android-compatibility-warning.png')
  await page.locator('#capabilities').fill(JSON.stringify({
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:ignoreHiddenApiPolicyError': false,
  }, null, 2))
  await expect(page.getByTestId('android-policy-warning')).toBeHidden()
  await page.locator('#capabilities').fill(JSON.stringify({
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': 'iPhone',
  }, null, 2))
  await expect(page.getByTestId('android-policy-warning')).toBeHidden()
  await expect(page.getByTestId('provisioning-warning')).toBeVisible()
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-ios-provisioning-warning.png')
  await page.locator('#session-id').fill('existing-session')
  await expect(page.getByTestId('android-policy-warning')).toBeHidden()
  await expect(page.getByTestId('provisioning-warning')).toBeHidden()
  await page.locator('#session-id').fill('')
  await page.getByTestId('provider-select').selectOption('mock')
  await expect(page.getByTestId('provisioning-warning')).toBeHidden()
  await page.getByTestId('start-button').click()
  await expect(page.getByText('Connecting…')).toBeVisible()

  await page.getByTestId('theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.getByText('Ready when you are')).toBeHidden()

  await page.getByRole('button', { name: 'Test tap' }).click()
  await expect(page.locator('#operation')).toBeHidden()
  await expect(page.locator('#meta-frame')).not.toHaveText('—')
  await viewer!.service.observe({ image: true, structure: true })
  await expect(page.getByTestId('agent-observation')).toContainText('Agent observation ready')
  await expect(page.locator('#meta-agent-policy')).toHaveText('mock-only')
  await expect(page.getByTestId('stop-button')).toBeEnabled()
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-streaming.png', true)
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-mcp-runtime-final.png', true)

  await page.getByTestId('stop-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Idle')
  await expect(page.locator('#device-frame')).toBeVisible()
})

test('keeps the retained frame and controls interactive while managed Appium is starting', async ({ page }) => {
  const fake = createManagedStartingService()
  await replaceViewer(page, fake.service)
  await expect(page.locator('#device-frame')).toBeVisible()
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('advanced-appium').locator('summary').click()
  await page.getByTestId('advanced-start-button').click()
  await expect(page.getByText('Starting managed Appium…')).toBeVisible()
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.getByTestId('stop-button')).toBeEnabled()
  await page.getByTestId('theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-managed-appium-starting.png', true)

  await page.getByTestId('stop-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Idle')
  await expect(page.locator('#device-frame')).toBeVisible()
  expect(fake.cancelled()).toBe(true)
})

test('guides Android with slow checks, platform isolation, last-good retention, confirmation and token redaction', async ({ page }) => {
  const harness = createGuidedHarness({ androidDelayMs: 550, failSecondAndroidCheck: true, failAndroidCheckNumber: 3 })
  await replaceViewer(page, harness.service, harness.assistant)
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByText('Checking Android…')).toBeVisible()

  await page.getByTestId('theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await page.getByTestId('platform-ios').click()
  await expect(page.getByTestId('assistant-report')).toBeHidden()
  await page.getByTestId('advanced-appium').locator('summary').click()
  await expect(page.getByTestId('advanced-appium')).toHaveAttribute('open', '')
  await page.getByTestId('platform-android').click()

  // A selection change cancels the old check; it must not revive an old ready report.
  await page.waitForTimeout(650)
  await expect(page.getByTestId('assistant-report')).toBeHidden()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toBeVisible()
  await page.getByTestId('advanced-appium').locator('summary').click()
  await expect(page.getByTestId('advanced-appium')).not.toHaveAttribute('open', '')
  await expect(page.getByTestId('assistant-report')).toContainText('UiAutomator2 may install/update its helper APKs')
  await expect(page.getByTestId('assistant-report')).toContainText('PNG polling')
  expect(await page.locator('body').innerText()).not.toContain(harness.privateCanary)
  expect(await page.locator('body').innerText()).not.toContain(harness.assistantToken)
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-guided-android-action-required.png')

  await expect(page.getByTestId('assistant-target')).toHaveValue('current-screen')
  await page.getByTestId('assistant-target').selectOption('settings')
  await page.getByTestId('language-select').selectOption('zh-CN')
  await expect(page.getByTestId('assistant-connect-button')).toHaveText('连接设备')
  await expect(page.getByTestId('assistant-target')).toHaveValue('settings')
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-connect-device-zh-cn.png')
  await page.getByTestId('language-select').selectOption('en')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-target')).toBeDisabled()
  await expect(page.getByTestId('assistant-connect-button')).toBeDisabled()
  await expect(page.locator('#error-message')).toContainText('connection assistant request is invalid')
  await expect(page.getByTestId('assistant-report')).toContainText('Android 1')
  await expect(page.getByTestId('assistant-target')).toHaveValue('settings')
  await page.locator('#android-helper-confirmation').check()
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByText('Connecting Android and opening Settings…')).toBeVisible()
  await expect(page.getByTestId('assistant-target')).toBeDisabled()
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(harness.connectPayload()).toMatchObject({ targetPreset: 'android-settings', confirmHelperApkSideEffect: true })
  expect(await page.locator('body').innerText()).not.toContain(harness.assistantToken)
})

test('guides iPhone signing without exposing private identifiers and keeps advanced controls collapsed', async ({ page }) => {
  const harness = createGuidedHarness()
  await replaceViewer(page, harness.service, harness.assistant)
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('platform-ios').click()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toBeVisible()
  await expect(page.getByTestId('assistant-report')).toContainText('Action required')
  await expect(page.locator('#ios-team-id')).toHaveAttribute('required', '')
  await expect(page.locator('#ios-wda-bundle-id')).toHaveAttribute('required', '')
  await expect(page.getByTestId('advanced-appium')).not.toHaveAttribute('open', '')
  await expect(page.getByTestId('policy-summary')).toContainText('Apple device registration')
  expect(await page.locator('body').innerText()).not.toContain(harness.privateCanary)
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-guided-ios-signing-required.png')

  await page.locator('#ios-team-id').fill('ABCDE12345')
  await page.locator('#ios-wda-bundle-id').fill('com.example.WebDriverAgentRunner')
  await expect(page.getByTestId('assistant-target')).toHaveValue('current-screen')
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByText('Connecting iPhone…')).toBeVisible()
  await page.getByTestId('theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(harness.connectPayload()).toMatchObject({
    targetPreset: 'ios-current-screen',
    signing: { teamId: 'ABCDE12345', wdaBundleId: 'com.example.WebDriverAgentRunner' },
  })
  await expect(page.locator('#ios-team-id')).toHaveValue('')
  await expect(page.locator('#ios-wda-bundle-id')).toHaveValue('')
})

test('separates iPhone signing readiness from WDA startup and supports safe retry after account failure', async ({ page }) => {
  const harness = createGuidedHarness({ iosSigningReady: true, connectDelayMs: 650, iosFailureOnConnect: 2 })
  await replaceViewer(page, harness.service, harness.assistant)
  await page.waitForFunction(() => Object.hasOwn(window, '__mobileMirrorZoomMetrics'))
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('platform-ios').click()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toContainText('Local WDA signing prerequisites were found')
  await expect(page.getByTestId('assistant-report')).toContainText('This read-only check has not started WDA')
  await expect(page.getByTestId('assistant-report')).toContainText('Xcode Settings > Accounts')
  expect(harness.connectPayload()).toBeNull()
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  await expect(page.locator('#device-frame')).toBeVisible()
  await page.getByTestId('stop-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Idle')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toContainText('This read-only check has not started WDA')
  await expect(page.locator('#device-frame')).toBeVisible()
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByText('Connecting iPhone…')).toBeVisible()
  await expect(page.locator('#device-frame')).toBeVisible()
  await page.getByTestId('theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await expect(page.locator('#error-message')).toContainText('Xcode Settings > Accounts')
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.locator('#meta-frame')).not.toHaveText('—')
  await expect(page.getByTestId('assistant-report')).toBeVisible()
  expect(await page.locator('body').innerText()).not.toMatch(/PRIVATE_ACCOUNT|TEAM-SECRET|\/Users\/private/)
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-ios-wda-account-recovery.png', true)
  await page.getByTestId('language-select').selectOption('zh-CN')
  await expect(page.locator('#error-message')).toContainText('Xcode')
  await expect(page.getByTestId('assistant-report')).toContainText('只读检查尚未启动 WDA')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toContainText('只读检查尚未启动 WDA')
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('镜像中')
})

test('quick-connects the only saved Android setup and makes persistence explicit for manual connections', async ({ page }) => {
  const checkGate = Promise.withResolvers<void>()
  const connectGate = Promise.withResolvers<void>()
  const harness = createGuidedHarness({ androidCheckGate: checkGate.promise, connectGate: connectGate.promise })
  await replaceViewer(page, harness.service, harness.assistant, () => ({ persistenceAvailable: true, preferredPlatform: 'android' }))

  await expect(page.getByTestId('provider-select')).toHaveValue('appium')
  await expect(page.getByTestId('assistant-saved-setup')).toBeVisible()
  await expect(page.getByTestId('assistant-saved-setup')).toContainText('UiAutomator2 may install/update helper APKs')
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-saved-setup-en.png')
  await page.getByTestId('language-select').selectOption('zh-CN')
  await expect(page.getByTestId('assistant-saved-setup')).toContainText('点击即确认 UiAutomator2 可能安装或更新辅助 APK')
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-saved-setup-zh-cn.png')
  await page.getByTestId('language-select').selectOption('en')
  // Keep each phase pending until its UI contract is observed, including on
  // slower CI runners that can miss a fixed 350 ms connection window.
  try {
    await page.getByTestId('assistant-quick-connect-button').click()
    await expect(page.getByText('Checking Android…')).toBeVisible()
    await expect(page.getByTestId('assistant-quick-connect-button')).toBeDisabled()
    checkGate.resolve()
    await expect(page.getByText('Connecting Android…')).toBeVisible()
    await expect(page.getByTestId('assistant-quick-connect-button')).toBeDisabled()
    await page.getByTestId('theme-button').click()
    await expect(page.locator('body')).toHaveClass(/light-stage/)
    await expect(page.getByText('Connecting Android…')).toBeVisible()
    await page.getByTestId('assistant-panel').screenshot({ path: test.info().outputPath('quick-connect-running.png') })
  } finally {
    checkGate.resolve()
    connectGate.resolve()
  }
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(harness.connectPayload()).toMatchObject({
    targetPreset: 'android-current-screen',
    runtime: 'configured',
    confirmHelperApkSideEffect: true,
  })
  expect(harness.connectPayload()).not.toHaveProperty('rememberOnThisMac')

  await page.getByTestId('stop-button').click()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.locator('#remember-setup-row')).toBeVisible()
  await page.locator('#android-helper-confirmation').check()
  await page.locator('#remember-setup').check()
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(harness.connectPayload()).toMatchObject({ rememberOnThisMac: true })
})

test('offers current-screen when Android Settings is unavailable and resets the mode on platform changes', async ({ page }) => {
  const harness = createGuidedHarness({ settingsAvailable: false })
  await replaceViewer(page, harness.service, harness.assistant)
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-target').locator('[value="settings"]')).toBeDisabled()
  await expect(page.getByTestId('assistant-target')).toHaveValue('current-screen')
  await expect(page.getByTestId('assistant-connect-button')).toBeEnabled()
  await page.locator('#android-helper-confirmation').check()
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(harness.connectPayload()).toMatchObject({ targetPreset: 'android-current-screen' })

  await page.getByTestId('stop-button').click()
  const ready = createGuidedHarness({ connectDelayMs: 1200 })
  await replaceViewer(page, ready.service, ready.assistant)
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('platform-ios').click()
  await page.getByTestId('assistant-check-button').click()
  await page.getByTestId('assistant-target').selectOption('settings')
  await page.getByTestId('platform-android').click()
  await page.getByTestId('platform-ios').click()
  await expect(page.getByTestId('assistant-target')).toHaveValue('current-screen')
  await expect(page.getByTestId('assistant-connect-button')).toBeDisabled()
  await page.getByTestId('assistant-check-button').click()
  await page.getByTestId('assistant-target').selectOption('settings')
  await page.locator('#ios-team-id').fill('ABCDE12345')
  await page.locator('#ios-wda-bundle-id').fill('com.example.WebDriverAgentRunner')
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByText('Connecting iPhone and opening Settings…')).toBeVisible()
  await page.getByTestId('platform-android').click()
  await page.getByTestId('platform-ios').click()
  await expect(page.getByTestId('assistant-target')).toHaveValue('settings')
  await expect(page.getByText('Connecting iPhone and opening Settings…')).toBeVisible()
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(ready.connectPayload()).toMatchObject({ targetPreset: 'ios-settings' })
})

test('quick-connects saved iPhone to current-screen and never continues an Android quick check after switching platforms', async ({ page }) => {
  const ios = createGuidedHarness({ iosSigningReady: true })
  await replaceViewer(page, ios.service, ios.assistant, () => ({ persistenceAvailable: true, preferredPlatform: 'ios' }))
  await page.getByTestId('assistant-quick-connect-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(ios.connectPayload()).toMatchObject({ targetPreset: 'ios-current-screen' })
  await page.getByTestId('stop-button').click()

  const android = createGuidedHarness({ androidDelayMs: 800 })
  await replaceViewer(page, android.service, android.assistant, () => ({ persistenceAvailable: true, preferredPlatform: 'android' }))
  await page.getByTestId('assistant-quick-connect-button').click()
  await expect(page.getByText('Checking Android…')).toBeVisible()
  await page.getByTestId('platform-ios').click()
  await page.getByTestId('platform-android').click()
  await page.waitForTimeout(900)
  await expect(page.getByTestId('assistant-report')).toBeHidden()
  expect(android.connectPayload()).toBeNull()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toBeVisible()
  await expect(page.getByTestId('assistant-connect-button')).toBeEnabled()
  expect(android.connectPayload()).toBeNull()
  await expect(page.getByTestId('connection-pill')).toContainText('Idle')
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-connect-device-en.png')
  await page.locator('#assistant-cancel-button').click()
  await page.getByTestId('assistant-quick-connect-button').click()
  await expect(page.getByText('Checking Android…')).toBeVisible()
  await page.locator('#assistant-cancel-button').click()
  await expect(page.locator('#assistant-progress')).toBeHidden()
  await expect(page.getByTestId('assistant-report')).toBeHidden()
  expect(android.connectPayload()).toBeNull()
})

test('covers managed-once, cancellation and stable expired, replayed, cross-platform and unsupported-target failures', async ({ page }) => {
  const harness = createGuidedHarness({ runtimeChoices: ['managed-once'] })
  await replaceViewer(page, harness.service, harness.assistant)
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-runtime')).toHaveValue('managed-once')
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByTestId('assistant-report')).toBeHidden()
  expect(harness.cancelCalls()).toBe(1)

  await page.getByTestId('assistant-check-button').click()
  await page.locator('#android-helper-confirmation').check()
  await page.getByTestId('assistant-target').selectOption('settings')
  await page.getByTestId('assistant-connect-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
  expect(harness.connectPayload()).toMatchObject({ runtime: 'managed-once', targetPreset: 'android-settings' })

  const errors = await page.evaluate(async () => {
    const origin = location.origin
    const request = async (body: Record<string, unknown>) => {
      const response = await fetch('/api/connection-assistant/connect', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() }
    }
    const base = { deviceRef: 'CAgICAgICAgICAgICAgICA', runtime: 'configured' }
    return {
      expired: await request({ ...base, assistantId: 'CQkJCQkJCQkJCQkJCQkJCQ', targetPreset: 'android-settings', confirmHelperApkSideEffect: true }),
      replayed: await request({ ...base, assistantId: 'CgoKCgoKCgoKCgoKCgoKCg', targetPreset: 'android-settings', confirmHelperApkSideEffect: true }),
      crossPlatform: await request({ ...base, assistantId: 'CwsLCwsLCwsLCwsLCwsLCw', targetPreset: 'ios-settings' }),
      unsupported: await request({ ...base, assistantId: 'DAwMDAwMDAwMDAwMDAwMDA', targetPreset: 'arbitrary-app' }),
      origin,
    }
  })
  expect(errors).toMatchObject({
    expired: { status: 410, body: { code: 'assistant_context_stale' } },
    replayed: { status: 409, body: { code: 'assistant_context_consumed' } },
    crossPlatform: { status: 400, body: { code: 'assistant_input_invalid' } },
    unsupported: { status: 400, body: { code: 'assistant_input_invalid' } },
  })
})

test('renders Android and iOS blocked diagnostics and scans public surfaces for private canaries', async ({ page }) => {
  const privateCanary = 'PRIVATE-SERIAL-UDID-MODEL-TEAM-CERT-PATH-CAPABILITIES'
  const responses: string[] = []
  const logs: string[] = []
  page.on('console', (message) => logs.push(message.text()))
  page.on('response', async (response) => {
    if (response.url().includes('/api/connection-assistant/')) responses.push(await response.text().catch(() => ''))
  })
  const service = createGuidedHarness().service
  const assistant: ConnectionAssistantApi = {
    check: async ({ platform }) => blockedReport(platform),
    connect: async () => { throw new ConnectionAssistantError('assistant_input_invalid') },
    cancel: () => ({ cancelled: true }),
    dispose: () => undefined,
  }
  await replaceViewer(page, service, assistant)
  await page.getByTestId('provider-select').selectOption('appium')
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toContainText('Authorize the USB Android device')
  await expect(page.getByTestId('assistant-report')).toContainText('Install the Appium uiautomator2 driver')
  await expect(page.getByTestId('assistant-report')).toContainText('Settings is unavailable on some devices')
  await expect(page.getByTestId('assistant-report')).toContainText('PNG polling remains available')
  await expect(page.getByTestId('policy-summary')).toContainText('Android hidden-API compatibility: on')
  await expect(page.getByTestId('assistant-connect-button')).toBeDisabled()

  await page.getByTestId('platform-ios').click()
  await page.getByTestId('assistant-check-button').click()
  await expect(page.getByTestId('assistant-report')).toContainText('Disable automatic device registration')
  await expect(page.getByTestId('assistant-connect-button')).toBeDisabled()
  const dom = await page.locator('body').innerText()
  const screenshot = await page.screenshot()
  const publicSurfaces = `${responses.join('\n')}\n${logs.join('\n')}\n${dom}`
  for (const marker of [privateCanary, 'appium:udid', 'PRIVATE_MODEL', '/Users/private', 'Apple Development: Private']) {
    expect(publicSurfaces).not.toContain(marker)
    expect(screenshot.toString('latin1')).not.toContain(marker)
  }
})

test('shows slow semantic control progress without exposing text or app targets', async ({ page }) => {
  const semanticConfig: Config = {
    ...config,
    mockStartupDelayMs: 0,
    agentAppControlPolicy: 'session-app',
  }
  const service = new MirrorService(semanticConfig, 'http://127.0.0.1:0', {
    providerFactory: () => new MockProvider(0, { operationDelayMs: 650 }),
  })
  await service.start({ provider: 'mock' })
  await replaceViewer(page, service)
  try {
    const initial = await service.observe({ image: false, structure: true })
    await service.action({ kind: 'tap_node', observationId: initial.observationId, nodeId: 'n3' })
    const focused = await service.observe({ image: false, structure: true })
    const marker = 'PUBLIC-E2E-CONTROL'
    const input = service.action({
      kind: 'input_text', observationId: focused.observationId, nodeId: 'n3', mode: 'replace', text: marker,
    })
    await expect(page.getByTestId('agent-control')).toContainText('Agent control acting…')
    await expect(page.getByTestId('stop-button')).toBeEnabled()
    await expect(page.locator('#device-frame')).toBeVisible()
    await page.getByTestId('theme-button').click()
    await expect(page.locator('body')).toHaveClass(/light-stage/)
    expect(await page.locator('body').innerText()).not.toContain(marker)
    await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-semantic-control-progress.png', true)
    await input
    await expect(page.getByTestId('agent-control')).toContainText('Agent control complete')

    const manage = service.manageApp({ operation: 'terminate' })
    await expect(page.getByTestId('agent-control')).toContainText('Agent managing application…')
    expect(await page.locator('body').innerText()).not.toMatch(/com\.example|nodeId|private-element/)
    await manage
    await expect(page.getByTestId('agent-control')).toContainText('Agent control complete')
    await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-semantic-control-final.png', true)
  } finally {
    await service.dispose()
  }
})

test('backs off failing PNG polling while actions stay responsive and trigger an async refresh', async ({ page }) => {
  const fake = createPollingFailureService()
  await replaceViewer(page, fake.service)

  await expect.poll(async () => await page.evaluate(() => (
    window as unknown as { __mobileMirrorPollingMetrics: { snapshot: () => { degraded: boolean } } }
  ).__mobileMirrorPollingMetrics.snapshot().degraded), { timeout: 6_000 }).toBe(true)
  await expect(page.locator('#meta-media')).toContainText('degraded (10s retry)')
  expect(fake.maxConcurrentFrames()).toBe(1)
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-polling-degraded.png')

  await page.getByRole('button', { name: 'Test tap' }).click()
  await expect.poll(fake.actions).toBe(1)
  await expect(page.locator('#operation')).toBeHidden()
  await expect.poll(async () => await page.evaluate(() => (
    window as unknown as { __mobileMirrorPollingMetrics: { snapshot: () => { inFlight: boolean } } }
  ).__mobileMirrorPollingMetrics.snapshot().inFlight)).toBe(true)
  expect(fake.maxConcurrentFrames()).toBe(1)
})

test('keeps polling without opening Android media when WebCodecs is unsupported', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'VideoDecoder', { configurable: true, value: undefined })
    Object.defineProperty(window, 'EncodedVideoChunk', { configurable: true, value: undefined })
  })
  const fake = createMediaService('scrcpy-h264')
  await replaceViewer(page, fake.service)
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.locator('#meta-media')).toContainText('PNG polling · decoder unsupported')
  await page.waitForTimeout(500)
  expect(fake.subscriptions()).toBe(0)
})

test('renders Android media after a slow first frame and falls back without blocking controls', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeEncodedVideoChunk {
      constructor(init: object) { Object.assign(this, init) }
    }
    class FakeVideoDecoder {
      static async isConfigSupported(decoderConfig: unknown) { return { supported: true, config: decoderConfig } }
      decodeQueueSize = 0
      callbacks: { output: (frame: ImageBitmap) => void; error: () => void }
      constructor(callbacks: { output: (frame: ImageBitmap) => void; error: () => void }) {
        this.callbacks = callbacks
        ;(window as unknown as { __failMobileMirrorDecoder: () => void }).__failMobileMirrorDecoder = () => callbacks.error()
      }
      configure() {}
      reset() {}
      close() {}
      decode(_chunk: unknown) {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 64
        const context = canvas.getContext('2d')!
        context.fillStyle = '#5b74ff'
        context.fillRect(0, 0, 32, 64)
        void createImageBitmap(canvas).then((bitmap) => {
          this.callbacks.output(bitmap)
        })
      }
    }
    Object.defineProperty(window, 'VideoDecoder', { configurable: true, value: FakeVideoDecoder })
    Object.defineProperty(window, 'EncodedVideoChunk', { configurable: true, value: FakeEncodedVideoChunk })
  })
  const fake = createMediaService('scrcpy-h264', 600)
  await replaceViewer(page, fake.service)
  await page.getByTestId('theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await expect(page.getByTestId('stop-button')).toBeEnabled()
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.locator('#device-video')).toBeVisible()
  const metrics = await page.evaluate(() => (window as Window & {
    __mobileMirrorMediaMetrics?: { snapshot(): {
      transport: string
      firstPaintMs: number | null
      fallbackReason: string | null
      packetCounts: Record<string, number>
      lastPacketType: string | null
      mediaVisible: boolean
    } }
  }).__mobileMirrorMediaMetrics?.snapshot())
  expect(metrics).toMatchObject({
    transport: 'scrcpy-h264',
    firstPaintMs: expect.any(Number),
    fallbackReason: null,
    packetCounts: { metadata: 2, session: 2, key: 1 },
    lastPacketType: expect.stringMatching(/^(key|delta)$/),
    mediaVisible: true,
  })
  expect(fake.frameRequests()).toBe(0)
  const controlPanelBox = await page.locator('.control-panel').boundingBox()
  const stageBox = await page.locator('.stage').boundingBox()
  const phoneFrameBox = await page.locator('.phone-frame').boundingBox()
  const videoBox = await page.locator('#device-video').boundingBox()
  expect(controlPanelBox).not.toBeNull()
  expect(stageBox).not.toBeNull()
  expect(phoneFrameBox).not.toBeNull()
  expect(videoBox).not.toBeNull()
  expect(stageBox!.x).toBeGreaterThanOrEqual(controlPanelBox!.x + controlPanelBox!.width - 1)
  expect(videoBox).toEqual(phoneFrameBox)
  await page.getByTestId('zoom-in-button').click()
  await expect(page.getByTestId('zoom-value')).toHaveText('125%')
  await expect.poll(async () => page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.phone-frame')!
    const canvas = document.querySelector<HTMLCanvasElement>('#device-video')!
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    const canvasBox = canvas.getBoundingClientRect()
    const frameBox = frame.getBoundingClientRect()
    return Math.round(canvasBox.width) === Math.round(frameBox.width)
      && Math.round(canvasBox.height) === Math.round(frameBox.height)
      && canvas.width === Math.round(frame.clientWidth * ratio)
      && canvas.height === Math.round(frame.clientHeight * ratio)
  })).toBe(true)
  const zoomedCanvas = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.phone-frame')!
    const canvas = document.querySelector<HTMLCanvasElement>('#device-video')!
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    return {
      cssWidth: Math.round(canvas.getBoundingClientRect().width),
      cssHeight: Math.round(canvas.getBoundingClientRect().height),
      frameWidth: Math.round(frame.getBoundingClientRect().width),
      frameHeight: Math.round(frame.getBoundingClientRect().height),
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      expectedBackingWidth: Math.round(frame.clientWidth * ratio),
      expectedBackingHeight: Math.round(frame.clientHeight * ratio),
    }
  })
  expect(zoomedCanvas).toMatchObject({
    cssWidth: zoomedCanvas.frameWidth,
    cssHeight: zoomedCanvas.frameHeight,
    backingWidth: zoomedCanvas.expectedBackingWidth,
    backingHeight: zoomedCanvas.expectedBackingHeight,
  })
  expect(fake.frameRequests()).toBe(0)
  await page.getByTestId('zoom-fit-button').click()
  await expect(page.getByTestId('zoom-value')).toHaveText('Fit')
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-android-media-final.png', true)

  await page.locator('#inspect-button').click()
  await expect(page.locator('#inspection-status')).toHaveText('Frozen inspection')
  const frozenSource = await page.locator('#inspection-image').getAttribute('src')
  const subscriptionsBefore = fake.subscriptions()
  await page.evaluate(() => (window as unknown as { __failMobileMirrorDecoder: () => void }).__failMobileMirrorDecoder())
  await expect(page.locator('#inspection-image')).toHaveAttribute('src', frozenSource!)
  await page.locator('#inspection-live').click()
  expect(fake.subscriptions()).toBe(subscriptionsBefore)
  await expect(page.locator('.inspection-box')).toHaveCount(0)
  await expect(page.locator('#device-frame')).toBeVisible({ timeout: 2_000 })
  await expect(page.locator('#device-video')).toBeHidden()
  const fallbackMetrics = await page.evaluate(() => (window as Window & {
    __mobileMirrorMediaMetrics?: { snapshot(): { fallbackMs: number | null; fallbackReason: string | null } }
  }).__mobileMirrorMediaMetrics?.snapshot())
  expect(fallbackMetrics).toMatchObject({ fallbackMs: expect.any(Number), fallbackReason: 'decoder-failed' })
  await page.getByTestId('stop-button').click()
  await expect(page.getByTestId('connection-pill')).toContainText('Idle')
})

test('renders iOS MJPEG, keeps the slow-start controls interactive, and restores polling on EOF', async ({ page }) => {
  const fake = createMediaService('wda-mjpeg', 500)
  await replaceViewer(page, fake.service)
  await page.getByTestId('theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await expect(page.getByTestId('stop-button')).toBeEnabled()
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.locator('#device-mjpeg')).toBeVisible()
  await expect(page.locator('#capture-record')).toBeEnabled()
  await page.locator('#capture-record').click()
  const pngEvent = page.waitForEvent('download')
  await page.locator('#capture-screenshot').click()
  expect((await readFile((await (await pngEvent).path())!)).subarray(1, 4).toString()).toBe('PNG')
  await page.waitForTimeout(1100)
  const mjpegBefore = await page.locator('#device-mjpeg').boundingBox()
  await page.getByTestId('zoom-in-button').click()
  await expect(page.getByTestId('zoom-value')).toHaveText('125%')
  const mjpegAfter = await page.locator('#device-mjpeg').boundingBox()
  const mjpegFrameAfter = await page.locator('.phone-frame').boundingBox()
  expect(mjpegBefore).not.toBeNull()
  expect(mjpegAfter).not.toBeNull()
  expect(mjpegFrameAfter).not.toBeNull()
  expect(mjpegAfter).toEqual(mjpegFrameAfter)
  expect(mjpegAfter!.height).toBeGreaterThan(mjpegBefore!.height)
  expect(fake.frameRequests()).toBe(0)
  await page.getByTestId('zoom-fit-button').click()
  await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-ios-media-final.png', true)

  await page.locator('#inspect-button').click()
  await expect(page.locator('#inspection-status')).toHaveText('Frozen inspection')
  const frozenSource = await page.locator('#inspection-image').getAttribute('src')
  const subscriptionsBefore = fake.subscriptions()
  fake.failMedia()
  await expect(page.locator('#inspection-image')).toHaveAttribute('src', frozenSource!)
  await page.locator('#inspection-live').click()
  expect(fake.subscriptions()).toBe(subscriptionsBefore)
  await expect(page.locator('.inspection-box')).toHaveCount(0)
  await expect(page.locator('#device-frame')).toBeVisible({ timeout: 2_000 })
  await expect(page.locator('#device-mjpeg')).toBeHidden()
  await expect(page.locator('#capture-record')).toHaveText('Stop recording')
  await page.waitForTimeout(600)
  const videoEvent = page.waitForEvent('download')
  await page.locator('#capture-record').click()
  const video = await readFile((await (await videoEvent).path())!)
  const replay = await playCapture(page, video, 'video/webm')
  expect(replay.width).toBeGreaterThan(0); expect(replay.height).toBeGreaterThan(0); expect(replay.audioTracks).toBe(0)
})

test('tears down a stalled media subscription when the page is hidden or unloaded', async ({ page }) => {
  const fake = createMediaService('wda-mjpeg', 100)
  await replaceViewer(page, fake.service)
  await expect(page.locator('#device-mjpeg')).toBeVisible()
  expect(fake.active()).toBe(true)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect.poll(fake.active).toBe(false)
})

test.describe('Viewer preview zoom', () => {
  test('uses bounded real-layout steps, scrolls oversized previews, resets, and performs no API work', async ({ page }) => {
    await expect(page.getByTestId('zoom-value')).toHaveText('Fit')
    const fit = await zoomSnapshot(page)
    expect(fit.mode).toBe('fit')
    expect(fit.height).toBeLessThanOrEqual(fit.clientHeight)

    await page.evaluate(() => {
      const target = window as Window & { __zoomTestCalls?: string[]; __zoomTestFetch?: typeof window.fetch }
      target.__zoomTestCalls = []
      target.__zoomTestFetch = window.fetch
      window.fetch = (...args) => {
        const input = args[0]
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        // State and directory reads are background polling, independent of zoom actions.
        if (!url.endsWith('/api/state') && !url.endsWith('/api/runs')) target.__zoomTestCalls!.push(url)
        return target.__zoomTestFetch!(...args)
      }
    })

    await page.getByTestId('zoom-out-button').click()
    await expect(page.getByTestId('zoom-value')).toHaveText('75%')
    await page.getByTestId('zoom-out-button').click()
    await expect(page.getByTestId('zoom-value')).toHaveText('50%')
    await expect(page.getByTestId('zoom-out-button')).toBeDisabled()

    for (const percent of [75, 100, 125, 150, 175, 200]) {
      await page.getByTestId('zoom-in-button').click()
      await expect(page.getByTestId('zoom-value')).toHaveText(`${percent}%`)
    }
    await expect(page.getByTestId('zoom-in-button')).toBeDisabled()
    const enlarged = await zoomSnapshot(page)
    expect(enlarged.mode).toBe('manual')
    expect(enlarged.scale).toBe(2)
    expect(enlarged.height).toBeGreaterThan(enlarged.clientHeight)
    expect(enlarged.scrollHeight).toBeGreaterThan(enlarged.clientHeight)

    const maxScroll = await page.evaluate(() => {
      const area = document.querySelector<HTMLElement>('#device-area')!
      area.scrollTop = area.scrollHeight
      return { top: area.scrollTop, max: area.scrollHeight - area.clientHeight }
    })
    expect(maxScroll.top).toBeGreaterThan(0)
    expect(Math.abs(maxScroll.top - maxScroll.max)).toBeLessThanOrEqual(1)

    await page.getByTestId('zoom-fit-button').click()
    await expect(page.getByTestId('zoom-value')).toHaveText('Fit')
    await page.getByTestId('zoom-in-button').click()
    await expect(page.getByTestId('zoom-value')).toHaveText('125%')
    const phoneBox = await page.getByTestId('phone-preview').boundingBox()
    expect(phoneBox).not.toBeNull()
    await page.mouse.dblclick(phoneBox!.x + phoneBox!.width / 2, phoneBox!.y + 4)
    await expect(page.getByTestId('zoom-value')).toHaveText('Fit')

    const apiCalls = await page.evaluate(() => {
      const target = window as Window & { __zoomTestCalls?: string[]; __zoomTestFetch?: typeof window.fetch }
      const calls = [...(target.__zoomTestCalls || [])]
      if (target.__zoomTestFetch) window.fetch = target.__zoomTestFetch
      return calls
    })
    expect(apiCalls).toEqual([])
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.toLowerCase().includes('zoom')))).toEqual([])

    await page.getByTestId('start-button').click()
    await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
    await expect(page.locator('#device-frame')).toBeVisible()
    for (const percent of [125, 150, 175, 200]) {
      await page.getByTestId('zoom-in-button').click()
      await expect(page.getByTestId('zoom-value')).toHaveText(`${percent}%`)
    }
    const frameBox = await page.locator('#device-frame').boundingBox()
    const frameShellBox = await page.locator('.phone-frame').boundingBox()
    expect(frameBox).toEqual(frameShellBox)
    await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-preview-zoom-200.png', true)
    await page.getByTestId('zoom-fit-button').click()
    await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-preview-zoom-fit.png', true)
    await page.getByTestId('stop-button').click()
  })

  test('preserves manual zoom across resize, state refresh and locale changes while narrow controls stay accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('group', { name: 'Device preview zoom' })).toBeVisible()
    await page.getByTestId('zoom-fit-button').focus()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('zoom-out-button')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('zoom-in-button')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('zoom-value')).toHaveText('125%')
    await page.waitForTimeout(350)
    expect(await zoomSnapshot(page)).toMatchObject({ mode: 'manual', scale: 1.25 })

    await page.getByTestId('language-select').selectOption('zh-CN')
    await expect(page.getByRole('group', { name: '设备预览缩放' })).toBeVisible()
    await expect(page.getByRole('button', { name: '使设备适应预览区域' })).toBeVisible()
    await expect(page.getByTestId('zoom-value')).toHaveText('125%')
    await page.setViewportSize({ width: 500, height: 900 })
    expect(await zoomSnapshot(page)).toMatchObject({ mode: 'manual', scale: 1.25 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await page.reload()
    await expect(page.getByTestId('zoom-value')).toHaveText('适应')
    expect(await zoomSnapshot(page)).toMatchObject({ mode: 'fit', scale: 1 })
  })
})

test.describe('Viewer localization', () => {
  test.use({ locale: 'zh-CN' })

  test('selects, persists and switches language without losing live or assistant state', async ({ page }) => {
    const consoleMessages: string[] = []
    const assistantResponses: string[] = []
    page.on('console', (message) => consoleMessages.push(message.text()))
    page.on('response', async (response) => {
      if (response.url().includes('/api/connection-assistant/')) {
        assistantResponses.push(await response.text().catch(() => ''))
      }
    })

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page).toHaveTitle('FlowAssert · 本地设备桥接')
    await expect(page.getByText('看见设备。')).toBeVisible()
    await expect(page.getByTestId('language-select')).toHaveValue('zh-CN')

    await page.getByTestId('language-select').selectOption('en')
    expect(await page.evaluate(() => localStorage.getItem('mobile-mirror.locale.v1'))).toBe('en')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByText('See the device.')).toBeVisible()

    await page.evaluate(() => localStorage.setItem('mobile-mirror.locale.v1', 'unsupported'))
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.getByText('看见设备。')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('mobile-mirror.locale.v1'))).toBeNull()

    await page.getByTestId('start-button').click()
    await expect(page.getByTestId('connection-pill')).toContainText('镜像中')
    await expect(page.locator('#device-frame')).toBeVisible()
    const streamingBefore = viewer!.service.state()
    const streamingSwitch = await page.evaluate(() => {
      const originalFetch = window.fetch
      let fetches = 0
      window.fetch = (...args) => {
        fetches += 1
        return originalFetch(...args)
      }
      const select = document.querySelector<HTMLSelectElement>('#language-select')!
      const frame = document.querySelector<HTMLImageElement>('#device-frame')!
      const before = { frame: frame.src, hidden: frame.hidden, stopDisabled: (document.querySelector<HTMLButtonElement>('#stop-button')!).disabled }
      select.value = 'en'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const after = { frame: frame.src, hidden: frame.hidden, stopDisabled: (document.querySelector<HTMLButtonElement>('#stop-button')!).disabled }
      window.fetch = originalFetch
      return { fetches, before, after }
    })
    expect(streamingSwitch).toEqual({ fetches: 0, before: streamingSwitch.before, after: streamingSwitch.before })
    expect(viewer!.service.state()).toMatchObject({
      lifecycle: streamingBefore.lifecycle,
      sessionId: streamingBefore.sessionId,
      provider: streamingBefore.provider,
    })
    await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
    await page.getByTestId('language-select').selectOption('zh-CN')
    await page.getByTestId('stop-button').click()
    await expect(page.getByTestId('connection-pill')).toContainText('空闲')

    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual({
      'mobile-mirror.locale.v1': 'zh-CN',
    })
    await page.addInitScript(() => {
      const originalGetItem = Storage.prototype.getItem
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.getItem = function (key: string) {
        if (key === 'mobile-mirror.locale.v1') throw new DOMException('storage blocked')
        return originalGetItem.call(this, key)
      }
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'mobile-mirror.locale.v1') throw new DOMException('storage blocked')
        return originalSetItem.call(this, key, value)
      }
    })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await page.getByTestId('language-select').selectOption('en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await page.getByTestId('start-button').click()
    await expect(page.getByTestId('connection-pill')).toContainText('Streaming')
    await page.getByTestId('stop-button').click()

    const harness = createGuidedHarness({ androidDelayMs: 650, runtimeChoices: ['configured', 'managed-once'] })
    await replaceViewer(page, harness.service, harness.assistant)
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await page.getByTestId('provider-select').selectOption('appium')
    await page.getByTestId('assistant-check-button').click()
    await expect(page.getByText('正在检查 Android…')).toBeVisible()
    const progressSwitch = await page.evaluate(() => {
      const originalFetch = window.fetch
      let fetches = 0
      window.fetch = (...args) => {
        fetches += 1
        return originalFetch(...args)
      }
      const select = document.querySelector<HTMLSelectElement>('#language-select')!
      const check = document.querySelector<HTMLButtonElement>('#assistant-check-button')!
      const before = { disabled: check.disabled, progressHidden: (document.querySelector<HTMLElement>('#assistant-progress')!).hidden }
      select.value = 'en'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const after = { disabled: check.disabled, progressHidden: (document.querySelector<HTMLElement>('#assistant-progress')!).hidden }
      window.fetch = originalFetch
      return { fetches, before, after }
    })
    expect(progressSwitch).toEqual({ fetches: 0, before: progressSwitch.before, after: progressSwitch.before })
    await expect(page.getByText('Checking Android…')).toBeVisible()
    await page.getByTestId('theme-button').click()
    await expect(page.locator('body')).toHaveClass(/light-stage/)
    await expect(page.getByTestId('assistant-report')).toContainText('UiAutomator2 may install/update its helper APKs')
    await page.getByTestId('language-select').selectOption('zh-CN')
    await expect(page.getByTestId('assistant-report')).toContainText('UiAutomator2 可能会在这台手机上安装或更新辅助 APK')

    await page.getByTestId('platform-ios').click()
    await page.getByTestId('assistant-check-button').click()
    await expect(page.getByTestId('assistant-report')).toContainText('请补齐本地 WDA 签名字段后重试')
    await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-zh-cn.png')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await captureStableScreenshot(page, 'artifacts/screenshots/mobile-mirror-zh-cn-narrow.png')
    await page.setViewportSize({ width: 1280, height: 720 })

    await page.locator('#ios-team-id').fill('ABCDE12345')
    await page.locator('#ios-wda-bundle-id').fill('com.example.WebDriverAgentRunner')
    await page.getByTestId('advanced-appium').locator('summary').click()
    await page.locator('#session-id').fill('unsubmitted-session')
    await page.locator('#capabilities').fill('{"platformName":"iOS"}')
    await page.getByTestId('assistant-runtime').selectOption('managed-once')
    const preservedBefore = await localizationFormState(page)
    await page.getByTestId('language-select').selectOption('en')
    await page.getByTestId('language-select').selectOption('zh-CN')
    expect(await localizationFormState(page)).toEqual(preservedBefore)
    expect(viewer!.service.state().lifecycle).toBe('idle')

    const publicSurface = `${await page.locator('body').innerText()}\n${consoleMessages.join('\n')}\n${assistantResponses.join('\n')}`
    expect(publicSurface).not.toContain(harness.privateCanary)
    expect(publicSurface).not.toContain('undefined')
    expect(publicSurface).not.toMatch(/(?:assistant|operation|lifecycle)\.[a-z]/)
  })
})

async function replaceViewer(
  page: Page,
  service: MirrorService,
  assistant: ConnectionAssistantApi | null = null,
  localSetup?: () => { persistenceAvailable: boolean; preferredPlatform: 'android' | 'ios' | null },
): Promise<void> {
  await viewer?.close()
  viewer = new ViewerServer(config, { service, assistant, workbenchRoot: test.info().outputPath('workbench'), ...(localSetup ? { localSetup } : {}) })
  await viewer.listen()
  await page.goto(viewer.url)
}

async function localizationFormState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    reportRows: document.querySelectorAll('#assistant-checks .readiness-row').length,
    reportHidden: (document.querySelector<HTMLElement>('#assistant-report')!).hidden,
    device: (document.querySelector<HTMLSelectElement>('#assistant-device')!).value,
    runtime: (document.querySelector<HTMLSelectElement>('#assistant-runtime')!).value,
    teamId: (document.querySelector<HTMLInputElement>('#ios-team-id')!).value,
    bundleId: (document.querySelector<HTMLInputElement>('#ios-wda-bundle-id')!).value,
    sessionId: (document.querySelector<HTMLInputElement>('#session-id')!).value,
    capabilities: (document.querySelector<HTMLTextAreaElement>('#capabilities')!).value,
    advancedOpen: (document.querySelector<HTMLDetailsElement>('#appium-options')!).open,
    checkDisabled: (document.querySelector<HTMLButtonElement>('#assistant-check-button')!).disabled,
    connectDisabled: (document.querySelector<HTMLButtonElement>('#assistant-connect-button')!).disabled,
  }))
}

async function zoomSnapshot(page: Page): Promise<{
  mode: string
  scale: number
  fitHeight: number
  width: number
  height: number
  scrollWidth: number
  scrollHeight: number
  clientWidth: number
  clientHeight: number
  scrollLeft: number
  scrollTop: number
}> {
  return page.evaluate(() => (window as unknown as Window & {
    __mobileMirrorZoomMetrics: { snapshot(): {
      mode: string
      scale: number
      fitHeight: number
      width: number
      height: number
      scrollWidth: number
      scrollHeight: number
      clientWidth: number
      clientHeight: number
      scrollLeft: number
      scrollTop: number
    } }
  }).__mobileMirrorZoomMetrics.snapshot())
}

function createGuidedHarness(options: { androidDelayMs?: number; connectDelayMs?: number; androidCheckGate?: Promise<void>; connectGate?: Promise<void>; failSecondAndroidCheck?: boolean; failAndroidCheckNumber?: number; settingsAvailable?: boolean; iosSigningReady?: boolean; iosFailureOnConnect?: number; runtimeChoices?: ConnectionAssistantReport['runtimeChoices'] } = {}) {
  const privateCanary = 'PRIVATE-DEVICE-UDID-MODEL-PATH'
  const assistantToken = Buffer.alloc(16, 7).toString('base64url')
  const deviceToken = Buffer.alloc(16, 8).toString('base64url')
  let checkCount = 0
  let cancelCount = 0
  let iosConnectCount = 0
  let lastConnect: Record<string, unknown> | null = null
  let current = guidedState('idle')
  let lastFrameUpdatedAt: string | null = null
  const service = {
    state: () => structuredClone(current),
    viewerInspectionContext: () => current.lifecycle === 'streaming' ? { generationToken: 'fixture-session', screenEpoch: 0 } : null,
    updateViewerUrl: (url: string) => { current = { ...current, viewerUrl: url, revision: current.revision + 1 } },
    stop: async () => { current = { ...guidedState('idle', current.viewerUrl, current.revision + 1), frameUpdatedAt: lastFrameUpdatedAt }; return structuredClone(current) },
    dispose: async () => undefined,
    frame: async () => ({ contentType: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#111827"/></svg>'), capturedAt: new Date().toISOString() }),
  } as unknown as MirrorService
  const assistant: ConnectionAssistantApi = {
    check: async ({ platform, deviceKind }, signal) => {
      checkCount += 1
      if (platform === 'android') await options.androidCheckGate
      if (platform === 'android' && options.androidDelayMs) await assistantDelay(options.androidDelayMs, signal)
      if (platform === 'android' && options.failSecondAndroidCheck && checkCount === (options.failAndroidCheckNumber ?? 2)) throw new Error('simulated local check failure')
      const report = guidedReport(platform, assistantToken, deviceToken, options.runtimeChoices)
      if (deviceKind === 'simulator') {
        report.devices = report.devices.map(device => ({ ...device, deviceKind, label: `${platform === 'ios' ? 'iPhone' : 'Android'} Simulator 1` }))
        delete report.signing
        report.checks = [{ id: 'device', status: 'pass', code: 'assistant_simulator_ready', action: 'A running simulator is available.' }]
      }
      if (options.settingsAvailable !== undefined) report.devices[0]!.settingsAvailable = options.settingsAvailable
      if (platform === 'ios' && options.iosSigningReady) {
        report.signing = { profileDefaultsReady: true, requiredInputs: [] }
        report.checks = [
          ...report.checks.filter((check) => check.id !== 'wda-signing'),
          { id: 'wda-signing', status: 'pass', code: 'assistant_wda_prerequisites_ready', action: 'Local WDA signing prerequisites were found.' },
          { id: 'xcode-account', status: 'manual', code: 'assistant_xcode_account_manual', action: 'Confirm the developer account for this Team in Xcode Settings > Accounts.' },
          { id: 'wda-runtime', status: 'manual', code: 'assistant_wda_runtime_unverified', action: 'This read-only check has not started WDA. Connect to verify it on the iPhone.' },
        ]
      }
      return report
    },
    connect: async (input, signal) => {
      if (input.assistantId === Buffer.alloc(16, 9).toString('base64url')) throw new ConnectionAssistantError('assistant_context_stale')
      if (input.assistantId === Buffer.alloc(16, 10).toString('base64url')) throw new ConnectionAssistantError('assistant_context_consumed')
      if (input.assistantId === Buffer.alloc(16, 11).toString('base64url')) throw new ConnectionAssistantError('assistant_input_invalid')
      lastConnect = structuredClone(input) as unknown as Record<string, unknown>
      current = guidedState('connecting', current.viewerUrl, current.revision + 1)
      await options.connectGate
      await assistantDelay(options.connectDelayMs ?? 350, signal)
      if (input.targetPreset.startsWith('ios-') && ++iosConnectCount === options.iosFailureOnConnect) {
        current = { ...guidedState('idle', current.viewerUrl, current.revision + 1), frameUpdatedAt: lastFrameUpdatedAt }
        throw new WdaStartError(
          'wda_developer_account_unavailable',
          'Sign in to the Apple developer account for this Team in Xcode Settings > Accounts, then rerun the iOS readiness check and connect.',
          null,
          new Error('PRIVATE_ACCOUNT@example.com TEAM-SECRET /Users/private'),
        )
      }
      current = guidedState('streaming', current.viewerUrl, current.revision + 1)
      lastFrameUpdatedAt = current.frameUpdatedAt
      return structuredClone(current)
    },
    cancel: () => { cancelCount += 1; return { cancelled: true } },
    dispose: () => undefined,
  }
  return { service, assistant, privateCanary, assistantToken, connectPayload: () => lastConnect, cancelCalls: () => cancelCount }
}

function guidedReport(platform: ConnectionAssistantPlatform, assistantId: string, deviceRef: string, runtimeChoices: ConnectionAssistantReport['runtimeChoices'] = ['configured']): ConnectionAssistantReport {
  const ios = platform === 'ios'
  return {
    schemaVersion: 1,
    assistantId,
    platform,
    status: 'action-required',
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    checks: ios ? [
      { id: 'appium-endpoint', status: 'pass', code: 'assistant_appium_endpoint_ready', action: 'Appium is ready.', version: '3.2.0' },
      { id: 'xcode', status: 'pass', code: 'assistant_xcode_ready', action: 'Xcode is available.', version: '26.6' },
      { id: 'device', status: 'pass', code: 'assistant_ios_device_ready', action: 'A physical iPhone is connected.', count: 1 },
      { id: 'wda-signing', status: 'warning', code: 'assistant_signing_incomplete', action: 'Provide the missing local WDA signing fields and retry.' },
    ] : [
      { id: 'appium-endpoint', status: 'pass', code: 'assistant_appium_endpoint_ready', action: 'Appium is ready.', version: '3.2.0' },
      { id: 'adb', status: 'pass', code: 'assistant_adb_ready', action: 'ADB is available.', version: '1.0.41' },
      { id: 'device', status: 'pass', code: 'assistant_android_device_ready', action: 'A USB Android device is authorized.', count: 1 },
      { id: 'settings-target', status: 'pass', code: 'assistant_android_settings_ready', action: 'Android Settings is available.' },
      { id: 'scrcpy', status: 'warning', code: 'assistant_scrcpy_not_configured', action: 'PNG polling remains available; configure trusted scrcpy 4.1 for low-latency media.' },
    ],
    devices: [{ deviceRef, label: ios ? 'iPhone 1' : 'Android 1', platform, osVersion: ios ? '18.6' : '15.0' }],
    runtimeChoices,
    ...(ios ? { signing: { profileDefaultsReady: false, requiredInputs: ['team-id', 'wda-bundle-id'] } } : {}),
    confirmations: ios ? ['device-trust', 'developer-mode', 'ui-automation'] : ['android-unlocked', 'usb-debugging', 'adb-authorized', 'uiautomator2-helper-apk'],
    media: ios ? { mode: 'polling', code: 'assistant_ios_media_after_connect' } : { mode: 'polling', code: 'assistant_scrcpy_not_configured' },
  }
}

function blockedReport(platform: ConnectionAssistantPlatform): ConnectionAssistantReport {
  const base = guidedReport(platform, Buffer.alloc(16, platform === 'android' ? 13 : 14).toString('base64url'), Buffer.alloc(16, 15).toString('base64url'))
  if (platform === 'android') return {
    ...base,
    status: 'blocked',
    devices: [],
    checks: [
      { id: 'appium-driver', status: 'blocked', code: 'assistant_uiautomator2_unavailable', action: 'Install the Appium uiautomator2 driver and retry.' },
      { id: 'adb', status: 'pass', code: 'assistant_adb_ready', action: 'ADB is available.' },
      { id: 'device', status: 'blocked', code: 'assistant_android_device_unauthorized', action: 'Authorize the USB Android device and retry.' },
      { id: 'settings-target', status: 'warning', code: 'assistant_android_settings_unresolved', action: 'Settings is unavailable; current-screen remains optional subject to device readiness.' },
      { id: 'scrcpy', status: 'warning', code: 'assistant_scrcpy_not_configured', action: 'PNG polling remains available; configure trusted scrcpy 4.1 for low-latency media.' },
    ],
  }
  return {
    ...base,
    status: 'blocked',
    checks: [
      { id: 'xcode', status: 'pass', code: 'assistant_xcode_ready', action: 'Xcode is available.' },
      { id: 'device', status: 'pass', code: 'assistant_ios_device_ready', action: 'A physical iPhone is connected.', count: 1 },
      { id: 'wda-signing', status: 'blocked', code: 'assistant_provisioning_enabled', action: 'Disable automatic device registration or use the advanced flow.' },
    ],
  }
}

function guidedState(lifecycle: MirrorState['lifecycle'], viewerUrl = 'http://127.0.0.1:0', revision = 0): MirrorState {
  const streaming = lifecycle === 'streaming'
  return {
    lifecycle, provider: streaming || lifecycle === 'connecting' ? 'appium' : null, sessionId: streaming ? 'opaque-session' : null,
    deviceName: streaming ? 'Settings' : null, viewerUrl, frameUpdatedAt: streaming ? new Date().toISOString() : null,
    lastAction: null, lastError: null, lastErrorCode: null,
    observation: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    control: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    media: { mode: 'polling', phase: streaming ? 'ready' : 'idle', transport: 'appium-screenshot', startedAt: null, firstFrameAt: null, lastFrameAt: null, width: null, height: null, targetFps: null, lastErrorCode: null },
    appiumRuntime: { mode: 'external', phase: 'idle', owned: false, lastErrorCode: null }, revision,
  }
}

async function assistantDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timeout); reject(signal.reason) }, { once: true })
  })
}

async function captureStableScreenshot(page: Page, path: string, freezeDeviceFrame = false): Promise<void> {
  await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace')!
    workspace.style.backdropFilter = 'none'
    workspace.style.setProperty('-webkit-backdrop-filter', 'none')
  })
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  if (freezeDeviceFrame) {
    await page.evaluate(async () => {
      const source = [...document.querySelectorAll<HTMLImageElement | HTMLCanvasElement>('#device-frame, #device-mjpeg, #device-video')]
        .find((element) => !element.hidden)!
      const frameElement = source.closest<HTMLElement>('.phone-frame')!
      const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
      let frozenDataUrl
      if (source instanceof HTMLCanvasElement) {
        frozenDataUrl = source.toDataURL('image/png')
      } else {
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(frameElement.clientWidth * pixelRatio))
        canvas.height = Math.max(1, Math.round(frameElement.clientHeight * pixelRatio))
        const scale = Math.max(canvas.width / source.naturalWidth, canvas.height / source.naturalHeight)
        const drawWidth = Math.round(source.naturalWidth * scale)
        const drawHeight = Math.round(source.naturalHeight * scale)
        const context = canvas.getContext('2d', { alpha: false })!
        context.fillStyle = '#000'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(source, Math.floor((canvas.width - drawWidth) / 2), Math.floor((canvas.height - drawHeight) / 2), drawWidth, drawHeight)
        frozenDataUrl = canvas.toDataURL('image/png')
      }
      const image = document.createElement('img')
      image.id = 'device-video-screenshot-freeze'
      image.alt = 'Frozen device frame for screenshot evidence'
      image.src = frozenDataUrl
      image.style.cssText = 'position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:contain;background:#000'
      await image.decode()
      source.dataset.screenshotHidden = 'true'
      source.hidden = true
      frameElement.append(image)
    })
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
  }
  try {
    await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  } finally {
    if (freezeDeviceFrame) {
      await page.evaluate(() => {
        document.querySelector('#device-video-screenshot-freeze')?.remove()
        const source = document.querySelector<HTMLElement>('[data-screenshot-hidden="true"]')!
        delete source.dataset.screenshotHidden
        source.hidden = false
      })
    }
    await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>('.workspace')!
      workspace.style.removeProperty('backdrop-filter')
      workspace.style.removeProperty('-webkit-backdrop-filter')
    })
  }
}

function createMediaService(transport: Exclude<ViewerMediaTransport, 'appium-screenshot'>, firstFrameDelayMs = 0): {
  service: MirrorService
  subscriptions: () => number
  active: () => boolean
  failMedia: () => void
  frameRequests: () => number
} {
  let subscriptionCount = 0
  let frameRequestCount = 0
  let active: AbortController | null = null
  let current: MirrorState = {
    lifecycle: 'streaming',
    provider: 'appium',
    sessionId: 'e2e-session',
    deviceName: transport === 'scrcpy-h264' ? 'Android media fixture' : 'iOS media fixture',
    viewerUrl: 'http://127.0.0.1:0',
    frameUpdatedAt: new Date().toISOString(),
    lastAction: null,
    lastError: null,
    lastErrorCode: null,
    observation: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    control: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
      media: {
      mode: 'auto',
      phase: 'ready',
      transport,
      startedAt: null,
      firstFrameAt: null,
      lastFrameAt: null,
      width: null,
      height: null,
      targetFps: transport === 'scrcpy-h264' ? 30 : 15,
        lastErrorCode: null,
      },
      appiumRuntime: { mode: 'external', phase: 'idle', owned: false, lastErrorCode: null },
      revision: 1,
  }

  const failMedia = () => {
    active?.abort()
    active = null
    current = {
      ...current,
      media: { ...current.media, phase: 'fallback', lastErrorCode: 'viewer_media_stream_ended' },
      revision: current.revision + 1,
    }
  }

  const service = {
    captureViewerInspection: async () => {
      const mock = new MockProvider(0)
      await mock.start({ provider: 'mock' }, new AbortController().signal)
      const geometry = await mock.screenGeometry(), image = await mock.snapshot(), source = await mock.screenSource()
      await mock.stop()
      return { inspectionId: 'media-inspection', generationToken: 'fixture-session', screenEpoch: 0, capturedAt: new Date().toISOString(), captureEndedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), ...geometry, image, structure: source.structure }
    },
    state: () => structuredClone(current),
    viewerInspectionContext: () => current.lifecycle === 'streaming' ? { generationToken: 'fixture-session', screenEpoch: 0 } : null,
    updateViewerUrl: (viewerUrl: string) => { current = { ...current, viewerUrl, revision: current.revision + 1 } },
    cachedFrame: () => ({
      contentType: 'image/svg+xml' as const,
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#111623"/><text x="40" y="90" fill="white">Polling fallback</text></svg>'),
    }),
    frame: async () => {
      frameRequestCount += 1
      return {
        contentType: 'image/svg+xml' as const,
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#111623"/><text x="40" y="90" fill="white">Polling fallback</text></svg>'),
      }
    },
    start: async () => current,
    stop: async () => {
      active?.abort()
      active = null
      current = { ...current, lifecycle: 'idle', provider: null, sessionId: null, deviceName: null, media: { ...current.media, phase: 'idle', transport: 'appium-screenshot' }, revision: current.revision + 1 }
      return structuredClone(current)
    },
    action: async () => current,
    subscribeMedia: (): ViewerMediaSubscription => {
      if (active) throw new Error('unexpected second E2E media subscription')
      subscriptionCount += 1
      active = new AbortController()
      const controller = active
      current = { ...current, media: { ...current.media, phase: 'starting', startedAt: new Date().toISOString() }, revision: current.revision + 1 }
      return {
        generation: `e2e-generation-${subscriptionCount}`,
        transport,
        contentType: transport === 'scrcpy-h264'
          ? 'application/x-mobile-mirror-h264; version=1'
          : 'multipart/x-mixed-replace; boundary=mobile-mirror-frame',
        packets: mediaPackets(transport, firstFrameDelayMs, controller.signal, () => {
          current = { ...current, media: { ...current.media, phase: 'live', firstFrameAt: new Date().toISOString(), lastFrameAt: new Date().toISOString(), width: 32, height: 64 }, revision: current.revision + 1 }
        }),
        close: async () => {
          controller.abort()
          if (active === controller) active = null
        },
      }
    },
    reportMediaClientFailure: async () => {
      failMedia()
      return true
    },
  } as unknown as MirrorService
  return { service, subscriptions: () => subscriptionCount, active: () => active !== null, failMedia, frameRequests: () => frameRequestCount }
}

function createPollingFailureService(): {
  service: MirrorService
  actions: () => number
  maxConcurrentFrames: () => number
} {
  let frameCalls = 0
  let activeFrames = 0
  let maxActiveFrames = 0
  let actionCalls = 0
  let current = guidedState('streaming')
  current = {
    ...current,
    deviceName: 'Polling stability fixture',
    frameUpdatedAt: new Date().toISOString(),
    media: { ...current.media, mode: 'auto', phase: 'ready', transport: 'appium-screenshot' },
  }
  const service = {
    state: () => structuredClone(current),
    viewerInspectionContext: () => current.lifecycle === 'streaming' ? { generationToken: 'fixture-session', screenEpoch: 0 } : null,
    updateViewerUrl: (viewerUrl: string) => { current = { ...current, viewerUrl, revision: current.revision + 1 } },
    cachedFrame: () => ({
      contentType: 'image/svg+xml' as const,
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#111827"/></svg>'),
    }),
    frame: async () => {
      frameCalls += 1
      activeFrames += 1
      maxActiveFrames = Math.max(maxActiveFrames, activeFrames)
      try {
        await assistantDelay(frameCalls <= 3 ? 20 : 750)
        if (frameCalls <= 3) throw new Error('simulated Appium screenshot timeout')
        return {
          contentType: 'image/svg+xml' as const,
          bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#111827"/><text x="50" y="110" fill="white">Recovered frame</text></svg>'),
        }
      } finally {
        activeFrames -= 1
      }
    },
    action: async () => {
      actionCalls += 1
      current = { ...current, lastAction: 'tap(195,420)', revision: current.revision + 1 }
      return structuredClone(current)
    },
    stop: async () => {
      current = guidedState('idle', current.viewerUrl, current.revision + 1)
      return structuredClone(current)
    },
    dispose: async () => undefined,
  } as unknown as MirrorService
  return { service, actions: () => actionCalls, maxConcurrentFrames: () => maxActiveFrames }
}

function createManagedStartingService(): { service: MirrorService; cancelled: () => boolean } {
  let cancelled = false
  let releaseStart!: () => void
  const startCancelled = new Promise<void>((resolve) => { releaseStart = resolve })
  let current: MirrorState = {
    lifecycle: 'error',
    provider: 'appium',
    sessionId: null,
    deviceName: 'Retained device frame',
    viewerUrl: 'http://127.0.0.1:0',
    frameUpdatedAt: new Date().toISOString(),
    lastAction: null,
    lastError: 'Previous connection failed',
    lastErrorCode: 'appium_start_timeout',
    observation: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    control: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    media: {
      mode: 'auto',
      phase: 'fallback',
      transport: 'appium-screenshot',
      startedAt: null,
      firstFrameAt: null,
      lastFrameAt: null,
      width: 390,
      height: 844,
      targetFps: null,
      lastErrorCode: null,
    },
    appiumRuntime: { mode: 'managed', phase: 'idle', owned: false, lastErrorCode: null },
    revision: 1,
  }
  const service = {
    state: () => structuredClone(current),
    viewerInspectionContext: () => current.lifecycle === 'streaming' ? { generationToken: 'fixture-session', screenEpoch: 0 } : null,
    updateViewerUrl: (viewerUrl: string) => { current = { ...current, viewerUrl, revision: current.revision + 1 } },
    frame: async () => ({
      contentType: 'image/svg+xml' as const,
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#111623"/><circle cx="195" cy="360" r="96" fill="#5b74ff"/><text x="80" y="520" fill="white" font-size="26">Retained frame</text></svg>'),
    }),
    start: async () => {
      current = {
        ...current,
        lifecycle: 'connecting',
        lastError: null,
        lastErrorCode: null,
        appiumRuntime: { mode: 'managed', phase: 'starting', owned: true, lastErrorCode: null },
        revision: current.revision + 1,
      }
      await startCancelled
      return structuredClone(current)
    },
    stop: async () => {
      cancelled = true
      current = {
        ...current,
        lifecycle: 'idle',
        appiumRuntime: { mode: 'managed', phase: 'idle', owned: false, lastErrorCode: null },
        revision: current.revision + 1,
      }
      releaseStart()
      return structuredClone(current)
    },
    dispose: async () => { releaseStart() },
  } as unknown as MirrorService
  return { service, cancelled: () => cancelled }
}

async function* mediaPackets(
  transport: Exclude<ViewerMediaTransport, 'appium-screenshot'>,
  delayMs: number,
  signal: AbortSignal,
  onLive: () => void,
): AsyncIterable<ViewerMediaPacket> {
  await abortableDelay(delayMs, signal)
  if (signal.aborted) return
  onLive()
  if (transport === 'scrcpy-h264') {
    yield { kind: 'metadata', bytes: new Uint8Array(), codec: 'avc1.42001e' }
    yield { kind: 'session', bytes: new Uint8Array(), width: 32, height: 64 }
    yield { kind: 'key', bytes: Uint8Array.of(0, 0, 0, 1, 0x67, 0x42, 0, 0x1e, 0, 0, 0, 1, 0x65, 1), ptsUs: 1n, width: 32, height: 64, codec: 'avc1.42001e' }
    let ptsUs = 2n
    while (!signal.aborted) {
      await abortableDelay(100, signal)
      if (signal.aborted) return
      yield { kind: 'delta', bytes: Uint8Array.of(0, 0, 0, 1, 0x41, 1), ptsUs, width: 32, height: 64, codec: 'avc1.42001e' }
      ptsUs += 1n
    }
  } else {
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCABAACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCh5/vR5/vWX5/vR5/vX7T9YPnOU1PP96PP96y/P96PP96PrAcpk/aPej7R71l+f70ef714n1g6eU1PtHvR9o96y/P96PP96PrAcplef70ef71lfaPej7R714v1g6OU1fP96PP96yvtHvR9o96PrAcplfaPej7R71lfaPej7R714n1g6OU1ftHvR9o96yvtHvR9o96PrAcp/9k=', 'base64')
    while (!signal.aborted) {
      yield { kind: 'jpeg', bytes: jpeg, width: 32, height: 64 }
      await abortableDelay(100, signal)
    }
  }
  await abortableDelay(60_000, signal)
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms === 0) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
