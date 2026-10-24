import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { access, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Config } from './config.js'
import { NodeHostCommandRunner, type HostCommandResult, type HostCommandRunner } from './host-command-runner.js'
import {
  IosWdaPreflightService,
  ViewerHostDiagnosticsGrant,
  type IosWdaPreflightResult,
} from './ios-wda-preflight.js'
import type { ArmableAppiumRuntimeLifecycle } from './managed-appium-runtime.js'
import { parseManagedTarget } from './managed-appium-runtime.js'
import type { MirrorService } from './mirror-service.js'
import type { MirrorState } from './types.js'
import { normalizePreflight, planEnvironmentChecks, featurePolicySchema, type FeaturePolicy } from './environment-preflight.js'
import { checkScrcpy } from './preflight-media.js'
import { BoundedPreflightRunner, readHostPrerequisite } from './preflight-host-checks.js'

export type ConnectionAssistantPlatform = 'android' | 'ios'
export type ConnectionAssistantDeviceKind = 'physical' | 'simulator'
export type ConnectionAssistantRuntimeChoice = 'configured' | 'managed-once'
export type ConnectionAssistantTargetPreset = 'android-current-screen' | 'ios-current-screen' | 'android-settings' | 'ios-settings'
export type ConnectionAssistantStatus = 'ready' | 'action-required' | 'blocked'
export type ConnectionAssistantCheckStatus = 'pass' | 'warning' | 'blocked' | 'manual'

export type ConnectionAssistantErrorCode =
  | 'assistant_origin_required'
  | 'assistant_platform_unsupported'
  | 'assistant_check_timeout'
  | 'assistant_appium_unavailable'
  | 'assistant_uiautomator2_unavailable'
  | 'assistant_xcuitest_unavailable'
  | 'assistant_adb_unavailable'
  | 'assistant_android_device_unauthorized'
  | 'assistant_android_device_unavailable'
  | 'assistant_android_settings_unresolved'
  | 'assistant_android_helper_confirmation_required'
  | 'assistant_ios_device_unavailable'
  | 'assistant_signing_incomplete'
  | 'assistant_context_stale'
  | 'assistant_context_consumed'
  | 'assistant_input_invalid'
  | 'assistant_managed_start_not_confirmed'
  | 'assistant_persistence_unavailable'
  | 'assistant_persistence_failed'

const ERROR_MESSAGES: Record<ConnectionAssistantErrorCode, string> = {
  assistant_origin_required: 'A matching Viewer origin is required',
  assistant_platform_unsupported: 'This platform or target is not supported by the connection assistant',
  assistant_check_timeout: 'A local readiness check timed out',
  assistant_appium_unavailable: 'A working Appium executable and endpoint are required',
  assistant_uiautomator2_unavailable: 'The Appium UiAutomator2 driver is unavailable',
  assistant_xcuitest_unavailable: 'The Appium XCUITest driver is unavailable',
  assistant_adb_unavailable: 'A working ADB executable is required',
  assistant_android_device_unauthorized: 'Authorize the USB Android device and retry',
  assistant_android_device_unavailable: 'Connect an unlocked USB Android device and retry',
  assistant_android_settings_unresolved: 'The Android Settings activity could not be resolved safely',
  assistant_android_helper_confirmation_required: 'Confirm the UiAutomator2 helper APK side effect before connecting',
  assistant_ios_device_unavailable: 'Connect, unlock, and trust a physical iPhone before retrying',
  assistant_signing_incomplete: 'Complete the iOS WDA signing prerequisites and retry',
  assistant_context_stale: 'The connection check expired or is no longer available',
  assistant_context_consumed: 'The connection check was already used',
  assistant_input_invalid: 'The connection assistant request is invalid',
  assistant_managed_start_not_confirmed: 'Confirm the one-shot managed Appium start before connecting',
  assistant_persistence_unavailable: 'Local Viewer setup cannot be saved in this runtime',
  assistant_persistence_failed: 'Local Viewer setup could not be saved safely',
}

export class ConnectionAssistantError extends Error {
  readonly code: ConnectionAssistantErrorCode

  constructor(code: ConnectionAssistantErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'ConnectionAssistantError'
    this.code = code
  }
}

export interface ConnectionAssistantCheck {
  id: 'appium-endpoint' | 'appium-cli' | 'appium-driver' | 'adb' | 'device' | 'settings-target' | 'scrcpy' | 'xcode' | 'wda-signing' | 'xcode-account' | 'wda-runtime'
  status: ConnectionAssistantCheckStatus
  code: string
  action: string
  version?: string
  count?: number
}

export interface ConnectionAssistantDevice {
  deviceRef: string
  label: string
  platform: ConnectionAssistantPlatform
  deviceKind?: ConnectionAssistantDeviceKind
  osVersion?: string
  settingsAvailable?: boolean
}

export type ConnectionAssistantConfirmation =
  | 'android-unlocked'
  | 'usb-debugging'
  | 'adb-authorized'
  | 'uiautomator2-helper-apk'
  | 'device-trust'
  | 'developer-mode'
  | 'ui-automation'

export interface ConnectionAssistantReport {
  schemaVersion: 1
  assistantId: string
  platform: ConnectionAssistantPlatform
  status: ConnectionAssistantStatus
  checkedAt: string
  expiresAt: string
  checks: ConnectionAssistantCheck[]
  devices: ConnectionAssistantDevice[]
  runtimeChoices: ConnectionAssistantRuntimeChoice[]
  signing?: {
    profileDefaultsReady: boolean
    requiredInputs: Array<'team-id' | 'wda-bundle-id'>
  }
  confirmations: ConnectionAssistantConfirmation[]
  media: { mode: 'polling' | 'scrcpy-available'; code: string }
}

export interface ConnectionAssistantCheckInput {
  platform: ConnectionAssistantPlatform
  deviceKind?: ConnectionAssistantDeviceKind
  media?: FeaturePolicy
}

export interface ConnectionAssistantSigningInput {
  teamId: string
  wdaBundleId: string
}

export interface ConnectionAssistantConnectInput {
  assistantId: string
  deviceRef: string
  targetPreset: ConnectionAssistantTargetPreset
  runtime: ConnectionAssistantRuntimeChoice
  confirmHelperApkSideEffect?: boolean
  signing?: ConnectionAssistantSigningInput
  rememberOnThisMac?: boolean
}

export interface ConnectionAssistantPersistedSetup {
  platform: ConnectionAssistantPlatform
  appiumExecutablePath: string
  signing?: ConnectionAssistantSigningInput
}

export interface ConnectionAssistantCancelInput {
  assistantId: string
}

export interface ConnectionAssistantApi {
  check(input: ConnectionAssistantCheckInput, signal?: AbortSignal): Promise<ConnectionAssistantReport>
  connect(input: ConnectionAssistantConnectInput, signal?: AbortSignal): Promise<MirrorState>
  cancel(input: ConnectionAssistantCancelInput): { cancelled: true }
  dispose(): void
}

