import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { PACKAGE_VERSION } from './version.js'
import { checkScrcpy } from './preflight-media.js'
import { BoundedPreflightRunner, readHostPrerequisite } from './preflight-host-checks.js'
import { EnvironmentPreflightService, normalizePreflight, PreflightInputError, type PreflightInput, type PreflightReport } from './environment-preflight.js'
import { checkDshVersion, checkDshProfile, type DshTarget } from './preflight-dsh.js'
import { resolvePreflightProject, type PreflightProject } from './preflight-project.js'
import { doctorOcr } from './workbench-ocr-helper.js'
import { requireOcrApproval } from './workbench-ocr-approval.js'
import { ocrProjectDigest } from './workbench-project.js'
import type { Config } from './config.js'
import { NodeHostCommandRunner, type HostCommandRunner } from './host-command-runner.js'
import { IosWdaPreflightService, parsePhysicalIosDeviceCount, type IosWdaPreflightResult } from './ios-wda-preflight.js'

export type DoctorPlatform = 'android' | 'ios' | 'all'
export type DoctorCheckStatus = 'pass' | 'warning' | 'blocked' | 'manual' | 'skipped'

export interface DoctorCheck {
  id: string
  status: DoctorCheckStatus
  code: string
  version?: string
  counts?: Record<string, number>
  suggestion: string
}

export type DoctorReport = PreflightReport

export interface DoctorServiceOptions {
  runner?: HostCommandRunner
  appiumStatus?: (url: string, signal?: AbortSignal) => Promise<{ ready: boolean; version: string | null }>
  executableAccess?: (path: string) => Promise<void>
  iosPreflight?: Pick<IosWdaPreflightService, 'run'>
  nodeVersion?: string
  dsh?: DshTarget
  reportPath?: string
  ocrCache?: string
  recordingSupported?: boolean
  timeoutMs?: number
}

export class DoctorService {
  readonly #config: Config
  readonly #runner: HostCommandRunner
  readonly #appiumStatus: (url: string, signal?: AbortSignal) => Promise<{ ready: boolean; version: string | null }>
  readonly #executableAccess: (path: string) => Promise<void>
  readonly #iosPreflight: Pick<IosWdaPreflightService, 'run'>
  readonly #nodeVersion: string
  readonly #options: DoctorServiceOptions

