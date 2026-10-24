import { describe, expect, it, vi } from 'vitest'
import { Config, type Config as MirrorConfig } from '../src/config.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'

function config(overrides: Partial<MirrorConfig> = {}): MirrorConfig {
  return Config({ viewerPort: 0, mockStartupDelayMs: 0, ...overrides } as MirrorConfig)
}

describe('LocalDeviceRuntime', () => {
  it('shares one service with the Viewer and closes idempotently', async () => {
    const runtime = new LocalDeviceRuntime(config())
    const dispose = vi.spyOn(runtime.service, 'dispose')
    expect(runtime.viewer.service).toBe(runtime.service)
    expect(runtime.viewer.assistant).toBe(runtime.assistant)
    await runtime.listen()
    await runtime.listen()
    expect(runtime.service.state().viewerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect((await fetch(runtime.viewer.url)).status).toBe(200)
    await runtime.close()
    await runtime.close()
    expect(dispose).toHaveBeenCalledTimes(1)
    await expect(fetch(runtime.viewer.url)).rejects.toThrow()
  })

  it('fails explicitly on a Viewer port conflict', async () => {
    const first = new LocalDeviceRuntime(config())
    await first.listen()
    const port = Number(new URL(first.viewer.url).port)
    const second = new LocalDeviceRuntime(config({ viewerPort: port }))
    await expect(second.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await second.close()
    await first.close()
  })

  it('aborts a slow startup while closing', async () => {
    const runtime = new LocalDeviceRuntime(config({ mockStartupDelayMs: 2_000 }))
    await runtime.listen()
    const start = runtime.commands.execute('mobile_mirror_start', { provider: 'mock' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await runtime.close()
    await expect(start).rejects.toThrow(/closing|abort/i)
  })
})