interface AppiumCandidate {
  path: string
  managedExecutablePath: string | null
  fingerprint: string
  version: string
  drivers: Map<string, string>
  configured: boolean
}

export interface AndroidDeviceSecret {
  platform: 'android'
  deviceKind?: ConnectionAssistantDeviceKind
  serial: string
  platformVersion?: string
  settingsActivity: string | null
}

export interface IosDeviceSecret {
  platform: 'ios'
  deviceKind?: ConnectionAssistantDeviceKind
  udid: string
  platformVersion?: string
}

export type DeviceSecret = AndroidDeviceSecret | IosDeviceSecret

export interface DeviceCandidate {
  secret: DeviceSecret
  osVersion?: string
}

interface StrategyCheckResult {
  checks: ConnectionAssistantCheck[]
  devices: DeviceCandidate[]
  confirmations: ConnectionAssistantConfirmation[]
  media: ConnectionAssistantReport['media']
  blocked: boolean
  actionRequired: boolean
  requiredSigningInputs: Array<'team-id' | 'wda-bundle-id'>
}

export interface StoredAssistantContext {
  platform: ConnectionAssistantPlatform
  media?: FeaturePolicy
  expiresAt: number
  status: ConnectionAssistantStatus
  runtimeChoices: ConnectionAssistantRuntimeChoice[]
  requiredSigningInputs: Array<'team-id' | 'wda-bundle-id'>
  appiumFingerprint: string
  devices: Map<string, DeviceSecret>
}

export interface CreatedAssistantContext {
  assistantId: string
  expiresAt: number
  devices: ConnectionAssistantDevice[]
}

export interface ConsumedAssistantContext {
  context: StoredAssistantContext
  device: DeviceSecret
}

export interface ConnectionAssistantRegistryOptions {
  now?: () => number
  tokenBytes?: () => Uint8Array
  ttlMs?: number
  maxContexts?: number
}

export class ConnectionAssistantRegistry {
  readonly #now: () => number
  readonly #tokenBytes: () => Uint8Array
  readonly #ttlMs: number
  readonly #maxContexts: number
  readonly #contexts = new Map<string, StoredAssistantContext>()
  readonly #consumed = new Map<string, number>()

  constructor(options: ConnectionAssistantRegistryOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#tokenBytes = options.tokenBytes ?? (() => randomBytes(16))
    this.#ttlMs = options.ttlMs ?? 120_000
    this.#maxContexts = options.maxContexts ?? 8
  }