  constructor(config: Config, options: DoctorServiceOptions = {}) {
    this.#config = config
    this.#options = options
    const runner = new BoundedPreflightRunner(options.runner ?? new NodeHostCommandRunner())
    this.#runner = { run: async (command, args, options = {}) => {
      options.signal?.throwIfAborted()
      const result = await runner.run(command, args, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 10_000, 20_000) })
      options.signal?.throwIfAborted()
      if (result.timedOut || result.aborted) throw new Error('preflight_command_incomplete')
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1_048_576) throw new Error('preflight_output_budget')
      return result
    } }
    this.#appiumStatus = options.appiumStatus ?? readAppiumStatus
    this.#executableAccess = options.executableAccess ?? (async (path) => access(path, constants.X_OK))
    this.#iosPreflight = options.iosPreflight ?? new IosWdaPreflightService(config, new DoctorCommandRunner(this.#runner, config.appiumExecutablePath))
    this.#nodeVersion = options.nodeVersion ?? process.versions.node
  }

  async run(input: PreflightInput | DoctorPlatform = {}, signal?: AbortSignal): Promise<DoctorReport> {
    const context = normalizePreflight(typeof input === 'string' ? { platform: input } : input)
    if (context.entry !== 'dsh' && this.#options.dsh || context.operation !== 'report' && this.#options.reportPath) throw new PreflightInputError()
    for (const path of [this.#options.dsh?.executable, this.#options.dsh?.profileRoot, this.#options.reportPath, this.#options.ocrCache]) if (path !== undefined && !isAbsolute(path)) throw new PreflightInputError()
    context.revision = createHash('sha256').update(JSON.stringify({ config: this.#config, target: this.#options.dsh ?? null })).digest('hex')
    const budget = Math.min(60_000, Math.max(1, this.#options.timeoutMs ?? 60_000)), started = Date.now()
    const timeout = AbortSignal.timeout(budget)
    const operationSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let registered: PreflightProject | undefined
    let preparationTimedOut = false
    if (context.operation === 'test') {
      try { registered = await resolvePreflightProject(context, this.#config, operationSignal) }
      catch (error) { signal?.throwIfAborted(); if (!timeout.aborted) throw error; preparationTimedOut = true }
    }
    return await new EnvironmentPreflightService(async (item, selectedSignal) => {
      selectedSignal.throwIfAborted()
      if (preparationTimedOut) return [check(item.id, 'manual', 'preflight_timeout', 'Retry registered test preparation.')]
      switch (item.id) {
        case 'node': return [nodeCheck(this.#nodeVersion)]
        case 'package': return [check('package', 'pass', 'package_loaded', 'Installed FlowAssert package loaded.', PACKAGE_VERSION)]
        case 'configuration': case 'mcp-configuration': case 'mock-configuration': return [check(item.id, 'pass', 'configuration_valid', 'Selected runtime configuration parsed; runtime startup is not verified.')]
        case 'registered-test': return [check(item.id, 'pass', 'registered_test_valid', 'Registered test preparation validated; no test or hook has run.')]
        case 'report-store': {
          if (!this.#options.reportPath) return [check(item.id, 'pass', 'report_runtime_ready', 'Report runtime prerequisites only; no report store was selected.')]
          try { await access(this.#options.reportPath, constants.R_OK); const info = await stat(this.#options.reportPath); if (!info.isFile() && !info.isDirectory()) throw new Error(); return [check(item.id, 'pass', 'report_store_readable', 'Selected report/store is readable; contents have not been executed.')] }
          catch { return [check(item.id, 'blocked', 'report_store_unavailable', 'Select an existing readable report/store.')] }
        }
        case 'dsh-version': return await checkDshVersion(this.#options.dsh ?? {}, this.#runner, selectedSignal)
        case 'dsh-profile': return await checkDshProfile(this.#options.dsh ?? {}, selectedSignal)
        case 'appium-endpoint': return [await this.#endpointCheck(selectedSignal)]
        case 'appium-command': return await this.#appiumCommandChecks(context.platform as DoctorPlatform, selectedSignal)
        case 'android': return await this.#androidChecks(selectedSignal)
        case 'ios': return await this.#iosChecks(selectedSignal)
        case 'media': {
          if (context.provider !== 'appium') return [check('media', 'manual', 'media_session_not_selected', 'Select a physical connection for low-latency media.')]
          if (this.#config.viewerMediaMode !== 'auto') return [check('media', 'blocked', 'media_disabled_by_configuration', 'Enable automatic media transport in trusted runtime configuration.')]
          const checks: DoctorCheck[] = []
          if (context.platform !== 'ios') checks.push(await this.#scrcpyCheck(selectedSignal))
          if (context.platform !== 'android') checks.push(check('ios-media', 'manual', 'mjpeg_runtime_unverified', 'MJPEG availability is verified after an authorized session starts; PNG remains available.'))
          return checks
        }
        case 'ocr': {
          if (!this.#options.ocrCache) return [check('ocr', 'manual', 'ocr_cache_required', 'Select an explicitly prepared OCR cache; doctor never compiles it.')]
          try {
            const helper = await doctorOcr(this.#options.ocrCache, selectedSignal)
            if (registered) for (const id of registered.ocr) requireOcrApproval(registered.project.ocrProfiles?.[id], ocrProjectDigest(registered.project), helper.identity)
            return [check('ocr', 'pass', 'ocr_prerequisites_ready', 'OCR helper and selected approval metadata verified; recognition has not run.')]
          } catch { return [check('ocr', 'blocked', 'ocr_prerequisites_unavailable', 'Prepare OCR explicitly and review the registered profile approval.')] }
        }
        case 'ai-recovery': {
          if (!registered || !registered.recovery.size) return [check('ai-recovery', 'manual', 'recovery_registration_required', 'Select a registered test with an approved recovery policy.')]
          const ready = [...registered.recovery].every(id => { const policy = registered!.project.recoveryPolicies[id]; const model = policy && registered!.project.recoveryModels[policy.modelRef]; return model && Boolean(process.env[model.apiKeyEnv]) })
          return [check('ai-recovery', ready ? 'pass' : 'blocked', ready ? 'recovery_configuration_ready' : 'recovery_credential_unavailable', 'Only registered policy and credential presence checked; no model request was sent.')]
        }
        case 'recording': return [check('recording', context.entry !== 'viewer' || this.#options.recordingSupported === undefined ? 'manual' : this.#options.recordingSupported ? 'pass' : 'blocked', 'recording_browser_check_required', 'Browser API/MIME support is a local hint; no capture has started.')]
        default: throw new PreflightInputError()
      }
    }, Math.max(1, budget - (Date.now() - started))).run(context, signal)
  }

  async #endpointCheck(signal?: AbortSignal): Promise<DoctorCheck> {
    const target = new URL(this.#config.appiumUrl)
    if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password || target.search || target.hash) return check('appium-endpoint', 'blocked', 'appium_endpoint_invalid', 'Use an explicit loopback Appium endpoint.')
    const result = await this.#appiumStatus(this.#config.appiumUrl, signal)
    if (result.ready) return check('appium-endpoint', 'pass', 'appium_ready', 'Appium is ready.', result.version ? parseVersion(result.version) ?? undefined : undefined)
    if (this.#config.appiumRuntimeMode === 'managed') {
      return check('appium-endpoint', 'warning', 'managed_appium_not_running', 'Managed Appium starts lazily with mobile_mirror_start.')
    }
    return check('appium-endpoint', 'blocked', 'appium_unreachable', 'Start the configured external Appium server and retry.')
  }

  async #appiumCommandChecks(platform: DoctorPlatform, signal?: AbortSignal): Promise<DoctorCheck[]> {
    const path = this.#config.appiumExecutablePath
    if (!path) {
      return [
        check('appium-executable', this.#config.appiumRuntimeMode === 'managed' ? 'blocked' : 'manual', 'appium_executable_not_configured', 'Set an absolute Appium executable path to validate the CLI and installed drivers.'),
        check('appium-drivers', 'manual', 'appium_drivers_not_checked', 'Configure an Appium executable, then rerun doctor.'),
      ]
    }
    try {
      await this.#executableAccess(path)
    } catch {
      return [
        check('appium-executable', 'blocked', 'appium_executable_unavailable', 'Configure an existing executable Appium path.'),
        check('appium-drivers', 'blocked', 'appium_drivers_unavailable', 'Repair the Appium executable before checking drivers.'),
      ]
    }
    const version = await readHostPrerequisite(this.#runner, 'appium-version', path, signal)
    const publicVersion = parseVersion(version.stdout)
    const executable = version.ok && publicVersion
      ? check('appium-executable', 'pass', 'appium_executable_ready', 'Appium executable is available.', publicVersion)
      : check('appium-executable', 'blocked', 'appium_executable_unavailable', 'Configure a working Appium executable.')
    if (!version.ok) return [executable, check('appium-drivers', 'skipped', 'appium_drivers_not_checked', 'Repair the selected executable, then retry driver inspection.')]
    const drivers = await readHostPrerequisite(this.#runner, 'appium-drivers', path, signal)
    const installed = parseDrivers(drivers.stdout)
    const required = [
      ...(platform === 'android' || platform === 'all' ? ['uiautomator2'] : []),
      ...(platform === 'ios' || platform === 'all' ? ['xcuitest'] : []),
    ]
    const missing = required.filter((name) => !installed.has(name))
    const driverCheck = drivers.ok && missing.length === 0
      ? check('appium-drivers', 'pass', 'appium_drivers_ready', 'Required Appium drivers are installed.', undefined, { installed: installed.size })
      : check('appium-drivers', 'blocked', 'appium_driver_missing', 'Install the required UiAutomator2/XCUITest driver and retry.', undefined, { installed: installed.size, missing: missing.length })
    return [executable, driverCheck]
  }

  async #androidChecks(signal?: AbortSignal): Promise<DoctorCheck[]> {
    const version = await readHostPrerequisite(this.#runner, 'adb-version', this.#config.adbPath, signal)
    const adbVersion = parseVersion(version.stdout)
    const adb = version.ok
      ? check('android-adb', 'pass', 'adb_ready', 'ADB is available.', adbVersion ?? undefined)
      : check('android-adb', 'blocked', 'adb_unavailable', 'Configure a working adb command and retry.')
    if (!version.ok) return [adb, check('android-devices', 'skipped', 'android_devices_not_checked', 'Repair ADB before checking devices.')]
    const devices = await readHostPrerequisite(this.#runner, 'adb-devices', this.#config.adbPath, signal)
    const counts = parseAdbCounts(devices.stdout)
    const device = devices.ok && counts.online > 0
      ? check('android-devices', 'pass', 'android_device_ready', 'At least one authorized Android device is online.', undefined, counts)
      : check('android-devices', 'blocked', 'android_device_unavailable', 'Connect and authorize an Android device, then retry.', undefined, counts)
    return [adb, device]
  }

  async #scrcpyCheck(signal?: AbortSignal): Promise<DoctorCheck> {
    return await checkScrcpy(this.#config.androidScrcpyPath, this.#runner, signal, this.#executableAccess)
  }

  async #iosChecks(signal?: AbortSignal): Promise<DoctorCheck[]> {
    const xcode = await readHostPrerequisite(this.#runner, 'xcode-version', 'xcodebuild', signal)
    const xcodeVersion = xcode.stdout.match(/^Xcode\s+(\d+\.\d+(?:\.\d+)?)\s*$/m)?.[1]
    const xcodeCheck = xcode.ok && xcodeVersion
      ? check('ios-xcode', 'pass', 'xcode_ready', 'Xcode command-line tools are available.', xcodeVersion)
      : check('ios-xcode', 'blocked', 'xcode_unavailable', 'Install or select Xcode command-line tools.')
    const devices = await readHostPrerequisite(this.#runner, 'ios-devices', this.#config.xcrunPath, signal)
    const connected = parsePhysicalIosDeviceCount(devices)
    const deviceCheck = devices.ok && connected > 0
      ? check('ios-devices', 'pass', 'ios_device_ready', 'At least one physical iOS device is connected.', undefined, { connected })
      : check('ios-devices', 'blocked', 'ios_device_unavailable', 'Connect, unlock and trust a physical iPhone.', undefined, { connected })
    const preflight = await this.#iosPreflight.run(signal)
    return [xcodeCheck, deviceCheck, iosWdaCheck(preflight)]
  }
}

export function doctorExitCode(report: DoctorReport): 0 | 2 {
  return report.overall === 'ready' ? 0 : 2
}

export function renderDoctorHuman(report: DoctorReport): string {
  return [
    `FlowAssert doctor v2: ${report.overall} (${report.context.entry}/${report.context.operation}/${report.platform})`,
    'Scope: selected environment prerequisites only; device session, MCP handshake, DSH tools and model requests are not verified.',
    ...report.checks.map((item) => {
      const version = item.version ? ` ${item.version}` : ''
      const counts = item.counts ? ` ${Object.entries(item.counts).map(([key, value]) => `${key}=${value}`).join(' ')}` : ''
      return `[${item.status.toUpperCase()}] ${item.id}: ${item.code}${version}${counts} — ${item.suggestion}`
    }),
    '',
  ].join('\n')
}

function nodeCheck(version: string): DoctorCheck {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  const supported = major > 24 || major === 24 || (major === 22 && minor >= 19)
  return supported
    ? check('node', 'pass', 'node_supported', 'Node satisfies ^22.19.0 or >=24.0.0.', version)
    : check('node', 'blocked', 'node_unsupported', 'Use Node ^22.19.0 or >=24.0.0.', version)
}

function iosWdaCheck(result: IosWdaPreflightResult): DoctorCheck {
  const driverVersion = parseVersion(result.versions.xcuitestDriver ?? '') ?? undefined
  if (result.status === 'disabled') return check('ios-wda-signing', 'manual', 'host_diagnostics_disabled', 'Enable host signing diagnostics in a personal config or verify WDA manually in Xcode.')
  if (result.status === 'ready') return check('ios-wda-signing', 'pass', 'wda_signing_prerequisites_ready', 'Local WDA signing prerequisites passed; WDA startup remains unverified.', driverVersion, { devices: result.counts.iosDevices, identities: result.counts.signingIdentities })
  return check('ios-wda-signing', 'blocked', result.issues[0]?.code ?? 'wda_blocked', result.issues[0]?.action ?? 'Resolve WDA signing prerequisites and retry.', driverVersion, { devices: result.counts.iosDevices, identities: result.counts.signingIdentities })
}

function check(id: string, status: DoctorCheckStatus, code: string, suggestion: string, version?: string, counts?: Record<string, number>): DoctorCheck {
  return { id, status, code, ...(version ? { version } : {}), ...(counts ? { counts } : {}), suggestion }
}

function parseVersion(value: string): string | null {
  return value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? null
}

function parseDrivers(value: string): Map<string, string> {
  try {
    const start = value.indexOf('{')
    const parsed = JSON.parse(start >= 0 ? value.slice(start) : value) as Record<string, { version?: unknown; installed?: unknown }>
    return new Map(Object.entries(parsed).flatMap(([name, item]) => item.installed !== false && typeof item.version === 'string' ? [[name.toLowerCase(), item.version]] : []))
  } catch {
    return new Map()
  }
}

function parseAdbCounts(value: string): { online: number; offline: number; unauthorized: number; other: number } {
  const counts = { online: 0, offline: 0, unauthorized: 0, other: 0 }
  for (const line of value.split('\n').slice(1)) {
    const state = line.trim().split(/\s+/)[1]
    if (!state) continue
    if (state === 'device') counts.online += 1
    else if (state === 'offline') counts.offline += 1
    else if (state === 'unauthorized') counts.unauthorized += 1
    else counts.other += 1
  }
  return counts
}

class DoctorCommandRunner implements HostCommandRunner {
  readonly #target: HostCommandRunner
  readonly #appiumPath: string

  constructor(target: HostCommandRunner, appiumPath: string) {
    this.#target = target
    this.#appiumPath = appiumPath
  }

  run(command: string, args: string[], options?: Parameters<HostCommandRunner['run']>[2]) {
    return this.#target.run(command === 'appium' && this.#appiumPath ? this.#appiumPath : command, args, options)
  }
}

async function readAppiumStatus(url: string, signal?: AbortSignal): Promise<{ ready: boolean; version: string | null }> {
  try {
    const target = new URL(url)
    target.pathname = `${target.pathname.replace(/\/$/, '')}/status`
    const operationSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000)
    const response = await fetch(target, { signal: operationSignal, redirect: 'error' })
    const text = await readBoundedResponse(response, 1024 * 1024)
    const payload = JSON.parse(text) as { value?: { ready?: unknown; build?: { version?: unknown } } }
    return { ready: response.ok && payload.value?.ready === true, version: typeof payload.value?.build?.version === 'string' ? payload.value.build.version : null }
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    if (error instanceof Error && error.name === 'TimeoutError') throw error
    return { ready: false, version: null }
  }
}

async function readBoundedResponse(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > limit) throw new Error('Appium status response is too large')
    chunks.push(next.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
