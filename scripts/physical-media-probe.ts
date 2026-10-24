import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { Config, type Config as PluginConfig } from '../src/config.js'
import { ViewerServer } from '../src/viewer-server.js'

const platform = process.env.MOBILE_MIRROR_PLATFORM
const deviceId = process.env.MOBILE_MIRROR_UDID
const androidDynamicScreen = process.env.MOBILE_MIRROR_ANDROID_DYNAMIC_SCREEN
if (platform !== 'android' && platform !== 'ios') throw new Error('MOBILE_MIRROR_PLATFORM must be android or ios')
if (!deviceId) throw new Error('MOBILE_MIRROR_UDID is required')
if (platform === 'android' && !process.env.MOBILE_MIRROR_SCRCPY_PATH) {
  throw new Error('MOBILE_MIRROR_SCRCPY_PATH must point to scrcpy 4.1')
}

const evidenceDirectory = resolve('artifacts/physical-validation', `media-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 })
const screenshotPath = validatedEvidencePath(
  process.env.MOBILE_MIRROR_MEDIA_SCREENSHOT_PATH,
  resolve(evidenceDirectory, 'viewer.png'),
  'artifacts/physical-validation',
)
const metricsPath = validatedEvidencePath(
  process.env.MOBILE_MIRROR_MEDIA_METRICS_PATH,
  resolve(evidenceDirectory, 'metrics.json'),
  'artifacts/physical-validation',
)
const failureScreenshotPath = validatedEvidencePath(
  undefined,
  resolve(evidenceDirectory, 'failure-viewer.png'),
  'artifacts/physical-validation',
)
const failureMetricsPath = validatedEvidencePath(
  undefined,
  resolve(evidenceDirectory, 'failure-metrics.json'),
  'artifacts/physical-validation',
)

const config = Config({
  defaultProvider: 'appium',
  agentScreenContentPolicy: 'image-and-structure',
  appiumUrl: process.env.MOBILE_MIRROR_APPIUM_URL ?? 'http://127.0.0.1:4723',
  viewerPort: 0,
  viewerMediaMode: 'auto',
  androidScrcpyPath: process.env.MOBILE_MIRROR_SCRCPY_PATH ?? '',
  androidScrcpyServerPath: process.env.MOBILE_MIRROR_SCRCPY_SERVER_PATH ?? '',
  startupTimeoutMs: 120_000,
  iosWdaAllowProvisioningDeviceRegistration: false,
  allowHostDeviceDiscovery: false,
  allowHostSigningDiagnostics: false,
} as PluginConfig)

const viewer = new ViewerServer(config)
const bundledChromium = chromium.executablePath()
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({
  headless: true,
  ...(!existsSync(bundledChromium) && existsSync(chrome) ? { executablePath: chrome } : {}),
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
let generation: string | null = null
page.on('response', (response) => {
  if (new URL(response.url()).pathname === '/api/media/stream') {
    generation = response.headers()['x-mobile-mirror-generation'] ?? generation
  }
})

let stopped = false
try {
  await viewer.listen()
  await viewer.service.start({ provider: 'appium', capabilities: capabilities(platform, deviceId) })
  let first = await viewer.service.observe({ image: true, structure: true })
  assertObservation(first)
  if (platform === 'android' && androidDynamicScreen === 'stopwatch') {
    await tapLabeledControl(viewer, first, /^(秒表|Stopwatch)$/i)
    first = await viewer.service.observe({ image: true, structure: true })
    assertObservation(first)
    await tapLabeledControl(viewer, first, /^(开始|启动|Start)$/i)
    first = await viewer.service.observe({ image: true, structure: true })
    assertObservation(first)
  }
  await page.goto(viewer.url)
  const mediaSelector = platform === 'android' ? '#device-video' : '#device-mjpeg'
  await page.locator(mediaSelector).waitFor({ state: 'visible', timeout: 5_000 })

  let actionFailure: unknown = null
  const activeAndroidAction = platform === 'android'
    ? viewer.service.action({
        kind: 'swipe',
        startX: Math.floor(first.viewport.width / 2),
        startY: Math.floor(first.viewport.height * 0.72),
        endX: Math.floor(first.viewport.width / 2),
        endY: Math.floor(first.viewport.height * 0.36),
        durationMs: 500,
        observationId: first.observationId,
        coordinateSpace: 'viewport',
      }).catch((error: unknown) => {
        actionFailure = error
      })
    : null
  await page.waitForTimeout(10_000)

  const browserMetrics = await page.evaluate(() => {
    const mediaWindow = window as Window & { __mobileMirrorMediaMetrics?: { snapshot(): Record<string, unknown> } }
    return mediaWindow.__mobileMirrorMediaMetrics?.snapshot() ?? null
  })
  const relayMetrics = viewer.mediaDiagnostics()
  validatePerformance(platform, browserMetrics, relayMetrics)

  if (activeAndroidAction) {
    await activeAndroidAction
    if (actionFailure) throw actionFailure
  } else {
    await viewer.service.action({
      kind: 'swipe',
      startX: Math.floor(first.viewport.width / 2),
      startY: Math.floor(first.viewport.height * 0.72),
      endX: Math.floor(first.viewport.width / 2),
      endY: Math.floor(first.viewport.height * 0.36),
      durationMs: 500,
      observationId: first.observationId,
      coordinateSpace: 'viewport',
    })
  }
  const second = await viewer.service.observe({ image: true, structure: true })
  assertObservation(second)
  if (second.frameRevision <= first.frameRevision || second.screenEpoch <= first.screenEpoch) {
    throw new Error('Fresh observation did not advance while media was live')
  }
  const afterControlMetrics = await page.evaluate(() => {
    const mediaWindow = window as Window & { __mobileMirrorMediaMetrics?: { snapshot(): Record<string, unknown> } }
    return mediaWindow.__mobileMirrorMediaMetrics?.snapshot() ?? null
  })
  if (!afterControlMetrics || afterControlMetrics.mediaVisible !== true) {
    throw new Error('Viewer media did not remain visible during Appium action and fresh observation')
  }
  await page.screenshot({ path: screenshotPath, fullPage: true })
  if (platform === 'android' && androidDynamicScreen === 'stopwatch') {
    await tapLabeledControl(viewer, second, /^(暂停|停止|Pause|Stop)$/i)
  }

  if (!generation) throw new Error('Viewer did not expose an opaque media generation')
  const fallbackStartedAt = Date.now()
  const accepted = await viewer.service.reportMediaClientFailure(generation, 'render-failed')
  if (!accepted) throw new Error('Current media generation interruption was not accepted')
  await page.locator('#device-frame').waitFor({ state: 'visible', timeout: 2_000 })
  const fallbackMs = Date.now() - fallbackStartedAt

  const finalState = await viewer.service.stop()
  stopped = finalState.lifecycle === 'idle'
  if (!stopped) throw new Error('Owned Appium session did not return to idle')
  const evidence = {
    platform,
    durationMs: 10_000,
    browser: browserMetrics,
    relay: relayMetrics,
    mediaVisibleAfterControl: true,
    fallbackMs,
    firstRevision: first.frameRevision,
    finalRevision: second.frameRevision,
    firstEpoch: first.screenEpoch,
    finalEpoch: second.screenEpoch,
    viewport: second.viewport,
    orientation: second.orientation,
    structureNodes: second.structure!.nodes.length,
    ownedSessionCleaned: true,
    screenshot: relative(process.cwd(), screenshotPath),
  }
  await writeFile(metricsPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
} catch (error) {
  let retainedScreenshot: string | null = relative(process.cwd(), failureScreenshotPath)
  try {
    await page.screenshot({ path: failureScreenshotPath, fullPage: true })
  } catch {
    retainedScreenshot = null
  }
  const browserMetrics = await page.evaluate(() => {
    const mediaWindow = window as Window & { __mobileMirrorMediaMetrics?: { snapshot(): Record<string, unknown> } }
    return mediaWindow.__mobileMirrorMediaMetrics?.snapshot() ?? null
  }).catch(() => null)
  const state = viewer.service.state()
  const failureEvidence = {
    platform,
    browser: browserMetrics,
    relay: viewer.mediaDiagnostics(),
    lifecycle: state.lifecycle,
    media: state.media,
    ownedSessionCleaned: false,
    screenshot: retainedScreenshot,
  }
  await writeFile(failureMetricsPath, `${JSON.stringify(failureEvidence, null, 2)}\n`, { mode: 0o600 })
  process.stderr.write(`${JSON.stringify(failureEvidence, null, 2)}\n`)
  throw error
} finally {
  if (!stopped) await viewer.service.stop().catch(() => undefined)
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await viewer.close().catch(() => undefined)
}

function capabilities(target: 'android' | 'ios', udid: string): Record<string, unknown> {
  if (target === 'android') {
    const appPackage = process.env.MOBILE_MIRROR_ANDROID_APP_PACKAGE ?? 'com.android.settings'
    const appActivity = process.env.MOBILE_MIRROR_ANDROID_APP_ACTIVITY ?? '.Settings'
    return {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Android',
      'appium:udid': udid,
      'appium:appPackage': appPackage,
      'appium:appActivity': appActivity,
      'appium:noReset': true,
      'appium:forceAppLaunch': true,
      'appium:settings': { waitForIdleTimeout: androidDynamicScreen === 'stopwatch' ? 0 : 1_000 },
    }
  }
  const value: Record<string, unknown> = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': 'iPhone',
    'appium:udid': udid,
    'appium:bundleId': 'com.apple.Preferences',
    'appium:noReset': true,
  }
  for (const [environment, key] of [
    ['MOBILE_MIRROR_IOS_TEAM_ID', 'appium:xcodeOrgId'],
    ['MOBILE_MIRROR_IOS_SIGNING_ID', 'appium:xcodeSigningId'],
    ['MOBILE_MIRROR_IOS_WDA_BUNDLE_ID', 'appium:updatedWDABundleId'],
    ['MOBILE_MIRROR_IOS_XCCONFIG', 'appium:xcodeConfigFile'],
  ] as const) {
    const configured = process.env[environment]
    if (configured) value[key] = configured
  }
  return value
}

function validatePerformance(
  target: 'android' | 'ios',
  browserMetrics: Record<string, unknown> | null,
  relay: ReturnType<ViewerServer['mediaDiagnostics']>,
): void {
  if (!browserMetrics || browserMetrics.mediaVisible !== true) throw new Error('Viewer did not retain a visible media frame')
  const firstFrameMs = relay.firstFrameAt !== null && relay.streamStartedAt !== null
    ? relay.firstFrameAt - relay.streamStartedAt
    : Number.POSITIVE_INFINITY
  if (firstFrameMs > 5_000) throw new Error('Media first frame exceeded 5 seconds')
  if (target === 'ios') {
    if ((relay.relayFps ?? 0) < 8) throw new Error('iOS MJPEG relay stayed below 8 fps')
    return
  }
  const firstPaintMs = browserMetrics.firstPaintMs
  const paintedFps = browserMetrics.paintedFps
  const p95 = browserMetrics.receiveToPaintP95Ms
  if (typeof firstPaintMs !== 'number' || firstPaintMs > 5_000) throw new Error('Android first paint exceeded 5 seconds')
  if (typeof paintedFps !== 'number' || paintedFps < 15) throw new Error('Android painted frame rate stayed below 15 fps')
  if (typeof p95 !== 'number' || p95 > 100) throw new Error('Android receive-to-paint p95 exceeded 100 ms')
}

function assertObservation(observation: Awaited<ReturnType<ViewerServer['service']['observe']>>): void {
  if (!observation.image || observation.image.bytes.byteLength < 24) throw new Error('Fresh observation returned no PNG')
  if (!observation.structure || observation.structure.nodes.length === 0) throw new Error('Fresh observation returned no structure')
}

async function tapLabeledControl(
  server: ViewerServer,
  observation: Awaited<ReturnType<ViewerServer['service']['observe']>>,
  label: RegExp,
): Promise<void> {
  const candidates = observation.structure?.nodes.filter((node) => {
    const text = [node.name, node.text, node.value].filter(Boolean).join(' ')
    return node.bounds && label.test(text)
  }) ?? []
  const node = candidates.find((candidate) => candidate.actionable) ?? candidates[0]
  if (!node?.bounds) throw new Error('Required dynamic-screen control was not found')
  await server.service.action({
    kind: 'tap',
    x: node.bounds.x + Math.floor(node.bounds.width / 2),
    y: node.bounds.y + Math.floor(node.bounds.height / 2),
    observationId: observation.observationId,
    coordinateSpace: 'viewport',
  })
}

function validatedEvidencePath(value: string | undefined, fallback: string, root: string): string {
  const rootPath = resolve(root)
  const path = resolve(value ?? fallback)
  if (!path.startsWith(`${rootPath}/`)) throw new Error(`Evidence path must be inside ${root}`)
  return path
}