  create(input: Omit<StoredAssistantContext, 'expiresAt' | 'devices'> & { devices: DeviceCandidate[] }): CreatedAssistantContext {
    this.#prune()
    while (this.#contexts.size >= this.#maxContexts) {
      const oldest = this.#contexts.keys().next().value as string | undefined
      if (!oldest) break
      this.#contexts.delete(oldest)
    }
    const assistantId = this.#token()
    const expiresAt = this.#now() + this.#ttlMs
    const devices = new Map<string, DeviceSecret>()
    const publicDevices = input.devices.map((candidate, index) => {
      const deviceRef = this.#token()
      devices.set(hashToken(deviceRef), candidate.secret)
      return {
        deviceRef,
        label: `${candidate.secret.platform === 'android' ? 'Android' : 'iPhone'}${candidate.secret.deviceKind === 'simulator' ? ' Simulator' : ''} ${index + 1}`,
        platform: candidate.secret.platform,
        deviceKind: candidate.secret.deviceKind ?? 'physical',
        settingsAvailable: candidate.secret.platform === 'ios' || candidate.secret.settingsActivity !== null,
        ...(candidate.osVersion ? { osVersion: candidate.osVersion } : {}),
      }
    })
    this.#contexts.set(hashToken(assistantId), {
      platform: input.platform,
      media: input.media ?? 'off',
      expiresAt,
      status: input.status,
      runtimeChoices: [...input.runtimeChoices],
      requiredSigningInputs: [...input.requiredSigningInputs],
      appiumFingerprint: input.appiumFingerprint,
      devices,
    })
    return { assistantId, expiresAt, devices: publicDevices }
  }

  inspect(assistantId: string, deviceRef: string): ConsumedAssistantContext {
    this.#prune()
    const assistantHash = hashToken(assistantId)
    if (findHashKey(this.#consumed, assistantHash)) throw assistantError('assistant_context_consumed')
    const contextKey = findHashKey(this.#contexts, assistantHash)
    const context = contextKey ? this.#contexts.get(contextKey) : undefined
    if (!context) throw assistantError('assistant_context_stale')
    const deviceHash = findHashKey(context.devices, hashToken(deviceRef))
    const device = deviceHash ? context.devices.get(deviceHash) : undefined
    if (!device) throw assistantError('assistant_context_stale')
    return { context, device }
  }

  consume(assistantId: string, deviceRef: string): ConsumedAssistantContext {
    const inspected = this.inspect(assistantId, deviceRef)
    const assistantHash = hashToken(assistantId)
    const contextKey = findHashKey(this.#contexts, assistantHash)
    if (!contextKey) throw assistantError('assistant_context_stale')
    this.#contexts.delete(contextKey)
    this.#consumed.set(assistantHash, inspected.context.expiresAt)
    return inspected
  }

  cancel(assistantId: string): { cancelled: true } {
    this.#prune()
    const assistantHash = hashToken(assistantId)
    if (findHashKey(this.#consumed, assistantHash)) throw assistantError('assistant_context_consumed')
    const contextKey = findHashKey(this.#contexts, assistantHash)
    if (!contextKey || !this.#contexts.delete(contextKey)) throw assistantError('assistant_context_stale')
    return { cancelled: true }
  }

  clear(): void {
    this.#contexts.clear()
    this.#consumed.clear()
  }

  #token(): string {
    const bytes = this.#tokenBytes()
    if (bytes.byteLength < 16) throw new Error('Connection assistant tokens require at least 128 bits')
    return Buffer.from(bytes).toString('base64url')
  }

  #prune(): void {
    const now = this.#now()
    for (const [key, context] of this.#contexts) {
      if (context.expiresAt <= now) this.#contexts.delete(key)
    }
    for (const [key, expiresAt] of this.#consumed) {
      if (expiresAt <= now) this.#consumed.delete(key)
    }
  }
}

export interface DeviceConnectionStrategy {
  readonly platform: ConnectionAssistantPlatform
  check(appiumExecutablePath: string | null, signal?: AbortSignal, media?: FeaturePolicy, deviceKind?: ConnectionAssistantDeviceKind): Promise<StrategyCheckResult>
  validateConnect(input: ConnectionAssistantConnectInput, device: DeviceSecret, appiumExecutablePath: string, expiresAt: number, signal?: AbortSignal): Promise<void>
  buildCapabilities(input: ConnectionAssistantConnectInput, device: DeviceSecret): Record<string, unknown>
}

export interface StrategyOptions {
  runner: HostCommandRunner
  executableAccess: (path: string) => Promise<void>
  resolvePath: (path: string) => Promise<string>
  now: () => number
}

export class AndroidConnectionStrategy implements DeviceConnectionStrategy {
  readonly platform = 'android' as const
  readonly #config: Config
  readonly #runner: HostCommandRunner
  readonly #executableAccess: (path: string) => Promise<void>
  readonly #resolvePath: (path: string) => Promise<string>

  constructor(config: Config, options: StrategyOptions) {
    this.#config = config
    this.#runner = options.runner
    this.#executableAccess = options.executableAccess
    this.#resolvePath = options.resolvePath
  }

  async check(_appiumExecutablePath: string | null, signal?: AbortSignal, mediaPolicy: FeaturePolicy = 'off', deviceKind: ConnectionAssistantDeviceKind = 'physical'): Promise<StrategyCheckResult> {
    const adbPath = await resolveExecutable(this.#config.adbPath, this.#runner, this.#executableAccess, this.#resolvePath, signal)
    if (!adbPath) return {
      checks: [assistantCheck('adb', 'blocked', 'assistant_adb_unavailable', 'Configure a working ADB executable and retry.')],
      devices: [],
      confirmations: deviceKind === 'simulator' ? ['uiautomator2-helper-apk'] : ['android-unlocked', 'usb-debugging', 'adb-authorized', 'uiautomator2-helper-apk'],
      media: { mode: 'polling', code: 'assistant_scrcpy_not_configured' },
      blocked: true,
      actionRequired: true,
      requiredSigningInputs: [],
    }

    const [adbVersion, adbDevices, media] = await Promise.all([
      readHostPrerequisite(this.#runner, 'adb-version', adbPath, signal),
      readHostPrerequisite(this.#runner, 'adb-usb-devices', adbPath, signal),
      mediaPolicy === 'off' ? Promise.resolve(null) : this.#checkScrcpy(signal),
    ])
    const parsed = parseAdbDeviceRows(adbDevices)
    const candidates = deviceKind === 'simulator' ? parsed.emulatorReady : parsed.usbReady
    const devices = await Promise.all(candidates.slice(0, 8).map(async (device): Promise<DeviceCandidate> => {
      const [version, settings] = await Promise.all([
        this.#runner.run(adbPath, ['-s', device.serial, 'shell', 'getprop', 'ro.build.version.release'], { signal, timeoutMs: 5_000 }),
        this.#runner.run(adbPath, ['-s', device.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.settings.SETTINGS'], { signal, timeoutMs: 5_000 }),
      ])
      const activity = parseAndroidSettingsActivity(settings)
      const platformVersion = safeVersion(version.stdout)
      const secret: AndroidDeviceSecret = {
        platform: 'android',
        deviceKind,
        serial: device.serial,
        settingsActivity: activity,
        ...(platformVersion ? { platformVersion } : {}),
      }
      return { secret, ...(platformVersion ? { osVersion: platformVersion } : {}) } satisfies DeviceCandidate
    }))
    const allSettingsReady = devices.length > 0 && devices.every(({ secret }) => secret.platform === 'android' && secret.settingsActivity !== null)
    const adbReady = adbVersion.ok && adbDevices.ok
    const adbTimedOut = adbVersion.timedOut || adbDevices.timedOut
    const deviceCode = devices.length > 0
      ? 'assistant_android_device_ready'
      : deviceKind === 'simulator' ? 'assistant_simulator_unavailable' : parsed.unauthorized > 0
        ? 'assistant_android_device_unauthorized'
        : 'assistant_android_device_unavailable'
    const deviceAction = devices.length > 0
      ? 'A USB Android device is authorized.'
      : parsed.unauthorized > 0
        ? 'Unlock the device and accept its USB debugging authorization prompt.'
        : 'Connect an unlocked USB Android device and authorize USB debugging.'
    return {
      checks: [
        assistantCheck('adb', adbReady ? 'pass' : 'blocked', adbReady ? 'assistant_adb_ready' : adbTimedOut ? 'assistant_check_timeout' : 'assistant_adb_unavailable', adbReady ? 'ADB is available.' : adbTimedOut ? 'ADB did not respond before the local timeout; retry after checking the USB connection.' : 'Configure a working ADB executable and retry.', safeVersion(adbVersion.stdout) ?? undefined),
        assistantCheck('device', devices.length > 0 ? 'pass' : 'blocked', deviceKind === 'simulator' && devices.length > 0 ? 'assistant_simulator_ready' : deviceCode, deviceKind === 'simulator' ? devices.length > 0 ? 'A running Android emulator is available.' : 'Start an Android emulator in Android Studio, then check again.' : deviceAction, undefined, devices.length),
        assistantCheck('settings-target', allSettingsReady ? 'pass' : 'warning', allSettingsReady ? 'assistant_android_settings_ready' : 'assistant_android_settings_unresolved', allSettingsReady ? 'Android Settings is available.' : 'Settings is unavailable on some devices; current-screen connections remain available.'),
        ...(media ? [{ ...media.check, status: mediaPolicy === 'required' && media.check.status !== 'pass' ? 'blocked' as const : media.check.status }] : []),
      ],
      devices,
      confirmations: deviceKind === 'simulator' ? ['uiautomator2-helper-apk'] : ['android-unlocked', 'usb-debugging', 'adb-authorized', 'uiautomator2-helper-apk'],
      media: media?.media ?? { mode: 'polling', code: 'assistant_media_not_selected' },
      blocked: !adbReady || devices.length === 0 || mediaPolicy === 'required' && media?.check.status !== 'pass',
      actionRequired: true,
      requiredSigningInputs: [],
    }
  }

  async validateConnect(input: ConnectionAssistantConnectInput, device: DeviceSecret, _appiumExecutablePath: string, _expiresAt: number, signal?: AbortSignal): Promise<void> {
    if (device.platform !== 'android' || !targetMatchesPlatform(input.targetPreset, 'android')) throw assistantError('assistant_input_invalid')
    if (input.confirmHelperApkSideEffect !== true) throw assistantError('assistant_android_helper_confirmation_required')
    const adbPath = await resolveExecutable(this.#config.adbPath, this.#runner, this.#executableAccess, this.#resolvePath, signal)
    if (!adbPath) throw assistantError('assistant_adb_unavailable')
    const rows = parseAdbDeviceRows(await this.#runner.run(adbPath, ['devices', '-l'], { signal, timeoutMs: 10_000 }))
    const candidates = device.deviceKind === 'simulator' ? rows.emulatorReady : rows.usbReady
    if (!candidates.some((row) => row.serial === device.serial)) throw assistantError(device.deviceKind === 'simulator' ? 'assistant_context_stale' : 'assistant_android_device_unavailable')
    if (input.targetPreset === 'android-settings') {
      if (!device.settingsActivity) throw assistantError('assistant_android_settings_unresolved')
      const settings = await this.#runner.run(adbPath, ['-s', device.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.settings.SETTINGS'], { signal, timeoutMs: 5_000 })
      if (parseAndroidSettingsActivity(settings) !== device.settingsActivity) throw assistantError('assistant_android_settings_unresolved')
    }
  }

  buildCapabilities(input: ConnectionAssistantConnectInput, device: DeviceSecret): Record<string, unknown> {
    if (device.platform !== 'android' || !targetMatchesPlatform(input.targetPreset, 'android')) throw assistantError('assistant_input_invalid')
    if (input.targetPreset === 'android-settings' && !device.settingsActivity) throw assistantError('assistant_android_settings_unresolved')
    return {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': device.serial,
      'appium:noReset': true,
      ...(input.targetPreset === 'android-settings' ? {
        'appium:appPackage': 'com.android.settings',
        'appium:appActivity': device.settingsActivity,
        'appium:forceAppLaunch': true,
      } : {
        ...currentScreenCapabilities(),
        'appium:skipUnlock': true,
      }),
      'appium:settings': {
        waitForIdleTimeout: 1_000,
        actionAcknowledgmentTimeout: 1_000,
      },
      ...(device.platformVersion ? { 'appium:platformVersion': device.platformVersion } : {}),
    }
  }

  async #checkScrcpy(signal?: AbortSignal): Promise<{ check: ConnectionAssistantCheck; media: ConnectionAssistantReport['media'] }> {
    if (this.#config.viewerMediaMode !== 'auto') return {
      check: assistantCheck('scrcpy', 'warning', 'assistant_media_disabled', 'Enable automatic media transport in trusted runtime configuration.'),
      media: { mode: 'polling', code: 'assistant_media_disabled' },
    }
    const result = await checkScrcpy(this.#config.androidScrcpyPath, this.#runner, signal, this.#executableAccess)
    const code = result.status === 'pass' ? 'assistant_scrcpy_ready' : result.code === 'scrcpy_not_configured' ? 'assistant_scrcpy_not_configured' : 'assistant_scrcpy_unavailable'
    return {
      check: assistantCheck('scrcpy', result.status === 'pass' ? 'pass' : 'warning', code, result.suggestion, result.version),
      media: { mode: result.status === 'pass' ? 'scrcpy-available' : 'polling', code },
    }
  }
}

export class IosConnectionStrategy implements DeviceConnectionStrategy {
  readonly platform = 'ios' as const
  readonly #config: Config
  readonly #runner: HostCommandRunner
  readonly #preflight: IosWdaPreflightService
  readonly #now: () => number

  constructor(config: Config, options: StrategyOptions & { preflight: IosWdaPreflightService }) {
    this.#config = config
    this.#runner = options.runner
    this.#preflight = options.preflight
    this.#now = options.now
  }

  async check(appiumExecutablePath: string | null, signal?: AbortSignal, _media?: FeaturePolicy, deviceKind: ConnectionAssistantDeviceKind = 'physical'): Promise<StrategyCheckResult> {
    if (deviceKind === 'simulator') return this.#checkSimulators(signal)
    const grant = new ViewerHostDiagnosticsGrant(this.#now() + 30_000, this.#now)
    const [preflight, deviceOutput] = await Promise.all([
      this.#preflight.run(signal, {
        authorization: grant,
        ...(appiumExecutablePath ? { appiumExecutablePath } : {}),
      }),
      readHostPrerequisite(this.#runner, 'ios-devices', this.#config.xcrunPath, signal),
    ])
    const devices = parseIosDeviceCandidates(deviceOutput)
    const requiredSigningInputs: Array<'team-id' | 'wda-bundle-id'> = []
    if (!this.#config.iosWdaXcodeOrgId.trim()) requiredSigningInputs.push('team-id')
    if (!this.#config.iosWdaUpdatedBundleId.trim()) requiredSigningInputs.push('wda-bundle-id')
    const nonSigningIssues = preflight.issues.filter((issue) => issue.code !== 'wda_signing_config_incomplete')
    const provisioningBlocked = this.#config.iosWdaAllowProvisioningDeviceRegistration
    const blocked = provisioningBlocked || devices.length === 0 || nonSigningIssues.length > 0
    return {
      checks: iosChecks(preflight, devices.length, provisioningBlocked),
      devices,
      confirmations: ['device-trust', 'developer-mode', 'ui-automation'],
      media: { mode: 'polling', code: 'assistant_ios_media_after_connect' },
      blocked,
      actionRequired: requiredSigningInputs.length > 0,
      requiredSigningInputs,
    }
  }

  async validateConnect(input: ConnectionAssistantConnectInput, device: DeviceSecret, appiumExecutablePath: string, expiresAt: number, signal?: AbortSignal): Promise<void> {
    if (device.platform !== 'ios' || !targetMatchesPlatform(input.targetPreset, 'ios')) throw assistantError('assistant_input_invalid')
    if (device.deviceKind === 'simulator') {
      if (input.signing) throw assistantError('assistant_input_invalid')
      const check = await this.#checkSimulators(signal)
      if (check.blocked || !check.devices.some(candidate => candidate.secret.platform === 'ios' && candidate.secret.udid === device.udid)) throw assistantError('assistant_context_stale')
      return
    }
    if (this.#config.iosWdaAllowProvisioningDeviceRegistration) throw assistantError('assistant_signing_incomplete')
    const teamId = input.signing?.teamId ?? this.#config.iosWdaXcodeOrgId
    const wdaBundleId = input.signing?.wdaBundleId ?? this.#config.iosWdaUpdatedBundleId
    if (!teamId || !wdaBundleId) throw assistantError('assistant_signing_incomplete')
    const grant = new ViewerHostDiagnosticsGrant(Math.min(expiresAt, this.#now() + 30_000), this.#now)
    const [preflight, devices] = await Promise.all([
      this.#preflight.run(signal, {
        authorization: grant,
        appiumExecutablePath,
        xcodeOrgId: teamId,
        updatedWdaBundleId: wdaBundleId,
      }),
      this.#runner.run(this.#config.xcrunPath, ['xcdevice', 'list'], { signal, timeoutMs: 15_000 }),
    ])
    if (preflight.status !== 'ready') throw assistantError('assistant_signing_incomplete')
    if (!parseIosDeviceCandidates(devices).some((candidate) => candidate.secret.platform === 'ios' && candidate.secret.udid === device.udid)) {
      throw assistantError('assistant_ios_device_unavailable')
    }
  }

  buildCapabilities(input: ConnectionAssistantConnectInput, device: DeviceSecret): Record<string, unknown> {
    if (device.platform !== 'ios' || !targetMatchesPlatform(input.targetPreset, 'ios')) throw assistantError('assistant_input_invalid')
    return {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': device.udid,
      ...(device.deviceKind === 'simulator' ? { 'mobileMirror:deviceKind': 'simulator', 'appium:allowProvisioningDeviceRegistration': false } : {}),
      ...(input.targetPreset === 'ios-settings' ? { 'appium:bundleId': 'com.apple.Preferences' } : currentScreenCapabilities()),
      ...(device.platformVersion ? { 'appium:platformVersion': device.platformVersion } : {}),
      ...(device.deviceKind !== 'simulator' && input.signing ? {
        'appium:xcodeOrgId': input.signing.teamId,
        'appium:updatedWDABundleId': input.signing.wdaBundleId,
      } : {}),
    }
  }

  async #checkSimulators(signal?: AbortSignal): Promise<StrategyCheckResult> {
    const [xcode, output] = await Promise.all([
      this.#runner.run(this.#config.xcrunPath, ['xcodebuild', '-version'], { signal, timeoutMs: 10_000 }),
      this.#runner.run(this.#config.xcrunPath, ['simctl', 'list', 'devices', 'booted', '--json'], { signal, timeoutMs: 15_000 }),
    ])
    const devices = parseIosSimulatorCandidates(output)
    return {
      checks: [
        assistantCheck('xcode', xcode.ok ? 'pass' : 'blocked', xcode.ok ? 'assistant_xcode_ready' : xcode.timedOut ? 'assistant_check_timeout' : 'assistant_xcode_unavailable', xcode.ok ? 'Xcode is available.' : 'Install and select Xcode with an iOS Simulator runtime.'),
        assistantCheck('device', devices.length > 0 ? 'pass' : 'blocked', output.timedOut ? 'assistant_check_timeout' : devices.length > 0 ? 'assistant_simulator_ready' : 'assistant_simulator_unavailable', devices.length > 0 ? 'A running iOS Simulator is available.' : 'Start an iOS Simulator in Xcode, then check again.', undefined, devices.length),
      ],
      devices,
      confirmations: [],
      media: { mode: 'polling', code: 'assistant_ios_media_after_connect' },
      blocked: !xcode.ok || devices.length === 0,
      actionRequired: false,
      requiredSigningInputs: [],
    }
  }
}

export interface ConnectionAssistantServiceOptions {
  service: MirrorService
  runtime: ArmableAppiumRuntimeLifecycle
  runner?: HostCommandRunner
  iosWdaPreflight?: IosWdaPreflightService
  registry?: ConnectionAssistantRegistry
  executableAccess?: (path: string) => Promise<void>
  resolvePath?: (path: string) => Promise<string>
  appiumStatus?: (url: string, signal?: AbortSignal) => Promise<{ ready: boolean; version: string | null }>
  now?: () => number
  hostPlatform?: NodeJS.Platform
  persistSetup?: (input: ConnectionAssistantPersistedSetup) => Promise<void>
}

export class ConnectionAssistantService implements ConnectionAssistantApi {
  readonly #config: Config
  readonly #service: MirrorService
  readonly #runtime: ArmableAppiumRuntimeLifecycle
  readonly #runner: HostCommandRunner
  readonly #registry: ConnectionAssistantRegistry
  readonly #executableAccess: (path: string) => Promise<void>
  readonly #resolvePath: (path: string) => Promise<string>
  readonly #appiumStatus: (url: string, signal?: AbortSignal) => Promise<{ ready: boolean; version: string | null }>
  readonly #now: () => number
  readonly #hostPlatform: NodeJS.Platform
  readonly #persistSetup: ((input: ConnectionAssistantPersistedSetup) => Promise<void>) | undefined
  readonly #strategies: Map<ConnectionAssistantPlatform, DeviceConnectionStrategy>

  constructor(config: Config, options: ConnectionAssistantServiceOptions) {
    this.#config = config
    this.#service = options.service
    this.#runtime = options.runtime
    this.#runner = new BoundedPreflightRunner(options.runner ?? new NodeHostCommandRunner())
    this.#now = options.now ?? Date.now
    this.#registry = options.registry ?? new ConnectionAssistantRegistry({ now: this.#now })
    this.#executableAccess = options.executableAccess ?? (async (path) => access(path, constants.X_OK))
    this.#resolvePath = options.resolvePath ?? realpath
    this.#appiumStatus = options.appiumStatus ?? probeAssistantAppiumStatus
    this.#hostPlatform = options.hostPlatform ?? process.platform
    this.#persistSetup = options.persistSetup
    const strategyOptions: StrategyOptions = {
      runner: this.#runner,
      executableAccess: this.#executableAccess,
      resolvePath: this.#resolvePath,
      now: this.#now,
    }
    const preflight = options.iosWdaPreflight ?? new IosWdaPreflightService(config, this.#runner)
    this.#strategies = new Map<ConnectionAssistantPlatform, DeviceConnectionStrategy>([
      ['android', new AndroidConnectionStrategy(config, strategyOptions)],
      ['ios', new IosConnectionStrategy(config, { ...strategyOptions, preflight })],
    ])
  }

  async check(input: ConnectionAssistantCheckInput, signal?: AbortSignal): Promise<ConnectionAssistantReport> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60_000)
    try { return await this.#check(input, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal) }
    catch (error) { if (controller.signal.aborted) throw assistantError('assistant_check_timeout'); throw error }
    finally { clearTimeout(timer); controller.abort() }
  }

  async #check(input: ConnectionAssistantCheckInput, signal: AbortSignal): Promise<ConnectionAssistantReport> {
    const context = normalizePreflight({ entry: 'viewer', operation: 'connect', platform: input.platform, features: { media: input.media ?? 'off' } })
    const plan = planEnvironmentChecks(context)
    if (this.#hostPlatform !== 'darwin') throw assistantError('assistant_platform_unsupported')
    const strategy = this.#strategies.get(input.platform)
    if (!strategy) throw assistantError('assistant_platform_unsupported')
    const statusUrl = assistantStatusUrl(this.#config.appiumUrl)
    const [candidate, endpoint] = await Promise.all([
      this.#discoverAppium(input.platform, signal),
      this.#appiumStatus(statusUrl, signal),
    ])
    const strategyResult = await strategy.check(candidate?.path ?? null, signal, plan.some(item => item.id === 'media') ? context.features.media : 'off', input.deviceKind)
    if (input.platform === 'ios' && context.features.media !== 'off') {
      strategyResult.checks.push(assistantCheck('wda-runtime', context.features.media === 'required' ? 'blocked' : 'warning', 'assistant_mjpeg_unverified', 'MJPEG requires session-time verification; PNG remains available.'))
      if (context.features.media === 'required') strategyResult.blocked = true
    }
    const driverName = input.platform === 'android' ? 'uiautomator2' : 'xcuitest'
    const driverVersion = candidate?.drivers.get(driverName)
    const runtimeChoices: ConnectionAssistantRuntimeChoice[] = []
    if (endpoint.ready || this.#config.appiumRuntimeMode === 'managed') runtimeChoices.push('configured')
    if (!endpoint.ready && this.#config.appiumRuntimeMode === 'external' && candidate?.managedExecutablePath) runtimeChoices.push('managed-once')
    const commonBlocked = !candidate || !driverVersion || runtimeChoices.length === 0
    const actionRequired = strategyResult.actionRequired || !endpoint.ready
    const status: ConnectionAssistantStatus = commonBlocked || strategyResult.blocked
      ? 'blocked'
      : actionRequired
        ? 'action-required'
        : 'ready'
    signal.throwIfAborted()
    const created = this.#registry.create({
      platform: input.platform,
      media: context.features.media,
      status,
      runtimeChoices,
      requiredSigningInputs: strategyResult.requiredSigningInputs,
      appiumFingerprint: candidate?.fingerprint ?? 'unavailable',
      devices: strategyResult.devices,
    })
    return {
      schemaVersion: 1,
      assistantId: created.assistantId,
      platform: input.platform,
      status,
      checkedAt: new Date(this.#now()).toISOString(),
      expiresAt: new Date(created.expiresAt).toISOString(),
      checks: [
        assistantCheck('appium-endpoint', endpoint.ready ? 'pass' : 'warning', endpoint.ready ? 'assistant_appium_endpoint_ready' : 'assistant_appium_endpoint_stopped', endpoint.ready ? 'Appium is ready.' : 'Confirm a configured or one-shot managed Appium start.', endpoint.version ?? undefined),
        assistantCheck('appium-cli', candidate ? 'pass' : 'blocked', candidate ? 'assistant_appium_cli_ready' : 'assistant_appium_unavailable', candidate ? 'Appium CLI is available.' : 'Install Appium or configure an absolute executable path.', candidate?.version),
        assistantCheck('appium-driver', driverVersion ? 'pass' : 'blocked', driverVersion ? `assistant_${driverName}_ready` : `assistant_${driverName}_unavailable`, driverVersion ? `${driverName} is installed.` : `Install the Appium ${driverName} driver and retry.`, driverVersion),
        ...strategyResult.checks,
      ],
      devices: created.devices,
      runtimeChoices,
      ...(input.platform === 'ios' && input.deviceKind !== 'simulator' ? {
        signing: {
          profileDefaultsReady: strategyResult.requiredSigningInputs.length === 0,
          requiredInputs: strategyResult.requiredSigningInputs,
        },
      } : {}),
      confirmations: strategyResult.confirmations,
      media: strategyResult.media,
    }
  }

  async connect(input: ConnectionAssistantConnectInput, signal?: AbortSignal): Promise<MirrorState> {
    const inspected = this.#registry.inspect(input.assistantId, input.deviceRef)
    this.#validateConnectInput(input, inspected.context)
    if (inspected.context.status === 'blocked') throw assistantError('assistant_input_invalid')
    if (inspected.context.media === 'required') {
      if (this.#config.viewerMediaMode !== 'auto' || inspected.context.platform !== 'android' || (await checkScrcpy(this.#config.androidScrcpyPath, this.#runner, signal, this.#executableAccess)).status !== 'pass') throw assistantError('assistant_context_stale')
    }
    const strategy = this.#strategies.get(inspected.context.platform)
    if (!strategy) throw assistantError('assistant_platform_unsupported')
    const candidate = await this.#discoverAppium(inspected.context.platform, signal)
    if (!candidate || candidate.fingerprint !== inspected.context.appiumFingerprint) throw assistantError('assistant_context_stale')
    await strategy.validateConnect(input, inspected.device, candidate.path, inspected.context.expiresAt, signal)
    if (input.rememberOnThisMac === true) {
      if (!this.#persistSetup || !candidate.managedExecutablePath) throw assistantError('assistant_persistence_unavailable')
      const signing = inspected.context.platform === 'ios' && inspected.device.deviceKind !== 'simulator'
        ? input.signing ?? {
            teamId: this.#config.iosWdaXcodeOrgId,
            wdaBundleId: this.#config.iosWdaUpdatedBundleId,
          }
        : undefined
      try {
        await this.#persistSetup({
          platform: inspected.context.platform,
          appiumExecutablePath: candidate.managedExecutablePath,
          ...(signing ? { signing } : {}),
        })
      } catch {
        throw assistantError('assistant_persistence_failed')
      }
    }
    const consumed = this.#registry.consume(input.assistantId, input.deviceRef)
    if (input.runtime === 'managed-once') {
      if (!candidate.managedExecutablePath) throw assistantError('assistant_appium_unavailable')
      this.#runtime.armOnce({ key: hashToken(input.assistantId), executablePath: candidate.managedExecutablePath, expiresAt: consumed.context.expiresAt })
    }
    return await this.#service.start({
      provider: 'appium',
      capabilities: strategy.buildCapabilities(input, consumed.device),
    }, signal)
  }

  cancel(input: ConnectionAssistantCancelInput): { cancelled: true } {
    return this.#registry.cancel(input.assistantId)
  }

  dispose(): void {
    this.#registry.clear()
  }

  #validateConnectInput(input: ConnectionAssistantConnectInput, context: StoredAssistantContext): void {
    if (!context.runtimeChoices.includes(input.runtime)) {
      throw assistantError(input.runtime === 'managed-once' ? 'assistant_managed_start_not_confirmed' : 'assistant_input_invalid')
    }
    if (context.platform === 'android') {
      if (!targetMatchesPlatform(input.targetPreset, 'android') || input.signing !== undefined || input.confirmHelperApkSideEffect !== true) {
        throw assistantError(input.confirmHelperApkSideEffect === true ? 'assistant_input_invalid' : 'assistant_android_helper_confirmation_required')
      }
      return
    }
    if (!targetMatchesPlatform(input.targetPreset, 'ios') || input.confirmHelperApkSideEffect !== undefined) throw assistantError('assistant_input_invalid')
    if (context.requiredSigningInputs.length > 0 && !input.signing) throw assistantError('assistant_signing_incomplete')
  }

  async #discoverAppium(platform: ConnectionAssistantPlatform, signal?: AbortSignal): Promise<AppiumCandidate | null> {
    const requested = this.#config.appiumExecutablePath || 'appium'
    const path = await resolveExecutable(requested, this.#runner, this.#executableAccess, this.#resolvePath, signal)
    if (!path) return null
    const [versionResult, driversResult] = await Promise.all([
      readHostPrerequisite(this.#runner, 'appium-version', path, signal),
      readHostPrerequisite(this.#runner, 'appium-drivers', path, signal),
    ])
    const version = safeVersion(versionResult.stdout)
    if (!versionResult.ok || !driversResult.ok || !version) return null
    const drivers = parseInstalledDrivers(driversResult.stdout)
    const requiredDriver = platform === 'android' ? 'uiautomator2' : 'xcuitest'
    const driverVersion = drivers.get(requiredDriver) ?? ''
    let canonicalPath: string
    try {
      canonicalPath = await this.#resolvePath(path)
    } catch {
      return null
    }
    const managedExecutablePath = await this.#resolveManagedExecutable(path, canonicalPath, signal)
    const managedCanonicalPath = managedExecutablePath
      ? await this.#resolvePath(managedExecutablePath).catch(() => '')
      : ''
    return {
      path,
      managedExecutablePath,
      version,
      drivers,
      configured: Boolean(this.#config.appiumExecutablePath),
      fingerprint: createHash('sha256').update(`${canonicalPath}\0${managedCanonicalPath}\0${version}\0${requiredDriver}\0${driverVersion}`).digest('hex'),
    }
  }

  async #resolveManagedExecutable(path: string, canonicalPath: string, signal?: AbortSignal): Promise<string | null> {
    if (basename(canonicalPath) !== 'volta-shim') return path
    const voltaPath = join(dirname(canonicalPath), 'volta')
    try {
      await this.#executableAccess(voltaPath)
    } catch {
      return null
    }
    const resolved = await this.#runner.run(voltaPath, ['which', 'appium'], { signal, timeoutMs: 5_000 })
    if (!resolved.ok) return null
    const directPath = resolved.stdout.split('\n').map((value) => value.trim()).find((value) => value.startsWith('/'))
    if (!directPath) return null
    return await resolveExecutable(directPath, this.#runner, this.#executableAccess, this.#resolvePath, signal)
  }
}

function targetMatchesPlatform(target: unknown, platform: ConnectionAssistantPlatform): target is ConnectionAssistantTargetPreset {
  return target === `${platform}-current-screen` || target === `${platform}-settings`
}

function currentScreenCapabilities(): Record<string, boolean> {
  return {
    'appium:autoLaunch': false,
    'appium:noReset': true,
    'appium:forceAppLaunch': false,
    'appium:shouldTerminateApp': false,
  }
}

export function parseConnectionAssistantCheckInput(body: Record<string, unknown>): ConnectionAssistantCheckInput {
  assertKeys(body, ['platform', 'media', 'deviceKind'])
  if (body.platform !== 'android' && body.platform !== 'ios') throw assistantError('assistant_input_invalid')
  if (body.deviceKind !== undefined && body.deviceKind !== 'physical' && body.deviceKind !== 'simulator') throw assistantError('assistant_input_invalid')
  const media = featurePolicySchema.safeParse(body.media ?? 'off')
  if (!media.success) throw assistantError('assistant_input_invalid')
  return { platform: body.platform, ...(body.media !== undefined ? { media: media.data } : {}), ...(body.deviceKind !== undefined ? { deviceKind: body.deviceKind } : {}) }
}

export function parseConnectionAssistantConnectInput(body: Record<string, unknown>): ConnectionAssistantConnectInput {
  assertKeys(body, ['assistantId', 'deviceRef', 'targetPreset', 'runtime', 'confirmHelperApkSideEffect', 'signing', 'rememberOnThisMac'])
  if (!isOpaqueToken(body.assistantId) || !isOpaqueToken(body.deviceRef)) throw assistantError('assistant_input_invalid')
  if (!targetMatchesPlatform(body.targetPreset, 'android') && !targetMatchesPlatform(body.targetPreset, 'ios')) throw assistantError('assistant_input_invalid')
  if (body.runtime !== 'configured' && body.runtime !== 'managed-once') throw assistantError('assistant_input_invalid')
  if (body.confirmHelperApkSideEffect !== undefined && typeof body.confirmHelperApkSideEffect !== 'boolean') throw assistantError('assistant_input_invalid')
  if (body.rememberOnThisMac !== undefined && typeof body.rememberOnThisMac !== 'boolean') throw assistantError('assistant_input_invalid')
  const signing = body.signing === undefined ? undefined : parseSigning(body.signing)
  return {
    assistantId: body.assistantId,
    deviceRef: body.deviceRef,
    targetPreset: body.targetPreset,
    runtime: body.runtime,
    ...(body.confirmHelperApkSideEffect !== undefined ? { confirmHelperApkSideEffect: body.confirmHelperApkSideEffect } : {}),
    ...(signing ? { signing } : {}),
    ...(body.rememberOnThisMac !== undefined ? { rememberOnThisMac: body.rememberOnThisMac } : {}),
  }
}

export function parseConnectionAssistantCancelInput(body: Record<string, unknown>): ConnectionAssistantCancelInput {
  assertKeys(body, ['assistantId'])
  if (!isOpaqueToken(body.assistantId)) throw assistantError('assistant_input_invalid')
  return { assistantId: body.assistantId }
}

function parseSigning(value: unknown): ConnectionAssistantSigningInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw assistantError('assistant_input_invalid')
  const signing = value as Record<string, unknown>
  assertKeys(signing, ['teamId', 'wdaBundleId'])
  if (typeof signing.teamId !== 'string' || !/^[A-Za-z0-9]{10}$/.test(signing.teamId)) throw assistantError('assistant_input_invalid')
  if (typeof signing.wdaBundleId !== 'string' || signing.wdaBundleId.length > 255
    || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(signing.wdaBundleId)) throw assistantError('assistant_input_invalid')
  return { teamId: signing.teamId, wdaBundleId: signing.wdaBundleId }
}

function assertKeys(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw assistantError('assistant_input_invalid')
}

function isOpaqueToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22,128}$/.test(value)
}

function assistantError(code: ConnectionAssistantErrorCode): ConnectionAssistantError {
  return new ConnectionAssistantError(code)
}

function assistantCheck(
  id: ConnectionAssistantCheck['id'],
  status: ConnectionAssistantCheckStatus,
  code: string,
  action: string,
  version?: string,
  count?: number,
): ConnectionAssistantCheck {
  return { id, status, code, action, ...(version ? { version } : {}), ...(count !== undefined ? { count } : {}) }
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function findHashKey<T>(map: Map<string, T>, candidate: string): string | null {
  const candidateBytes = Buffer.from(candidate, 'hex')
  let found: string | null = null
  for (const key of map.keys()) {
    const keyBytes = Buffer.from(key, 'hex')
    if (keyBytes.byteLength === candidateBytes.byteLength && timingSafeEqual(keyBytes, candidateBytes)) found = key
  }
  return found
}

async function resolveExecutable(
  requested: string,
  runner: HostCommandRunner,
  executableAccess: (path: string) => Promise<void>,
  resolvePath: (path: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<string | null> {
  let path = requested
  if (!path.startsWith('/')) {
    if (!/^[A-Za-z0-9._+-]{1,128}$/.test(path)) return null
    const located = await runner.run('/usr/bin/which', [path], { signal, timeoutMs: 5_000 })
    path = located.ok ? located.stdout.split('\n').map((value) => value.trim()).find((value) => value.startsWith('/')) ?? '' : ''
  }
  if (!path.startsWith('/')) return null
  try {
    const canonicalPath = await resolvePath(path)
    if (!canonicalPath.startsWith('/')) return null
    await executableAccess(canonicalPath)
    return path
  } catch {
    return null
  }
}

function parseInstalledDrivers(value: string): Map<string, string> {
  try {
    const start = value.indexOf('{')
    const parsed = JSON.parse(start >= 0 ? value.slice(start) : value) as Record<string, { version?: unknown; installed?: unknown }>
    return new Map(Object.entries(parsed).flatMap(([name, item]) => item.installed !== false && typeof item.version === 'string'
      ? [[name.toLowerCase(), item.version]]
      : []))
  } catch {
    return new Map()
  }
}

interface ParsedAdbRows {
  usbReady: Array<{ serial: string }>
  emulatorReady: Array<{ serial: string }>
  unauthorized: number
  offline: number
  unsupported: number
}

function parseAdbDeviceRows(result: HostCommandResult): ParsedAdbRows {
  const parsed: ParsedAdbRows = { usbReady: [], emulatorReady: [], unauthorized: 0, offline: 0, unsupported: 0 }
  if (!result.ok) return parsed
  for (const line of result.stdout.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    const serial = parts[0]
    const state = parts[1]
    if (!serial || !state) continue
    if (state === 'unauthorized') { parsed.unauthorized += 1; continue }
    if (state === 'offline') { parsed.offline += 1; continue }
    if (state === 'device' && /^emulator-\d+$/.test(serial)) { parsed.emulatorReady.push({ serial }); continue }
    const usb = parts.slice(2).some((part) => part.startsWith('usb:'))
    const unsupported = serial.startsWith('emulator-') || serial.includes(':') || !usb
    if (state !== 'device' || unsupported) { parsed.unsupported += 1; continue }
    parsed.usbReady.push({ serial })
  }
  return parsed
}

function parseAndroidSettingsActivity(result: HostCommandResult): string | null {
  if (!result.ok) return null
  for (const line of result.stdout.split('\n').map((value) => value.trim())) {
    const match = line.match(/^com\.android\.settings\/(\.?[A-Za-z0-9_.$]+)$/)
    if (match?.[1]) return match[1]
  }
  return null
}

function parseIosDeviceCandidates(result: HostCommandResult): DeviceCandidate[] {
  if (!result.ok) return []
  try {
    const devices = JSON.parse(result.stdout) as Array<Record<string, unknown>>
    return devices.flatMap((device) => {
      if (device.platform !== 'com.apple.platform.iphoneos' || device.available !== true || device.simulator === true
        || typeof device.identifier !== 'string' || !/^[0-9A-Fa-f-]{8,}$/.test(device.identifier)) return []
      const platformVersion = typeof device.operatingSystemVersion === 'string' ? safeVersion(device.operatingSystemVersion) : null
      const secret: IosDeviceSecret = {
        platform: 'ios',
        udid: device.identifier,
        ...(platformVersion ? { platformVersion } : {}),
      }
      return [{ secret, ...(platformVersion ? { osVersion: platformVersion } : {}) }]
    })
  } catch {
    return []
  }
}

export function parseIosSimulatorCandidates(result: HostCommandResult): DeviceCandidate[] {
  if (!result.ok) return []
  try {
    const payload = JSON.parse(result.stdout) as { devices?: Record<string, unknown> }
    if (!payload.devices || typeof payload.devices !== 'object' || Array.isArray(payload.devices)) return []
    return Object.entries(payload.devices).flatMap(([runtime, rows]) => {
      const version = /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+(?:-\d+)*)$/.exec(runtime)?.[1]?.replaceAll('-', '.')
      if (!version || !Array.isArray(rows)) return []
      return rows.flatMap((row: unknown): DeviceCandidate[] => {
        if (!row || typeof row !== 'object') return []
        const device = row as Record<string, unknown>
        if (device.isAvailable !== true || device.state !== 'Booted' || typeof device.udid !== 'string'
          || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(device.udid)) return []
        return [{ secret: { platform: 'ios', deviceKind: 'simulator', udid: device.udid, platformVersion: version }, osVersion: version }]
      })
    }).slice(0, 8)
  } catch { return [] }
}

function iosChecks(preflight: IosWdaPreflightResult, deviceCount: number, provisioningBlocked: boolean): ConnectionAssistantCheck[] {
  const xcode = preflight.checks.xcode === true
  const timedOut = preflight.issues.some((issue) => issue.code === 'host_diagnostics_timeout')
  const signingConfig = preflight.checks.signingConfig === true
  const signingReady = preflight.status === 'ready' && !provisioningBlocked
  return [
    assistantCheck('xcode', xcode ? 'pass' : 'blocked', xcode ? 'assistant_xcode_ready' : timedOut ? 'assistant_check_timeout' : 'assistant_xcode_unavailable', xcode ? 'Xcode is available.' : timedOut ? 'A local iOS readiness command timed out; retry after checking Xcode and USB state.' : 'Install or select Xcode command-line tools.', preflight.versions.xcode ?? undefined),
    assistantCheck('device', deviceCount > 0 ? 'pass' : 'blocked', deviceCount > 0 ? 'assistant_ios_device_ready' : 'assistant_ios_device_unavailable', deviceCount > 0 ? 'A physical iPhone is connected.' : 'Connect, unlock, and trust a physical iPhone.', undefined, deviceCount),
    assistantCheck('wda-signing', signingReady ? 'pass' : signingConfig && provisioningBlocked ? 'blocked' : 'warning', signingReady ? 'assistant_wda_prerequisites_ready' : provisioningBlocked ? 'assistant_provisioning_enabled' : 'assistant_signing_incomplete', signingReady ? 'Local WDA signing prerequisites were found.' : provisioningBlocked ? 'Disable automatic device registration or use the advanced flow.' : 'Provide the missing local WDA signing fields and retry.'),
    assistantCheck('xcode-account', 'manual', 'assistant_xcode_account_manual', 'Confirm the Apple developer account for this Team is signed in under Xcode Settings > Accounts when WDA must be rebuilt.'),
    assistantCheck('wda-runtime', 'manual', 'assistant_wda_runtime_unverified', 'WDA startup is not verified by this read-only check; connect to verify it on the iPhone.'),
  ]
}

function safeVersion(value: string): string | null {
  return value.match(/\b\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?\b/)?.[0] ?? null
}

function assistantStatusUrl(value: string): string {
  try {
    return parseManagedTarget(value).statusUrl
  } catch {
    throw assistantError('assistant_appium_unavailable')
  }
}

async function probeAssistantAppiumStatus(url: string, signal?: AbortSignal): Promise<{ ready: boolean; version: string | null }> {
  try {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(1_000)]) : AbortSignal.timeout(1_000)
    const response = await fetch(url, { signal: requestSignal })
    if (!response.ok) return { ready: false, version: null }
    const payload = JSON.parse(await readBoundedText(response, 1024 * 1024)) as { value?: { ready?: unknown; build?: { version?: unknown } } }
    const version = typeof payload.value?.build?.version === 'string' ? safeVersion(payload.value.build.version) : null
    return { ready: payload.value?.ready === true, version }
  } catch {
    if (signal?.aborted) throw signal.reason
    return { ready: false, version: null }
  }
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > limit) throw new Error('Response is too large')
    chunks.push(next.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
