import { describe, expect, it, vi } from 'vitest'
import { Config, type Config as PluginConfig } from '../src/config.js'
import {
  AndroidConnectionStrategy,
  ConnectionAssistantRegistry,
  ConnectionAssistantService,
  IosConnectionStrategy,
  parseConnectionAssistantCancelInput,
  parseConnectionAssistantCheckInput,
  parseConnectionAssistantConnectInput,
  parseIosSimulatorCandidates,
  type StoredAssistantContext,
} from '../src/connection-assistant.js'
import type { HostCommandOptions, HostCommandResult, HostCommandRunner } from '../src/host-command-runner.js'
import type { IosWdaPreflightResult, IosWdaPreflightService } from '../src/ios-wda-preflight.js'
import type { AppiumRuntimeArm, ArmableAppiumRuntimeLifecycle } from '../src/managed-appium-runtime.js'
import type { MirrorService } from '../src/mirror-service.js'
import type { MirrorState, StartMirrorInput } from '../src/types.js'
import { WdaStartError } from '../src/wda-errors.js'

const ANDROID_SERIAL = 'ANDROID-PRIVATE-SERIAL'
const IOS_UDID = '00008120-001234567890001E'

function config(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return Config({
    viewerPort: 0,
    appiumExecutablePath: '/trusted/appium',
    adbPath: '/trusted/adb',
    iosWdaXcodeOrgId: 'ABCDE12345',
    iosWdaUpdatedBundleId: 'com.example.WebDriverAgentRunner',
    ...overrides,
  } as PluginConfig)
}

function result(stdout = '', overrides: Partial<HostCommandResult> = {}): HostCommandResult {
  return { ok: true, stdout, stderr: '', exitCode: 0, timedOut: false, aborted: false, ...overrides }
}

class FakeRunner implements HostCommandRunner {
  readonly calls: Array<{ command: string; args: string[] }> = []
  readonly #respond: (command: string, args: string[]) => HostCommandResult

  constructor(respond: (command: string, args: string[]) => HostCommandResult) {
    this.#respond = respond
  }

  async run(command: string, args: string[], _options?: HostCommandOptions): Promise<HostCommandResult> {
    this.calls.push({ command, args })
    return this.#respond(command, args)
  }
}

function tokenSource(): () => Uint8Array {
  let value = 0
  return () => new Uint8Array(16).fill(++value)
}

function context(platform: 'android' | 'ios' = 'android'): Omit<StoredAssistantContext, 'expiresAt' | 'devices'> & {
  devices: Array<{ secret: { platform: 'android'; serial: string; settingsActivity: string } }>
} {
  return {
    platform,
    status: 'action-required',
    runtimeChoices: ['configured'],
    requiredSigningInputs: [],
    appiumFingerprint: 'fingerprint',
    devices: [{ secret: { platform: 'android', serial: ANDROID_SERIAL, settingsActivity: '.Settings' } }],
  }
}

