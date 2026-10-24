import { constants as fsConstants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { ViewerMediaConfig } from './config.js'
import { NodeHostCommandRunner, type HostCommandRunner } from './host-command-runner.js'
import { NodeLoopbackPortAllocator, type LoopbackPortAllocator } from './loopback-port.js'
import { ScrcpyVideoParser } from './scrcpy-protocol.js'
import { NodeStreamingHostProcessRunner, type StreamingHostProcess, type StreamingHostProcessRunner } from './streaming-host-process.js'
import type { ViewerMediaPacket, ViewerMediaSource } from './types.js'
import { viewerMediaError } from './viewer-media-error.js'

const SCRCPY_VERSION = '4.1'

export interface ScrcpyInstallation {
  executablePath: string
  serverPath: string
  version: typeof SCRCPY_VERSION
}

export interface AndroidScrcpySourceOptions {
  commands?: HostCommandRunner
  processes?: StreamingHostProcessRunner
  ports?: LoopbackPortAllocator
  connectSocket?: (port: number, signal: AbortSignal) => Promise<Socket>
}

export class AndroidScrcpySource implements ViewerMediaSource {
  readonly transport = 'scrcpy-h264' as const
  readonly #deviceId: string
  readonly #adbPath: string
  readonly #config: ViewerMediaConfig['android']
  readonly #commands: HostCommandRunner
  readonly #processes: StreamingHostProcessRunner
  readonly #ports: LoopbackPortAllocator
  readonly #connectSocket: (port: number, signal: AbortSignal) => Promise<Socket>
  #abort: AbortController | null = null
  #socket: Socket | null = null
  #process: StreamingHostProcess | null = null
  #forward: string | null = null
  #remoteJar: string | null = null
  #cleanupPromise: Promise<void> | null = null

  constructor(deviceId: string, adbPath: string, config: ViewerMediaConfig['android'], options: AndroidScrcpySourceOptions = {}) {
    if (!deviceId) throw viewerMediaError('viewer_media_unavailable')
    this.#deviceId = deviceId
    this.#adbPath = adbPath
    this.#config = config
    this.#commands = options.commands ?? new NodeHostCommandRunner()
    this.#processes = options.processes ?? new NodeStreamingHostProcessRunner()
    this.#ports = options.ports ?? new NodeLoopbackPortAllocator()
    this.#connectSocket = options.connectSocket ?? connectLoopback
  }

  async *open(signal: AbortSignal): AsyncIterable<ViewerMediaPacket> {
    if (this.#abort) throw viewerMediaError('viewer_media_unavailable')
    this.#abort = new AbortController()
    const combined = AbortSignal.any([signal, this.#abort.signal])
    this.#cleanupPromise = null
    try {
      const installation = await resolveScrcpyInstallation(this.#config, this.#commands, combined)
      const port = await this.#ports.allocate(combined)
      const scid = randomScid()
      const socketName = `scrcpy_${scid}`
      const remoteJar = `/data/local/tmp/mobile-mirror-scrcpy-${scid}.jar`
      const forward = `tcp:${port}`
      this.#remoteJar = remoteJar
      this.#forward = forward

      await this.#runAdb(['push', installation.serverPath, remoteJar], combined)
      await this.#runAdb(['forward', forward, `localabstract:${socketName}`], combined)

      const args = [
        '-s', this.#deviceId,
        'shell',
        `CLASSPATH=${remoteJar}`,
        'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY_VERSION,
        `scid=${scid}`,
        'log_level=warn',
        'video=true',
        'audio=false',
        'control=false',
        'cleanup=false',
        'tunnel_forward=true',
        'send_device_meta=false',
        'send_dummy_byte=false',
        'send_stream_meta=true',
        'send_frame_meta=true',
        'video_codec=h264',
        `video_bit_rate=${this.#config.videoBitRate}`,
        `max_size=${this.#config.maxSize}`,
        `max_fps=${this.#config.maxFps}`,
      ]
      this.#process = this.#processes.spawn(this.#adbPath, args, { signal: combined })
      this.#socket = await this.#connectSocket(port, combined)

      const parser = new ScrcpyVideoParser()
      for await (const chunk of this.#socket) {
        if (combined.aborted) throw combined.reason
        for (const packet of parser.push(chunk)) yield packet
      }
      if (!combined.aborted) {
        parser.finish()
        throw viewerMediaError('viewer_media_stream_ended')
      }
    } catch (error) {
      if (combined.aborted) throw combined.reason
      if (error instanceof Error && error.name === 'ViewerMediaError') throw error
      throw viewerMediaError('viewer_media_stream_ended', error)
    } finally {
      await this.#cleanup()
      this.#abort = null
    }
  }

  async close(): Promise<void> {
    const active = this.#abort
    active?.abort(viewerMediaError('viewer_media_stream_ended'))
    this.#socket?.destroy()
    const process = this.#process
    this.#process = null
    await process?.stop().catch(() => undefined)
    if (!active) await this.#cleanup()
  }

  async #runAdb(args: string[], signal?: AbortSignal): Promise<void> {
    const result = await this.#commands.run(this.#adbPath, ['-s', this.#deviceId, ...args], { signal, timeoutMs: 15_000 })
    if (!result.ok) throw viewerMediaError('viewer_media_stream_ended')
  }

  async #cleanup(): Promise<void> {
    if (this.#cleanupPromise) return this.#cleanupPromise
    this.#cleanupPromise = (async () => {
      const socket = this.#socket
      const process = this.#process
      const forward = this.#forward
      const remoteJar = this.#remoteJar
      this.#socket = null
      this.#process = null
      this.#forward = null
      this.#remoteJar = null
      socket?.destroy()
      await process?.stop().catch(() => undefined)
      if (forward) await this.#commands.run(this.#adbPath, ['-s', this.#deviceId, 'forward', '--remove', forward], { timeoutMs: 5_000 }).catch(() => undefined)
      if (remoteJar) await this.#commands.run(this.#adbPath, ['-s', this.#deviceId, 'shell', 'rm', '-f', remoteJar], { timeoutMs: 5_000 }).catch(() => undefined)
    })()
    return this.#cleanupPromise
  }
}

export async function resolveScrcpyInstallation(
  config: ViewerMediaConfig['android'],
  commands: HostCommandRunner = new NodeHostCommandRunner(),
  signal?: AbortSignal,
): Promise<ScrcpyInstallation> {
  if (!config.scrcpyPath || !config.scrcpyPath.startsWith('/')) throw viewerMediaError('viewer_media_scrcpy_missing')
  try {
    if (!(await stat(config.scrcpyPath)).isFile()) throw new Error('not a file')
    await access(config.scrcpyPath, fsConstants.X_OK)
  } catch (error) {
    throw viewerMediaError('viewer_media_scrcpy_missing', error)
  }
  const version = await commands.run(config.scrcpyPath, ['--version'], { signal, timeoutMs: 5_000 })
  if (!version.ok || !/(?:^|\n)scrcpy 4\.1(?:\s|$)/.test(version.stdout)) {
    throw viewerMediaError('viewer_media_scrcpy_version_unsupported')
  }

  const serverPath = await resolveServerPath(config.scrcpyPath, config.scrcpyServerPath)
  return { executablePath: config.scrcpyPath, serverPath, version: SCRCPY_VERSION }
}

async function resolveServerPath(executablePath: string, explicitPath: string): Promise<string> {
  if (explicitPath) {
    if (!explicitPath.startsWith('/')) throw viewerMediaError('viewer_media_scrcpy_missing')
    try {
      if (!(await stat(explicitPath)).isFile()) throw new Error('not a file')
      await access(explicitPath, fsConstants.R_OK)
      return explicitPath
    } catch (error) {
      throw viewerMediaError('viewer_media_scrcpy_missing', error)
    }
  }

  const resolvedExecutable = await realpath(executablePath).catch(() => executablePath)
  const candidates = [
    resolve(dirname(executablePath), 'scrcpy-server'),
    resolve(dirname(executablePath), '../share/scrcpy/scrcpy-server'),
    resolve(dirname(resolvedExecutable), '../share/scrcpy/scrcpy-server'),
  ]
  for (const candidate of new Set(candidates)) {
    try {
      if (!(await stat(candidate)).isFile()) continue
      await access(candidate, fsConstants.R_OK)
      return candidate
    } catch {
      // Only deterministic portable/prefix locations are accepted.
    }
  }
  throw viewerMediaError('viewer_media_scrcpy_missing')
}

function randomScid(): string {
  return (randomBytes(4).readUInt32BE(0) & 0x7fff_ffff).toString(16).padStart(8, '0')
}

async function connectLoopback(port: number, signal: AbortSignal): Promise<Socket> {
  const deadline = Date.now() + 5_000
  while (true) {
    if (signal.aborted) throw signal.reason
    try {
      return await new Promise<Socket>((resolveSocket, reject) => {
        const socket = connect({ host: '127.0.0.1', port })
        let settled = false
        let timer: ReturnType<typeof setTimeout>
        const cleanup = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          socket.removeListener('data', firstData)
          socket.removeListener('error', failed)
          socket.removeListener('close', closed)
        }
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          cleanup()
          socket.destroy()
          reject(error)
        }
        const abort = () => fail(signal.reason)
        const failed = (error: Error) => fail(error)
        const closed = () => fail(new Error('ADB forward closed before media data'))
        const firstData = (chunk: Buffer) => {
          if (settled) return
          settled = true
          cleanup()
          socket.pause()
          socket.unshift(chunk)
          resolveSocket(socket)
        }
        timer = setTimeout(() => fail(new Error('Timed out waiting for media data')), Math.max(1, deadline - Date.now()))
        signal.addEventListener('abort', abort, { once: true })
        socket.once('data', firstData)
        socket.once('error', failed)
        socket.once('close', closed)
      })
    } catch (error) {
      if (Date.now() >= deadline) throw viewerMediaError('viewer_media_stream_ended', error)
      await abortableDelay(100, signal)
    }
  }
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason
  await new Promise<void>((resolveDelay, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      cleanup()
      resolveDelay()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
