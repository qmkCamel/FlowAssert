import { describe, expect, it, vi } from 'vitest'
import type { ViewerMediaConfig } from '../src/config.js'
import type { ViewerMediaPacket, ViewerMediaSource } from '../src/types.js'
import { ViewerMediaCoordinator, ViewerMediaSubscriptionConflict, type ViewerMediaSourceFactory } from '../src/viewer-media-coordinator.js'

const config: ViewerMediaConfig = {
  mode: 'auto',
  android: { scrcpyPath: '/trusted/scrcpy', scrcpyServerPath: '/trusted/scrcpy-server', maxSize: 1280, maxFps: 30, videoBitRate: 4_000_000 },
  ios: { port: 0, framerate: 15, scalingFactor: 50, screenshotQuality: 40 },
}

describe('ViewerMediaCoordinator', () => {
  it('starts lazily, publishes live on the first queued frame, and returns to ready after idle grace', async () => {
    const source = sourceFrom([
      { kind: 'metadata', bytes: new Uint8Array(), codec: 'avc1.42001e' },
      { kind: 'session', bytes: new Uint8Array(), width: 390, height: 844 },
      { kind: 'key', bytes: Uint8Array.of(1, 2, 3), ptsUs: 1n },
    ])
    const coordinator = new ViewerMediaCoordinator(config, { sourceFactory: fixedFactory(source), idleGraceMs: 5 })
    await coordinator.prepare({ kind: 'android-scrcpy', deviceId: 'fixture-device', adbPath: '/fixture/adb' })
    expect(coordinator.state()).toMatchObject({ phase: 'ready', transport: 'scrcpy-h264' })

    const subscription = coordinator.subscribe()
    expect(coordinator.state().phase).toBe('starting')
    await waitFor(() => coordinator.state().phase === 'live')
    expect(coordinator.state()).toMatchObject({ width: 390, height: 844, firstFrameAt: expect.any(String) })
    expect(() => coordinator.subscribe()).toThrow(ViewerMediaSubscriptionConflict)

    await subscription.close()
    await waitFor(() => coordinator.state().phase === 'ready')
    expect(source.close).toHaveBeenCalledTimes(1)
    await coordinator.dispose()
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it('keeps polling mode side-effect free and exposes a stable fallback after source failure', async () => {
    const polling = new ViewerMediaCoordinator({ ...config, mode: 'polling' })
    await polling.prepare({ kind: 'android-scrcpy', deviceId: 'ignored', adbPath: '/ignored' })
    expect(polling.state()).toMatchObject({ phase: 'idle', transport: 'appium-screenshot' })
    expect(() => polling.subscribe()).toThrow(expect.objectContaining({ code: 'viewer_media_unavailable' }))

    const failed = sourceFrom([], new Error('PRIVATE_UPSTREAM_URL PRIVATE_UDID /Users/private/scrcpy-server adb -s secret forward tcp:12000 PRIVATE_STDERR'))
    const coordinator = new ViewerMediaCoordinator(config, { sourceFactory: fixedFactory(failed) })
    await coordinator.prepare({ kind: 'ios-wda-mjpeg', host: '127.0.0.1', port: 12000, owned: true })
    coordinator.subscribe()
    await waitFor(() => coordinator.state().phase === 'fallback')
    expect(coordinator.state()).toMatchObject({ lastErrorCode: 'viewer_media_stream_ended' })
    const publicState = JSON.stringify(coordinator.state())
    for (const secret of ['PRIVATE_UPSTREAM_URL', 'PRIVATE_UDID', '/Users/private', 'scrcpy-server', 'adb -s', '12000', 'PRIVATE_STDERR']) {
      expect(publicState).not.toContain(secret)
    }
    expect(JSON.stringify(coordinator.state())).not.toContain('12000')
    await coordinator.dispose()
  })

  it('aborts slow startup and accepts only the current generation failure report', async () => {
    const source = waitingSource()
    const coordinator = new ViewerMediaCoordinator(config, { sourceFactory: fixedFactory(source) })
    await coordinator.prepare({ kind: 'ios-wda-mjpeg', host: '127.0.0.1', port: 12001, owned: false })
    const subscription = coordinator.subscribe()
    await expect(coordinator.reportClientFailure('stale-generation', 'decoder-failed')).resolves.toBe(false)
    await expect(coordinator.reportClientFailure(subscription.generation, 'decoder-unsupported')).resolves.toBe(true)
    expect(coordinator.state()).toMatchObject({ phase: 'fallback', lastErrorCode: 'viewer_media_decoder_unsupported' })
    expect(source.close).toHaveBeenCalledTimes(1)
    await coordinator.stopSession()
    await coordinator.stopSession()
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it('bounds a slow subscriber and waits for the next self-describing key frame after dropping deltas', async () => {
    let releaseNextKey!: () => void
    const nextKey = new Promise<void>((resolve) => { releaseNextKey = resolve })
    const abort = new AbortController()
    const source: ViewerMediaSource & { close: ReturnType<typeof vi.fn> } = {
      transport: 'scrcpy-h264',
      close: vi.fn(async () => abort.abort()),
      async *open(signal) {
        yield { kind: 'metadata', bytes: new Uint8Array(), codec: 'avc1.42001e' }
        yield { kind: 'session', bytes: new Uint8Array(), width: 390, height: 844 }
        yield { kind: 'config', bytes: Uint8Array.of(0, 0, 0, 1, 0x67), codec: 'avc1.42001e' }
        yield { kind: 'key', bytes: Uint8Array.of(1), ptsUs: 1n }
        yield { kind: 'delta', bytes: Uint8Array.of(2), ptsUs: 2n }
        yield { kind: 'delta', bytes: Uint8Array.of(3), ptsUs: 3n }
        yield { kind: 'delta', bytes: Uint8Array.of(4), ptsUs: 4n }
        await nextKey
        if (!signal.aborted && !abort.signal.aborted) {
          yield { kind: 'delta', bytes: Uint8Array.of(4, 5), ptsUs: 45n }
          yield { kind: 'key', bytes: Uint8Array.of(5), ptsUs: 5n }
        }
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
          abort.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    }
    const coordinator = new ViewerMediaCoordinator(config, { sourceFactory: fixedFactory(source) })
    await coordinator.prepare({ kind: 'android-scrcpy', deviceId: 'fixture-device', adbPath: '/fixture/adb' })
    const subscription = coordinator.subscribe()
    const packets = subscription.packets[Symbol.asyncIterator]()
    await waitFor(() => coordinator.state().phase === 'live')
    await expect(packets.next()).resolves.toMatchObject({ value: { kind: 'key', codec: 'avc1.42001e', width: 390, height: 844 } })
    await expect(packets.next()).resolves.toMatchObject({ value: { kind: 'delta', bytes: Uint8Array.of(2) } })
    const pending = packets.next()
    releaseNextKey()
    await expect(pending).resolves.toMatchObject({ value: { kind: 'key', bytes: Uint8Array.of(5) } })
    await subscription.close()
    await coordinator.dispose()
  })

  it('starts every Android subscription on a self-describing key frame', async () => {
    const source = sourceFrom([
      { kind: 'metadata', bytes: new Uint8Array(), codec: 'avc1.42001e' },
      { kind: 'session', bytes: new Uint8Array(), width: 390, height: 844 },
      { kind: 'delta', bytes: Uint8Array.of(1), ptsUs: 1n },
      { kind: 'key', bytes: Uint8Array.of(2), ptsUs: 2n },
    ])
    const coordinator = new ViewerMediaCoordinator(config, { sourceFactory: fixedFactory(source) })
    await coordinator.prepare({ kind: 'android-scrcpy', deviceId: 'fixture-device', adbPath: '/fixture/adb' })
    const subscription = coordinator.subscribe()
    const first = await subscription.packets[Symbol.asyncIterator]().next()
    expect(first).toMatchObject({ done: false, value: { kind: 'key', codec: 'avc1.42001e', width: 390, height: 844 } })
    await subscription.close()
    await coordinator.dispose()
  })

  it('does not let an expired idle-grace cleanup overwrite a replacement subscription', async () => {
    let releaseClose!: () => void
    const closeGate = new Promise<void>((resolve) => { releaseClose = resolve })
    const first: ViewerMediaSource & { close: ReturnType<typeof vi.fn> } = {
      transport: 'scrcpy-h264',
      close: vi.fn(async () => { await closeGate }),
      async *open(signal) {
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      },
    }
    const second = waitingSource()
    let createCount = 0
    const coordinator = new ViewerMediaCoordinator(config, {
      idleGraceMs: 5,
      sourceFactory: { create: () => createCount++ === 0 ? first : second },
    })
    await coordinator.prepare({ kind: 'android-scrcpy', deviceId: 'fixture-device', adbPath: '/fixture/adb' })
    const initial = coordinator.subscribe()
    await initial.close()
    await waitFor(() => first.close.mock.calls.length === 1)
    const replacement = coordinator.subscribe()
    expect(coordinator.state().phase).toBe('starting')
    releaseClose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(coordinator.state().phase).toBe('starting')
    await replacement.close()
    await coordinator.dispose()
  })
})

function fixedFactory(source: ViewerMediaSource): ViewerMediaSourceFactory {
  return { create: () => source }
}

function sourceFrom(packets: ViewerMediaPacket[], failure?: Error): ViewerMediaSource & { close: ReturnType<typeof vi.fn> } {
  const abort = new AbortController()
  return {
    transport: 'scrcpy-h264',
    close: vi.fn(async () => abort.abort()),
    async *open(signal) {
      for (const packet of packets) yield packet
      if (failure) throw failure
      await new Promise<void>((resolve) => {
        const done = () => resolve()
        abort.signal.addEventListener('abort', done, { once: true })
        signal.addEventListener('abort', done, { once: true })
      })
    },
  }
}

function waitingSource(): ViewerMediaSource & { close: ReturnType<typeof vi.fn> } {
  return sourceFrom([])
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('Condition was not reached')
}
