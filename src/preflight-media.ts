import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { HostCommandRunner } from './host-command-runner.js'
import type { PreflightCheck } from './environment-preflight.js'

/** Shared doctor/connection-assistant leaf; never searches PATH or starts a stream. */
export async function checkScrcpy(path: string, runner: HostCommandRunner, signal?: AbortSignal,
  executableAccess: (path: string) => Promise<void> = path => access(path, constants.X_OK)): Promise<PreflightCheck> {
  const item: PreflightCheck = { id: 'android-scrcpy', status: 'blocked', code: path ? 'scrcpy_version_unsupported' : 'scrcpy_not_configured',
    suggestion: 'PNG polling remains available; explicitly configure trusted scrcpy 4.1 for low-latency media.' }
  if (!path || !isAbsolute(path)) return item
  try {
    signal?.throwIfAborted(); await executableAccess(path); signal?.throwIfAborted()
    const output = await runner.run(path, ['--version'], { signal, timeoutMs: 10_000 })
    const version = output.stdout.match(/^scrcpy\s+(\d+\.\d+(?:\.\d+)?)(?:\s|$)/im)?.[1]
    if (output.ok && version && /^4\.1(?:\.\d+)?$/.test(version)) return { ...item, status: 'pass', code: 'scrcpy_4_1_ready', version }
    if (output.timedOut || output.aborted) return { ...item, status: 'manual', code: 'scrcpy_check_unverified' }
  } catch { signal?.throwIfAborted() }
  return item
}
