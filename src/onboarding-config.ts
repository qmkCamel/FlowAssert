import { isAbsolute, join } from 'node:path'
import { Config, type Config as MirrorConfig } from './config.js'

export type OnboardingPlatform = 'mock' | 'android' | 'ios'
export type OnboardingConfigTarget = 'dsh' | 'mcp' | 'codex'

export interface RenderOnboardingConfigOptions {
  target: OnboardingConfigTarget
  platform?: OnboardingPlatform
  packageRoot?: string
  configPath?: string
}

export function renderOnboardingConfig(options: RenderOnboardingConfigOptions): string {
  const platform = options.platform ?? 'mock'
  if (options.target === 'codex') return renderCodexCommand(options.packageRoot, options.configPath)
  const config = safeTemplate(platform)
  return options.target === 'dsh' ? renderDshPatch(config) : `${JSON.stringify({ ...config, mcp: { maxImageBytes: 8 * 1024 * 1024 } }, null, 2)}\n`
}

export function safeTemplate(platform: OnboardingPlatform): MirrorConfig {
  return Config({
    defaultProvider: 'mock',
    agentScreenContentPolicy: 'mock-only',
    agentTextInputPolicy: 'mock-only',
    agentAppControlPolicy: 'disabled',
    agentAllowedAppIds: [],
    appiumUrl: 'http://127.0.0.1:4723',
    appiumRuntimeMode: 'external',
    appiumExecutablePath: platform === 'mock' ? '' : '/ABSOLUTE/PATH/TO/APPIUM',
    viewerHost: '127.0.0.1',
    viewerPort: 3210,
    allowHostDeviceDiscovery: false,
    allowHostSigningDiagnostics: false,
    iosWdaAllowProvisioningDeviceRegistration: false,
    ...(platform === 'android' ? {
      adbPath: '/ABSOLUTE/PATH/TO/ADB',
      androidScrcpyPath: '/ABSOLUTE/PATH/TO/SCRCPY-4.1',
      androidScrcpyServerPath: '/ABSOLUTE/PATH/TO/SCRCPY-SERVER-4.1',
    } : {}),
    ...(platform === 'ios' ? {
      xcrunPath: '/usr/bin/xcrun',
      iosWdaXcodeOrgId: 'REPLACE_WITH_TEAM_ID',
      iosWdaUpdatedBundleId: 'com.example.WebDriverAgentRunner',
    } : {}),
  } as unknown as MirrorConfig)
}

function renderDshPatch(config: MirrorConfig): string {
  const lines = ['- id: mobile-mirror', '  config:']
  for (const [key, value] of Object.entries(config)) lines.push(`    ${key}: ${yamlScalar(value)}`)
  return `${lines.join('\n')}\n`
}

function renderCodexCommand(packageRoot?: string, configPath?: string): string {
  if (!packageRoot || !configPath || !isAbsolute(packageRoot) || !isAbsolute(configPath)) throw new Error('Codex config requires absolute package and config paths')
  const bin = join(packageRoot, 'scripts', 'mobile-mirror-mcp.mjs')
  return `codex mcp add mobile-mirror -- node ${shellQuote(bin)} --config ${shellQuote(configPath)}\n`
}

function yamlScalar(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}
