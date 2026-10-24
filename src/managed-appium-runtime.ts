import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { createConnection } from 'node:net'
import type { Config } from './config.js'
import { NodeStreamingHostProcessRunner, type StreamingHostProcess, type StreamingHostProcessRunner } from './streaming-host-process.js'
import type { AppiumRuntimeErrorCode, AppiumRuntimeState, StartMirrorInput } from './types.js'

const OUTPUT_LIMIT = 64 * 1024
const STATUS_LIMIT = 1024 * 1024

export class ManagedAppiumError extends Error {
  readonly code: AppiumRuntimeErrorCode

  constructor(code: AppiumRuntimeErrorCode, message: string) {
    super(message)
    this.name = 'ManagedAppiumError'
    this.code = code
  }
}

export interface AppiumRuntimeLifecycle {
  state(): AppiumRuntimeState
  ensureReady(input: StartMirrorInput, signal?: AbortSignal): Promise<void>
  stop(): Promise<void>
}

export interface AppiumRuntimeArm {
  key: string
  executablePath: string
  expiresAt: number
}

export interface ArmableAppiumRuntimeLifecycle extends AppiumRuntimeLifecycle {
  armOnce(arm: AppiumRuntimeArm): void
  cancelArm(key: string): boolean
}

export interface ManagedAppiumRuntimeOptions {
  processRunner?: StreamingHostProcessRunner
  statusProbe?: (url: string, signal?: AbortSignal) => Promise<boolean>
  listenerProbe?: (host: string, port: number, signal?: AbortSignal) => Promise<boolean>
  executableAccess?: (path: string) => Promise<void>
  onState?: (state: AppiumRuntimeState) => void
  pollIntervalMs?: number
  now?: () => number
}

export function createAppiumRuntime(config: Config, options: ManagedAppiumRuntimeOptions = {}): AppiumRuntimeLifecycle {
  return config.appiumRuntimeMode === 'managed'
    ? new ManagedAppiumRuntime(config, options)
    : new ExternalAppiumRuntime()
}

export class ExternalAppiumRuntime implements AppiumRuntimeLifecycle {
  state(): AppiumRuntimeState {
    return { mode: 'external', phase: 'idle', owned: false, lastErrorCode: null }
  }

  async ensureReady(_input: StartMirrorInput, _signal?: AbortSignal): Promise<void> {}

  async stop(): Promise<void> {}
}

export class GuidedAppiumRuntime implements ArmableAppiumRuntimeLifecycle {
  readonly #config: Config
  readonly #options: ManagedAppiumRuntimeOptions
  readonly #base: AppiumRuntimeLifecycle
  readonly #now: () => number
  #arm: AppiumRuntimeArm | null = null
  #activeOneShot: ManagedAppiumRuntime | null = null

  constructor(config: Config, options: ManagedAppiumRuntimeOptions = {}) {
    this.#config = config
    this.#options = options
    this.#now = options.now ?? Date.now
    this.#base = createAppiumRuntime(config, options)
  }

