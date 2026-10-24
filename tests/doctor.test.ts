import { describe, expect, it } from 'vitest'
import { Config, type Config as MirrorConfig } from '../src/config.js'
import { DoctorService, doctorExitCode, renderDoctorHuman } from '../src/doctor.js'
import type { HostCommandOptions, HostCommandResult, HostCommandRunner } from '../src/host-command-runner.js'
import type { IosWdaPreflightResult } from '../src/ios-wda-preflight.js'

describe('doctor', () => {
  it('reports an Android environment ready without device identifiers', async () => {
    const secret = 'SERIAL-PRIVATE-123'
    const config = Config({
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
      adbPath: '/trusted/adb',
      androidScrcpyPath: '/trusted/scrcpy',
    } as MirrorConfig)
    const runner = new FakeRunner({
      '/trusted/appium --version': ok('3.2.0'),
      '/trusted/appium driver list --installed --json': ok('{"uiautomator2":{"installed":true,"version":"6.8.0"}}'),
      '/trusted/adb version': ok('Android Debug Bridge version 1.0.41'),
      '/trusted/adb devices': ok(`List of devices attached\n${secret}\tdevice\n`),
      '/trusted/scrcpy --version': ok('scrcpy 4.1'),
    })
    const report = await new DoctorService(config, {
      runner,
      appiumStatus: async () => ({ ready: true, version: '3.2.0' }),
      executableAccess: async () => undefined,
      nodeVersion: '24.19.0',
    }).run({ platform: 'android', features: { media: 'preferred' } })
    expect(report.overall).toBe('ready')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'appium-drivers', status: 'pass' }),
      expect.objectContaining({ id: 'android-devices', status: 'pass', counts: { online: 1, offline: 0, unauthorized: 0, other: 0 } }),
      expect.objectContaining({ id: 'android-scrcpy', status: 'pass', version: '4.1' }),
    ]))
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(doctorExitCode(report)).toBe(0)
  })

  it('keeps disabled iOS signing diagnostics manual and sanitized', async () => {
    const config = Config({ appiumRuntimeMode: 'external' } as MirrorConfig)
    const runner = new FakeRunner({
      'xcodebuild -version': ok('Xcode 16.4\nBuild version PRIVATE'),
      'xcrun xcdevice list': ok(JSON.stringify([
        { name: 'Private iPhone', identifier: '00008110-ABCDEF1234567890', platform: 'com.apple.platform.iphoneos', available: true, simulator: false },
        { platform: 'com.apple.platform.macosx', available: true, simulator: false },
        { platform: 'com.apple.platform.iphoneos', available: false, simulator: false },
        { platform: 'com.apple.platform.iphoneos', available: true, simulator: true },
      ])),
    })
    const report = await new DoctorService(config, {
      runner,
      appiumStatus: async () => ({ ready: true, version: '3.2.0' }),
      iosPreflight: { run: async () => disabledPreflight() },
      nodeVersion: '24.19.0',
    }).run('ios')
    expect(report.overall).toBe('incomplete')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'ios-xcode', status: 'pass', version: '16.4' }),
      expect.objectContaining({ id: 'ios-devices', status: 'pass', counts: { connected: 1 } }),
      expect.objectContaining({ id: 'ios-wda-signing', status: 'manual', code: 'host_diagnostics_disabled' }),
    ]))
    expect(JSON.stringify(report)).not.toContain('Private iPhone')
    expect(JSON.stringify(report)).not.toContain('00008110')
  })

  it('blocks missing dependencies and unsupported configured scrcpy', async () => {
    const config = Config({
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
      adbPath: '/trusted/adb',
      androidScrcpyPath: '/trusted/scrcpy',
    } as MirrorConfig)
    const runner = new FakeRunner({
      '/trusted/appium --version': failed('/private/appium'),
      '/trusted/appium driver list --installed --json': ok('{}'),
      '/trusted/adb version': failed('SERIAL_SECRET'),
      '/trusted/adb devices': ok('List of devices attached\nSERIAL_SECRET\tunauthorized'),
      '/trusted/scrcpy --version': ok('scrcpy 4.0'),
    })
    const report = await new DoctorService(config, {
      runner,
      appiumStatus: async () => ({ ready: false, version: null }),
      executableAccess: async () => undefined,
      nodeVersion: '24.19.0',
    }).run({ platform: 'android', features: { media: 'required' } })
    expect(report.overall).toBe('blocked')
    expect(doctorExitCode(report)).toBe(2)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'appium_drivers_not_checked', status: 'skipped' }),
      expect.objectContaining({ code: 'adb_unavailable', status: 'blocked' }),
      expect.objectContaining({ code: 'scrcpy_version_unsupported', status: 'blocked' }),
    ]))
    const rendered = renderDoctorHuman(report)
    expect(rendered).not.toContain('SERIAL_SECRET')
    expect(rendered).not.toContain('/private')
  })

  it('maps timed-out host commands without exposing their output', async () => {
    const secret = 'PRIVATE-TIMEOUT-OUTPUT'
    const config = Config({
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
      adbPath: '/trusted/adb',
    } as MirrorConfig)
    const runner = new FakeRunner({
      '/trusted/appium --version': timedOut(secret),
      '/trusted/appium driver list --installed --json': timedOut(secret),
      '/trusted/adb version': timedOut(secret),
      '/trusted/adb devices': timedOut(secret),
    })
    const report = await new DoctorService(config, {
      runner,
      appiumStatus: async () => ({ ready: false, version: null }),
      executableAccess: async () => undefined,
      nodeVersion: '24.19.0',
    }).run('android')
    expect(report.overall).toBe('incomplete')
    expect(JSON.stringify(report)).not.toContain(secret)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'appium-command', status: 'manual' }),
      expect.objectContaining({ id: 'android', status: 'manual' }),
    ]))
  })
})

class FakeRunner implements HostCommandRunner {
  readonly #results: Record<string, HostCommandResult>

  constructor(results: Record<string, HostCommandResult>) {
    this.#results = results
  }

  async run(command: string, args: string[], _options?: HostCommandOptions): Promise<HostCommandResult> {
    return this.#results[[command, ...args].join(' ')] ?? failed('not configured')
  }
}

function ok(stdout: string): HostCommandResult {
  return { ok: true, stdout, stderr: '', exitCode: 0, timedOut: false, aborted: false }
}

function failed(stderr: string): HostCommandResult {
  return { ok: false, stdout: '', stderr, exitCode: 1, timedOut: false, aborted: false }
}

function timedOut(stderr: string): HostCommandResult {
  return { ok: false, stdout: '', stderr, exitCode: null, timedOut: true, aborted: false }
}

function disabledPreflight(): IosWdaPreflightResult {
  return {
    status: 'disabled',
    wdaRuntime: 'not-verified',
    checks: { signingConfig: null, xcode: null, xcuitestDriver: null, iosDevice: null, signingIdentity: null, provisioningProfile: null },
    counts: { iosDevices: 0, signingIdentities: 0 },
    versions: { xcode: null, appium: null, xcuitestDriver: null },
    issues: [{ code: 'host_diagnostics_disabled', action: 'Enable diagnostics.' }],
    warnings: [],
    manualChecks: ['device_trust', 'developer_mode', 'ui_automation', 'xcode_account'],
  }
}
