import { execFile } from 'node:child_process'

export interface HostCommandOptions {
  signal?: AbortSignal | undefined
  timeoutMs?: number
}

export interface HostCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  aborted: boolean
}

export interface HostCommandRunner {
  run(command: string, args: string[], options?: HostCommandOptions): Promise<HostCommandResult>
}

export class NodeHostCommandRunner implements HostCommandRunner {
  async run(command: string, args: string[], options: HostCommandOptions = {}): Promise<HostCommandResult> {
    return await new Promise((resolve) => {
      execFile(command, args, {
        encoding: 'utf8',
        maxBuffer: 1_048_576,
        signal: options.signal,
        timeout: options.timeoutMs ?? 10_000,
      }, (error, stdout, stderr) => {
        const commandError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string } | null
        resolve({
          ok: error === null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          exitCode: typeof commandError?.code === 'number' ? commandError.code : error === null ? 0 : null,
          timedOut: Boolean(commandError?.killed && commandError.signal === 'SIGTERM' && !options.signal?.aborted),
          aborted: Boolean(options.signal?.aborted || commandError?.name === 'AbortError'),
        })
      })
    })
  }
}
