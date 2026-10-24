import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.js'
import { ConnectionAssistantError, type ConnectionAssistantApi } from '../src/connection-assistant.js'
import type { MirrorService } from '../src/mirror-service.js'
import { AppiumPublicError } from '../src/providers/appium-provider.js'
import type { ViewerMediaPacket, ViewerMediaSubscription } from '../src/types.js'
import { ViewerMediaSubscriptionConflict } from '../src/viewer-media-coordinator.js'
import { ViewerServer } from '../src/viewer-server.js'
import { WdaStartError } from '../src/wda-errors.js'
import { jpegFixture } from './media-fixtures.js'

const viewers: ViewerServer[] = []

afterEach(async () => {
  await Promise.all(viewers.splice(0).map((viewer) => viewer.close()))
})

const config: Config = {
  defaultProvider: 'mock',
  agentScreenContentPolicy: 'mock-only',
  agentTextInputPolicy: 'mock-only',
  agentAppControlPolicy: 'disabled',
  agentAllowedAppIds: [],
  appiumUrl: 'http://127.0.0.1:4723',
  appiumRuntimeMode: 'external',
  appiumExecutablePath: '',
  viewerHost: '127.0.0.1',
  viewerPort: 0,
  frameIntervalMs: 250,
  viewerMediaMode: 'auto',
  androidScrcpyPath: '',
  androidScrcpyServerPath: '',
  androidScrcpyMaxSize: 1280,
  androidScrcpyMaxFps: 30,
  androidScrcpyVideoBitRate: 4_000_000,
  iosMjpegPort: 0,
  iosMjpegFramerate: 15,
  iosMjpegScalingFactor: 50,
  iosMjpegScreenshotQuality: 40,
  startupTimeoutMs: 2_000,
  appiumSessionStartupTimeoutMs: 2_000,
  mockStartupDelayMs: 10,
  allowHostDeviceDiscovery: false,
  adbPath: 'adb',
  xcrunPath: 'xcrun',
  androidIgnoreHiddenApiPolicyError: true,
  iosWdaXcodeOrgId: '',
  iosWdaXcodeSigningId: 'Apple Development',
  iosWdaUpdatedBundleId: '',
  iosWdaXcodeConfigFile: '',
  iosWdaAllowProvisioningDeviceRegistration: false,
  allowHostSigningDiagnostics: false,
}