  state(): AppiumRuntimeState {
    if (this.#activeOneShot) return this.#activeOneShot.state()
    if (this.#arm && this.#arm.expiresAt <= this.#now()) this.#arm = null
    if (this.#arm) return { mode: 'managed', phase: 'idle', owned: false, lastErrorCode: null }
    return this.#base.state()
  }

  armOnce(arm: AppiumRuntimeArm): void {
    if (this.#config.appiumRuntimeMode !== 'external' || this.#activeOneShot || this.#arm) {
      throw managedError('managed_appium_config_invalid', 'One-shot managed Appium is unavailable')
    }
    if (!arm.key || !arm.executablePath.startsWith('/') || arm.expiresAt <= this.#now()) {
      throw managedError('managed_appium_config_invalid', 'One-shot managed Appium authorization is invalid')
    }
    this.#arm = { ...arm }
    this.#options.onState?.(this.state())
  }

  cancelArm(key: string): boolean {
    if (!this.#arm || this.#arm.key !== key) return false
    this.#arm = null
    this.#options.onState?.(this.#base.state())
    return true
  }

  async ensureReady(input: StartMirrorInput, signal?: AbortSignal): Promise<void> {
    if (this.#activeOneShot) return this.#activeOneShot.ensureReady(input, signal)
    const arm = this.#arm
    if (!arm) return this.#base.ensureReady(input, signal)
    this.#arm = null
    if (arm.expiresAt <= this.#now()) {
      this.#options.onState?.(this.#base.state())
      throw managedError('managed_appium_config_invalid', 'One-shot managed Appium authorization expired')
    }
    const runtime = new ManagedAppiumRuntime({
      ...this.#config,
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: arm.executablePath,
    }, this.#options)
    this.#activeOneShot = runtime
    try {
      await runtime.ensureReady(input, signal)
    } catch (error) {
      await runtime.stop()
      if (this.#activeOneShot === runtime) this.#activeOneShot = null
      this.#options.onState?.(this.#base.state())
      throw error
    }
  }

  async stop(): Promise<void> {
    this.#arm = null
    const active = this.#activeOneShot
    if (active) await active.stop()
    else await this.#base.stop()
    this.#activeOneShot = null
    this.#options.onState?.(this.#base.state())
  }
}

export class ManagedAppiumRuntime implements AppiumRuntimeLifecycle {
  readonly #config: Config
  readonly #target: ManagedTarget
  readonly #processRunner: StreamingHostProcessRunner
  readonly #statusProbe: (url: string, signal?: AbortSignal) => Promise<boolean>
  readonly #listenerProbe: (host: string, port: number, signal?: AbortSignal) => Promise<boolean>
  readonly #executableAccess: (path: string) => Promise<void>
  readonly #onState: ((state: AppiumRuntimeState) => void) | undefined
  readonly #pollIntervalMs: number
  #state: AppiumRuntimeState = { mode: 'managed', phase: 'idle', owned: false, lastErrorCode: null }
  #child: StreamingHostProcess | null = null
  #startPromise: Promise<void> | null = null
  #startAbort: AbortController | null = null
  #stopPromise: Promise<void> | null = null

  constructor(config: Config, options: ManagedAppiumRuntimeOptions = {}) {
    this.#config = config
    this.#target = parseManagedTarget(config.appiumUrl)
    this.#processRunner = options.processRunner ?? new NodeStreamingHostProcessRunner()
    this.#statusProbe = options.statusProbe ?? probeAppiumStatus
    this.#listenerProbe = options.listenerProbe ?? (options.statusProbe ? async () => false : probeListener)
    this.#executableAccess = options.executableAccess ?? (async (path) => access(path, constants.X_OK))
    this.#onState = options.onState
    this.#pollIntervalMs = options.pollIntervalMs ?? 100
  }

  state(): AppiumRuntimeState {
    return { ...this.#state }
  }

  async ensureReady(input: StartMirrorInput, signal?: AbortSignal): Promise<void> {
    if (input.sessionId) throw managedError('managed_appium_config_invalid', 'Managed Appium cannot attach an external session; use external mode')
    if (this.#state.phase === 'ready' && this.#child) return
    if (this.#startPromise) return this.#startPromise
    // A failed cleanup still owns resources. Never overwrite that handle on retry.
    if (this.#child) await this.stop()
    const controller = new AbortController()
    this.#startAbort = controller
    const operationSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    this.#startPromise = this.#start(operationSignal).finally(() => {
      this.#startPromise = null
      if (this.#startAbort === controller) this.#startAbort = null
    })
    return this.#startPromise
  }

  async stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = this.#stop().finally(() => { this.#stopPromise = null })
    return this.#stopPromise
  }

  async #start(signal?: AbortSignal): Promise<void> {
    if (!this.#config.appiumExecutablePath.startsWith('/')) {
      return this.#fail('managed_appium_config_invalid', 'Managed Appium requires an absolute executable path')
    }
    try {
      await this.#executableAccess(this.#config.appiumExecutablePath)
    } catch {
      return this.#fail('managed_appium_config_invalid', 'Managed Appium executable is unavailable')
    }
    if (signal?.aborted) throw signal.reason
    if (await this.#statusProbe(this.#target.statusUrl, signal)) {
      return this.#fail('managed_appium_listener_conflict', 'Managed Appium target is already in use; use external mode or another loopback port')
    }
    if (await this.#listenerProbe(this.#target.host, this.#target.port, signal)) {
      return this.#fail('managed_appium_listener_conflict', 'Managed Appium target is already in use; use external mode or another loopback port')
    }

    this.#transition({ phase: 'starting', owned: false, lastErrorCode: null })
    let child: StreamingHostProcess
    try {
      child = this.#processRunner.spawn(this.#config.appiumExecutablePath, this.#target.args, {
        outputLimit: OUTPUT_LIMIT,
        stopGraceMs: 2_000,
        ownedDescendants: true,
        env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS,
          `--import=${new URL('../scripts/appium-loopback-guard.mjs', import.meta.url).href}`].filter(Boolean).join(' ') },
      })
      this.#child = child
      this.#transition({ phase: 'starting', owned: true, lastErrorCode: null })
    } catch {
      return this.#fail('managed_appium_start_failed', 'Managed Appium failed to start')
    }

    const deadline = Date.now() + this.#config.startupTimeoutMs
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted) throw signal.reason
        if (await this.#statusProbe(this.#target.statusUrl, signal)) {
          this.#transition({ phase: 'ready', owned: true, lastErrorCode: null })
          return
        }
        const outcome = await Promise.race([
          child.exited.then(() => 'exited' as const),
          wait(this.#pollIntervalMs, signal).then(() => 'poll' as const),
        ])
        if (outcome === 'exited') {
          await this.#cleanupChild()
          return this.#fail('managed_appium_exited', 'Managed Appium exited before becoming ready')
        }
      }
      await this.#cleanupChild()
      return this.#fail('managed_appium_start_timeout', 'Managed Appium did not become ready in time')
    } catch (error) {
      await this.#cleanupChild()
      if (signal?.aborted) throw signal.reason
      throw error
    }
  }

  async #stop(): Promise<void> {
    this.#startAbort?.abort(new Error('Managed Appium is stopping'))
    if (this.#startPromise) await this.#startPromise.catch(() => undefined)
    if (!this.#child) {
      this.#transition({ phase: 'idle', owned: false, lastErrorCode: null })
      return
    }
    this.#transition({ phase: 'stopping', owned: true, lastErrorCode: null })
    try {
      await this.#cleanupChild()
      this.#transition({ phase: 'idle', owned: false, lastErrorCode: null })
    } catch {
      this.#transition({ phase: 'error', owned: Boolean(this.#child), lastErrorCode: 'managed_appium_stop_failed' })
      throw managedError('managed_appium_stop_failed', 'Managed Appium failed to stop cleanly')
    }
  }

  async #cleanupChild(): Promise<void> {
    const child = this.#child
    try { if (child) await child.stop() }
    catch {
      this.#transition({ phase: 'error', owned: true, lastErrorCode: 'managed_appium_stop_failed' })
      throw managedError('managed_appium_stop_failed', 'Managed Appium failed to stop cleanly')
    }
    this.#child = null
  }

  #transition(patch: Partial<AppiumRuntimeState>): void {
    this.#state = { ...this.#state, ...patch }
    this.#onState?.(this.state())
  }

