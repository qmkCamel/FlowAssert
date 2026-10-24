import { describe, expect, it } from 'vitest'
import { Config, type Config as PluginConfig } from '../src/config.js'
import type { HostCommandOptions, HostCommandResult, HostCommandRunner } from '../src/host-command-runner.js'
import { IosWdaPreflightService, ViewerHostDiagnosticsGrant } from '../src/ios-wda-preflight.js'
import { registerTools } from '../src/tools.js'
import { ViewerServer } from '../src/viewer-server.js'

const SECRET_TEAM = 'SECRETTEAM'
const SECRET_BUNDLE = 'com.private.WebDriverAgentRunner'
const SECRET_DEVICE = '00008120-001234567890001E'
const SECRET_PROFILE = '/Users/private-user/Library/MobileDevice/Provisioning Profiles/private.mobileprovision'

function config(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    ...Config({} as PluginConfig),
    viewerPort: 0,
    iosWdaXcodeOrgId: SECRET_TEAM,
    iosWdaUpdatedBundleId: SECRET_BUNDLE,
    ...overrides,
  }
}

function result(stdout = '', overrides: Partial<HostCommandResult> = {}): HostCommandResult {
  return {
    ok: true,
    stdout,
    stderr: '',
    exitCode: 0,
    timedOut: false,
    aborted: false,
    ...overrides,
  }
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

function readyRunner(): FakeRunner {
  return new FakeRunner((command, args) => {
    if (command === 'xcodebuild') return result('Xcode 26.6\nBuild version 17F113\n')
    if ((command === 'appium' || command === '/trusted/appium') && args[0] === '--version') return result('3.2.0\n')
    if (command === 'appium' || command === '/trusted/appium') return result(JSON.stringify({ xcuitest: { installed: true, version: '10.19.1' } }))
    if (args[0] === 'xcdevice') return result(JSON.stringify([{
      identifier: SECRET_DEVICE,
      platform: 'com.apple.platform.iphoneos',
      available: true,
      simulator: false,
    }]))
    if (command === '/usr/bin/security' && args[0] === 'find-identity') {
      return result(`1) 0123456789012345678901234567890123456789 "Apple Development: Private Person (${SECRET_TEAM})"`)
    }
    if (command === '/usr/bin/find') return result(`${SECRET_PROFILE}\n`)
    if (command === '/usr/bin/security' && args[0] === 'cms') {
      return result(`<plist><dict><key>application-identifier</key><string>${SECRET_TEAM}.${SECRET_BUNDLE}</string></dict></plist>`)
    }
    return result('', { ok: false, exitCode: 1 })
  })
}

describe('IosWdaPreflightService', () => {
  it('executes no host commands when diagnostics are disabled', async () => {
    const runner = readyRunner()
    const preflight = new IosWdaPreflightService(config({ allowHostSigningDiagnostics: false }), runner)

    await expect(preflight.run()).resolves.toMatchObject({
      status: 'disabled',
      wdaRuntime: 'not-verified',
      issues: [{ code: 'host_diagnostics_disabled' }],
    })
    expect(runner.calls).toEqual([])
  })

  it('returns ready with safe versions, counts, and manual device checks', async () => {
    const runner = readyRunner()
    const preflight = new IosWdaPreflightService(config({
      allowHostSigningDiagnostics: true,
      iosWdaAllowProvisioningDeviceRegistration: true,
    }), runner)

    const output = await preflight.run()
    expect(output).toMatchObject({
      status: 'ready',
      wdaRuntime: 'not-verified',
      checks: {
        signingConfig: true,
        xcode: true,
        xcuitestDriver: true,
        iosDevice: true,
        signingIdentity: true,
        provisioningProfile: true,
      },
      counts: { iosDevices: 1, signingIdentities: 1 },
      versions: { xcode: '26.6', appium: '3.2.0', xcuitestDriver: '10.19.1' },
      manualChecks: ['device_trust', 'developer_mode', 'ui_automation', 'xcode_account'],
    })
    expect(runner.calls.some((call) => call.command === 'xcodebuild' && call.args.some((arg) => arg !== '-version'))).toBe(false)
    expect(runner.calls.some((call) => call.args.includes('Accounts') || call.args.includes('session'))).toBe(false)
    expect(output.warnings).toHaveLength(1)
    const serialized = JSON.stringify(output)
    for (const secret of [SECRET_TEAM, SECRET_BUNDLE, SECRET_DEVICE, SECRET_PROFILE, 'Private Person']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('accepts one consumable Viewer grant and in-memory signing/Appium overrides without enabling MCP diagnostics', async () => {
    const runner = readyRunner()
    const preflight = new IosWdaPreflightService(config({
      allowHostSigningDiagnostics: false,
      iosWdaXcodeOrgId: '',
      iosWdaUpdatedBundleId: '',
    }), runner)
    const grant = new ViewerHostDiagnosticsGrant(2_000, () => 1_000)
    await expect(preflight.run(undefined, {
      authorization: grant,
      appiumExecutablePath: '/trusted/appium',
      xcodeOrgId: SECRET_TEAM,
      updatedWdaBundleId: SECRET_BUNDLE,
    })).resolves.toMatchObject({ status: 'ready', checks: { signingConfig: true } })
    expect(runner.calls.some((call) => call.command === '/trusted/appium' && call.args[0] === '--version')).toBe(true)
    expect(await preflight.run(undefined, { authorization: grant })).toMatchObject({
      status: 'disabled',
      issues: [{ code: 'host_diagnostics_disabled' }],
    })
  })

  it('rejects expired Viewer grants and non-absolute executable overrides before host work', async () => {
    const runner = readyRunner()
    const preflight = new IosWdaPreflightService(config({ allowHostSigningDiagnostics: false }), runner)
    await expect(preflight.run(undefined, {
      authorization: new ViewerHostDiagnosticsGrant(1_000, () => 1_000),
    })).resolves.toMatchObject({ status: 'disabled' })
    expect(runner.calls).toEqual([])

    await expect(new IosWdaPreflightService(config({ allowHostSigningDiagnostics: true }), runner).run(undefined, {
      appiumExecutablePath: 'appium',
    })).rejects.toThrow('must be absolute')
  })

  it('maps timeout and missing prerequisites to stable codes without command output', async () => {
    const runner = new FakeRunner((command) => command === 'xcodebuild'
      ? result(`timed out for ${SECRET_DEVICE}`, { ok: false, timedOut: true, exitCode: null })
      : result(`private output ${SECRET_TEAM} ${SECRET_PROFILE}`, { ok: false, exitCode: 1 }))
    const output = await new IosWdaPreflightService(config({ allowHostSigningDiagnostics: true }), runner).run()

    expect(output.status).toBe('blocked')
    expect(output.wdaRuntime).toBe('not-verified')
    expect(output.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'host_diagnostics_timeout',
      'xcode_unavailable',
      'xcuitest_driver_unavailable',
      'ios_device_unavailable',
      'wda_signing_identity_invalid',
      'wda_profile_missing',
    ]))
    expect(JSON.stringify(output)).not.toContain(SECRET_TEAM)
    expect(JSON.stringify(output)).not.toContain(SECRET_PROFILE)
  })

  it('registers a thin sanitized preflight tool', async () => {
    type RegisteredTool = {
      name: string
      execute(args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<string>
    }
    const registered: RegisteredTool[] = []
    const pluginConfig = config({ allowHostSigningDiagnostics: false })
    const preflight = new IosWdaPreflightService(pluginConfig, readyRunner())
    const viewer = new ViewerServer(pluginConfig)
    registerTools({
      tools: {
        register(tool: unknown) {
          registered.push(tool as RegisteredTool)
          return tool
        },
      },
    }, viewer, pluginConfig, { defineTool: (definition) => definition, iosWdaPreflight: preflight })

    const tool = registered.find((candidate) => candidate.name === 'mobile_mirror_ios_preflight')
    expect(tool).toBeDefined()
    const output = JSON.parse(await tool!.execute({}, { signal: new AbortController().signal })) as Record<string, unknown>
    expect(output.status).toBe('disabled')
    expect(registered.map((candidate) => candidate.name)).toContain('mobile_mirror_start')
  })
})