describe('connection assistant contract and registry', () => {
  it('parses exact platform-specific payloads and rejects unknown or cross-platform fields', () => {
    expect(parseConnectionAssistantCheckInput({ platform: 'android' })).toEqual({ platform: 'android' })
    expect(parseConnectionAssistantCheckInput({ platform: 'ios', deviceKind: 'simulator' })).toEqual({ platform: 'ios', deviceKind: 'simulator' })
    expect(() => parseConnectionAssistantCheckInput({ platform: 'ios', deviceKind: 'remote' })).toThrow(expect.objectContaining({ code: 'assistant_input_invalid' }))
    expect(() => parseConnectionAssistantCheckInput({ platform: 'android', path: '/private/appium' })).toThrow(expect.objectContaining({ code: 'assistant_input_invalid' }))

    const token = Buffer.alloc(16, 1).toString('base64url')
    expect(parseConnectionAssistantConnectInput({
      assistantId: token,
      deviceRef: token,
      targetPreset: 'android-settings',
      runtime: 'managed-once',
      confirmHelperApkSideEffect: true,
      rememberOnThisMac: true,
    })).toMatchObject({ targetPreset: 'android-settings', confirmHelperApkSideEffect: true, rememberOnThisMac: true })
    expect(parseConnectionAssistantConnectInput({
      assistantId: token,
      deviceRef: token,
      targetPreset: 'ios-settings',
      runtime: 'configured',
      signing: { teamId: 'ABCDE12345', wdaBundleId: 'com.example.WDA' },
    })).toMatchObject({ signing: { teamId: 'ABCDE12345', wdaBundleId: 'com.example.WDA' } })
    expect(() => parseConnectionAssistantConnectInput({
      assistantId: token,
      deviceRef: token,
      targetPreset: 'ios-settings',
      runtime: 'configured',
      signing: { teamId: 'bad', wdaBundleId: 'not a bundle' },
    })).toThrow(expect.objectContaining({ code: 'assistant_input_invalid' }))
    expect(() => parseConnectionAssistantConnectInput({
      assistantId: token,
      deviceRef: token,
      targetPreset: 'ios-settings',
      runtime: 'configured',
      rememberOnThisMac: 'yes',
    })).toThrow(expect.objectContaining({ code: 'assistant_input_invalid' }))
    expect(parseConnectionAssistantCancelInput({ assistantId: token })).toEqual({ assistantId: token })
  })

  it('uses opaque hashed single-use contexts with expiry, cancellation, replay protection and a bound', async () => {
    let now = 1_000
    const registry = new ConnectionAssistantRegistry({ now: () => now, tokenBytes: tokenSource(), ttlMs: 100, maxContexts: 2 })
    const first = registry.create(context())
    expect(first.assistantId).not.toContain(ANDROID_SERIAL)
    expect(JSON.stringify(first.devices)).not.toContain(ANDROID_SERIAL)
    expect(first.devices[0]).toMatchObject({ label: 'Android 1', platform: 'android' })

    const settled = await Promise.allSettled([
      Promise.resolve().then(() => registry.consume(first.assistantId, first.devices[0]!.deviceRef)),
      Promise.resolve().then(() => registry.consume(first.assistantId, first.devices[0]!.deviceRef)),
    ])
    expect(settled.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((entry) => entry.status === 'rejected')[0]).toMatchObject({ reason: { code: 'assistant_context_consumed' } })

    const cancelled = registry.create(context())
    expect(registry.cancel(cancelled.assistantId)).toEqual({ cancelled: true })
    expect(() => registry.inspect(cancelled.assistantId, cancelled.devices[0]!.deviceRef)).toThrow(expect.objectContaining({ code: 'assistant_context_stale' }))

    const expired = registry.create(context())
    now += 101
    expect(() => registry.inspect(expired.assistantId, expired.devices[0]!.deviceRef)).toThrow(expect.objectContaining({ code: 'assistant_context_stale' }))

    const evicted = registry.create(context())
    registry.create(context())
    registry.create(context())
    expect(() => registry.inspect(evicted.assistantId, evicted.devices[0]!.deviceRef)).toThrow(expect.objectContaining({ code: 'assistant_context_stale' }))
    registry.clear()
  })
})

