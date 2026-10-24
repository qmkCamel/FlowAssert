import type { HostCommandOptions, HostCommandResult, HostCommandRunner } from './host-command-runner.js'

const queries = {
  'appium-version': { args: ['--version'], timeoutMs: 10_000 },
  'appium-drivers': { args: ['driver', 'list', '--installed', '--json'], timeoutMs: 20_000 },
  'adb-version': { args: ['version'], timeoutMs: 10_000 },
  'adb-devices': { args: ['devices'], timeoutMs: 10_000 },
  'adb-usb-devices': { args: ['devices', '-l'], timeoutMs: 10_000 },
  'xcode-version': { args: ['-version'], timeoutMs: 10_000 },
  'ios-devices': { args: ['xcdevice', 'list'], timeoutMs: 15_000 },
} as const

/** Reusable read-only leaves; discovery/authorization and result ownership stay with the caller. */
export function readHostPrerequisite(runner: HostCommandRunner, kind: keyof typeof queries, executable: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const query = queries[kind]
  return runner.run(executable, [...query.args], { signal, timeoutMs: query.timeoutMs })
}

/** Caps nested diagnostic fan-out as well as top-level plan parallelism. */
export class BoundedPreflightRunner implements HostCommandRunner {
  #active = 0
  #queue: { enter: () => void; reject: (error: Error) => void; signal?: AbortSignal | undefined; abort: () => void }[] = []
  constructor(private readonly target: HostCommandRunner) {}
  async run(command: string, args: string[], options: HostCommandOptions = {}): Promise<HostCommandResult> {
    options.signal?.throwIfAborted()
    if (this.#active < 3) this.#active++
    else await new Promise<void>((enter, reject) => {
      const item = { enter, reject, signal: options.signal, abort: () => {
        this.#queue = this.#queue.filter(queued => queued !== item); reject(new Error('preflight_aborted'))
      } }
      this.#queue.push(item); options.signal?.addEventListener('abort', item.abort, { once: true })
      if (options.signal?.aborted) item.abort()
    })
    try {
      options.signal?.throwIfAborted()
      const result = await this.target.run(command, args, { ...options, timeoutMs: Math.min(options.timeoutMs ?? 10_000, 20_000) })
      options.signal?.throwIfAborted()
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1_048_576) throw new Error('preflight_output_budget')
      return result
    } finally {
      const next = this.#queue.shift()
      if (next) { next.signal?.removeEventListener('abort', next.abort); next.enter() }
      else this.#active--
    }
  }
}
