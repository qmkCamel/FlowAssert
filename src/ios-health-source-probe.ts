import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { readHealthCommand } from './health-command.js'
import { probeIosHealth } from './workbench-health-probe.js'

export type IosDiagnosticCheck = { status: 'readable' | 'unavailable' | 'invalid'; reason?: string; bytes?: number }
const MAX_JSON_BYTES = 1024 * 1024

/** Xcode puts outcome in info, not at the root. Do not accept another command's output. */
export function inspectIosDiagnosticJson(value: unknown, kind: 'details' | 'crash-archive'): IosDiagnosticCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid', reason: 'diagnostic-json-schema' }
  const { info, result } = value as { info?: { outcome?: unknown; commandType?: unknown }; result?: Record<string, unknown> }
  const command = kind === 'details' ? 'devicectl.device.info.details' : 'devicectl.device.info.files'
  if (!info || info.commandType !== command || info.outcome !== 'success' || !result || typeof result !== 'object' || Array.isArray(result)) {
    return { status: 'invalid', reason: 'diagnostic-json-schema' }
  }
  if (kind === 'details' ? !result.deviceProperties || typeof result.deviceProperties !== 'object' || Array.isArray(result.deviceProperties)
    : result.domain !== 'systemCrashLogs' || !Array.isArray(result.files)) return { status: 'invalid', reason: 'diagnostic-json-schema' }
  return { status: 'readable' }
}

/** Read-only live diagnostic discovery. Archive readability never releases a collector. */
export function iosDiagnosticArguments(deviceId: string, kind: 'details' | 'crash-archive', output: string): string[] {
  if (!/^[A-Za-z0-9-]{8,160}$/.test(deviceId) || !isAbsolute(output)) throw new Error('ios-diagnostic-target-invalid')
  return ['devicectl', 'device', 'info', ...(kind === 'details' ? ['details'] : [
    'files', '--domain-type', 'systemCrashLogs', '--no-recurse', '--filter', "Name BEGINSWITH 'RuntimeFixture'",
  ]), '--device', deviceId, '--timeout', '10', '--quiet', '--json-output', output]
}

export function summarizeIosDiagnosticProbe(details: IosDiagnosticCheck, archive: IosDiagnosticCheck) {
  const attemptedLive = details.status === 'readable' && archive.status !== 'invalid'
  const base = probeIosHealth()
  return {
    ...base, schemaVersion: 1 as const,
    capability: { ...base.capability, signals: {
      crash: { supported: false, reason: archive.status === 'readable' ? 'archive-without-window-completeness' : 'authorized-source-unavailable' },
      hang: { supported: false, reason: 'verified-hang-source-unavailable' },
    } },
    facts: { liveDeviceDetailsReadable: details.status === 'readable', liveDiagnosticSourceChecked: attemptedLive,
      scopedCrashArchiveReadable: archive.status === 'readable', archiveIsRealtimeWindow: false,
      hangSourceVerified: false, healthSignalsReleased: false },
    checks: { details, archive },
    missing: ['authoritative-process-generation', 'window-start-and-end-cursors', 'loss-detection-in-window',
      'bounded-event-time-mapping', 'end-cursor-drain-acknowledgement', 'verified-hang-source'],
  }
}

export async function probeIosDiagnosticSource(input: { xcrunPath: string; deviceId: string; privateRoot: string }, signal: AbortSignal) {
  if (!isAbsolute(input.xcrunPath) || !isAbsolute(input.privateRoot)) throw new Error('ios-diagnostic-path-invalid')
  const check = async (kind: 'details' | 'crash-archive'): Promise<IosDiagnosticCheck> => {
    const output = resolve(input.privateRoot, `${kind}.json`)
    const args = iosDiagnosticArguments(input.deviceId, kind, output)
    try {
      await readHealthCommand(input.xcrunPath, args, signal, { timeoutMs: 12000, bytes: MAX_JSON_BYTES, killGraceMs: 250 })
      const file = await lstat(output)
      if (!file.isFile() || file.isSymbolicLink() || file.size > MAX_JSON_BYTES) return { status: 'invalid', reason: 'diagnostic-json-budget-or-type' }
      const result = inspectIosDiagnosticJson(JSON.parse(await readFile(output, 'utf8')), kind)
      return result.status === 'readable' ? { ...result, bytes: file.size } : result
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : ''
      return { status: 'unavailable', reason: /^health-probe-[a-z-]+$/.test(reason) ? reason : 'diagnostic-output-unavailable' }
    }
  }
  return summarizeIosDiagnosticProbe(await check('details'), await check('crash-archive'))
}