describe('platform connection strategies', () => {
  it('selects only online local Android emulators when requested, and rechecks before connecting', async () => {
    let online = true
    const base = androidRunner()
    const runner = new FakeRunner((command, args) => args[0] === 'devices'
      ? result(`List of devices attached\nemulator-5554 ${online ? 'device' : 'offline'} transport_id:1\n${ANDROID_SERIAL} device usb:1\n127.0.0.1:5555 device\nemulator-bad device\n`)
      : result(args[0] === 'version' ? 'Android Debug Bridge version 1.0.41' : args.includes('getprop') ? '15.0' : 'com.android.settings/.Settings'))
    const strategy = new AndroidConnectionStrategy(config(), strategyOptions(runner))
    const output = await strategy.check(null, undefined, 'off', 'simulator')
    expect(output.devices).toHaveLength(1)
    expect(output.devices[0]!.secret).toMatchObject({ serial: 'emulator-5554', deviceKind: 'simulator' })
    expect(output.confirmations).toEqual(['uiautomator2-helper-apk'])
    const input = { assistantId: '', deviceRef: '', targetPreset: 'android-current-screen', runtime: 'configured', confirmHelperApkSideEffect: true } as const
    expect(strategy.buildCapabilities(input, output.devices[0]!.secret)).toMatchObject({ 'appium:udid': 'emulator-5554', 'appium:autoLaunch': false })
    await strategy.validateConnect(input, output.devices[0]!.secret, '', 0)
    online = false
    await expect(strategy.validateConnect(input, output.devices[0]!.secret, '', 0)).rejects.toMatchObject({ code: 'assistant_context_stale' })
    expect((await new AndroidConnectionStrategy(config(), strategyOptions(base)).check(null)).devices).toHaveLength(1)
  })

  it('filters malformed, shutdown, unavailable and non-iOS simulator rows', () => {
    const row = { udid: '12345678-1234-1234-1234-123456789ABC', state: 'Booted', isAvailable: true }
    const parse = (devices: unknown) => parseIosSimulatorCandidates(result(JSON.stringify({ devices })))
    expect(parse({ 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [row, { ...row, state: 'Shutdown' }, { ...row, isAvailable: false }, { ...row, udid: IOS_UDID }, null] })).toHaveLength(1)
    expect(parse({ 'com.apple.CoreSimulator.SimRuntime.tvOS-26-5': [row] })).toEqual([])
    expect(parse([])).toEqual([])
    expect(parseIosSimulatorCandidates(result('bad json'))).toEqual([])
    expect(parseIosSimulatorCandidates(result('{}', { ok: false, timedOut: true }))).toEqual([])
  })

  it('connects iOS Simulator without signing diagnostics, binds its identity and persists no signing fields', async () => {
    let booted = true
    const udid = '12345678-1234-1234-1234-123456789ABC'
    const runner = new FakeRunner((_command, args) => {
      if (args[0] === '--version') return result('3.2.0')
      if (args[0] === 'driver') return result(JSON.stringify({ xcuitest: { version: '10.19.1' } }))
      if (args[0] === 'xcodebuild') return result('Xcode 26.5')
      if (args[0] === 'simctl') return result(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [{ udid, isAvailable: true, state: booted ? 'Booted' : 'Shutdown' }] } }))
      throw new Error(`Unexpected host command: ${args.join(' ')}`)
    })
    const run = vi.fn(), persist = vi.fn(async () => undefined), start = vi.fn(async () => mirrorState())
    const assistant = serviceHarness('ios', runner, start, vi.fn(), true, config({ iosWdaXcodeOrgId: '', iosWdaUpdatedBundleId: '', iosWdaAllowProvisioningDeviceRegistration: true }), { run } as unknown as IosWdaPreflightService, undefined, persist)
    const check = () => assistant.check({ platform: 'ios', deviceKind: 'simulator' })
    const report = await check()
    expect(report.status).toBe('ready')
    expect(report.signing).toBeUndefined()
    expect(report.devices[0]).toMatchObject({ deviceKind: 'simulator', label: 'iPhone Simulator 1' })
    expect(JSON.stringify(report)).not.toContain(udid)
    const input = { assistantId: report.assistantId, deviceRef: report.devices[0]!.deviceRef, targetPreset: 'ios-current-screen', runtime: 'configured', rememberOnThisMac: true } as const
    booted = false
    await expect(assistant.connect(input)).rejects.toMatchObject({ code: 'assistant_context_stale' })
    expect(start).not.toHaveBeenCalled()
    booted = true
    await assistant.connect(input)
    expect(start.mock.calls[0]).toBeDefined()
    expect(persist).toHaveBeenCalledWith({ platform: 'ios', appiumExecutablePath: '/trusted/appium' })
    expect(run).not.toHaveBeenCalled()
    await expect(assistant.connect(input)).rejects.toMatchObject({ code: 'assistant_context_consumed' })
  })

  it('discovers only authorized physical USB Android devices and keeps scrcpy optional', async () => {
    const runner = androidRunner()
    const strategy = new AndroidConnectionStrategy(config(), strategyOptions(runner))
    const output = await strategy.check('/trusted/appium')

    expect(output.devices).toHaveLength(1)
    expect(output.devices[0]).toMatchObject({ secret: { platform: 'android', serial: ANDROID_SERIAL, settingsActivity: '.Settings' }, osVersion: '15.0' })
    expect(output.media).toEqual({ mode: 'polling', code: 'assistant_media_not_selected' })
    expect(output.checks.some(check => check.id === 'scrcpy')).toBe(false)
    const commands = runner.calls.map((call) => `${call.command} ${call.args.join(' ')}`).join('\n')
    expect(commands).toContain('devices -l')
    expect(commands).not.toMatch(/ install | push |settings put|tcpip|connect /)
    expect(JSON.stringify(output.checks)).not.toContain(ANDROID_SERIAL)
  })

  it('rejects Android unauthorized/emulator/TCP rows and maps a timeout without mutation', async () => {
    const runner = new FakeRunner((command, args) => {
      if (args[0] === 'version') return result('', { ok: false, timedOut: true, exitCode: null })
      if (args[0] === 'devices') return result([
        'List of devices attached',
        'unauthorized-one unauthorized usb:1-1',
        'emulator-5554 device transport_id:1',
        '192.168.1.5:5555 device product:test',
      ].join('\n'))
      return result('', { ok: false, exitCode: 1 })
    })
    const output = await new AndroidConnectionStrategy(config(), strategyOptions(runner)).check('/trusted/appium')
    expect(output.devices).toEqual([])
    expect(output.checks).toContainEqual(expect.objectContaining({ id: 'adb', code: 'assistant_check_timeout' }))
    expect(output.checks).toContainEqual(expect.objectContaining({ id: 'device', code: 'assistant_android_device_unauthorized' }))
  })

  it('isolates iOS discovery and uses a consumable Viewer preflight authorization', async () => {
    const runner = iosRunner()
    const run = vi.fn(async (_signal?: AbortSignal, request?: { authorization?: { consume(): boolean } }) => {
      expect(request?.authorization?.consume()).toBe(true)
      return readyPreflight()
    })
    const strategy = new IosConnectionStrategy(config(), {
      ...strategyOptions(runner),
      preflight: { run } as unknown as IosWdaPreflightService,
    })
    const output = await strategy.check('/trusted/appium')
    expect(output.devices).toHaveLength(1)
    expect(output.devices[0]).toMatchObject({ secret: { platform: 'ios', udid: IOS_UDID } })
    expect(run).toHaveBeenCalledWith(undefined, expect.objectContaining({ appiumExecutablePath: '/trusted/appium' }))
    const firstCall = run.mock.calls[0] as unknown as [AbortSignal | undefined, { authorization: { consume(): boolean } }]
    const authorization = firstCall[1].authorization
    expect(authorization.consume()).toBe(false)
    expect(runner.calls.some((call) => call.command.includes('adb'))).toBe(false)
    expect(JSON.stringify(output.checks)).not.toContain(IOS_UDID)
  })
})

