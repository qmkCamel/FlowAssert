import { spawn } from 'node:child_process'

/** One owned diagnostic client; fixed callers supply argv. No shell or external-service cleanup. */
export async function readHealthCommand(executable: string, args: string[], signal: AbortSignal,
  limits = { timeoutMs: 5000, bytes: 1024 * 1024, killGraceMs: 250 }): Promise<string> {
  signal.throwIfAborted()
  const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  let failure: Error | undefined, bytes = 0, output = '', killer: ReturnType<typeof setTimeout> | undefined
  const stop = (error: Error) => {
    failure ??= error
    if (killer) return
    child.kill('SIGTERM')
    killer = setTimeout(() => child.kill('SIGKILL'), limits.killGraceMs)
  }
  const onAbort = () => stop(new Error('health-probe-interrupted'))
  const timeout = setTimeout(() => stop(new Error('health-probe-timeout')), limits.timeoutMs)
  signal.addEventListener('abort', onAbort, { once: true })
  const collect = (chunk: Buffer, stdout: boolean) => {
    bytes += chunk.byteLength
    if (bytes > limits.bytes) { stop(new Error('health-probe-overflow')); return }
    if (stdout) output += chunk.toString()
  }
  child.stdout.on('data', chunk => collect(chunk, true)); child.stderr.on('data', chunk => collect(chunk, false))
  try {
    const code = await new Promise<number | null>(resolve => {
      child.once('error', () => { failure ??= new Error('health-probe-command-unavailable') })
      child.once('close', code => resolve(code))
      if (signal.aborted) onAbort()
    })
    if (failure) throw failure
    if (code !== 0) throw new Error('health-probe-command-failed')
    return output
  } finally { clearTimeout(timeout); if (killer) clearTimeout(killer); signal.removeEventListener('abort', onAbort) }
}
