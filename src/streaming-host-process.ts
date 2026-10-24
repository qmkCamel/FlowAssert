import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { OwnedProcessTree, PROCESS_OWNER_ENV } from './owned-process-tree.js'

const DEFAULT_OUTPUT_LIMIT = 64 * 1024

export interface StreamingHostProcess {
  readonly stdout: string
  readonly stderr: string
  readonly exited: Promise<number | null>
  stop(): Promise<void>
}

export interface StreamingHostProcessRunner {
  spawn(command: string, args: string[], options?: { signal?: AbortSignal; outputLimit?: number; stopGraceMs?: number; ownedDescendants?: boolean; env?: NodeJS.ProcessEnv }): StreamingHostProcess
}

export class NodeStreamingHostProcessRunner implements StreamingHostProcessRunner {
  spawn(command: string, args: string[], options: { signal?: AbortSignal; outputLimit?: number; stopGraceMs?: number; ownedDescendants?: boolean; env?: NodeJS.ProcessEnv } = {}): StreamingHostProcess {
    if (options.ownedDescendants && !['darwin', 'linux'].includes(process.platform)) throw new Error('Managed descendant cleanup requires macOS or Linux')
    const owner = options.ownedDescendants ? randomUUID() : undefined
    const child = spawn(command, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      ...(owner || options.env ? { env: { ...(options.env ?? process.env), ...(owner ? { [PROCESS_OWNER_ENV]: owner } : {}) } } : {}) })
    child.stdin.end()
    const tree = owner && child.pid ? new OwnedProcessTree(child.pid, owner) : undefined
    tree?.start()
    return new NodeStreamingHostProcess(child, options.signal, options.outputLimit ?? DEFAULT_OUTPUT_LIMIT, options.stopGraceMs ?? 1_000, tree)
  }
}

class NodeStreamingHostProcess implements StreamingHostProcess {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #outputLimit: number
  readonly exited: Promise<number | null>
  #stdout = ''
  #stderr = ''
  #stopPromise: Promise<void> | null = null
  #abortListener: (() => void) | null = null
  readonly #stopGraceMs: number

  constructor(child: ChildProcessWithoutNullStreams, signal: AbortSignal | undefined, outputLimit: number, stopGraceMs: number, private readonly tree?: OwnedProcessTree) {
    this.#child = child
    this.#outputLimit = outputLimit
    this.#stopGraceMs = stopGraceMs
    child.stdout.on('data', (chunk: Buffer) => { this.#stdout = boundedAppend(this.#stdout, chunk, outputLimit) })
    child.stderr.on('data', (chunk: Buffer) => { this.#stderr = boundedAppend(this.#stderr, chunk, outputLimit) })
    this.exited = new Promise((resolve) => {
      child.once('exit', (code) => resolve(code))
      child.once('error', () => resolve(null))
    })
    if (signal) {
      this.#abortListener = () => { void this.stop() }
      if (signal.aborted) this.#abortListener()
      else signal.addEventListener('abort', this.#abortListener, { once: true })
      void this.exited.finally(() => {
        if (this.#abortListener) signal.removeEventListener('abort', this.#abortListener)
      })
    }
  }

  get stdout(): string { return this.#stdout }
  get stderr(): string { return this.#stderr }

  async stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = (async () => {
      await this.tree?.sample()
      if (this.#child.exitCode === null && this.#child.signalCode === null) this.#child.kill('SIGTERM')
      const exited = await Promise.race([
        this.exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), this.#stopGraceMs)),
      ])
      if (!exited && this.#child.exitCode === null) this.#child.kill('SIGKILL')
      await Promise.race([
        this.exited,
        new Promise<void>((resolve) => setTimeout(resolve, this.#stopGraceMs)),
      ])
      await this.tree?.cleanup(this.#stopGraceMs)
      if (this.#child.exitCode === null && this.#child.signalCode === null && this.#child.pid) throw new Error('Owned process did not stop')
    })().catch((error) => { this.#stopPromise = null; throw error })
    return this.#stopPromise
  }
}

function boundedAppend(previous: string, chunk: Buffer, limit: number): string {
  const next = previous + chunk.toString('utf8')
  return next.length <= limit ? next : next.slice(next.length - limit)
}