describe('ConnectionAssistantService orchestration', () => {
  it.each(['android', 'ios'] as const)('connects %s current-screen without launching an app and retains platform/confirmation/replay guards', async (platform) => {
    const runner = platform === 'android' ? androidRunner(true) : iosRunner(true)
    const start = vi.fn(async (_input: StartMirrorInput) => mirrorState())
    const armOnce = vi.fn()
    const assistant = serviceHarness(platform, runner, start, armOnce)
    const report = await assistant.check({ platform })
    const input = parseConnectionAssistantConnectInput({
      assistantId: report.assistantId, deviceRef: report.devices[0]!.deviceRef,
      targetPreset: `${platform}-current-screen`, runtime: 'configured',
      ...(platform === 'android' ? { confirmHelperApkSideEffect: true } : {}),
    })
    expect(() => parseConnectionAssistantConnectInput({ ...input, targetPreset: 'arbitrary-current-screen' })).toThrow()
    expect(() => parseConnectionAssistantConnectInput({ ...input, capabilities: { 'appium:appPackage': 'private.app' } })).toThrow()
    await expect(assistant.connect({ ...input, targetPreset: platform === 'android' ? 'ios-current-screen' : 'android-current-screen' })).rejects.toMatchObject({ code: 'assistant_input_invalid' })
    if (platform === 'android') {
      await expect(assistant.connect({ ...input, confirmHelperApkSideEffect: false })).rejects.toMatchObject({ code: 'assistant_android_helper_confirmation_required' })
    }
    expect(start).not.toHaveBeenCalled()
    expect(armOnce).not.toHaveBeenCalled()
    await assistant.connect(input)
    const caps = start.mock.calls[0]![0].capabilities!
    expect(caps).toMatchObject({
      platformName: platform === 'android' ? 'Android' : 'iOS',
      'appium:automationName': platform === 'android' ? 'UiAutomator2' : 'XCUITest',
      'appium:udid': platform === 'android' ? ANDROID_SERIAL : IOS_UDID,
      'appium:autoLaunch': false, 'appium:noReset': true,
      'appium:forceAppLaunch': false, 'appium:shouldTerminateApp': false,
    })
    for (const key of ['app', 'appPackage', 'appActivity', 'bundleId']) expect(caps).not.toHaveProperty(`appium:${key}`)
    if (platform === 'android') expect(caps).toMatchObject({
      'appium:skipUnlock': true,
      'appium:settings': { waitForIdleTimeout: 1000, actionAcknowledgmentTimeout: 1000 },
    })
    await expect(assistant.connect(input)).rejects.toMatchObject({ code: 'assistant_context_consumed' })
  })

  it('keeps current-screen available when Settings cannot resolve and rejects Settings before consuming the context', async () => {
    const runner = androidRunner(true)
    const run = runner.run.bind(runner)
    vi.spyOn(runner, 'run').mockImplementation((command, args, options) => args.includes('resolve-activity')
      ? Promise.resolve(result('PRIVATE-untrusted/activity', { ok: false, timedOut: true })) : run(command, args, options))
    const start = vi.fn(async (_input: StartMirrorInput) => mirrorState())
    const armOnce = vi.fn()
    const assistant = serviceHarness('android', runner, start, armOnce)
    const report = await assistant.check({ platform: 'android' })
    expect(report.status).toBe('action-required')
    expect(report.devices).toMatchObject([{ settingsAvailable: false }])
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'settings-target', status: 'warning' }))
    expect(JSON.stringify(report)).not.toContain('PRIVATE-')
    const input = { assistantId: report.assistantId, deviceRef: report.devices[0]!.deviceRef, runtime: 'configured' as const, confirmHelperApkSideEffect: true }
    await expect(assistant.connect({ ...input, targetPreset: 'android-settings' })).rejects.toMatchObject({ code: 'assistant_android_settings_unresolved' })
    expect(start).not.toHaveBeenCalled()
    expect(armOnce).not.toHaveBeenCalled()
    await assistant.connect({ ...input, targetPreset: 'android-current-screen' })
    expect(start).toHaveBeenCalledOnce()
  })

  it.each(['android', 'ios'] as const)('revalidates %s device presence before a current-screen session', async (platform) => {
    const runner = platform === 'android' ? androidRunner(true) : iosRunner(true)
    const start = vi.fn(async () => mirrorState())
    const armOnce = vi.fn()
    const assistant = serviceHarness(platform, runner, start, armOnce)
    const report = await assistant.check({ platform })
    const run = runner.run.bind(runner)
    vi.spyOn(runner, 'run').mockImplementation((command, args, options) => args[0] === 'devices' || args[0] === 'xcdevice'
      ? Promise.resolve(result(platform === 'ios' ? '[]' : 'List of devices attached')) : run(command, args, options))
    await expect(assistant.connect({
      assistantId: report.assistantId, deviceRef: report.devices[0]!.deviceRef,
      targetPreset: `${platform}-current-screen`, runtime: 'configured',
      ...(platform === 'android' ? { confirmHelperApkSideEffect: true } : {}),
    })).rejects.toMatchObject({ code: `assistant_${platform}_device_unavailable` })
    expect(start).not.toHaveBeenCalled()
    expect(armOnce).not.toHaveBeenCalled()
  })

  it('retains selected-platform partial device results when Appium itself is unavailable', async () => {
    const assistant = serviceHarness('android', androidRunner(false), vi.fn(async () => mirrorState()), vi.fn())
    const report = await assistant.check({ platform: 'android' })
    expect(report.status).toBe('blocked')
    expect(report.devices).toHaveLength(1)
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'appium-cli', status: 'blocked' }))
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'device', status: 'pass' }))
  })

  it('checks and connects Android Settings through the sole MirrorService owner', async () => {
    const runner = androidRunner(true)
    const start = vi.fn(async (_input: StartMirrorInput) => mirrorState())
    const armOnce = vi.fn()
    const assistant = serviceHarness('android', runner, start, armOnce)
    const report = await assistant.check({ platform: 'android' })
    expect(report).toMatchObject({ platform: 'android', status: 'action-required', devices: [{ label: 'Android 1' }] })
    expect(report.runtimeChoices).toEqual(['configured'])
    expect(JSON.stringify(report)).not.toContain(ANDROID_SERIAL)

    await expect(assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'ios-settings',
      runtime: 'configured',
      confirmHelperApkSideEffect: true,
    })).rejects.toMatchObject({ code: 'assistant_input_invalid' })

    await assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'android-settings',
      runtime: 'configured',
      confirmHelperApkSideEffect: true,
    })
    expect(start).toHaveBeenCalledWith({
      provider: 'appium',
      capabilities: expect.objectContaining({
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': ANDROID_SERIAL,
        'appium:appPackage': 'com.android.settings',
        'appium:appActivity': '.Settings',
        'appium:forceAppLaunch': true,
        'appium:settings': {
          waitForIdleTimeout: 1_000,
          actionAcknowledgmentTimeout: 1_000,
        },
      }),
    }, undefined)
    expect(armOnce).not.toHaveBeenCalled()
    await expect(assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'android-settings',
      runtime: 'configured',
      confirmHelperApkSideEffect: true,
    })).rejects.toMatchObject({ code: 'assistant_context_consumed' })
  })

  it('arms a single managed Appium start and rejects missing Android confirmation', async () => {
    const runner = androidRunner(true)
    const start = vi.fn(async () => mirrorState())
    const armOnce = vi.fn()
    const assistant = serviceHarness('android', runner, start, armOnce, false, config(), undefined, async (path) => path === '/trusted/appium' ? '/canonical/volta-shim' : path)
    const report = await assistant.check({ platform: 'android' })
    expect(report.runtimeChoices).toEqual(['managed-once'])
    await expect(assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'android-settings',
      runtime: 'managed-once',
    })).rejects.toMatchObject({ code: 'assistant_android_helper_confirmation_required' })
    await assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'android-settings',
      runtime: 'managed-once',
      confirmHelperApkSideEffect: true,
    })
    expect(armOnce).toHaveBeenCalledWith(expect.objectContaining({ executablePath: '/direct/appium' }))
  })

  it('connects iOS Settings with only allowed signing fields and blocks provisioning mutation', async () => {
    const runner = iosRunner(true)
    const start = vi.fn(async () => mirrorState())
    const preflight = { run: vi.fn(async () => readyPreflight()) } as unknown as IosWdaPreflightService
    const assistant = serviceHarness('ios', runner, start, vi.fn(), true, config(), preflight)
    const report = await assistant.check({ platform: 'ios' })
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'wda-signing', status: 'pass', code: 'assistant_wda_prerequisites_ready' }),
      expect.objectContaining({ id: 'xcode-account', status: 'manual', code: 'assistant_xcode_account_manual' }),
      expect.objectContaining({ id: 'wda-runtime', status: 'manual', code: 'assistant_wda_runtime_unverified' }),
    ]))
    expect(start).not.toHaveBeenCalled()
    await assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'ios-settings',
      runtime: 'configured',
      signing: { teamId: 'ABCDE12345', wdaBundleId: 'com.example.WDA' },
    })
    expect(start).toHaveBeenCalledWith({
      provider: 'appium',
      capabilities: expect.objectContaining({
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:bundleId': 'com.apple.Preferences',
        'appium:xcodeOrgId': 'ABCDE12345',
        'appium:updatedWDABundleId': 'com.example.WDA',
      }),
    }, undefined)

    const blocked = serviceHarness('ios', iosRunner(true), vi.fn(), vi.fn(), true, config({ iosWdaAllowProvisioningDeviceRegistration: true }), preflight)
    const blockedReport = await blocked.check({ platform: 'ios' })
    expect(blockedReport.status).toBe('blocked')
    await expect(blocked.connect({
      assistantId: blockedReport.assistantId,
      deviceRef: blockedReport.devices[0]!.deviceRef,
      targetPreset: 'ios-settings',
      runtime: 'configured',
    })).rejects.toMatchObject({ code: 'assistant_input_invalid' })
  })

  it('keeps a classified WDA startup failure and requires a fresh check before retry', async () => {
    const start = vi.fn(async () => mirrorState())
    start.mockRejectedValueOnce(new WdaStartError(
      'wda_developer_account_unavailable',
      'Sign in to the Apple developer account for this Team in Xcode Settings > Accounts, then rerun the iOS readiness check and connect.',
      null,
      new Error('PRIVATE_ACCOUNT@example.com TEAM-SECRET /Users/private'),
    ))
    const assistant = serviceHarness('ios', iosRunner(true), start, vi.fn(), true, config())
    const report = await assistant.check({ platform: 'ios' })
    const request = {
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'ios-current-screen' as const,
      runtime: 'configured' as const,
      signing: { teamId: 'ABCDE12345', wdaBundleId: 'com.example.WDA' },
    }
    await expect(assistant.connect(request)).rejects.toMatchObject({ code: 'wda_developer_account_unavailable' })
    await expect(assistant.connect(request)).rejects.toMatchObject({ code: 'assistant_context_consumed' })
    const retryReport = await assistant.check({ platform: 'ios' })
    await expect(assistant.connect({
      ...request,
      assistantId: retryReport.assistantId,
      deviceRef: retryReport.devices[0]!.deviceRef,
    })).resolves.toMatchObject({ lifecycle: 'streaming' })
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('persists only a validated local setup before starting and leaves the context reusable on write failure', async () => {
    const signing = { teamId: 'ABCDE12345', wdaBundleId: 'com.example.WDA' }
    const persistSetup = vi.fn(async () => undefined)
    const start = vi.fn(async () => mirrorState())
    const assistant = serviceHarness('ios', iosRunner(true), start, vi.fn(), true, config(), undefined, undefined, persistSetup)
    const report = await assistant.check({ platform: 'ios' })
    await assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'ios-settings',
      runtime: 'configured',
      signing,
      rememberOnThisMac: true,
    })
    expect(persistSetup).toHaveBeenCalledWith({
      platform: 'ios',
      appiumExecutablePath: '/trusted/appium',
      signing,
    })
    expect(persistSetup.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]!)

    const failingPersistence = vi.fn(async () => { throw new Error('PRIVATE PATH / secret') })
    const notStarted = vi.fn(async () => mirrorState())
    const retryable = serviceHarness('ios', iosRunner(true), notStarted, vi.fn(), true, config(), undefined, undefined, failingPersistence)
    const retryableReport = await retryable.check({ platform: 'ios' })
    const request = {
      assistantId: retryableReport.assistantId,
      deviceRef: retryableReport.devices[0]!.deviceRef,
      targetPreset: 'ios-settings' as const,
      runtime: 'configured' as const,
      signing,
      rememberOnThisMac: true,
    }
    await expect(retryable.connect(request)).rejects.toMatchObject({
      code: 'assistant_persistence_failed',
      message: 'Local Viewer setup could not be saved safely',
    })
    expect(notStarted).not.toHaveBeenCalled()
    await expect(retryable.connect({ ...request, rememberOnThisMac: false })).resolves.toMatchObject({ lifecycle: 'streaming' })
  })

  it('fails before starting when persistence is not available', async () => {
    const start = vi.fn(async () => mirrorState())
    const assistant = serviceHarness('android', androidRunner(true), start, vi.fn())
    const report = await assistant.check({ platform: 'android' })
    await expect(assistant.connect({
      assistantId: report.assistantId,
      deviceRef: report.devices[0]!.deviceRef,
      targetPreset: 'android-settings',
      runtime: 'configured',
      confirmHelperApkSideEffect: true,
      rememberOnThisMac: true,
    })).rejects.toMatchObject({ code: 'assistant_persistence_unavailable' })
    expect(start).not.toHaveBeenCalled()
  })
})

