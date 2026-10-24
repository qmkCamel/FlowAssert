import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.js'
import {
  createAppiumRuntime,
  ExternalAppiumRuntime,
  GuidedAppiumRuntime,
  ManagedAppiumRuntime,
  parseManagedTarget,
} from '../src/managed-appium-runtime.js'
import type { StreamingHostProcess, StreamingHostProcessRunner } from '../src/streaming-host-process.js'

const config = {
  appiumRuntimeMode: 'managed',
  appiumExecutablePath: '/trusted/appium',
  appiumUrl: 'http://127.0.0.1:4723/wd/hub',
  startupTimeoutMs: 100,
} as Config

describe('managed Appium runtime', () => {
  it('derives fixed loopback arguments and rejects unsafe URLs', () => {
    expect(parseManagedTarget('http://127.0.0.1:4723/wd/hub')).toEqual({
      statusUrl: 'http://127.0.0.1:4723/wd/hub/status',
      host: '127.0.0.1',
      port: 4723,
      args: ['--address', '127.0.0.1', '--port', '4723', '--base-path', '/wd/hub'],
    })
    for (const url of ['https://127.0.0.1:4723', 'http://remote.example:4723', 'http://user:secret@127.0.0.1:4723']) {
      expect(() => parseManagedTarget(url)).toThrow('loopback HTTP URL')
    }
  })

  it('keeps external mode a process-free no-op', async () => {
    const runtime = createAppiumRuntime({ ...config, appiumRuntimeMode: 'external' })
    expect(runtime).toBeInstanceOf(ExternalAppiumRuntime)
    await runtime.ensureReady({ provider: 'appium', sessionId: 'external-session' })
    await runtime.stop()
    expect(runtime.state()).toEqual({ mode: 'external', phase: 'idle', owned: false, lastErrorCode: null })
  })

  it('starts once, waits for ready, and precisely stops the saved child', async () => {
    const child = fakeChild()
    const runner = fakeRunner(child.process)
    const states: string[] = []
    const probe = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const runtime = new ManagedAppiumRuntime(config, {
      processRunner: runner,
      statusProbe: probe,
      executableAccess: async () => undefined,
      pollIntervalMs: 1,
      onState: (state) => states.push(`${state.phase}:${state.owned}`),
    })

    await runtime.ensureReady({ provider: 'appium' })
    expect(runner.spawn).toHaveBeenCalledWith('/trusted/appium', [
      '--address', '127.0.0.1', '--port', '4723', '--base-path', '/wd/hub',
    ], expect.objectContaining({ outputLimit: 64 * 1024, stopGraceMs: 2_000 }))
    expect(runtime.state()).toMatchObject({ phase: 'ready', owned: true })
    expect(runner.spawn.mock.calls[0]?.[2]?.env.NODE_OPTIONS).toContain('appium-loopback-guard.mjs')
    expect(states).toContain('starting:true')
    await runtime.ensureReady({ provider: 'appium' })
    expect(runner.spawn).toHaveBeenCalledTimes(1)

    await Promise.all([runtime.stop(), runtime.stop()])
    expect(child.stop).toHaveBeenCalledTimes(1)
    expect(runtime.state()).toEqual({ mode: 'managed', phase: 'idle', owned: false, lastErrorCode: null })
  })

  it('keeps a failed cleanup owned and retries it before accepting another start', async () => {
    const child = fakeChild(), runner = fakeRunner(child.process)
    const runtime = new ManagedAppiumRuntime(config, {
      processRunner: runner, executableAccess: async () => undefined,
      statusProbe: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
    })
    await runtime.ensureReady({ provider: 'appium' })
    child.stop.mockRejectedValueOnce(new Error('Process identity unavailable'))
    await expect(runtime.stop()).rejects.toMatchObject({ code: 'managed_appium_stop_failed' })
    expect(runtime.state()).toMatchObject({ phase: 'error', owned: true })
    await runtime.stop()
    expect(runtime.state()).toMatchObject({ phase: 'idle', owned: false })
    expect(child.stop).toHaveBeenCalledTimes(2)
    expect(runner.spawn).toHaveBeenCalledTimes(1)
  })

  it('refuses an occupied listener and attached session without spawning', async () => {
    const runner = fakeRunner(fakeChild().process)
    const occupied = new ManagedAppiumRuntime(config, {
      processRunner: runner,
      statusProbe: async () => true,
      executableAccess: async () => undefined,
    })
    await expect(occupied.ensureReady({ provider: 'appium' })).rejects.toMatchObject({ code: 'managed_appium_listener_conflict' })
    expect(runner.spawn).not.toHaveBeenCalled()

    const unhealthy = new ManagedAppiumRuntime(config, {
      processRunner: runner,
      statusProbe: async () => false,
      listenerProbe: async () => true,
      executableAccess: async () => undefined,
    })
    await expect(unhealthy.ensureReady({ provider: 'appium' })).rejects.toMatchObject({ code: 'managed_appium_listener_conflict' })
    expect(runner.spawn).not.toHaveBeenCalled()

    const attached = new ManagedAppiumRuntime(config, {
      processRunner: runner,
      statusProbe: async () => false,
      executableAccess: async () => undefined,
    })
    await expect(attached.ensureReady({ provider: 'appium', sessionId: 'external' })).rejects.toMatchObject({ code: 'managed_appium_config_invalid' })
    expect(runner.spawn).not.toHaveBeenCalled()
  })

  it('cleans an early exit and supports a later retry', async () => {
    const first = fakeChild(1)
    const second = fakeChild()
    const runner = {
      spawn: vi.fn()
        .mockReturnValueOnce(first.process)
        .mockReturnValueOnce(second.process),
    } satisfies StreamingHostProcessRunner
    const readiness = [false, false, false, true]
    const runtime = new ManagedAppiumRuntime(config, {
      processRunner: runner,
      statusProbe: async () => readiness.shift() ?? true,
      executableAccess: async () => undefined,
      pollIntervalMs: 1,
    })
    await expect(runtime.ensureReady({ provider: 'appium' })).rejects.toMatchObject({ code: 'managed_appium_exited' })
    expect(first.stop).toHaveBeenCalledTimes(1)

    await runtime.ensureReady({ provider: 'appium' })
    expect(runtime.state()).toMatchObject({ phase: 'ready', owned: true })
    await runtime.stop()
    expect(second.stop).toHaveBeenCalledTimes(1)
  })

  it('maps ready timeout and cleans the owned child', async () => {
    const child = fakeChild()
    const runtime = new ManagedAppiumRuntime({ ...config, startupTimeoutMs: 5 }, {
      processRunner: fakeRunner(child.process),
      statusProbe: async () => false,
      executableAccess: async () => undefined,
      pollIntervalMs: 1,
    })
    await expect(runtime.ensureReady({ provider: 'appium' })).rejects.toMatchObject({ code: 'managed_appium_start_timeout' })
    expect(child.stop).toHaveBeenCalledTimes(1)
    expect(runtime.state()).toMatchObject({ phase: 'error', owned: false, lastErrorCode: 'managed_appium_start_timeout' })
  })

  it('cancels an in-flight start and removes only its child', async () => {
    const child = fakeChild()
    const runtime = new ManagedAppiumRuntime({ ...config, startupTimeoutMs: 5_000 }, {
      processRunner: fakeRunner(child.process),
      statusProbe: async () => false,
      executableAccess: async () => undefined,
      pollIntervalMs: 10,
    })
    const start = runtime.ensureReady({ provider: 'appium' })
    await vi.waitFor(() => expect(runtime.state().owned).toBe(true))
    await runtime.stop()
    await expect(start).rejects.toThrow('Managed Appium is stopping')
    expect(child.stop).toHaveBeenCalledTimes(1)
    expect(runtime.state()).toMatchObject({ phase: 'idle', owned: false })
  })

  it('fails closed when the executable is unavailable', async () => {
    const runner = fakeRunner(fakeChild().process)
    const runtime = new ManagedAppiumRuntime(config, {
      processRunner: runner,
      statusProbe: async () => false,
      executableAccess: async () => { throw new Error('/private/path') },
    })
    await expect(runtime.ensureReady({ provider: 'appium' })).rejects.toMatchObject({
      code: 'managed_appium_config_invalid',
      message: 'Managed Appium executable is unavailable',
    })
    expect(runner.spawn).not.toHaveBeenCalled()
  })

  it('arms one validated executable, starts once under concurrency, and returns to external mode on stop', async () => {
    const child = fakeChild()
    const runner = fakeRunner(child.process)
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const runtime = new GuidedAppiumRuntime({ ...config, appiumRuntimeMode: 'external', appiumExecutablePath: '' }, {
      processRunner: runner,
      statusProbe: probe,
      listenerProbe: async () => false,
      executableAccess: async () => undefined,
      pollIntervalMs: 1,
      now: () => 1_000,
    })
    runtime.armOnce({ key: 'opaque-arm', executablePath: '/trusted/appium', expiresAt: 2_000 })
    expect(() => runtime.armOnce({ key: 'second', executablePath: '/trusted/appium', expiresAt: 2_000 })).toThrow('unavailable')
    await Promise.all([
      runtime.ensureReady({ provider: 'appium' }),
      runtime.ensureReady({ provider: 'appium' }),
    ])
    expect(runner.spawn).toHaveBeenCalledTimes(1)
    expect(runtime.state()).toMatchObject({ mode: 'managed', phase: 'ready', owned: true })
    await runtime.stop()
    expect(child.stop).toHaveBeenCalledTimes(1)
    expect(runtime.state()).toEqual({ mode: 'external', phase: 'idle', owned: false, lastErrorCode: null })
  })

  it('fails closed for expired, unsafe, conflicted, and timed-out one-shot arms without touching external listeners', async () => {
    let now = 1_000
    const expiredRunner = fakeRunner(fakeChild().process)
    const expired = new GuidedAppiumRuntime({ ...config, appiumRuntimeMode: 'external', appiumExecutablePath: '' }, {
      processRunner: expiredRunner,
      now: () => now,
    })
    expect(() => expired.armOnce({ key: 'unsafe', executablePath: 'appium', expiresAt: 2_000 })).toThrow('invalid')
    expired.armOnce({ key: 'expired', executablePath: '/trusted/appium', expiresAt: 2_000 })
    now = 2_001
    await expect(expired.ensureReady({ provider: 'appium' })).rejects.toMatchObject({ code: 'managed_appium_config_invalid' })
    expect(expiredRunner.spawn).not.toHaveBeenCalled()

    const conflictRunner = fakeRunner(fakeChild().process)
    const conflict = new GuidedAppiumRuntime({ ...config, appiumRuntimeMode: 'external', appiumExecutablePath: '' }, {
      processRunner: conflictRunner,
      statusProbe: async () => true,
      executableAccess: async () => undefined,
      now: () => 1_000,
    })
    conflict.armOnce({ key: 'conflict', executablePath: '/trusted/appium', expiresAt: 2_000 })
    await expect(conflict.ensureReady({ provider: 'appium' })).rejects.toMatchObject({ code: 'managed_appium_listener_conflict' })
    expect(conflictRunner.spawn).not.toHaveBeenCalled()
    expect(conflict.state()).toMatchObject({ mode: 'external', phase: 'idle', owned: false })

    const child = fakeChild()
    const timeout = new GuidedAppiumRuntime({ ...config, appiumRuntimeMode: 'external', appiumExecutablePath: '', startupTimeoutMs: 5 }, {
      processRunner: fakeRunner(child.process),
      statusProbe: async () => false,
      listenerProbe: async () => false,
      executableAccess: async () => undefined,
      pollIntervalMs: 1,
      now: () => 1_000,
    })
    timeout.armOnce({ key: 'timeout', executablePath: '/trusted/appium', expiresAt: 2_000 })
    await expect(timeout.ensureReady({ provider: 'appium' })).rejects.toMatchObject({ code: 'managed_appium_start_timeout' })
    expect(child.stop).toHaveBeenCalledTimes(1)
    expect(timeout.state()).toMatchObject({ mode: 'external', phase: 'idle', owned: false })
  })

  it('cancels only the matching unused arm and clears it on stop', async () => {
    const runner = fakeRunner(fakeChild().process)
    const runtime = new GuidedAppiumRuntime({ ...config, appiumRuntimeMode: 'external', appiumExecutablePath: '' }, {
      processRunner: runner,
      now: () => 1_000,
    })
    runtime.armOnce({ key: 'first', executablePath: '/trusted/appium', expiresAt: 2_000 })
    expect(runtime.cancelArm('other')).toBe(false)
    expect(runtime.cancelArm('first')).toBe(true)
    await runtime.ensureReady({ provider: 'appium' })
    expect(runner.spawn).not.toHaveBeenCalled()
    runtime.armOnce({ key: 'second', executablePath: '/trusted/appium', expiresAt: 2_000 })
    await runtime.stop()
    await runtime.ensureReady({ provider: 'appium' })
    expect(runner.spawn).not.toHaveBeenCalled()
  })
})

function fakeRunner(process: StreamingHostProcess): StreamingHostProcessRunner & { spawn: ReturnType<typeof vi.fn> } {
  return { spawn: vi.fn(() => process) }
}

function fakeChild(exitCode?: number) {
  let resolveExit!: (code: number | null) => void
  const exited = exitCode === undefined
    ? new Promise<number | null>((resolve) => { resolveExit = resolve })
    : Promise.resolve(exitCode)
  const stop = vi.fn(async () => { resolveExit?.(0) })
  return {
    stop,
    process: {
      stdout: 'bounded stdout',
      stderr: 'bounded stderr',
      exited,
      stop,
    } satisfies StreamingHostProcess,
  }
}
