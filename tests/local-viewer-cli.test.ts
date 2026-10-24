import { describe, expect, it, vi } from 'vitest'
import { resolveLocalViewerSettings } from '../src/local-viewer-config.js'
import { startLocalViewerCli } from '../src/local-viewer-cli.js'
import type { LocalDeviceRuntimeOptions } from '../src/local-device-runtime.js'

describe('local Viewer CLI', () => {
  it('loads saved defaults without host work and starts the shared runtime on loopback', async () => {
    const write = vi.fn()
    const saveSetup = vi.fn(async () => resolveLocalViewerSettings())
    const listen = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const createRuntime = vi.fn((config, options) => ({
      listen,
      close,
      viewer: { url: 'http://127.0.0.1:43210' },
      config,
      options,
    }))
    const handle = await startLocalViewerCli(['--config', '/private/viewer.json', '--port', '0'], { stdout: { write } }, {
      env: {},
      createStore: (path) => {
        expect(path).toBe('/private/viewer.json')
        return {
          load: async () => ({
            settings: resolveLocalViewerSettings({
              mirror: {
                defaultProvider: 'appium',
                appiumRuntimeMode: 'managed',
                appiumExecutablePath: '/trusted/appium',
              },
              local: { preferredPlatform: 'ios' },
            }),
            exists: true,
          }),
          saveSetup,
        }
      },
      createRuntime,
    })

    expect(listen).toHaveBeenCalledTimes(1)
    expect(createRuntime.mock.calls[0]?.[0]).toMatchObject({
      viewerPort: 0,
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
      appiumSessionStartupTimeoutMs: 120_000,
    })
    const runtimeOptions = createRuntime.mock.calls[0]?.[1]
    expect(runtimeOptions?.localSetup?.()).toEqual({ persistenceAvailable: true, preferredPlatform: 'ios' })
    expect(write).toHaveBeenCalledWith('FlowAssert viewer: http://127.0.0.1:43210\n')
    await handle?.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('updates only the public setup summary after an explicit persisted save', async () => {
    const initial = resolveLocalViewerSettings()
    const saved = resolveLocalViewerSettings({
      mirror: { appiumRuntimeMode: 'managed', appiumExecutablePath: '/trusted/appium' },
      local: { preferredPlatform: 'android' },
    })
    let runtimeOptions: LocalDeviceRuntimeOptions | undefined
    await startLocalViewerCli(['--config', '/private/viewer.json'], { stdout: { write: () => undefined } }, {
      env: {},
      createStore: () => ({
        load: async () => ({ settings: initial, exists: false }),
        saveSetup: async () => saved,
      }),
      createRuntime: (_config, options) => {
        runtimeOptions = options
        return { listen: async () => undefined, close: async () => undefined, viewer: { url: 'http://127.0.0.1:3210' } }
      },
    })
    if (!runtimeOptions?.localSetup || !runtimeOptions.persistSetup) throw new Error('Missing runtime setup callbacks')
    expect(runtimeOptions.localSetup()).toEqual({ persistenceAvailable: true, preferredPlatform: null })
    await runtimeOptions.persistSetup({ platform: 'android', appiumExecutablePath: '/trusted/appium' })
    expect(runtimeOptions.localSetup()).toEqual({ persistenceAvailable: true, preferredPlatform: 'android' })
    expect(JSON.stringify(runtimeOptions.localSetup())).not.toMatch(/trusted|appium|team|bundle/i)
  })

  it('rejects relative config/media paths and invalid ports before runtime creation', async () => {
    const createRuntime = vi.fn()
    for (const [args, env] of [
      [['--config', 'relative.json'], {}],
      [['--port', '70000'], {}],
      [[], { MOBILE_MIRROR_SCRCPY_PATH: 'relative/scrcpy' }],
    ] as const) {
      await expect(startLocalViewerCli(args, { stdout: { write: () => undefined } }, { env, createRuntime }))
        .rejects.toThrow('Invalid Viewer startup options')
    }
    expect(createRuntime).not.toHaveBeenCalled()
  })
})