function strategyOptions(runner: HostCommandRunner) {
  return {
    runner,
    executableAccess: async () => undefined,
    resolvePath: async (path: string) => path,
    now: () => 1_000,
  }
}

function androidRunner(includeAppium = false): FakeRunner {
  return new FakeRunner((command, args) => {
    if (includeAppium && command === '/trusted/appium' && args[0] === '--version') return result('3.2.0')
    if (includeAppium && command === '/trusted/appium' && args[0] === 'driver') return result(JSON.stringify({ uiautomator2: { installed: true, version: '5.0.0' } }))
    if (includeAppium && command === '/canonical/volta' && args[0] === 'which') return result('/direct/appium')
    if (command === '/trusted/adb' && args[0] === 'version') return result('Android Debug Bridge version 1.0.41')
    if (command === '/trusted/adb' && args[0] === 'devices') return result([
      'List of devices attached',
      `${ANDROID_SERIAL} device usb:1-1 product:private model:PRIVATE_MODEL transport_id:1`,
      'emulator-5554 device product:sdk transport_id:2',
      '192.168.1.2:5555 device product:tcp',
    ].join('\n'))
    if (command === '/trusted/adb' && args.includes('getprop')) return result('15.0')
    if (command === '/trusted/adb' && args.includes('resolve-activity')) return result('com.android.settings/.Settings')
    return result('', { ok: false, exitCode: 1 })
  })
}

