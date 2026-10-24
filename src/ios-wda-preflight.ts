import { homedir } from 'node:os'
import type { Config } from './config.js'
import { NodeHostCommandRunner, type HostCommandResult, type HostCommandRunner } from './host-command-runner.js'
import { readHostPrerequisite } from './preflight-host-checks.js'

export type IosWdaPreflightStatus = 'disabled' | 'blocked' | 'ready'

export type IosWdaPreflightCode =
  | 'host_diagnostics_disabled'
  | 'host_diagnostics_timeout'
  | 'xcode_unavailable'
  | 'xcuitest_driver_unavailable'
  | 'ios_device_unavailable'
  | 'wda_signing_config_incomplete'
  | 'wda_profile_missing'
  | 'wda_signing_identity_invalid'

export interface IosWdaPreflightIssue {
  code: IosWdaPreflightCode
  action: string
}

export interface IosWdaPreflightResult {
  status: IosWdaPreflightStatus
  /** Static host checks cannot prove that WDA will start on the selected device. */
  wdaRuntime: 'not-verified'
  checks: {
    signingConfig: boolean | null
    xcode: boolean | null
    xcuitestDriver: boolean | null
    iosDevice: boolean | null
    signingIdentity: boolean | null
    provisioningProfile: boolean | null
  }
  counts: {
    iosDevices: number
    signingIdentities: number
  }
  versions: {
    xcode: string | null
    appium: string | null
    xcuitestDriver: string | null
  }
  issues: IosWdaPreflightIssue[]
  warnings: string[]
  manualChecks: Array<'device_trust' | 'developer_mode' | 'ui_automation' | 'xcode_account'>
}

export class ViewerHostDiagnosticsGrant {
  readonly expiresAt: number
  readonly #now: () => number
  #consumed = false

  constructor(expiresAt: number, now: () => number = Date.now) {
    this.expiresAt = expiresAt
    this.#now = now
  }

  consume(): boolean {
    if (this.#consumed || this.expiresAt <= this.#now()) return false
    this.#consumed = true
    return true
  }
}

export interface IosWdaPreflightRequest {
  authorization?: ViewerHostDiagnosticsGrant
  appiumExecutablePath?: string
  xcodeOrgId?: string
  updatedWdaBundleId?: string
}

export const IOS_WDA_PROVISIONING_WARNING = 'Automatic provisioning is authorized: Xcode may update profiles or register the device in Apple Developer.'

const PROFILE_DIRECTORIES = [
  'Library/MobileDevice/Provisioning Profiles',
  'Library/Developer/Xcode/UserData/Provisioning Profiles',
]

export class IosWdaPreflightService {
  readonly #config: Config
  readonly #runner: HostCommandRunner

  constructor(config: Config, runner: HostCommandRunner = new NodeHostCommandRunner()) {
    this.#config = config
    this.#runner = runner
  }