  #fail(code: AppiumRuntimeErrorCode, message: string): never {
    this.#transition({ phase: 'error', owned: false, lastErrorCode: code })
    throw managedError(code, message)
  }
}

interface ManagedTarget {
  statusUrl: string
  host: string
  port: number
  args: string[]
}

export function parseManagedTarget(value: string): ManagedTarget {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw managedError('managed_appium_config_invalid', 'Managed Appium URL must be a loopback HTTP URL')
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw managedError('managed_appium_config_invalid', 'Managed Appium URL must be a loopback HTTP URL')
  }
  const port = url.port ? Number(url.port) : 80
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw managedError('managed_appium_config_invalid', 'Managed Appium URL has an invalid port')
  const basePath = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '')
  const host = url.hostname === '::1' ? '::1' : url.hostname
  const statusUrl = `${url.origin}${basePath === '/' ? '' : basePath}/status`
  return {
    statusUrl,
    host,
    port,
    args: ['--address', host, '--port', String(port), '--base-path', basePath],
  }
}

async function probeListener(host: string, port: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) throw signal.reason
  return await new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host, port })
    let settled = false
    const finish = (value: boolean, error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => finish(false, signal?.reason)
    const timeout = setTimeout(() => finish(false), 500)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function probeAppiumStatus(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const operationSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(1_000)])
      : AbortSignal.timeout(1_000)
    const response = await fetch(url, { signal: operationSignal })
    if (!response.ok) return false
    const text = await readBounded(response, STATUS_LIMIT)
    const payload = JSON.parse(text) as { value?: { ready?: unknown } }
    return payload.value?.ready === true
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    return false
  }
}

async function readBounded(response: Response, limit: number): Promise<string> {
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

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    const timeout = setTimeout(finish, ms)
    const abort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

function managedError(code: AppiumRuntimeErrorCode, message: string): ManagedAppiumError {
  return new ManagedAppiumError(code, message)
}