function iosRunner(includeAppium = false): FakeRunner {
  return new FakeRunner((command, args) => {
    if (includeAppium && command === '/trusted/appium' && args[0] === '--version') return result('3.2.0')
    if (includeAppium && command === '/trusted/appium' && args[0] === 'driver') return result(JSON.stringify({ xcuitest: { installed: true, version: '10.19.1' } }))
    if (args[0] === 'xcdevice') return result(JSON.stringify([{
      identifier: IOS_UDID,
      platform: 'com.apple.platform.iphoneos',
      available: true,
      simulator: false,
      operatingSystemVersion: '18.6.2',
      name: 'PRIVATE IPHONE NAME',
    }]))
    return result('', { ok: false, exitCode: 1 })
  })
}

function readyPreflight(): IosWdaPreflightResult {
  return {
    status: 'ready',
    wdaRuntime: 'not-verified',
    checks: { signingConfig: true, xcode: true, xcuitestDriver: true, iosDevice: true, signingIdentity: true, provisioningProfile: true },
    counts: { iosDevices: 1, signingIdentities: 1 },
    versions: { xcode: '26.6', appium: '3.2.0', xcuitestDriver: '10.19.1' },
    issues: [],
    warnings: [],
    manualChecks: ['device_trust', 'developer_mode', 'ui_automation', 'xcode_account'],
  }
}