  async run(signal?: AbortSignal, request: IosWdaPreflightRequest = {}): Promise<IosWdaPreflightResult> {
    const warnings = this.#config.iosWdaAllowProvisioningDeviceRegistration
      ? [IOS_WDA_PROVISIONING_WARNING]
      : []
    const viewerAuthorized = request.authorization?.consume() ?? false
    if (!this.#config.allowHostSigningDiagnostics && !viewerAuthorized) {
      return {
        status: 'disabled',
        wdaRuntime: 'not-verified',
        checks: emptyChecks(),
        counts: { iosDevices: 0, signingIdentities: 0 },
        versions: { xcode: null, appium: null, xcuitestDriver: null },
        issues: [{
          code: 'host_diagnostics_disabled',
          action: 'Set allowHostSigningDiagnostics=true in your personal DSH profile to run read-only host checks.',
        }],
        warnings,
        manualChecks: manualChecks(),
      }
    }

    const appiumExecutable = request.appiumExecutablePath ?? 'appium'
    if (request.appiumExecutablePath !== undefined && !request.appiumExecutablePath.startsWith('/')) {
      throw new TypeError('iOS WDA preflight Appium executable must be absolute')
    }
    const [xcode, appiumVersionResult, appiumDrivers, devices, identities] = await Promise.all([
      readHostPrerequisite(this.#runner, 'xcode-version', 'xcodebuild', signal),
      readHostPrerequisite(this.#runner, 'appium-version', appiumExecutable, signal),
      readHostPrerequisite(this.#runner, 'appium-drivers', appiumExecutable, signal),
      readHostPrerequisite(this.#runner, 'ios-devices', this.#config.xcrunPath, signal),
      this.#runner.run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { signal, timeoutMs: 10_000 }),
    ])

    const issues: IosWdaPreflightIssue[] = []
    addTimeoutIssue(issues, xcode, appiumVersionResult, appiumDrivers, devices, identities)

    const xcodeVersion = parseXcodeVersion(xcode)
    const appiumVersion = parseAppiumVersion(appiumVersionResult)
    const xcuitestDriverVersion = parseXcuitestDriverVersion(appiumDrivers)
    const iosDeviceCount = parsePhysicalIosDeviceCount(devices)
    const signingIdentityCount = countMatchingSigningIdentities(identities, this.#config.iosWdaXcodeSigningId)
    const xcodeOrgId = request.xcodeOrgId ?? this.#config.iosWdaXcodeOrgId
    const updatedWdaBundleId = request.updatedWdaBundleId ?? this.#config.iosWdaUpdatedBundleId
    const configComplete = await this.#signingConfigComplete(xcodeOrgId, updatedWdaBundleId, signal)
    const profileMatches = configComplete
      ? await this.#hasMatchingProvisioningProfile(xcodeOrgId, updatedWdaBundleId, signal)
      : null

    if (!xcodeVersion) issues.push({
      code: 'xcode_unavailable',
      action: 'Install or select Xcode command-line tools, then rerun the preflight.',
    })
    if (!xcuitestDriverVersion) issues.push({
      code: 'xcuitest_driver_unavailable',
      action: 'Install the Appium XCUITest driver and verify it with appium driver list --installed.',
    })
    if (iosDeviceCount === 0) issues.push({
      code: 'ios_device_unavailable',
      action: 'Connect, unlock, and trust a physical iPhone before retrying.',
    })
    if (!configComplete) issues.push({
      code: 'wda_signing_config_incomplete',
      action: 'Configure a Team ID and unique WDA bundle ID in your personal DSH profile; verify any xcconfig path is readable.',
    })
    if (signingIdentityCount === 0) issues.push({
      code: 'wda_signing_identity_invalid',
      action: 'Repair an Apple Development identity with its private key in Xcode Accounts and Keychain.',
    })
    if (profileMatches === false) issues.push({
      code: 'wda_profile_missing',
      action: 'Run WebDriverAgentRunner once from Xcode with automatic signing, or explicitly authorize automatic provisioning.',
    })

    return {
      status: issues.length === 0 ? 'ready' : 'blocked',
      wdaRuntime: 'not-verified',
      checks: {
        signingConfig: configComplete,
        xcode: Boolean(xcodeVersion),
        xcuitestDriver: Boolean(xcuitestDriverVersion),
        iosDevice: iosDeviceCount > 0,
        signingIdentity: signingIdentityCount > 0,
        provisioningProfile: profileMatches,
      },
      counts: { iosDevices: iosDeviceCount, signingIdentities: signingIdentityCount },
      versions: {
        xcode: xcodeVersion,
        appium: appiumVersion,
        xcuitestDriver: xcuitestDriverVersion,
      },
      issues: deduplicateIssues(issues),
      warnings,
      manualChecks: manualChecks(),
    }
  }

  async #signingConfigComplete(xcodeOrgId: string, updatedWdaBundleId: string, signal?: AbortSignal): Promise<boolean> {
    if (!xcodeOrgId.trim() || !updatedWdaBundleId.trim()) return false
    if (!this.#config.iosWdaXcodeConfigFile.trim()) return true
    const result = await this.#runner.run('/usr/bin/test', ['-r', this.#config.iosWdaXcodeConfigFile], {
      signal,
      timeoutMs: 5_000,
    })
    return result.ok
  }

  async #hasMatchingProvisioningProfile(xcodeOrgId: string, updatedWdaBundleId: string, signal?: AbortSignal): Promise<boolean> {
    const profilePaths: string[] = []
    for (const relativeDirectory of PROFILE_DIRECTORIES) {
      const directory = `${homedir()}/${relativeDirectory}`
      const result = await this.#runner.run('/usr/bin/find', [
        directory,
        '-maxdepth', '1',
        '-type', 'f',
        '(', '-name', '*.mobileprovision', '-o', '-name', '*.provisionprofile', ')',
        '-print',
      ], { signal, timeoutMs: 10_000 })
      if (result.ok) profilePaths.push(...result.stdout.split('\n').map((value) => value.trim()).filter(Boolean))
    }

    for (const path of [...new Set(profilePaths)].slice(0, 64)) {
      const decoded = await this.#runner.run('/usr/bin/security', ['cms', '-D', '-i', path], {
        signal,
        timeoutMs: 10_000,
      })
      if (decoded.ok && profileMatches(decoded.stdout, xcodeOrgId, updatedWdaBundleId)) {
        return true
      }
    }
    return false
  }
}