describe('ViewerServer', () => {
  it('requires an explicit assistant boundary for every custom service', () => {
    expect(() => new ViewerServer(config, { service: mediaService(() => subscription('wda-mjpeg', [])) })).toThrow('explicit assistant')
  })

  it('serves the viewer and drives the complete mirror API lifecycle', async () => {
    const viewer = new ViewerServer({
      ...config,
      iosWdaXcodeOrgId: 'TEAM-SECRET',
      iosWdaUpdatedBundleId: 'com.example.secret',
      iosWdaAllowProvisioningDeviceRegistration: true,
    })
    viewers.push(viewer)
    await viewer.listen()

    const html = await fetch(viewer.url).then((response) => response.text())
    expect(html).toContain('See the device.')
    expect(html).toContain('Connect a phone or simulator')
    expect(html).toContain('Start demo')
    expect(html).toContain('data-i18n="hero.see"')

    const i18n = await fetch(`${viewer.url}/i18n.js`)
    expect(i18n.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await i18n.text()).toContain("'zh-CN': Object.freeze(zhCN)")

    const stateText = await fetch(`${viewer.url}/api/state`).then((response) => response.text())
    expect(stateText).toContain('"androidIgnoreHiddenApiPolicyError":true')
    expect(stateText).toContain('"iosWdaProvisioningMutationEnabled":true')
    expect(stateText).toContain('"localSetup":{"persistenceAvailable":false,"preferredPlatform":null}')
    expect(stateText).not.toContain('TEAM-SECRET')
    expect(stateText).not.toContain('com.example.secret')

    const start = await post(viewer.url, '/api/start', { provider: 'mock' })
    expect(start.lifecycle).toBe('streaming')
    const cachedFrame = await fetch(`${viewer.url}/api/frame?cached=1`)
    expect(cachedFrame.headers.get('x-mobile-mirror-frame-status')).toBe('cached')
    expect(await cachedFrame.text()).toContain('Hello, harness.')
    const frame = await fetch(`${viewer.url}/api/frame`)
    expect(frame.headers.get('content-type')).toBe('image/svg+xml')
    expect(frame.headers.get('x-mobile-mirror-frame-status')).toBe('fresh')
    expect(await frame.text()).toContain('Hello, harness.')

    const action = await post(viewer.url, '/api/action', { kind: 'tap', x: 195, y: 420 })
    expect(action.lastAction).toBe('tap(195,420)')
    const stop = await post(viewer.url, '/api/stop', {})
    expect(stop.lifecycle).toBe('idle')
  })

  it('publishes only a redacted local setup summary', async () => {
    const viewer = new ViewerServer(config, {
      localSetup: () => ({ persistenceAvailable: true, preferredPlatform: 'ios' }),
    })
    viewers.push(viewer)
    await viewer.listen()
    const body = await fetch(`${viewer.url}/api/state`).then((response) => response.text())
    expect(body).toContain('"localSetup":{"persistenceAvailable":true,"preferredPlatform":"ios"}')
    expect(body).not.toMatch(/\/trusted\/appium|ABCDE12345|com\.example\.WDA/)
  })

  it('returns stable Appium timeout codes without exposing transport causes', async () => {
    const service = mutationService()
    service.action.mockRejectedValue(new AppiumPublicError(
      'appium_session_command_timeout',
      new Error('PRIVATE session/path/device detail'),
    ))
    const viewer = new ViewerServer(config, { service, assistant: null })
    viewers.push(viewer)
    await viewer.listen()

    const response = await fetch(`${viewer.url}/api/action`, {
      method: 'POST',
      headers: { origin: viewer.url, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'back' }),
    })
    expect(response.status).toBe(504)
    const body = await response.text()
    expect(body).toContain('"code":"appium_session_command_timeout"')
    expect(body).not.toMatch(/PRIVATE|session\/path|device detail/)
  })

  it('returns a safe WDA account code from guided connection without masking it as invalid input', async () => {
    const action = 'Sign in to the Apple developer account for this Team in Xcode Settings > Accounts, then rerun the iOS readiness check and connect.'
    const connect = vi.fn(async () => { throw new WdaStartError(
      'wda_developer_account_unavailable', action, null,
      new Error('PRIVATE_ACCOUNT@example.com TEAM-SECRET /Users/private'),
    ) })
    const viewer = new ViewerServer(config, { service: mutationService(), assistant: fakeAssistant({ connect }) })
    viewers.push(viewer)
    await viewer.listen()
    const token = Buffer.alloc(16, 1).toString('base64url')
    const response = await postResponse(viewer.url, '/api/connection-assistant/connect', {
      assistantId: token,
      deviceRef: token,
      targetPreset: 'ios-current-screen',
      runtime: 'configured',
    })
    expect(response.status).toBe(502)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({ code: 'wda_developer_account_unavailable', message: action })
    expect(body).not.toMatch(/PRIVATE_ACCOUNT|TEAM-SECRET|\/Users\/private|assistant_input_invalid/)
  })

  it('streams same-origin H.264 envelopes with bounded status metadata and closes on completion', async () => {
    const close = vi.fn(async () => undefined)
    const failure = vi.fn(async () => true)
    const service = mediaService(() => subscription('scrcpy-h264', [
      { kind: 'key', bytes: Uint8Array.of(0, 0, 0, 1, 0x67, 0x42, 0, 0x1e, 0, 0, 0, 1, 0x65), ptsUs: 1n, codec: 'avc1.42001e', width: 390, height: 844 },
    ], close), failure)
    const viewer = new ViewerServer(config, { service, assistant: null })
    viewers.push(viewer)
    await viewer.listen()

    const response = await fetch(`${viewer.url}/api/media/stream`, { headers: { origin: viewer.url } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/x-mobile-mirror-h264; version=1')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const generation = response.headers.get('x-mobile-mirror-generation')
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('MMV1')
    expect(bytes.toString('utf8')).toContain(generation!)
    expect(bytes.toString('utf8')).not.toContain('/private/scrcpy')
    expect(close).toHaveBeenCalledTimes(1)
    expect(viewer.mediaDiagnostics()).toMatchObject({ transport: 'scrcpy-h264', frameCount: 1, firstFrameAt: expect.any(Number) })

    const report = await fetch(`${viewer.url}/api/media/client-failure`, {
      method: 'POST',
      headers: { origin: viewer.url, 'content-type': 'application/json' },
      body: JSON.stringify({ generation, code: 'decoder-failed' }),
    })
    expect(report.status).toBe(202)
    expect(failure).toHaveBeenCalledWith(generation, 'decoder-failed')
  })

  it('re-publishes MJPEG with a fixed boundary and rejects upstream/cross-origin injection', async () => {
    const jpeg = jpegFixture(3, 2)
    const subscribe = vi.fn(() => subscription('wda-mjpeg', [{ kind: 'jpeg', bytes: jpeg, width: 3, height: 2 }]))
    const viewer = new ViewerServer(config, { service: mediaService(subscribe), assistant: null })
    viewers.push(viewer)
    await viewer.listen()

    const response = await fetch(`${viewer.url}/api/media/stream`, { headers: { referer: `${viewer.url}/index.html` } })
    expect(response.headers.get('content-type')).toBe('multipart/x-mixed-replace; boundary=mobile-mirror-frame')
    const body = Buffer.from(await response.arrayBuffer())
    expect(body.toString('latin1')).toContain('--mobile-mirror-frame\r\nContent-Type: image/jpeg')
    expect(body.includes(jpeg)).toBe(true)

    const injected = await fetch(`${viewer.url}/api/media/stream?upstream=http://private-device:9100`)
    expect(injected.status).toBe(400)
    const crossOrigin = await fetch(`${viewer.url}/api/media/stream`, { headers: { origin: 'https://attacker.example' } })
    expect(crossOrigin.status).toBe(400)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('returns 409 for a second subscription and validates fixed client-failure payloads', async () => {
    const viewer = new ViewerServer(config, { service: mediaService(() => { throw new ViewerMediaSubscriptionConflict() }), assistant: null })
    viewers.push(viewer)
    await viewer.listen()
    expect((await fetch(`${viewer.url}/api/media/stream`)).status).toBe(409)
    const invalid = await fetch(`${viewer.url}/api/media/client-failure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generation: 'current', code: 'PRIVATE_BROWSER_ERROR', detail: '/Users/private' }),
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).not.toContain('/Users/private')
  })

  it('requires exact Origin before reading every mutation body or invoking assistant host work', async () => {
    const check = vi.fn(async () => assistantReport())
    const assistant = fakeAssistant({ check })
    const service = mutationService()
    const viewer = new ViewerServer(config, { service, assistant })
    viewers.push(viewer)
    await viewer.listen()

    for (const path of ['/api/start', '/api/stop', '/api/action', '/api/media/client-failure', '/api/connection-assistant/check']) {
      const missing = await fetch(`${viewer.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"platform":"android"}',
      })
      expect(missing.status, path).toBe(400)
      expect(await missing.json(), path).toEqual({
        code: 'assistant_origin_required',
        message: 'A matching Viewer origin is required',
      })
      const mismatch = await fetch(`${viewer.url}${path}`, {
        method: 'POST',
        headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
        body: '{"platform":"android"}',
      })
      expect(mismatch.status, path).toBe(400)
    }
    expect(check).not.toHaveBeenCalled()
    expect(service.start).not.toHaveBeenCalled()
    expect(service.stop).not.toHaveBeenCalled()
    expect(service.action).not.toHaveBeenCalled()
    expect(service.reportMediaClientFailure).not.toHaveBeenCalled()
  })

  it('serves bounded assistant routes with stable errors and request cancellation', async () => {
    const check = vi.fn(async () => assistantReport())
    const connect = vi.fn(async () => ({
      lifecycle: 'streaming', provider: 'appium', sessionId: 'opaque', deviceName: 'Generic device', viewerUrl: 'http://127.0.0.1:0',
      frameUpdatedAt: null, lastAction: null, lastError: null, lastErrorCode: null,
      observation: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
      control: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
      media: { mode: 'polling', phase: 'idle', transport: 'appium-screenshot', startedAt: null, firstFrameAt: null, lastFrameAt: null, width: null, height: null, targetFps: null, lastErrorCode: null },
      appiumRuntime: { mode: 'external', phase: 'idle', owned: false, lastErrorCode: null }, revision: 1,
    } as const))
    const cancel = vi.fn(() => ({ cancelled: true as const }))
    const viewer = new ViewerServer(config, {
      service: mutationService(),
      assistant: fakeAssistant({ check, connect, cancel }),
    })
    viewers.push(viewer)
    await viewer.listen()

    const checked = await post(viewer.url, '/api/connection-assistant/check', { platform: 'android' })
    expect(checked).toMatchObject({ schemaVersion: 1, platform: 'android' })
    expect(check).toHaveBeenCalledWith({ platform: 'android' }, expect.any(AbortSignal))

    const malformed = await fetch(`${viewer.url}/api/connection-assistant/check`, {
      method: 'POST', headers: { origin: viewer.url, 'content-type': 'application/json' }, body: '{',
    })
    expect(await malformed.json()).toEqual({ code: 'assistant_input_invalid', message: 'The connection assistant request is invalid' })
    const oversized = await fetch(`${viewer.url}/api/connection-assistant/check`, {
      method: 'POST', headers: { origin: viewer.url, 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'android', padding: 'x'.repeat(1_024) }),
    })
    expect(await oversized.json()).toEqual({ code: 'assistant_input_invalid', message: 'The connection assistant request is invalid' })

    check.mockRejectedValueOnce(new ConnectionAssistantError('assistant_context_stale'))
    const stale = await postResponse(viewer.url, '/api/connection-assistant/check', { platform: 'android' })
    expect(stale.status).toBe(410)
    expect(await stale.json()).toEqual({ code: 'assistant_context_stale', message: 'The connection check expired or is no longer available' })
  })
})