function serviceHarness(
  platform: 'android' | 'ios',
  runner: FakeRunner,
  start: ReturnType<typeof vi.fn<(input: StartMirrorInput, signal?: AbortSignal) => Promise<MirrorState>>>,
  armOnce: ReturnType<typeof vi.fn<(arm: AppiumRuntimeArm) => void>>,
  endpointReady = true,
  pluginConfig = config(),
  preflight?: IosWdaPreflightService,
  resolvePath: (path: string) => Promise<string> = async (path) => path,
  persistSetup?: (input: { platform: 'android' | 'ios'; appiumExecutablePath: string; signing?: { teamId: string; wdaBundleId: string } }) => Promise<void>,
): ConnectionAssistantService {
  const service = { start } as unknown as MirrorService
  const runtime = {
    state: () => ({ mode: 'external', phase: 'idle', owned: false, lastErrorCode: null }),
    ensureReady: async () => undefined,
    stop: async () => undefined,
    armOnce,
    cancelArm: () => false,
  } satisfies ArmableAppiumRuntimeLifecycle
  return new ConnectionAssistantService(pluginConfig, {
    service,
    runtime,
    runner,
    ...(preflight ? { iosWdaPreflight: preflight } : platform === 'ios' ? { iosWdaPreflight: { run: async () => readyPreflight() } as unknown as IosWdaPreflightService } : {}),
    executableAccess: async () => undefined,
    resolvePath,
    appiumStatus: async () => ({ ready: endpointReady, version: endpointReady ? '3.2.0' : null }),
    hostPlatform: 'darwin',
    now: () => 1_000,
    ...(persistSetup ? { persistSetup } : {}),
  })
}

function mirrorState(): MirrorState {
  return {
    lifecycle: 'streaming', provider: 'appium', sessionId: 'opaque-session', deviceName: 'Generic device',
    viewerUrl: 'http://127.0.0.1:0', frameUpdatedAt: null, lastAction: null, lastError: null, lastErrorCode: null,
    observation: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    control: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    media: { mode: 'polling', phase: 'idle', transport: 'appium-screenshot', startedAt: null, firstFrameAt: null, lastFrameAt: null, width: null, height: null, targetFps: null, lastErrorCode: null },
    appiumRuntime: { mode: 'external', phase: 'idle', owned: false, lastErrorCode: null }, revision: 1,
  }
}
