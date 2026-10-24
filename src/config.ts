import Schema from '@deepseek-ai/schemastery'
import type {
  AgentAppControlPolicy,
  AgentScreenContentPolicy,
  AgentTextInputPolicy,
  AppiumRuntimeMode,
  ProviderKind,
  ViewerMediaMode,
} from './types.js'

export interface AgentTestControlConfig {
  enabled: boolean
  projectPath: string
  allowedFlows: string[]
  allowedSuites: string[]
  allowedPlatforms: Array<'android' | 'ios'>
  allowedAppIds: string[]
  sharedEvidence: Array<'flow' | 'plan' | 'extension' | 'executor-log' | 'xml' | 'image'>
}

export interface Config {
  defaultProvider: ProviderKind
  agentScreenContentPolicy: AgentScreenContentPolicy
  agentTextInputPolicy: AgentTextInputPolicy
  agentAppControlPolicy: AgentAppControlPolicy
  agentAllowedAppIds: string[]
  appiumUrl: string
  appiumRuntimeMode: AppiumRuntimeMode
  appiumExecutablePath: string
  viewerHost: '127.0.0.1' | 'localhost' | '::1'
  viewerPort: number
  frameIntervalMs: number
  viewerMediaMode: ViewerMediaMode
  androidScrcpyPath: string
  androidScrcpyServerPath: string
  androidScrcpyMaxSize: number
  androidScrcpyMaxFps: number
  androidScrcpyVideoBitRate: number
  iosMjpegPort: number
  iosMjpegFramerate: number
  iosMjpegScalingFactor: number
  iosMjpegScreenshotQuality: number
  startupTimeoutMs: number
  appiumSessionStartupTimeoutMs: number
  mockStartupDelayMs: number
  allowHostDeviceDiscovery: boolean
  adbPath: string
  xcrunPath: string
  androidIgnoreHiddenApiPolicyError: boolean
  iosWdaXcodeOrgId: string
  iosWdaXcodeSigningId: string
  iosWdaUpdatedBundleId: string
  iosWdaXcodeConfigFile: string
  iosWdaAllowProvisioningDeviceRegistration: boolean
  allowHostSigningDiagnostics: boolean
  agentTestControl?: AgentTestControlConfig
  repairToolsEnabled?: boolean
}

export const DISABLED_AGENT_TEST_CONTROL: AgentTestControlConfig = {
  enabled: false, projectPath: '', allowedFlows: [], allowedSuites: [], allowedPlatforms: [], allowedAppIds: [], sharedEvidence: [],
}

export interface AndroidAppiumDefaults {
  ignoreHiddenApiPolicyError: boolean
}

export interface IosWdaDefaults {
  xcodeOrgId: string
  xcodeSigningId: string
  updatedBundleId: string
  xcodeConfigFile: string
  allowProvisioningDeviceRegistration: boolean
}

export interface ViewerMediaConfig {
  mode: ViewerMediaMode
  android: {
    scrcpyPath: string
    scrcpyServerPath: string
    maxSize: number
    maxFps: number
    videoBitRate: number
  }
  ios: {
    port: number
    framerate: number
    scalingFactor: number
    screenshotQuality: number
  }
}