function emptyChecks(): IosWdaPreflightResult['checks'] {
  return {
    signingConfig: null,
    xcode: null,
    xcuitestDriver: null,
    iosDevice: null,
    signingIdentity: null,
    provisioningProfile: null,
  }
}

function manualChecks(): IosWdaPreflightResult['manualChecks'] {
  return ['device_trust', 'developer_mode', 'ui_automation', 'xcode_account']
}

function parseXcodeVersion(result: HostCommandResult): string | null {
  if (!result.ok) return null
  return result.stdout.match(/^Xcode\s+([^\s]+)/m)?.[1] ?? null
}

function parseAppiumVersion(result: HostCommandResult): string | null {
  if (!result.ok) return null
  return result.stdout.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? null
}

function parseXcuitestDriverVersion(result: HostCommandResult): string | null {
  if (!result.ok) return null
  try {
    const jsonStart = result.stdout.indexOf('{')
    const payload = JSON.parse(jsonStart >= 0 ? result.stdout.slice(jsonStart) : result.stdout) as Record<string, unknown>
    const xcuitest = payload.xcuitest as { version?: unknown; installed?: unknown; appiumVersion?: unknown } | undefined
    return xcuitest?.installed !== false && typeof xcuitest?.version === 'string' ? xcuitest.version : null
  } catch {
    return null
  }
}

export function parsePhysicalIosDeviceCount(result: HostCommandResult): number {
  if (!result.ok) return 0
  try {
    const devices = JSON.parse(result.stdout) as Array<Record<string, unknown>>
    return devices.filter((device) => device.platform === 'com.apple.platform.iphoneos'
      && device.available === true && device.simulator !== true).length
  } catch {
    return 0
  }
}

function countMatchingSigningIdentities(result: HostCommandResult, signingId: string): number {
  if (!result.ok || !signingId.trim()) return 0
  const normalized = signingId.toLowerCase()
  return result.stdout.split('\n').filter((line) => line.toLowerCase().includes(normalized)).length
}

function profileMatches(xml: string, teamId: string, bundleId: string): boolean {
  const team = escapeRegExp(teamId.trim())
  const bundle = escapeRegExp(bundleId.trim().replace(/\.xctrunner$/, ''))
  if (!team || !bundle) return false
  const identifiers = [...xml.matchAll(/<key>application-identifier<\/key>\s*<string>([^<]+)<\/string>/g)]
    .map((match) => match[1] ?? '')
  return identifiers.some((identifier) => identifier === `${teamId}.*`
    || new RegExp(`^${team}\\.${bundle}(?:\\.xctrunner)?$`).test(identifier))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function addTimeoutIssue(issues: IosWdaPreflightIssue[], ...results: HostCommandResult[]): void {
  if (results.some((result) => result.timedOut)) {
    issues.push({
      code: 'host_diagnostics_timeout',
      action: 'A read-only host diagnostic timed out. Verify local Xcode/Appium responsiveness and retry.',
    })
  }
}

function deduplicateIssues(issues: IosWdaPreflightIssue[]): IosWdaPreflightIssue[] {
  return [...new Map(issues.map((issue) => [issue.code, issue])).values()]
}
