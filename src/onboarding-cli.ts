import { runSuiteCli } from './workbench-cli.js'
import { runOcrCli } from './workbench-ocr-cli.js'
import { runMatrixCli } from './device-matrix-cli.js'
import { isAbsolute } from 'node:path'
import { DoctorService, doctorExitCode, renderDoctorHuman, type DoctorServiceOptions } from './doctor.js'
import { normalizePreflight, type PreflightInput } from './environment-preflight.js'
import { runHealthProbeCli } from './workbench-health-cli.js'
import { loadStandaloneMcpConfig, resolveStandaloneMcpConfig } from './mcp-config.js'
import { renderOnboardingConfig, type OnboardingConfigTarget, type OnboardingPlatform } from './onboarding-config.js'
import { PACKAGE_VERSION } from './version.js'

export interface OnboardingCliIo {
  stdout: { write(value: string): unknown }
  stderr: { write(value: string): unknown }
}

export interface OnboardingCliDependencies {
  createDoctor?: (config: ReturnType<typeof resolveStandaloneMcpConfig>['mirror'], options?: DoctorServiceOptions) => Pick<DoctorService, 'run'>
}

export async function runOnboardingCli(
  args: readonly string[] = process.argv.slice(2),
  io: OnboardingCliIo = { stdout: process.stdout, stderr: process.stderr },
  dependencies: OnboardingCliDependencies = {},
): Promise<number> {
  try {
    if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0] ?? ''))) {
      io.stdout.write(helpText())
      return 0
    }
    if (args.length === 1 && args[0] === '--version') {
      io.stdout.write(`${PACKAGE_VERSION}\n`)
      return 0
    }
    if (args[0] === 'test') return await runSuiteCli(args.slice(1),io)
    if (args[0] === 'ocr') return await runOcrCli(args.slice(1), io)
    if (args[0] === 'matrix') return await runMatrixCli(args.slice(1), io)
    if (args[0] === 'doctor') return await runDoctor(args.slice(1), io, dependencies)
    if (args[0] === 'health-probe') return await runHealthProbeCli(args.slice(1), io)
    if (args[0] === 'config') return runConfig(args.slice(1), io)
    throw new Error('invalid')
  } catch {
    io.stderr.write('Invalid mobile mirror command. Use --help for supported options.\n')
    return 1
  }
}

async function runDoctor(args: readonly string[], io: OnboardingCliIo, dependencies: OnboardingCliDependencies): Promise<number> {
  const input: Record<string, unknown> = {}
  const features: Record<string, string> = {}
  const options: DoctorServiceOptions = {}
  const seen = new Set<string>()
  let format: 'human' | 'json' = 'human'
  let configPath: string | undefined
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key || !value) throw new Error('invalid')
    if (seen.has(key)) throw new Error('invalid')
    seen.add(key)
    if (key === '--platform') input.platform = value
    else if (key === '--target') input.entry = value
    else if (key === '--operation') input.operation = value
    else if (key === '--provider') input.provider = value
    else if (key === '--test-ref') input.testRef = value
    else if (['--media', '--ocr', '--ai-recovery', '--recording'].includes(key)) features[key.slice(2)] = value
    else if (key === '--dsh-executable' && isAbsolute(value)) options.dsh = { ...options.dsh, executable: value }
    else if (key === '--dsh-profile-root' && isAbsolute(value)) options.dsh = { ...options.dsh, profileRoot: value }
    else if (key === '--report-path' && isAbsolute(value)) options.reportPath = value
    else if (key === '--ocr-cache' && isAbsolute(value)) options.ocrCache = value
    else if (key === '--format' && ['human', 'json'].includes(value)) format = value as 'human' | 'json'
    else if (key === '--config' && isAbsolute(value)) configPath = value
    else throw new Error('invalid')
  }
  input.features = features
  const context = normalizePreflight(input)
  if (context.entry !== 'dsh' && options.dsh || context.operation !== 'report' && options.reportPath
    || context.features.ocr === 'off' && options.ocrCache && context.operation !== 'test') throw new Error('invalid')
  const config = await loadStandaloneMcpConfig(configPath)
  const doctor = dependencies.createDoctor?.(config.mirror, options) ?? new DoctorService(config.mirror, options)
  const controller = new AbortController(), cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  try {
    const report = await doctor.run(input as PreflightInput, controller.signal)
    io.stdout.write(format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderDoctorHuman(report))
    return doctorExitCode(report)
  } catch (error) { if (controller.signal.aborted) { io.stderr.write('Environment check cancelled.\n'); return 130 } throw error }
  finally { process.removeListener('SIGINT', cancel) }
}