export const Config: Schema<Config> = Schema.object({
  defaultProvider: Schema.union(['mock', 'appium']).default('mock'),
  agentScreenContentPolicy: Schema.union(['mock-only', 'structure', 'image-and-structure']).default('mock-only').description('Controls agent access to device screen content. Mock is always allowed. Appium structure requires "structure" or "image-and-structure"; Appium PNG sharing requires "image-and-structure" and persists through the DSH attachment lifecycle.'),
  agentTextInputPolicy: Schema.union(['mock-only', 'non-sensitive']).default('mock-only').description('Allow bounded ordinary text input only for Mock, or explicitly for verified non-sensitive Appium inputs. Never use for secrets.'),
  agentAppControlPolicy: Schema.union(['disabled', 'session-app', 'allowlist']).default('disabled').description('Authorize activate/terminate for no apps, the owned session target, or exact allowed app ids.'),
  agentAllowedAppIds: Schema.transform(
    Schema.array(Schema.string().pattern(/^[A-Za-z0-9._-]{1,255}$/)).max(32),
    (ids) => {
      if (new Set(ids).size !== ids.length) throw new TypeError('Agent app allowlist contains duplicate ids')
      return ids
    },
  ).default([]).description('Exact case-sensitive app ids for allowlist mode; no globs, URLs, paths, whitespace or controls.'),
  appiumUrl: Schema.string().default('http://127.0.0.1:4723'),
  appiumRuntimeMode: Schema.union(['external', 'managed']).default('external').description('Use an existing Appium server, or lazily start the explicitly configured loopback executable.'),
  appiumExecutablePath: Schema.string().pattern(/^(?:$|\/)/).default('').description('Explicit absolute Appium executable for managed mode. Empty keeps managed startup disabled.'),
  viewerHost: Schema.union(['127.0.0.1', 'localhost', '::1']).default('127.0.0.1'),
  viewerPort: Schema.number().step(1).min(0).max(65_535).default(3210),
  frameIntervalMs: Schema.number().step(1).min(250).max(10_000).default(750),
  viewerMediaMode: Schema.union(['auto', 'polling']).default('auto').description('Use low-latency Viewer media when safely available, or keep screenshot polling only.'),
  androidScrcpyPath: Schema.string().pattern(/^(?:$|\/)/).default('').description('Explicit absolute path to the trusted scrcpy 4.1 executable. Empty disables Android low-latency media.'),
  androidScrcpyServerPath: Schema.string().pattern(/^(?:$|\/)/).default('').description('Optional absolute scrcpy-server 4.1 path for non-standard installations.'),
  androidScrcpyMaxSize: Schema.number().step(1).min(256).max(4096).default(1280),
  androidScrcpyMaxFps: Schema.number().step(1).min(1).max(120).default(30),
  androidScrcpyVideoBitRate: Schema.number().step(1).min(100_000).max(50_000_000).default(4_000_000),
  iosMjpegPort: Schema.union([
    Schema.const(0),
    Schema.number().step(1).min(1024).max(65_535),
  ]).default(0).description('WDA MJPEG port for new owned iOS sessions. Zero safely probes the WDA default port 9100 and falls back to screenshots if unavailable.'),
  iosMjpegFramerate: Schema.number().step(1).min(1).max(60).default(15),
  iosMjpegScalingFactor: Schema.number().step(1).min(1).max(100).default(50),
  iosMjpegScreenshotQuality: Schema.number().step(1).min(1).max(100).default(40),
  startupTimeoutMs: Schema.number().step(1).min(1_000).max(300_000).default(30_000),
  appiumSessionStartupTimeoutMs: Schema.number().step(1).min(1_000).max(300_000).default(120_000).description('Timeout for creating a physical-device Appium session, including a cold WDA start. Managed server readiness and initial frames keep startupTimeoutMs.'),
  mockStartupDelayMs: Schema.number().step(1).min(0).max(10_000).default(700),
  allowHostDeviceDiscovery: Schema.boolean().default(false),
  adbPath: Schema.string().default('adb'),
  xcrunPath: Schema.string().default('xcrun'),
  androidIgnoreHiddenApiPolicyError: Schema.boolean().default(true).description('Allow Android UiAutomator2 startup to continue when an OEM denies hidden API policy changes. Disable for strict failure; continuing may expose later driver incompatibilities.'),
  iosWdaXcodeOrgId: Schema.string().default('').description('Apple Developer Team ID for new iOS WDA sessions. Keep this value in a personal DSH profile.'),
  iosWdaXcodeSigningId: Schema.string().default('Apple Development').description('Xcode signing identity label used for new iOS WDA sessions.'),
  iosWdaUpdatedBundleId: Schema.string().default('').description('Unique WebDriverAgent bundle identifier for new iOS sessions. Keep this value in a personal DSH profile.'),
  iosWdaXcodeConfigFile: Schema.string().default('').description('Optional local xcconfig path for WDA signing. Do not commit machine-specific paths.'),
  iosWdaAllowProvisioningDeviceRegistration: Schema.boolean().default(false).description('Explicitly allow Xcode to update provisioning and register the device in Apple Developer. This may change external account state.'),
  allowHostSigningDiagnostics: Schema.boolean().default(false).description('Allow read-only local Xcode, Appium, device, signing identity, and provisioning profile diagnostics.'),
  agentTestControl: Schema.object({
    enabled: Schema.boolean().default(false),
    projectPath: Schema.string().pattern(/^(?:$|\/)/).default('').description('Explicit absolute registered test-project path. Empty keeps Agent test execution disabled.'),
    allowedFlows: uniqueNames().default([]),
    allowedSuites: uniqueNames().default([]),
    allowedPlatforms: uniqueValues(Schema.union(['android', 'ios'])).default([]),
    allowedAppIds: uniqueValues(Schema.string().pattern(/^[A-Za-z0-9._-]{1,255}$/)).max(32).default([]),
    sharedEvidence: uniqueValues(Schema.union(['flow', 'plan', 'extension', 'executor-log', 'xml', 'image'])).default([]),
  }).default({
    enabled: false,
    projectPath: '',
    allowedFlows: [],
    allowedSuites: [],
    allowedPlatforms: [],
    allowedAppIds: [],
    sharedEvidence: [],
  }).description('Opt-in registered test execution and evidence-sharing policy for Agent tools.'),
  repairToolsEnabled: Schema.boolean().default(false).description('Expose five repair tools only by explicit local opt-in; project repair permissions remain an independent runtime gate.'),
})

