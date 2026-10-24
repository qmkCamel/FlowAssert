import { describe, expect, it } from 'vitest'
import { assertAppiumRuntimeConfig, Config, type Config as PluginConfig } from '../src/config.js'

describe('Config', () => {
  it('uses side-effect-free iOS WDA defaults', () => {
    expect(Config({} as PluginConfig)).toMatchObject({
      agentScreenContentPolicy: 'mock-only',
      agentTextInputPolicy: 'mock-only',
      agentAppControlPolicy: 'disabled',
      agentAllowedAppIds: [],
      appiumRuntimeMode: 'external',
      appiumExecutablePath: '',
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
      startupTimeoutMs: 30_000,
      appiumSessionStartupTimeoutMs: 120_000,
      androidIgnoreHiddenApiPolicyError: true,
      iosWdaXcodeOrgId: '',
      iosWdaXcodeSigningId: 'Apple Development',
      iosWdaUpdatedBundleId: '',
      iosWdaXcodeConfigFile: '',
      iosWdaAllowProvisioningDeviceRegistration: false,
      allowHostSigningDiagnostics: false,
      agentTestControl: {
        enabled: false, projectPath: '', allowedFlows: [], allowedSuites: [], allowedPlatforms: [], allowedAppIds: [], sharedEvidence: [],
      },
    })
  })

  it('requires explicit registered test paths and rejects duplicate authorization entries', () => {
    expect(Config({ agentTestControl: { enabled: true, projectPath: '/tmp/project.json', allowedFlows: ['smoke'], allowedSuites: [], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.app'], sharedEvidence: ['image'] } } as unknown as PluginConfig).agentTestControl).toMatchObject({ enabled: true, allowedFlows: ['smoke'] })
    expect(() => assertAppiumRuntimeConfig(Config({ agentTestControl: { enabled: true, projectPath: '', allowedFlows: [], allowedSuites: [], allowedPlatforms: [], allowedAppIds: [], sharedEvidence: [] } } as unknown as PluginConfig))).toThrow('absolute project path')
    expect(() => Config({ agentTestControl: { enabled: false, projectPath: '', allowedFlows: ['same', 'same'], allowedSuites: [], allowedPlatforms: [], allowedAppIds: [], sharedEvidence: [] } } as unknown as PluginConfig)).toThrow('duplicate')
  })

  it('validates explicit text and exact app-control policies', () => {
    expect(Config({
      agentTextInputPolicy: 'non-sensitive',
      agentAppControlPolicy: 'allowlist',
      agentAllowedAppIds: ['com.example.App_1', 'org.example-demo'],
    } as PluginConfig)).toMatchObject({
      agentTextInputPolicy: 'non-sensitive',
      agentAppControlPolicy: 'allowlist',
      agentAllowedAppIds: ['com.example.App_1', 'org.example-demo'],
    })
    for (const agentAllowedAppIds of [
      ['com.example.same', 'com.example.same'],
      ['../private'],
      ['https://example.test/app'],
      Array.from({ length: 33 }, (_, index) => `com.example.app${index}`),
    ]) expect(() => Config({ agentAllowedAppIds } as PluginConfig)).toThrow()
  })

  it('accepts explicit structure and image screen-content policies', () => {
    expect(Config({ agentScreenContentPolicy: 'structure' } as PluginConfig)).toMatchObject({
      agentScreenContentPolicy: 'structure',
    })
    expect(Config({ agentScreenContentPolicy: 'image-and-structure' } as PluginConfig)).toMatchObject({
      agentScreenContentPolicy: 'image-and-structure',
    })
  })

  it('normalizes explicit persistent signing values', () => {
    expect(Config({
      iosWdaXcodeOrgId: 'TEAM_PLACEHOLDER',
      iosWdaUpdatedBundleId: 'com.example.WebDriverAgentRunner',
      iosWdaAllowProvisioningDeviceRegistration: true,
      allowHostSigningDiagnostics: true,
    } as PluginConfig)).toMatchObject({
      iosWdaXcodeOrgId: 'TEAM_PLACEHOLDER',
      iosWdaUpdatedBundleId: 'com.example.WebDriverAgentRunner',
      iosWdaAllowProvisioningDeviceRegistration: true,
      allowHostSigningDiagnostics: true,
    })
  })

  it('allows strict Android hidden API policy handling to be persisted', () => {
    expect(Config({
      androidIgnoreHiddenApiPolicyError: false,
    } as PluginConfig)).toMatchObject({
      androidIgnoreHiddenApiPolicyError: false,
    })
  })

  it('validates low-latency media modes, absolute paths, and numeric bounds', () => {
    expect(Config({
      viewerMediaMode: 'polling',
      androidScrcpyPath: '/opt/local/bin/scrcpy',
      androidScrcpyServerPath: '/opt/local/share/scrcpy/scrcpy-server',
      androidScrcpyMaxFps: 60,
      iosMjpegPort: 12_345,
    } as PluginConfig)).toMatchObject({
      viewerMediaMode: 'polling',
      androidScrcpyPath: '/opt/local/bin/scrcpy',
      androidScrcpyMaxFps: 60,
      iosMjpegPort: 12_345,
    })
    for (const input of [
      { viewerMediaMode: 'video' },
      { androidScrcpyPath: 'relative/scrcpy' },
      { appiumRuntimeMode: 'automatic' },
      { appiumExecutablePath: 'relative/appium' },
      { androidScrcpyServerPath: './scrcpy-server' },
      { androidScrcpyMaxFps: 121 },
      { iosMjpegPort: 1 },
      { iosMjpegFramerate: 0 },
      { iosMjpegScalingFactor: 101 },
      { appiumSessionStartupTimeoutMs: 999 },
    ]) expect(() => Config(input as unknown as PluginConfig)).toThrow()
  })

  it('fails closed for incomplete or non-loopback managed Appium configuration', () => {
    expect(assertAppiumRuntimeConfig(Config({
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
      appiumUrl: 'http://127.0.0.1:4723/wd/hub',
    } as PluginConfig))).toMatchObject({ appiumRuntimeMode: 'managed' })
    for (const input of [
      { appiumRuntimeMode: 'managed', appiumExecutablePath: '', appiumUrl: 'http://127.0.0.1:4723' },
      { appiumRuntimeMode: 'managed', appiumExecutablePath: '/trusted/appium', appiumUrl: 'https://127.0.0.1:4723' },
      { appiumRuntimeMode: 'managed', appiumExecutablePath: '/trusted/appium', appiumUrl: 'http://remote.example:4723' },
    ]) expect(() => assertAppiumRuntimeConfig(Config(input as PluginConfig))).toThrow('Managed Appium configuration is invalid')
  })
})