function runConfig(args: readonly string[], io: OnboardingCliIo): number {
  let target: OnboardingConfigTarget | undefined
  let platform: OnboardingPlatform = 'mock'
  let packageRoot: string | undefined
  let configPath: string | undefined
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key || !value) throw new Error('invalid')
    if (key === '--target' && ['dsh', 'mcp', 'codex'].includes(value)) target = value as OnboardingConfigTarget
    else if (key === '--platform' && ['mock', 'android', 'ios'].includes(value)) platform = value as OnboardingPlatform
    else if (key === '--package-root' && isAbsolute(value)) packageRoot = value
    else if (key === '--config-path' && isAbsolute(value)) configPath = value
    else throw new Error('invalid')
  }
  if (!target) throw new Error('invalid')
  io.stdout.write(renderOnboardingConfig({
    target,
    platform,
    ...(packageRoot ? { packageRoot } : {}),
    ...(configPath ? { configPath } : {}),
  }))
  return 0
}

function helpText(): string {
  return [
    'Usage: flowassert <command>',
    '',
    'Commands:',
    '  ocr doctor|prepare --cache <absolute-private-directory> (macOS; explicit preparation only)',
    '  doctor [--platform android|ios|all] [--config <absolute-json>] [--format human|json]',
    '         [--target viewer|mcp|codex|dsh|cli] [--operation runtime|report|mock|connect|test]',
    '         [--provider none|mock|appium] [--test-ref flow:<id>|suite:<id>]',
    '         [--media off|preferred|required] [--ocr off|preferred|required] [--ai-recovery off|preferred|required]',
    '         [--recording off|preferred] [--ocr-cache <absolute-path>] [--report-path <absolute-path>]',
    '         [--dsh-executable <absolute-path> --dsh-profile-root <absolute-profile-directory>]',
    '         v2: default runtime only (no phone/DSH scan); ready=0, blocked/incomplete=2, invalid=1, cancelled=130.',
    '  health-probe --platform android --device <authorized-id> --app <app-id> [--adb <executable>]',
    '  health-probe --platform ios (capability only; does not install diagnostic agents)',
    '  test suite <registered-id> --url http://127.0.0.1:<port> [--tags smoke] [--platform android|ios] [--report-dir path]',
    '  test job <registered-id> --config <absolute-json> --connection <absolute-json> --report-dir <absolute-path>',
    '  test triage start <run-id> --url http://127.0.0.1:<port> [--comparison <id>] [--request-id <uuid>] [--wait]',
    '  test triage get|cancel <job-id> --url http://127.0.0.1:<port>',
    '  test repair verify --id <case-id> --url http://127.0.0.1:<port> [--required-grade software|device]',
    '           [--tags smoke] [--platform android|ios] [--startup-timeout-ms N] [--timeout-ms N] [--shutdown-timeout-ms N]',
    '  config --target dsh|mcp|codex [--platform mock|android|ios]',
    '         [--package-root <absolute-path> --config-path <absolute-json>]',
    '',
    'doctor/config are read-only. test suite attaches to an existing Viewer; test job owns a bounded loopback runtime and only its resources.',
    '',
  ].join('\n')
}
