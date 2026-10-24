import { readHealthCommand } from './health-command.js'
import { parseAndroidExitHistory } from './android-health-diagnostics.js'
import type { HealthCapability } from './workbench-health.js'

/** Fixed, read-only argv. Raw diagnostics and device IDs are never returned. */
export async function probeAndroidHealth(input: { adbPath: string; deviceId: string; appId: string }, signal: AbortSignal): Promise<{
  schemaVersion: 1; capability: HealthCapability; facts: Record<string, boolean | string>; missing: string[]
}> {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(input.deviceId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(input.appId)) throw new Error('health-probe-target-invalid')
  const read = async (args: string[]) => {
    return readHealthCommand(input.adbPath, ['-s', input.deviceId, ...args], signal)
  }
  const facts: Record<string, boolean | string> = {}
  const commands: [string, string[]][] = [
    ['api', ['shell', 'getprop', 'ro.build.version.sdk']],
    ['targetInstalled', ['shell', 'pm', 'path', input.appId]],
    ['exitHistoryReadable', ['shell', 'dumpsys', 'activity', 'exit-info', input.appId]],
    ['bufferMetadataReadable', ['logcat', '-g']],
  ]
  for (const [name, args] of commands) {
    signal.throwIfAborted()
    try {
      const value = await read(args)
      facts[name] = name === 'api' ? (/^\d{1,3}$/.test(value.trim()) ? value.trim() : 'unknown')
        : name === 'targetInstalled' ? /^package:/m.test(value) : value.trim().length > 0 && !/permission denial|permission denied/i.test(value)
      if (name === 'exitHistoryReadable') facts.exitHistoryBounded = !parseAndroidExitHistory(value).truncated
    } catch { signal.throwIfAborted(); facts[name] = name === 'api' ? 'unknown' : false }
  }
  // Readability is not a cursor, process-generation mapping, loss detector or drain acknowledgement.
  return { schemaVersion: 1, facts,
    capability: { schemaVersion: 1, platform: 'android', source: 'android-adb-candidate', sourceVersion: 'unapproved',
      signals: { crash: { supported: false, reason: 'source-completeness-unproven' }, anr: { supported: false, reason: 'source-completeness-unproven' } } },
    missing: ['authoritative-process-generation', 'loss-detection-in-window', 'bounded-late-event-mapping', 'end-cursor-drain-acknowledgement'] }
}

export function probeIosHealth(): { schemaVersion: 1; capability: HealthCapability; missing: string[] } {
  return { schemaVersion: 1, capability: { schemaVersion: 1, platform: 'ios', source: 'ios-diagnostics-candidate', sourceVersion: 'unapproved',
    signals: { crash: { supported: false, reason: 'authorized-source-unavailable' }, hang: { supported: false, reason: 'authorized-source-unavailable' } } },
    missing: ['authorized-live-diagnostic-source', 'window-boundaries-and-loss-detection', 'end-cursor-drain-acknowledgement'] }
}