async function post(baseUrl: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await postResponse(baseUrl, path, body)
  return await response.json() as Record<string, unknown>
}

async function postResponse(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { origin: baseUrl, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mediaService(
  subscribeMedia: () => ViewerMediaSubscription,
  reportMediaClientFailure: (generation: string, code: 'decoder-unsupported' | 'decoder-failed' | 'render-failed') => Promise<boolean> = async () => false,
): MirrorService {
  return { subscribeMedia, reportMediaClientFailure, updateViewerUrl: () => undefined } as unknown as MirrorService
}

function subscription(
  transport: 'scrcpy-h264' | 'wda-mjpeg',
  packets: ViewerMediaPacket[],
  close = vi.fn(async () => undefined),
): ViewerMediaSubscription {
  return {
    generation: 'opaque-generation',
    transport,
    contentType: transport === 'scrcpy-h264'
      ? 'application/x-mobile-mirror-h264; version=1'
      : 'multipart/x-mixed-replace; boundary=mobile-mirror-frame',
    packets: (async function* () { for (const packet of packets) yield packet })(),
    close,
  }
}

function assistantReport() {
  return {
    schemaVersion: 1 as const,
    assistantId: Buffer.alloc(16, 1).toString('base64url'),
    platform: 'android' as const,
    status: 'action-required' as const,
    checkedAt: new Date(0).toISOString(),
    expiresAt: new Date(120_000).toISOString(),
    checks: [],
    devices: [],
    runtimeChoices: ['configured' as const],
    confirmations: ['uiautomator2-helper-apk' as const],
    media: { mode: 'polling' as const, code: 'assistant_scrcpy_not_configured' },
  }
}

function fakeAssistant(overrides: Partial<ConnectionAssistantApi> = {}): ConnectionAssistantApi {
  return {
    check: async () => assistantReport(),
    connect: async () => { throw new ConnectionAssistantError('assistant_input_invalid') },
    cancel: () => ({ cancelled: true }),
    dispose: () => undefined,
    ...overrides,
  }
}

function mutationService(): MirrorService & {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  action: ReturnType<typeof vi.fn>
  reportMediaClientFailure: ReturnType<typeof vi.fn>
} {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    action: vi.fn(),
    reportMediaClientFailure: vi.fn(),
    updateViewerUrl: vi.fn(),
  } as unknown as MirrorService & {
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    action: ReturnType<typeof vi.fn>
    reportMediaClientFailure: ReturnType<typeof vi.fn>
  }
}
