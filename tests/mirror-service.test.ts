import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { MirrorService } from '../src/mirror-service.js'
import { MOCK_SECONDARY_APP_ID } from '../src/mock-screen-model.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import type { Config } from '../src/config.js'
import type { AppiumRuntimeLifecycle } from '../src/managed-appium-runtime.js'
import type { MirrorFrame } from '../src/types.js'
import type { ViewerMediaSourceFactory } from '../src/viewer-media-coordinator.js'

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
  mockStartupDelayMs: 20,
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

describe('MirrorService', () => {
  it('publishes explicit lifecycle and completion state', async () => {
    const service = new MirrorService(config, 'http://127.0.0.1:0')
    const start = service.start({ provider: 'mock' })
    expect(service.state().lifecycle).toBe('connecting')
    await start
    expect(service.state()).toMatchObject({ lifecycle: 'streaming', provider: 'mock', sessionId: 'mock-iphone-15' })
    expect(service.state().frameUpdatedAt).not.toBeNull()
    await service.action({ kind: 'back' })
    expect(service.state().lastAction).toBe('back')
    await service.stop()
    expect(service.state().lifecycle).toBe('idle')
  })

  it('returns a successful action without starting a post-action frame request', async () => {
    const provider = new MockProvider(0)
    const service = new MirrorService(config, 'http://127.0.0.1:0', { providerFactory: () => provider })
    await service.start({ provider: 'mock' })
    const frame = vi.spyOn(provider, 'frame')
    await expect(service.action({ kind: 'back' })).resolves.toMatchObject({
      lastAction: 'back',
      control: { phase: 'idle', lastErrorCode: null },
    })
    expect(frame).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('makes repeated starts idempotent for the same active provider', async () => {
    const service = new MirrorService(config, 'http://127.0.0.1:0')
    const first = await service.start({ provider: 'mock' })
    const second = await service.start({ provider: 'mock' })
    expect(second.sessionId).toBe(first.sessionId)
    await service.dispose()
  })

  it('uses the longer Appium session timeout without widening Mock or initial-frame startup', async () => {
    const provider = new MockProvider(75)
    const service = new MirrorService({
      ...config,
      startupTimeoutMs: 20,
      appiumSessionStartupTimeoutMs: 200,
    }, 'http://127.0.0.1:0', { providerFactory: () => provider })

    await expect(service.start({ provider: 'appium', capabilities: { platformName: 'iOS' } }))
      .resolves.toMatchObject({ lifecycle: 'streaming', provider: 'appium' })
    await service.dispose()
  })

  it('treats an owned managed Appium shutdown as authoritative when session deletion races', async () => {
    const provider = new MockProvider(0)
    vi.spyOn(provider, 'stop').mockRejectedValue(new Error('session deletion raced with shutdown'))
    const runtimeStop = vi.fn(async () => undefined)
    const runtime: AppiumRuntimeLifecycle = {
      state: () => ({ mode: 'managed', phase: 'ready', owned: true, lastErrorCode: null }),
      ensureReady: async () => undefined,
      stop: runtimeStop,
    }
    const release = vi.fn(async () => true)
    const service = new MirrorService(config, 'http://127.0.0.1:0', {
      appiumRuntime: runtime,
      providerFactory: () => provider,
      deviceClaim: { acquire: async () => ({ key: 'ios:test', nonce: 'owned', markActive: async () => undefined, release }) },
    })

    await service.start({ provider: 'appium', capabilities: { platformName: 'iOS', 'appium:udid': 'test-device' } })
    await expect(service.stop()).resolves.toMatchObject({ lifecycle: 'idle', lastErrorCode: null })
    expect(runtimeStop).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    await service.dispose()
  })

  it('keeps an external Appium session deletion failure visible without claiming cleanup', async () => {
    const provider = new MockProvider(0)
    vi.spyOn(provider, 'stop').mockRejectedValue(new Error('external session was not deleted'))
    const release = vi.fn(async () => true)
    const service = new MirrorService(config, 'http://127.0.0.1:0', {
      providerFactory: () => provider,
      deviceClaim: { acquire: async () => ({ key: 'ios:test', nonce: 'external', markActive: async () => undefined, release }) },
    })

    await service.start({ provider: 'appium', capabilities: { platformName: 'iOS', 'appium:udid': 'test-device' } })
    await expect(service.stop()).rejects.toThrow('external session was not deleted')
    expect(service.state()).toMatchObject({ lifecycle: 'error', provider: null, sessionId: null })
    expect(release).not.toHaveBeenCalled()
    await service.dispose()
  })

  it('releases an explicit device claim when disposing an owned managed runtime', async () => {
    const provider = new MockProvider(0)
    vi.spyOn(provider, 'stop').mockRejectedValue(new Error('session deletion raced with shutdown'))
    const runtime: AppiumRuntimeLifecycle = {
      state: () => ({ mode: 'managed', phase: 'ready', owned: true, lastErrorCode: null }),
      ensureReady: async () => undefined,
      stop: async () => undefined,
    }
    const release = vi.fn(async () => true)
    const service = new MirrorService(config, 'http://127.0.0.1:0', {
      appiumRuntime: runtime,
      providerFactory: () => provider,
      deviceClaim: { acquire: async () => ({ key: 'ios:dispose', nonce: 'owned', markActive: async () => undefined, release }) },
    })
    await service.start({ provider: 'appium', capabilities: { platformName: 'iOS', 'appium:udid': 'dispose-device' } })
    await service.dispose()
    expect(release).toHaveBeenCalledOnce()
  })

  it('retains an explicit device claim when dispose cannot delete an external session', async () => {
    const provider = new MockProvider(0)
    vi.spyOn(provider, 'stop').mockRejectedValue(new Error('external session was not deleted'))
    const release = vi.fn(async () => true)
    const service = new MirrorService(config, 'http://127.0.0.1:0', {
      providerFactory: () => provider,
      deviceClaim: { acquire: async () => ({ key: 'ios:dispose-external', nonce: 'external', markActive: async () => undefined, release }) },
    })
    await service.start({ provider: 'appium', capabilities: { platformName: 'iOS', 'appium:udid': 'dispose-external-device' } })
    await service.dispose()
    expect(release).not.toHaveBeenCalled()
  })

  it('aborts an in-flight Viewer frame without publishing a stale stop error', async () => {
    const provider = new MockProvider(0)
    const service = new MirrorService(config, 'http://127.0.0.1:0', { providerFactory: () => provider })
    await service.start({ provider: 'mock' })
    const retained = service.cachedFrame()
    vi.spyOn(provider, 'frame').mockImplementationOnce(async (signal?: AbortSignal): Promise<MirrorFrame> => await new Promise<MirrorFrame>((_, reject) => {
      const abort = () => reject(signal?.reason ?? new Error('aborted'))
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    }))

    const pendingFrame = service.frame()
    await vi.waitFor(() => expect(provider.frame).toHaveBeenCalledOnce())
    await expect(service.stop()).resolves.toMatchObject({ lifecycle: 'idle', lastError: null, lastErrorCode: null })
    const resolvedFrame = await pendingFrame
    expect(resolvedFrame.contentType).toBe(retained?.contentType)
    expect(Buffer.from(resolvedFrame.bytes)).toEqual(retained?.bytes)
    expect(service.state()).toMatchObject({ lifecycle: 'idle', lastError: null, lastErrorCode: null })
    await service.dispose()
  })

  it('lets stop cancel a managed start while preserving the last usable frame', async () => {
    let phase: 'idle' | 'starting' = 'idle'
    const lifecycle: AppiumRuntimeLifecycle = {
      state: () => ({ mode: 'managed', phase, owned: phase === 'starting', lastErrorCode: null }),
      ensureReady: async (_input, signal) => {
        phase = 'starting'
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(signal?.reason)
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        })
      },
      stop: async () => { phase = 'idle' },
    }
    const service = new MirrorService({
      ...config,
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
    }, 'http://127.0.0.1:0', { appiumRuntime: lifecycle })
    await service.start({ provider: 'mock' })
    const retainedFrame = await service.frame()
    const retainedAt = service.state().frameUpdatedAt
    await service.stop()

    const starting = service.start({ provider: 'appium', capabilities: { platformName: 'Android' } })
    await waitForState(() => service.state().lifecycle === 'connecting')
    await expect(service.stop()).resolves.toMatchObject({ lifecycle: 'idle' })
    await expect(starting).resolves.toMatchObject({ lifecycle: 'idle' })
    expect(service.state().frameUpdatedAt).toBe(retainedAt)
    await expect(service.frame()).resolves.toEqual(retainedFrame)
    await service.dispose()
  })

  it('keeps Mock independent from enabled iOS provisioning defaults', async () => {
    const service = new MirrorService({
      ...config,
      iosWdaXcodeOrgId: 'TEAM_PLACEHOLDER',
      iosWdaUpdatedBundleId: 'com.example.WebDriverAgentRunner',
      iosWdaAllowProvisioningDeviceRegistration: true,
    }, 'http://127.0.0.1:0')
    await expect(service.start({ provider: 'mock' })).resolves.toMatchObject({
      lifecycle: 'streaming',
      provider: 'mock',
    })
    await service.dispose()
  })

  it('runs the Mock observation and strict safe-action loop', async () => {
    const service = new MirrorService(config, 'http://127.0.0.1:0')
    await service.start({ provider: 'mock' })

    const first = await service.observe({ image: true, structure: true })
    expect(first).toMatchObject({
      frameRevision: 1,
      viewport: { width: 390, height: 844 },
      image: { contentType: 'image/png', width: 390, height: 844 },
      structure: { truncated: false },
    })
    expect(first.structure?.nodes[2]).toMatchObject({ name: '0 actions received' })

    await service.action({
      kind: 'tap',
      x: 389,
      y: 843,
      observationId: first.observationId,
      coordinateSpace: 'snapshot',
    })
    expect(service.state().lastAction).toBe('tap(389,843)')
    await expect(service.action({ kind: 'back', observationId: first.observationId })).rejects.toMatchObject({ code: 'screen_observation_stale' })

    const second = await service.observe({ image: false, structure: true })
    expect(second.frameRevision).toBe(2)
    expect(second.structure?.nodes[2]).toMatchObject({ name: '1 actions received' })
    await expect(service.action({
      kind: 'tap',
      x: 390,
      y: 10,
      observationId: second.observationId,
    })).rejects.toMatchObject({ code: 'screen_coordinate_space_invalid' })

    await service.action({ kind: 'tap', x: 999, y: 999 })
    await expect(service.action({ kind: 'tap', x: 1, y: 1, coordinateSpace: 'snapshot' })).rejects.toMatchObject({ code: 'screen_coordinate_space_invalid' })
    await service.stop()
    await service.start({ provider: 'mock' })
    await expect(service.action({ kind: 'back', observationId: second.observationId })).rejects.toMatchObject({ code: 'screen_observation_session_mismatch' })
    await service.dispose()
  })

  it('runs observation-bound node focus and bounded ordinary text without public payload echo', async () => {
    const marker = 'PUBLIC-MARKER-42'
    const service = new MirrorService(config, 'http://127.0.0.1:0')
    await service.start({ provider: 'mock' })

    const initial = await service.observe({ image: false, structure: true })
    await service.action({ kind: 'tap_node', observationId: initial.observationId, nodeId: 'n3' })
    await expect(service.action({ kind: 'tap_node', observationId: initial.observationId, nodeId: 'n3' }))
      .rejects.toMatchObject({ code: 'screen_observation_stale' })

    const focused = await service.observe({ image: false, structure: true })
    expect(focused.structure?.nodes.find((node) => node.nodeId === 'n3')).toMatchObject({ role: 'input', focused: true })
    await service.action({ kind: 'input_text', observationId: focused.observationId, nodeId: 'n3', mode: 'replace', text: marker })
    const afterReplace = await service.observe({ image: false, structure: true })
    expect(afterReplace.structure?.nodes.find((node) => node.nodeId === 'n3')?.value).toBe(marker)
    expect(JSON.stringify(service.state())).not.toContain(marker)
    expect(service.state().lastAction).toBe(`input_text(replace,${marker.length} code points)`)

    await service.action({ kind: 'input_text', observationId: afterReplace.observationId, nodeId: 'n3', mode: 'append', text: '-A' })
    const afterAppend = await service.observe({ image: false, structure: true })
    expect(afterAppend.structure?.nodes.find((node) => node.nodeId === 'n3')?.value).toBe(`${marker}-A`)

    await service.action({ kind: 'tap_node', observationId: afterAppend.observationId, nodeId: 'n4' })
    const secureFocused = await service.observe({ image: false, structure: true })
    const secure = secureFocused.structure?.nodes.find((node) => node.nodeId === 'n4')
    expect(secure).toMatchObject({ sensitive: true, focused: true })
    expect(secure).not.toHaveProperty('value')
    await expect(service.action({
      kind: 'input_text', observationId: secureFocused.observationId, nodeId: 'n4', mode: 'append', text: 'public-only',
    })).rejects.toMatchObject({ code: 'screen_text_input_sensitive' })
    expect(service.state().control).toMatchObject({ phase: 'idle', lastErrorCode: 'screen_text_input_sensitive' })
    await service.dispose()
  })

  it('authorizes only exact owned-session or allowlisted mock app targets', async () => {
    const disabled = new MirrorService(config, 'http://127.0.0.1:0')
    await disabled.start({ provider: 'mock' })
    await expect(disabled.manageApp({ operation: 'terminate' })).rejects.toMatchObject({ code: 'app_control_disabled' })
    await disabled.dispose()

    const session = new MirrorService({ ...config, agentAppControlPolicy: 'session-app' }, 'http://127.0.0.1:0')
    await session.start({ provider: 'mock' })
    await expect(session.manageApp({ operation: 'terminate', appId: 'com.example.other' }))
      .rejects.toMatchObject({ code: 'app_target_not_allowed' })
    const stopped = await session.manageApp({ operation: 'terminate' })
    expect(stopped).toMatchObject({ operation: 'terminate', targetScope: 'mock', beforeState: 'foreground', afterState: 'not-running', outcome: 'terminated' })
    expect(stopped).not.toHaveProperty('appId')
    expect(await session.manageApp({ operation: 'activate' })).toMatchObject({ afterState: 'foreground', outcome: 'activated' })
    await session.dispose()

    const allowlisted = new MirrorService({
      ...config,
      agentAppControlPolicy: 'allowlist',
      agentAllowedAppIds: [MOCK_SECONDARY_APP_ID],
    }, 'http://127.0.0.1:0')
    await allowlisted.start({ provider: 'mock' })
    expect(await allowlisted.manageApp({ operation: 'activate', appId: MOCK_SECONDARY_APP_ID })).toMatchObject({
      targetScope: 'mock', beforeState: 'not-running', afterState: 'foreground', outcome: 'activated',
    })
    expect(JSON.stringify(allowlisted.state())).not.toContain(MOCK_SECONDARY_APP_ID)
    await allowlisted.dispose()
  })

  it('invalidates old observations after a provider reports partial text mutation', async () => {
    const service = new MirrorService(config, 'http://127.0.0.1:0', {
      providerFactory: () => new MockProvider(0, { failTextAfterMutation: true }),
    })
    await service.start({ provider: 'mock' })
    const initial = await service.observe({ image: false, structure: true })
    await service.action({ kind: 'tap_node', observationId: initial.observationId, nodeId: 'n3' })
    const focused = await service.observe({ image: false, structure: true })
    await expect(service.action({
      kind: 'input_text', observationId: focused.observationId, nodeId: 'n3', mode: 'replace', text: 'PUBLIC-PARTIAL',
    })).rejects.toMatchObject({ code: 'screen_text_input_partial' })
    await expect(service.action({ kind: 'tap_node', observationId: focused.observationId, nodeId: 'n3' }))
      .rejects.toMatchObject({ code: 'screen_observation_stale' })
    const refreshed = await service.observe({ image: false, structure: true })
    expect(refreshed.screenEpoch).toBe(focused.screenEpoch + 1)
    expect(JSON.stringify(service.state())).not.toContain('PUBLIC-PARTIAL')
    await service.dispose()
  })

  it('preserves a fixed business error without starting a recovery frame request', async () => {
    const provider = new MockProvider(0)
    const service = new MirrorService(config, 'http://127.0.0.1:0', { providerFactory: () => provider })
    await service.start({ provider: 'mock' })
    const observation = await service.observe({ image: false, structure: true })
    vi.spyOn(provider, 'frame').mockRejectedValueOnce(new Error('PRIVATE FRAME FAILURE'))
    await expect(service.action({
      kind: 'input_text', observationId: observation.observationId, nodeId: 'n4', mode: 'append', text: 'PUBLIC',
    })).rejects.toMatchObject({ code: 'screen_text_input_sensitive' })
    expect(service.state()).toMatchObject({
      lastErrorCode: 'screen_text_input_sensitive',
      control: { phase: 'idle', lastErrorCode: 'screen_text_input_sensitive' },
    })
    expect(provider.frame).not.toHaveBeenCalled()
    expect(JSON.stringify(service.state())).not.toContain('PRIVATE FRAME FAILURE')
    await service.dispose()
  })

  it('exposes generic control progress while another status read remains available', async () => {
    const service = new MirrorService(config, 'http://127.0.0.1:0', {
      providerFactory: () => new MockProvider(0, { operationDelayMs: 350 }),
    })
    await service.start({ provider: 'mock' })
    const initial = await service.observe({ image: false, structure: true })
    await service.action({ kind: 'tap_node', observationId: initial.observationId, nodeId: 'n3' })
    const focused = await service.observe({ image: false, structure: true })
    const action = service.action({ kind: 'input_text', observationId: focused.observationId, nodeId: 'n3', mode: 'append', text: 'PUBLIC-SLOW' })
    await waitForState(() => service.state().control.phase === 'acting')
    expect(service.state()).toMatchObject({ lifecycle: 'streaming', control: { phase: 'acting', lastErrorCode: null } })
    await action
    expect(service.state().control).toMatchObject({ phase: 'idle', lastErrorCode: null })
    await service.dispose()
  })

  it('lets stop cancel a post-mutation text operation and finishes control cleanup', async () => {
    const service = new MirrorService(config, 'http://127.0.0.1:0', {
      providerFactory: () => new MockProvider(0, { postMutationDelayMs: 2_000 }),
    })
    await service.start({ provider: 'mock' })
    const initial = await service.observe({ image: false, structure: true })
    await service.action({ kind: 'tap_node', observationId: initial.observationId, nodeId: 'n3' })
    const focused = await service.observe({ image: false, structure: true })
    const input = service.action({
      kind: 'input_text', observationId: focused.observationId, nodeId: 'n3', mode: 'replace', text: 'PUBLIC-CANCELLED',
    })
    const handledInput = input.catch((error: unknown) => error as Error & { code?: string })
    await waitForState(() => service.state().control.phase === 'acting')
    await expect(service.stop()).resolves.toMatchObject({ lifecycle: 'idle', control: { phase: 'idle' } })
    expect(await handledInput).toMatchObject({ code: 'screen_text_input_partial' })
    expect(JSON.stringify(service.state())).not.toContain('PUBLIC-CANCELLED')
    await service.dispose()
  })

  it('invalidates observations on unknown app mutation outcomes and rejects attached ownership before provider calls', async () => {
    const failing = new MirrorService({ ...config, agentAppControlPolicy: 'session-app' }, 'http://127.0.0.1:0', {
      providerFactory: () => new MockProvider(0, { failAppAfterMutation: true }),
    })
    await failing.start({ provider: 'mock' })
    const before = await failing.observe({ image: false, structure: true })
    await expect(failing.manageApp({ operation: 'terminate' })).rejects.toMatchObject({ code: 'app_terminate_failed' })
    await expect(failing.action({ kind: 'tap_node', observationId: before.observationId, nodeId: 'n3' }))
      .rejects.toMatchObject({ code: 'screen_observation_stale' })
    expect((await failing.observe({ image: false, structure: true })).screenEpoch).toBe(before.screenEpoch + 1)
    await failing.dispose()

    const attachedProvider = new MockProvider(0)
    const manage = vi.spyOn(attachedProvider, 'manageApp')
    vi.spyOn(attachedProvider, 'appControlContext').mockReturnValue({
      owned: false, platform: 'android', targetAppId: 'com.example.attached',
    })
    const attached = new MirrorService({ ...config, agentAppControlPolicy: 'session-app' }, 'http://127.0.0.1:0', {
      providerFactory: () => attachedProvider,
    })
    await attached.start({ provider: 'mock' })
    await expect(attached.manageApp({ operation: 'terminate' }))
      .rejects.toMatchObject({ code: 'app_control_attached_session_forbidden' })
    expect(manage).not.toHaveBeenCalled()
    await attached.dispose()
  })

  it('applies the 15 second safe-action freshness independently from store TTL', async () => {
    let now = 50_000
    const service = new MirrorService(config, 'http://127.0.0.1:0', { now: () => now })
    await service.start({ provider: 'mock' })
    const observation = await service.observe({ image: true, structure: false })
    now += 15_001
    await expect(service.action({ kind: 'back', observationId: observation.observationId })).rejects.toMatchObject({ code: 'screen_observation_expired' })
    await service.dispose()
  })

  it('rejects Appium observation before screen endpoints under the default policy', async () => {
    const screenRequests: string[] = []
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'policy-session', capabilities: { platformName: 'Android' } } }))
      else if (request.url === '/session/policy-session/screenshot') response.end(JSON.stringify({ value: Buffer.from('viewer-frame').toString('base64') }))
      else {
        screenRequests.push(request.url ?? '')
        response.end(JSON.stringify({ value: null }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const service = new MirrorService({ ...config, appiumUrl: `http://127.0.0.1:${address.port}` }, 'http://127.0.0.1:0')
    try {
      await service.start({ provider: 'appium', capabilities: { platformName: 'Android' } })
      screenRequests.length = 0
      await expect(service.observe({ image: false, structure: true })).rejects.toMatchObject({ code: 'screen_observation_disabled' })
      await expect(service.observe({ image: true, structure: false })).rejects.toMatchObject({ code: 'screen_observation_disabled' })
      expect(screenRequests).toEqual([])
    } finally {
      await service.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('fails concurrent observation fast and lets stop abort queued session work', async () => {
    let resolveSourceStarted!: () => void
    const sourceStarted = new Promise<void>((resolve) => { resolveSourceStarted = resolve })
    const actionRequests: string[] = []
    const observationRequests: string[] = []
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (/\/(?:screenshot|source|orientation)$|\/window\/rect$/.test(request.url ?? '')) observationRequests.push(request.url ?? '')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'slow-session', capabilities: { platformName: 'Android' } } }))
      else if (request.url === '/session/slow-session/screenshot') response.end(JSON.stringify({ value: Buffer.from('viewer-frame').toString('base64') }))
      else if (request.url === '/session/slow-session/window/rect') response.end(JSON.stringify({ value: { x: 0, y: 0, width: 390, height: 844 } }))
      else if (request.url === '/session/slow-session/orientation') response.end(JSON.stringify({ value: 'PORTRAIT' }))
      else if (request.url === '/session/slow-session/source') {
        resolveSourceStarted()
      } else {
        if (request.url?.endsWith('/actions')) actionRequests.push(request.url)
        response.end(JSON.stringify({ value: null }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const service = new MirrorService({
      ...config,
      agentScreenContentPolicy: 'structure',
      appiumUrl: `http://127.0.0.1:${address.port}`,
    }, 'http://127.0.0.1:0')
    try {
      await service.start({ provider: 'appium', capabilities: { platformName: 'Android' } })
      observationRequests.length = 0
      await expect(service.observe({ image: true, structure: false })).rejects.toMatchObject({ code: 'screen_image_sharing_disabled' })
      expect(observationRequests).toEqual([])
      const observation = service.observe({ image: false, structure: true })
      await sourceStarted
      expect(service.state()).toMatchObject({ lifecycle: 'streaming', observation: { phase: 'capturing' } })
      await expect(service.observe({ image: false, structure: true })).rejects.toMatchObject({ code: 'screen_observation_in_progress' })
      const queuedAction = service.action({ kind: 'back' })
      const stopped = service.stop()
      await expect(observation).rejects.toMatchObject({ code: 'screen_observation_session_mismatch' })
      await expect(queuedAction).rejects.toMatchObject({ code: 'screen_observation_session_mismatch' })
      await expect(stopped).resolves.toMatchObject({ lifecycle: 'idle' })
      expect(actionRequests).toEqual([])
    } finally {
      await service.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('preserves the last successful observation and Viewer frame after a fresh capture failure', async () => {
    let invalidSource = false
    const png = Buffer.alloc(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.writeUInt32BE(390, 16)
    png.writeUInt32BE(844, 20)
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'failure-session', capabilities: { platformName: 'Android' } } }))
      else if (request.url === '/session/failure-session/screenshot') response.end(JSON.stringify({ value: png.toString('base64') }))
      else if (request.url === '/session/failure-session/window/rect') response.end(JSON.stringify({ value: { x: 0, y: 0, width: 390, height: 844 } }))
      else if (request.url === '/session/failure-session/orientation') response.end(JSON.stringify({ value: 'PORTRAIT' }))
      else if (request.url === '/session/failure-session/source') response.end(JSON.stringify({ value: invalidSource
        ? '<hierarchy><node secret="PRIVATE_SCREEN_TEXT"></hierarchy>'
        : '<hierarchy><node class="android.widget.Button" clickable="true" bounds="[0,0][100,100]"/></hierarchy>' }))
      else response.end(JSON.stringify({ value: null }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const service = new MirrorService({
      ...config,
      agentScreenContentPolicy: 'image-and-structure',
      appiumUrl: `http://127.0.0.1:${address.port}`,
    }, 'http://127.0.0.1:0')
    try {
      await service.start({ provider: 'appium', capabilities: { platformName: 'Android' } })
      const first = await service.observe({ image: true, structure: true })
      const viewerFrameTime = service.state().frameUpdatedAt
      invalidSource = true
      const error = await service.observe({ image: true, structure: true }).then(
        () => new Error('Expected invalid structure') as Error & { code?: string },
        (failure: unknown) => failure as Error & { code?: string },
      )
      expect(error).toMatchObject({ code: 'screen_structure_invalid' })
      expect(error.message).not.toContain('PRIVATE_SCREEN_TEXT')
      expect(service.state()).toMatchObject({
        lifecycle: 'streaming',
        frameUpdatedAt: viewerFrameTime,
        observation: { phase: 'idle', lastErrorCode: 'screen_structure_invalid' },
      })
      await expect(service.action({ kind: 'back', observationId: first.observationId })).resolves.toMatchObject({ lastAction: 'back' })
    } finally {
      await service.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('keeps the last usable result when a later iOS WDA start is classified', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else {
        response.statusCode = 500
        response.end(JSON.stringify({ value: { message: 'No profiles for the WDA runner were found' } }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const managedStop = vi.fn(async () => undefined)
    const appiumRuntime: AppiumRuntimeLifecycle = {
      state: () => ({ mode: 'managed', phase: 'ready', owned: true, lastErrorCode: null }),
      ensureReady: async () => undefined,
      stop: managedStop,
    }
    const service = new MirrorService({
      ...config,
      appiumUrl: `http://127.0.0.1:${address.port}`,
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
    }, 'http://127.0.0.1:0', { appiumRuntime })

    try {
      await service.start({ provider: 'mock' })
      await service.action({ kind: 'back' })
      const lastFrame = service.state().frameUpdatedAt
      await expect(service.start({
        provider: 'appium',
        capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
      })).rejects.toMatchObject({ code: 'wda_profile_missing' })
      expect(service.state()).toMatchObject({
        lifecycle: 'error',
        lastAction: 'back',
        lastErrorCode: 'wda_profile_missing',
        frameUpdatedAt: lastFrame,
      })
      expect(managedStop).toHaveBeenCalledTimes(1)
    } finally {
      await service.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('keeps media independent from fresh observation, stale actions, and provider ownership cleanup', async () => {
    const order: string[] = []
    const png = Buffer.alloc(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.writeUInt32BE(390, 16)
    png.writeUInt32BE(844, 20)
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') {
        response.end(JSON.stringify({ value: { sessionId: 'media-session', capabilities: { platformName: 'Android', 'appium:udid': 'fixture-device' } } }))
      } else if (request.url === '/session/media-session/screenshot') response.end(JSON.stringify({ value: png.toString('base64') }))
      else if (request.url === '/session/media-session/window/rect') response.end(JSON.stringify({ value: { x: 0, y: 0, width: 390, height: 844 } }))
      else if (request.url === '/session/media-session/orientation') response.end(JSON.stringify({ value: 'PORTRAIT' }))
      else if (request.url === '/session/media-session/source') response.end(JSON.stringify({ value: '<hierarchy><node class="android.widget.Button" clickable="true" bounds="[0,0][100,100]"/></hierarchy>' }))
      else if (request.url === '/session/media-session' && request.method === 'DELETE') {
        order.push('provider-delete')
        response.end(JSON.stringify({ value: null }))
      } else response.end(JSON.stringify({ value: null }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const mediaAbort = new AbortController()
    const close = vi.fn(async () => {
      order.push('media-close')
      mediaAbort.abort()
    })
    const sourceFactory: ViewerMediaSourceFactory = {
      create: () => ({
        transport: 'scrcpy-h264',
        close,
        async *open(signal) {
          yield { kind: 'metadata', bytes: new Uint8Array(), codec: 'avc1.42001e' }
          yield { kind: 'session', bytes: new Uint8Array(), width: 390, height: 844 }
          yield { kind: 'key', bytes: Uint8Array.of(1, 2, 3), ptsUs: 1n }
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
            mediaAbort.signal.addEventListener('abort', () => resolve(), { once: true })
          })
        },
      }),
    }
    const appiumRuntime: AppiumRuntimeLifecycle = {
      state: () => ({ mode: 'managed', phase: 'ready', owned: true, lastErrorCode: null }),
      ensureReady: async () => undefined,
      stop: async () => { order.push('appium-child') },
    }
    const service = new MirrorService({
      ...config,
      appiumRuntimeMode: 'managed',
      appiumExecutablePath: '/trusted/appium',
      agentScreenContentPolicy: 'image-and-structure',
      appiumUrl: `http://127.0.0.1:${address.port}`,
      androidScrcpyPath: '/trusted/scrcpy',
    }, 'http://127.0.0.1:0', { media: { sourceFactory, idleGraceMs: 5 }, appiumRuntime })
    try {
      await service.start({ provider: 'appium', capabilities: { platformName: 'Android', 'appium:udid': 'fixture-device' } })
      const subscription = service.subscribeMedia()
      await waitForState(() => service.state().media.phase === 'live')
      const observation = await service.observe({ image: true, structure: true })
      expect(observation.image?.contentType).toBe('image/png')
      await service.action({ kind: 'tap', x: 10, y: 10, observationId: observation.observationId })
      await expect(service.action({ kind: 'back', observationId: observation.observationId })).rejects.toMatchObject({ code: 'screen_observation_stale' })
      expect(service.state().media.phase).toBe('live')
      await service.stop()
      await subscription.close()
      expect(order).toEqual(['media-close', 'provider-delete', 'appium-child'])
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      await service.dispose()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

async function waitForState(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('State was not reached')
}