function uniqueNames() {
  return uniqueValues(Schema.string().pattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)).max(100)
}

function uniqueValues<T>(item: Schema<T>): Schema<T[]> {
  return Schema.transform(Schema.array(item), (values) => {
    if (new Set(values).size !== values.length) throw new TypeError('Agent test control list contains duplicate values')
    return values
  })
}

export function assertAppiumRuntimeConfig(config: Config): Config {
  if (config.agentTestControl?.enabled && !config.agentTestControl.projectPath.startsWith('/')) {
    throw new TypeError('Agent test control requires an absolute project path')
  }
  if (config.repairToolsEnabled && !config.agentTestControl?.projectPath.startsWith('/'))
    throw new TypeError('Repair tools require an absolute trusted test project path')
  if (config.appiumRuntimeMode === 'external') return config
  if (!config.appiumExecutablePath.startsWith('/')) throw new TypeError('Managed Appium configuration is invalid')
  let url: URL
  try {
    url = new URL(config.appiumUrl)
  } catch {
    throw new TypeError('Managed Appium configuration is invalid')
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Managed Appium configuration is invalid')
  }
  return config
}

export function androidAppiumDefaultsFromConfig(config: Config): AndroidAppiumDefaults {
  return {
    ignoreHiddenApiPolicyError: config.androidIgnoreHiddenApiPolicyError,
  }
}

export function iosWdaDefaultsFromConfig(config: Config): IosWdaDefaults {
  return {
    xcodeOrgId: config.iosWdaXcodeOrgId,
    xcodeSigningId: config.iosWdaXcodeSigningId,
    updatedBundleId: config.iosWdaUpdatedBundleId,
    xcodeConfigFile: config.iosWdaXcodeConfigFile,
    allowProvisioningDeviceRegistration: config.iosWdaAllowProvisioningDeviceRegistration,
  }
}

export function viewerMediaConfigFromConfig(config: Config): ViewerMediaConfig {
  return {
    mode: config.viewerMediaMode,
    android: {
      scrcpyPath: config.androidScrcpyPath,
      scrcpyServerPath: config.androidScrcpyServerPath,
      maxSize: config.androidScrcpyMaxSize,
      maxFps: config.androidScrcpyMaxFps,
      videoBitRate: config.androidScrcpyVideoBitRate,
    },
    ios: {
      port: config.iosMjpegPort,
      framerate: config.iosMjpegFramerate,
      scalingFactor: config.iosMjpegScalingFactor,
      screenshotQuality: config.iosMjpegScreenshotQuality,
    },
  }
}
