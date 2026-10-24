import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AndroidAppiumDefaults, IosWdaDefaults, ViewerMediaConfig } from '../src/config.js'
import {
  AppiumProvider,
  appiumPublicErrorCode,
  mergeAndroidAppiumCapabilities,
  mergeIosWdaCapabilities,
} from '../src/providers/appium-provider.js'
import { mayHaveMutated } from '../src/screen-errors.js'
import { WdaStartError } from '../src/wda-errors.js'

const servers: Array<ReturnType<typeof createServer>> = []

const iosDefaults: IosWdaDefaults = {
  xcodeOrgId: 'PERSISTED_TEAM',
  xcodeSigningId: 'Apple Development',
  updatedBundleId: 'com.example.persisted.WebDriverAgentRunner',
  xcodeConfigFile: '/local/persisted.xcconfig',
  allowProvisioningDeviceRegistration: true,
}

const androidDefaults: AndroidAppiumDefaults = {
  ignoreHiddenApiPolicyError: true,
}

const viewerMedia: ViewerMediaConfig = {
  mode: 'auto',
  android: { scrcpyPath: '/trusted/scrcpy', scrcpyServerPath: '/trusted/scrcpy-server', maxSize: 1280, maxFps: 30, videoBitRate: 4_000_000 },
  ios: { port: 0, framerate: 15, scalingFactor: 50, screenshotQuality: 40 },
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('AppiumProvider', () => {
  it('omits real-device signing defaults and local routing metadata for Simulator sessions', () => {
    const caps = { platformName: 'iOS', 'mobileMirror:deviceKind': 'simulator', 'appium:udid': '12345678-1234-1234-1234-123456789ABC', 'appium:allowProvisioningDeviceRegistration': false }
    const expected = { platformName: 'iOS', 'appium:udid': caps['appium:udid'], 'appium:allowProvisioningDeviceRegistration': false }
    expect(mergeIosWdaCapabilities(caps, iosDefaults)).toEqual(expected)
    expect(mergeIosWdaCapabilities(caps)).toEqual(expected)
  })

  it('merges configured WDA defaults only into a new iOS session', async () => {
    let sessionBody: unknown
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      if (request.url === '/session' && request.method === 'POST') {
        sessionBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }
      response.setHeader('content-type', 'application/json')
      if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'ios-session' } }))
      else response.end(JSON.stringify({ value: { ready: true } }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults)
    await provider.start({
      provider: 'appium',
      capabilities: {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:xcodeOrgId': 'REQUEST_TEAM',
      },
    }, AbortSignal.timeout(2_000))
    expect(provider.runProvenance()).toEqual({})
    await provider.stop()

    expect(sessionBody).toEqual({
      capabilities: {
        alwaysMatch: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:xcodeOrgId': 'REQUEST_TEAM',
          'appium:xcodeSigningId': 'Apple Development',
          'appium:updatedWDABundleId': 'com.example.persisted.WebDriverAgentRunner',
          'appium:xcodeConfigFile': '/local/persisted.xcconfig',
          'appium:allowProvisioningDeviceRegistration': true,
        },
        firstMatch: [{}],
      },
    })
  })

  it('collects only public metadata returned by the active Appium session', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/session/observed') response.end(JSON.stringify({ value: { capabilities: {
        platformName: 'iOS', 'appium:platformVersion': '19.0', 'appium:automationName': 'XCUITest', 'appium:bundleId': 'com.example.observed',
        'mobileMirror:appVersion': '1.2.3', 'mobileMirror:appBuild': '42', 'mobileMirror:appBinarySha256': 'a'.repeat(64), 'appium:udid': 'PRIVATE_DEVICE',
      } } }))
      else response.end(JSON.stringify({ value: { ready: true } }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', sessionId: 'observed' }, AbortSignal.timeout(2_000))
    const provenance = provider.runProvenance()
    expect(provenance).toEqual({ appId: 'com.example.observed', appVersion: '1.2.3', appBuild: '42', appBinarySha256: 'a'.repeat(64), os: 'iOS 19.0', driver: 'XCUITest' })
    expect(JSON.stringify(provenance)).not.toContain('PRIVATE_DEVICE')
    await provider.stop()
  })

  it('honors explicit empty and false request values over persisted defaults', () => {
    expect(mergeIosWdaCapabilities({
      platformName: 'iOS',
      'appium:xcodeOrgId': '',
      'appium:xcodeSigningId': '',
      'appium:updatedWDABundleId': '',
      'appium:xcodeConfigFile': '',
      'appium:allowProvisioningDeviceRegistration': false,
    }, iosDefaults)).toEqual({
      platformName: 'iOS',
      'appium:xcodeOrgId': '',
      'appium:xcodeSigningId': '',
      'appium:updatedWDABundleId': '',
      'appium:xcodeConfigFile': '',
      'appium:allowProvisioningDeviceRegistration': false,
    })
  })

  it('does not add WDA signing capabilities to Android sessions', () => {
    expect(mergeIosWdaCapabilities({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
    }, iosDefaults)).toEqual({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
    })
  })

  it('merges the Android hidden API compatibility default without overriding strict requests', () => {
    expect(mergeAndroidAppiumCapabilities({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
    }, androidDefaults)).toEqual({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:ignoreHiddenApiPolicyError': true,
    })
    expect(mergeAndroidAppiumCapabilities({
      platformName: 'Android',
      'appium:ignoreHiddenApiPolicyError': false,
    }, androidDefaults)).toEqual({
      platformName: 'Android',
      'appium:ignoreHiddenApiPolicyError': false,
    })
  })

  it('does not add Android compatibility capabilities to iOS sessions', () => {
    expect(mergeAndroidAppiumCapabilities({
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
    }, androidDefaults)).toEqual({
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
    })
  })

  it('maps an Appium WDA profile failure without echoing request secrets', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else {
        response.statusCode = 500
        response.end(JSON.stringify({ value: { message: `No profiles for '${iosDefaults.updatedBundleId}.xctrunner' were found for ${iosDefaults.xcodeOrgId}` } }))
      }
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults)
    const error = await provider.start({
      provider: 'appium',
      capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest' },
    }, AbortSignal.timeout(2_000)).catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(WdaStartError)
    expect((error as WdaStartError).code).toBe('wda_profile_missing')
    expect((error as Error).message).not.toContain(iosDefaults.xcodeOrgId)
    expect((error as Error).message).not.toContain(iosDefaults.updatedBundleId)
  })

  it('creates an Appium session, captures frames, sends W3C actions, and deletes owned sessions', async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: request.method ?? '', path: request.url ?? '', body: text ? JSON.parse(text) : null })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'session-1', capabilities: {} } }))
      else if (request.url === '/session/session-1/screenshot') response.end(JSON.stringify({ value: Buffer.from('png').toString('base64') }))
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const provider = new AppiumProvider(
      `http://127.0.0.1:${address.port}`,
      undefined,
      androidDefaults,
      { ...viewerMedia, android: { ...viewerMedia.android, scrcpyPath: '', scrcpyServerPath: '' } },
    )
    const session = await provider.start({
      provider: 'appium',
      capabilities: { platformName: 'Android', 'appium:automationName': 'UiAutomator2' },
    }, AbortSignal.timeout(2_000))
    expect(session.sessionId).toBe('session-1')
    expect(provider.mediaContextError()).toBe('viewer_media_unavailable')
    expect(Buffer.from((await provider.frame()).bytes).toString()).toBe('png')
    await provider.action({ kind: 'tap', x: 12, y: 34 })
    await provider.stop()

    expect(requests.map((item) => `${item.method} ${item.path}`)).toEqual([
      'GET /status',
      'POST /session',
      'GET /session/session-1/screenshot',
      'POST /session/session-1/actions',
      'DELETE /session/session-1',
    ])
    expect(requests[1]?.body).toEqual({
      capabilities: {
        alwaysMatch: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:ignoreHiddenApiPolicyError': true,
        },
        firstMatch: [{}],
      },
    })
  })

  it('classifies an active-session timeout without exposing endpoint details and marks the action uncertain', async () => {
    let releaseAction!: () => void
    let markActionStarted!: () => void
    const actionGate = new Promise<void>((resolve) => { releaseAction = resolve })
    const actionStarted = new Promise<void>((resolve) => { markActionStarted = resolve })
    const server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'timeout-session', capabilities: { platformName: 'Android' } } }))
      else if (request.url?.endsWith('/screenshot')) response.end(JSON.stringify({ value: Buffer.from('png').toString('base64') }))
      else if (request.url?.endsWith('/actions')) {
        markActionStarted()
        await actionGate
        if (!response.destroyed) response.end(JSON.stringify({ value: null }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android' } }, AbortSignal.timeout(2_000))
    const action = provider.action({ kind: 'tap', x: 12, y: 34 }, AbortSignal.timeout(50))
      .then(() => new Error('Expected timeout'), (error: unknown) => error as Error)
    await actionStarted
    const failure = await action
    expect(appiumPublicErrorCode(failure)).toBe('appium_session_command_timeout')
    expect(failure.message).toBe('appium_session_command_timeout: The active Appium session did not answer the command in time.')
    expect(failure.message).not.toContain(String(address.port))
    expect(mayHaveMutated(failure)).toBe(true)
    releaseAction()
    await provider.stop(AbortSignal.timeout(2_000))
  })

  it('classifies a refused loopback endpoint as server-unreachable', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    const failure = await provider.start({ provider: 'appium', capabilities: { platformName: 'Android' } }, AbortSignal.timeout(2_000))
      .then(() => new Error('Expected connection failure'), (error: unknown) => error as Error)
    expect(appiumPublicErrorCode(failure)).toBe('appium_server_unreachable')
    expect(failure.message).toBe('appium_server_unreachable: Appium is not reachable on the configured loopback address.')
    expect(failure.message).not.toContain(String(address.port))
  })

  it('does not delete an attached Appium session', async () => {
    const methods: string[] = []
    const server = createServer((request, response) => {
      methods.push(`${request.method} ${request.url}`)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ value: request.url === '/status' ? { ready: true } : {} }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults)
    await provider.start({ provider: 'appium', sessionId: 'external' }, AbortSignal.timeout(2_000))
    await provider.stop()
    expect(methods).not.toContain('DELETE /session/external')
    expect(methods).not.toContain('POST /session')
  })

  it('reads fresh PNG, viewport, orientation, and bounded source with remembered platform', async () => {
    const paths: string[] = []
    const png = Buffer.alloc(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.writeUInt32BE(390, 16)
    png.writeUInt32BE(844, 20)
    const server = createServer((request, response) => {
      paths.push(`${request.method} ${request.url}`)
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'screen-session', capabilities: { platformName: 'Android' } } }))
      else if (request.url === '/session/screen-session/screenshot') response.end(JSON.stringify({ value: png.toString('base64') }))
      else if (request.url === '/session/screen-session/window/rect') response.end(JSON.stringify({ value: { x: 0, y: 0, width: 390, height: 844 } }))
      else if (request.url === '/session/screen-session/orientation') response.end(JSON.stringify({ value: 'PORTRAIT' }))
      else if (request.url === '/session/screen-session/source') response.end(JSON.stringify({ value: '<hierarchy><node class="android.widget.Button"/></hierarchy>' }))
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android' } }, AbortSignal.timeout(2_000))
    await expect(provider.snapshot()).resolves.toMatchObject({ width: 390, height: 844, contentType: 'image/png' })
    await expect(provider.screenGeometry()).resolves.toEqual({
      viewport: { x: 0, y: 0, width: 390, height: 844 },
      orientation: 'portrait',
      orientationSource: 'provider',
    })
    await expect(provider.screenSource()).resolves.toEqual({
      kind: 'xml',
      platform: 'android',
      xml: '<hierarchy><node class="android.widget.Button"/></hierarchy>',
    })
    expect(paths).toEqual(expect.arrayContaining([
      'GET /session/screen-session/window/rect',
      'GET /session/screen-session/orientation',
      'GET /session/screen-session/source',
    ]))
    await provider.stop()
  })

  it('infers orientation when a driver does not implement it and rejects oversized source safely', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session/external') response.end(JSON.stringify({ value: { capabilities: { platformName: 'iOS' } } }))
      else if (request.url === '/session/external/window/rect') response.end(JSON.stringify({ value: { x: 0, y: 0, width: 844, height: 390 } }))
      else if (request.url === '/session/external/orientation') {
        response.statusCode = 404
        response.end(JSON.stringify({ value: { message: 'not implemented' } }))
      } else if (request.url === '/session/external/source') {
        response.end(JSON.stringify({ value: `PRIVATE_UDID${'x'.repeat(4 * 1024 * 1024)}` }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', sessionId: 'external' }, AbortSignal.timeout(2_000))
    await expect(provider.screenGeometry()).resolves.toMatchObject({ orientation: 'landscape', orientationSource: 'inferred' })
    const error = await provider.screenSource().then(
      () => new Error('Expected oversized source failure') as Error & { code?: string },
      (failure: unknown) => failure as Error & { code?: string },
    )
    expect(error).toMatchObject({ code: 'screen_observation_too_large' })
    expect(error.message).not.toContain('PRIVATE_UDID')
    await provider.stop()
  })

  it('uses the WDA default MJPEG port for an owned iOS session, applies bounded settings, and keeps screenshots fresh', async () => {
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = []
    const png = Buffer.alloc(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.writeUInt32BE(390, 16)
    png.writeUInt32BE(844, 20)
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: request.method ?? '', path: request.url ?? '', body: text ? JSON.parse(text) as Record<string, unknown> : null })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') {
        response.end(JSON.stringify({ value: { sessionId: 'ios-media', capabilities: { 'appium:mjpegServerPort': 9_100 } } }))
      } else if (request.url === '/session/ios-media/screenshot') response.end(JSON.stringify({ value: png.toString('base64') }))
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const allocate = vi.fn(async () => 12_011)
    const isAvailable = vi.fn(async () => true)
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults, androidDefaults, viewerMedia, { portAllocator: { allocate, isAvailable } })

    await provider.start({ provider: 'appium', capabilities: { platformName: 'iOS', 'appium:udid': 'PRIVATE_DEVICE' } }, AbortSignal.timeout(2_000))
    await expect(provider.snapshot()).resolves.toMatchObject({ width: 390, height: 844 })
    expect(provider.mediaContext()).toEqual({ kind: 'ios-wda-mjpeg', host: '127.0.0.1', port: 9_100, owned: true })
    expect(isAvailable).toHaveBeenCalledWith(9_100, expect.any(AbortSignal))
    expect(allocate).not.toHaveBeenCalled()
    const createBody = requests.find((item) => item.path === '/session')?.body
    expect(createBody).toMatchObject({ capabilities: { alwaysMatch: { 'appium:mjpegServerPort': 9_100 } } })
    expect(JSON.stringify(createBody)).not.toContain('mjpegScreenshotUrl')
    expect(requests.find((item) => item.path.endsWith('/appium/settings'))?.body).toEqual({
      settings: { mjpegServerFramerate: 15, mjpegScalingFactor: 50, mjpegServerScreenshotQuality: 40, mjpegFixOrientation: true },
    })
    expect(requests.map((item) => item.path)).toContain('/session/ios-media/screenshot')
    await provider.stop()
  })

  it('keeps attached iOS MJPEG read-only and requires an explicit reachable port hint', async () => {
    const paths: string[] = []
    const server = createServer((request, response) => {
      paths.push(`${request.method} ${request.url}`)
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session/no-hint') response.end(JSON.stringify({ value: { capabilities: { platformName: 'iOS' } } }))
      else if (request.url === '/session/with-hint') response.end(JSON.stringify({ value: { capabilities: { platformName: 'iOS', 'appium:mjpegServerPort': 12_012 } } }))
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')

    const withoutHint = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults, androidDefaults, viewerMedia)
    await withoutHint.start({ provider: 'appium', sessionId: 'no-hint' }, AbortSignal.timeout(2_000))
    expect(withoutHint.mediaContext()).toBeNull()
    expect(withoutHint.mediaContextError()).toBe('viewer_media_unavailable')
    await withoutHint.stop()

    const withHint = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults, androidDefaults, viewerMedia)
    await withHint.start({ provider: 'appium', sessionId: 'with-hint' }, AbortSignal.timeout(2_000))
    expect(withHint.mediaContext()).toEqual({ kind: 'ios-wda-mjpeg', host: '127.0.0.1', port: 12_012, owned: false })
    await withHint.stop()
    expect(paths.some((path) => path.includes('/appium/settings'))).toBe(false)
    expect(paths.some((path) => path.startsWith('DELETE'))).toBe(false)
  })

  it('retries an auto-planned iOS forwarding race once without media and preserves the control session', async () => {
    let createAttempts = 0
    const requestedPorts: number[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') {
        createAttempts += 1
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        requestedPorts.push(body.capabilities.alwaysMatch['appium:mjpegServerPort'])
        if (createAttempts === 1) {
          response.statusCode = 500
          response.end(JSON.stringify({ value: { message: 'address already in use while forwarding port' } }))
        } else response.end(JSON.stringify({ value: { sessionId: 'retry-ios', capabilities: { platformName: 'iOS' } } }))
      } else if (request.url?.endsWith('/appium/settings')) {
        response.statusCode = 500
        response.end(JSON.stringify({ value: { message: 'settings unavailable' } }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults, androidDefaults, viewerMedia, {
      portAllocator: { allocate: async () => 12_013, isAvailable: async () => true },
    })
    await expect(provider.start({ provider: 'appium', capabilities: { platformName: 'iOS' } }, AbortSignal.timeout(2_000)))
      .resolves.toMatchObject({ sessionId: 'retry-ios' })
    expect(requestedPorts).toEqual([9_100, undefined])
    expect(provider.mediaContext()).toBeNull()
    expect(provider.mediaContextError()).toBe('viewer_media_port_unavailable')
    await provider.stop()
  })

  it('keeps the iOS control session when local port 9100 is unavailable and does not request MJPEG', async () => {
    const createBodies: Array<{ capabilities: { alwaysMatch: Record<string, unknown> } }> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') {
        createBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        response.end(JSON.stringify({ value: { sessionId: 'ios-polling', capabilities: { platformName: 'iOS' } } }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults, androidDefaults, viewerMedia, {
      portAllocator: { allocate: async () => 12_015, isAvailable: async () => false },
    })

    await expect(provider.start({ provider: 'appium', capabilities: { platformName: 'iOS' } }, AbortSignal.timeout(2_000)))
      .resolves.toMatchObject({ sessionId: 'ios-polling' })
    expect(createBodies[0]?.capabilities.alwaysMatch).not.toHaveProperty('appium:mjpegServerPort')
    expect(provider.mediaContext()).toBeNull()
    expect(provider.mediaContextError()).toBe('viewer_media_port_unavailable')
    await provider.stop()
  })

  it('preserves an explicit nonzero iOS MJPEG expert port without probing or rewriting it', async () => {
    const requestedPorts: unknown[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        requestedPorts.push(body.capabilities.alwaysMatch['appium:mjpegServerPort'])
        response.end(JSON.stringify({ value: { sessionId: 'ios-explicit', capabilities: { platformName: 'iOS', 'appium:mjpegServerPort': 12_016 } } }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const isAvailable = vi.fn(async () => false)
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`, iosDefaults, androidDefaults, {
      ...viewerMedia,
      ios: { ...viewerMedia.ios, port: 12_016 },
    }, { portAllocator: { allocate: async () => 12_017, isAvailable } })

    await expect(provider.start({ provider: 'appium', capabilities: { platformName: 'iOS' } }, AbortSignal.timeout(2_000)))
      .resolves.toMatchObject({ sessionId: 'ios-explicit' })
    expect(requestedPorts).toEqual([12_016])
    expect(isAvailable).not.toHaveBeenCalled()
    expect(provider.mediaContext()).toEqual({ kind: 'ios-wda-mjpeg', host: '127.0.0.1', port: 12_016, owned: true })
    await provider.stop()
  })

  it.each(['Android', 'iOS'])('does not grant target-app authority from driver-inferred capabilities for %s current-screen', async (platform) => {
    const deleted: string[] = []
    const server = createServer((request, response) => {
      request.resume()
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: {
        sessionId: 'current-screen-session', capabilities: {
          platformName: platform,
          [platform === 'Android' ? 'appium:appPackage' : 'appium:bundleId']: 'driver.inferred.app',
        },
      } }))
      else {
        if (request.method === 'DELETE') deleted.push(request.url!)
        response.end(JSON.stringify({ value: null }))
      }
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: platform, 'appium:autoLaunch': false, 'appium:noReset': true } }, AbortSignal.timeout(2000))
    expect(provider.appControlContext()).toEqual({ owned: true, platform: platform.toLowerCase(), targetAppId: null })
    await provider.stop()
    expect(deleted).toEqual(['/session/current-screen-session'])
  })

  it('verifies the active element rectangle before append and replace text input', async () => {
    let currentText = ''
    const requests: Array<{ method: string; path: string; body: unknown }> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8')
      requests.push({ method: request.method ?? '', path: request.url ?? '', body: text ? JSON.parse(text) : null })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'text-session', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } } }))
      else if (request.url?.endsWith('/element/active')) response.end(JSON.stringify({ value: { 'element-6066-11e4-a52e-4f735466cecf': 'element/private-id' } }))
      else if (request.url?.endsWith('/rect')) response.end(JSON.stringify({ value: { x: 20, y: 40, width: 100, height: 50 } }))
      else if (request.url?.endsWith('/text')) response.end(JSON.stringify({ value: currentText }))
      else if (request.url?.endsWith('/value')) { currentText = JSON.parse(text).text; response.end(JSON.stringify({ value: null })) }
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } }, AbortSignal.timeout(2_000))
    expect(provider.appControlContext()).toEqual({ owned: true, platform: 'android', targetAppId: 'com.example.public' })
    await provider.inputText({ mode: 'append', text: 'PUBLIC-A', expectedBounds: { x: 10, y: 30, width: 120, height: 70 } })
    await provider.inputText({ mode: 'replace', text: 'PUBLIC-B', expectedBounds: { x: 20, y: 40, width: 100, height: 50 } })

    const elementPaths = requests.filter((item) => item.path.includes('/element/')).map((item) => `${item.method} ${item.path}`)
    expect(elementPaths).toEqual([
      'GET /session/text-session/element/active',
      'GET /session/text-session/element/element%2Fprivate-id/rect',
      'GET /session/text-session/element/element%2Fprivate-id/text',
      'GET /session/text-session/element/element%2Fprivate-id/attribute/hint',
      'GET /session/text-session/element/active',
      'POST /session/text-session/element/element%2Fprivate-id/value',
      'GET /session/text-session/element/element%2Fprivate-id/text',
      'GET /session/text-session/element/active',
      'GET /session/text-session/element/element%2Fprivate-id/rect',
      'POST /session/text-session/element/element%2Fprivate-id/clear',
      'POST /session/text-session/element/element%2Fprivate-id/value',
    ])
    expect(requests.filter((item) => item.path.endsWith('/value')).map((item) => item.body)).toEqual([
      { text: 'PUBLIC-A', replace: true }, { text: 'PUBLIC-B', replace: true },
    ])
    await provider.stop()
  })

  it('rejects active-element mismatch before mutation and redacts partial text failures', async () => {
    let rectMatches = false
    const mutations: string[] = []
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'text-errors', capabilities: { platformName: 'iOS' } } }))
      else if (request.url?.endsWith('/element/active')) response.end(JSON.stringify({ value: { 'element-6066-11e4-a52e-4f735466cecf': 'private-element' } }))
      else if (request.url?.endsWith('/rect')) response.end(JSON.stringify({ value: rectMatches
        ? { x: 0, y: 0, width: 100, height: 40 }
        : { x: 500, y: 500, width: 100, height: 40 } }))
      else if (request.url?.endsWith('/clear')) {
        mutations.push('clear')
        response.end(JSON.stringify({ value: null }))
      } else if (request.url?.endsWith('/value')) {
        mutations.push('value')
        response.statusCode = 500
        response.end(JSON.stringify({ value: { message: 'upstream echoed PRIVATE-TEXT and private-element' } }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'iOS' } }, AbortSignal.timeout(2_000))
    await expect(provider.inputText({ mode: 'replace', text: 'PRIVATE-TEXT', expectedBounds: { x: 0, y: 0, width: 100, height: 40 } }))
      .rejects.toMatchObject({ code: 'screen_text_input_target_mismatch' })
    expect(mutations).toEqual([])

    rectMatches = true
    const failure = await provider.inputText({ mode: 'replace', text: 'PRIVATE-TEXT', expectedBounds: { x: 0, y: 0, width: 100, height: 40 } })
      .then(() => new Error('Expected failure'), (error: unknown) => error as Error & { code?: string })
    expect(failure).toMatchObject({ code: 'screen_text_input_partial' })
    expect(mayHaveMutated(failure)).toBe(true)
    expect(failure.message).not.toMatch(/PRIVATE-TEXT|private-element|upstream/)
    expect(mutations).toEqual(['clear', 'value'])
    await provider.stop()
  })

  it('queries and verifies Android activate and terminate without returning the app id', async () => {
    let state = 2
    const requests: Array<{ path: string; body: unknown }> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8')
      requests.push({ path: request.url ?? '', body: text ? JSON.parse(text) : null })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'app-session', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } } }))
      else if (request.url?.endsWith('/app_state')) response.end(JSON.stringify({ value: state }))
      else if (request.url?.endsWith('/activate_app')) { state = 4; response.end(JSON.stringify({ value: null })) }
      else if (request.url?.endsWith('/terminate_app')) { state = 1; response.end(JSON.stringify({ value: true })) }
      else if (request.url?.endsWith('/screenshot')) response.end(JSON.stringify({ value: Buffer.from('session-still-usable').toString('base64') }))
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } }, AbortSignal.timeout(2_000))
    expect(await provider.manageApp({ operation: 'activate', appId: 'com.example.public' })).toEqual({
      beforeState: 'background', afterState: 'foreground', outcome: 'activated',
    })
    expect(await provider.manageApp({ operation: 'terminate', appId: 'com.example.public' })).toEqual({
      beforeState: 'foreground', afterState: 'not-running', outcome: 'terminated',
    })
    expect(requests.filter((item) => item.path.endsWith('/app_state'))).toHaveLength(4)
    expect(requests.find((item) => item.path.endsWith('/terminate_app'))?.body).toEqual({
      appId: 'com.example.public', options: { timeout: 5_000 },
    })
    expect(Buffer.from((await provider.frame()).bytes).toString()).toBe('session-still-usable')
    await provider.stop()
  })

  it('uses fixed mobile launchApp only for a not-running owned iOS target and keeps attached ownership visible', async () => {
    let state = 1
    const requests: Array<{ path: string; body: unknown }> = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const text = Buffer.concat(chunks).toString('utf8')
      requests.push({ path: request.url ?? '', body: text ? JSON.parse(text) : null })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'ios-app', capabilities: { platformName: 'iOS', 'appium:bundleId': 'com.example.public' } } }))
      else if (request.url === '/session/external') response.end(JSON.stringify({ value: { capabilities: { platformName: 'iOS', 'appium:bundleId': 'com.example.external' } } }))
      else if (request.url?.endsWith('/app_state')) response.end(JSON.stringify({ value: state }))
      else if (request.url?.endsWith('/execute/sync')) { state = 4; response.end(JSON.stringify({ value: null })) }
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const owned = new AppiumProvider(baseUrl)
    await owned.start({ provider: 'appium', capabilities: { platformName: 'iOS', 'appium:bundleId': 'com.example.public' } }, AbortSignal.timeout(2_000))
    expect(await owned.manageApp({ operation: 'activate', appId: 'com.example.public' })).toMatchObject({ outcome: 'activated', afterState: 'foreground' })
    expect(requests.find((item) => item.path.endsWith('/execute/sync'))?.body).toEqual({
      script: 'mobile: launchApp', args: [{ bundleId: 'com.example.public' }],
    })
    await owned.stop()

    const attached = new AppiumProvider(baseUrl)
    await attached.start({ provider: 'appium', sessionId: 'external' }, AbortSignal.timeout(2_000))
    expect(attached.appControlContext()).toEqual({ owned: false, platform: 'ios', targetAppId: 'com.example.external' })
    await attached.stop()
  })

  it('enforces the exact 50 percent active-element overlap boundary and maps unsupported endpoints', async () => {
    let currentText = ''
    let rectX = 50
    let activeUnsupported = false
    const mutations: string[] = []
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'overlap', capabilities: { platformName: 'Android' } } }))
      else if (request.url?.endsWith('/element/active') && activeUnsupported) {
        response.statusCode = 404
        response.end(JSON.stringify({ value: { message: 'PRIVATE upstream unsupported details' } }))
      } else if (request.url?.endsWith('/element/active')) response.end(JSON.stringify({ value: { 'element-6066-11e4-a52e-4f735466cecf': 'private-id' } }))
      else if (request.url?.endsWith('/rect')) response.end(JSON.stringify({ value: { x: rectX, y: 0, width: 100, height: 100 } }))
      else if (request.url?.endsWith('/text')) response.end(JSON.stringify({ value: currentText }))
      else if (request.url?.endsWith('/value')) { currentText = 'PUBLIC'; mutations.push('value'); response.end(JSON.stringify({ value: null })) }
      else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android' } }, AbortSignal.timeout(2_000))
    await expect(provider.inputText({ mode: 'append', text: 'PUBLIC', expectedBounds: { x: 0, y: 0, width: 100, height: 100 } })).resolves.toBeUndefined()
    expect(mutations).toEqual(['value'])
    rectX = 51
    await expect(provider.inputText({ mode: 'append', text: 'PUBLIC', expectedBounds: { x: 0, y: 0, width: 100, height: 100 } }))
      .rejects.toMatchObject({ code: 'screen_text_input_target_mismatch' })
    expect(mutations).toEqual(['value'])
    activeUnsupported = true
    const unsupported = await provider.inputText({ mode: 'append', text: 'PUBLIC', expectedBounds: { x: 0, y: 0, width: 100, height: 100 } })
      .then(() => new Error('Expected failure'), (error: unknown) => error as Error & { code?: string })
    expect(unsupported).toMatchObject({ code: 'screen_text_input_unsupported' })
    expect(unsupported.message).not.toContain('PRIVATE')
    await provider.stop()
  })

  it('returns app-state no-ops and marks after-state mismatches as may-have-mutated', async () => {
    let state = 4
    let preserveStateAfterActivate = false
    const mutations: string[] = []
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'state-matrix', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } } }))
      else if (request.url?.endsWith('/app_state')) response.end(JSON.stringify({ value: state }))
      else if (request.url?.endsWith('/activate_app')) {
        mutations.push('activate')
        if (!preserveStateAfterActivate) state = 4
        response.end(JSON.stringify({ value: null }))
      } else if (request.url?.endsWith('/terminate_app')) {
        mutations.push('terminate')
        state = 1
        response.end(JSON.stringify({ value: true }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } }, AbortSignal.timeout(2_000))
    expect(await provider.manageApp({ operation: 'activate', appId: 'com.example.public' })).toMatchObject({ outcome: 'already-foreground' })
    expect(mutations).toEqual([])
    await provider.manageApp({ operation: 'terminate', appId: 'com.example.public' })
    expect(await provider.manageApp({ operation: 'terminate', appId: 'com.example.public' })).toMatchObject({ outcome: 'already-stopped' })
    expect(mutations).toEqual(['terminate'])

    state = 0
    await expect(provider.manageApp({ operation: 'activate', appId: 'com.example.public' }))
      .rejects.toMatchObject({ code: 'app_not_installed' })
    expect(mutations).toEqual(['terminate'])

    state = 3
    expect(await provider.manageApp({ operation: 'terminate', appId: 'com.example.public' })).toMatchObject({
      beforeState: 'suspended', afterState: 'not-running', outcome: 'terminated',
    })
    expect(mutations).toEqual(['terminate', 'terminate'])

    state = 2
    preserveStateAfterActivate = true
    const mismatch = await provider.manageApp({ operation: 'activate', appId: 'com.example.public' })
      .then(() => new Error('Expected failure'), (error: unknown) => error as Error & { code?: string })
    expect(mismatch).toMatchObject({ code: 'app_state_unverified' })
    expect(mayHaveMutated(mismatch)).toBe(true)
    expect(mutations).toEqual(['terminate', 'terminate', 'activate'])
    state = 9
    const invalid = await provider.manageApp({ operation: 'activate', appId: 'com.example.public' })
      .then(() => new Error('Expected failure'), (error: unknown) => error as Error & { code?: string })
    expect(invalid).toMatchObject({ code: 'app_state_unverified' })
    expect(mayHaveMutated(invalid)).toBe(false)
    await provider.stop()
  })

  it('marks application request failures as may-have-mutated and redacts upstream details', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session') response.end(JSON.stringify({ value: { sessionId: 'redacted-app', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } } }))
      else if (request.url?.endsWith('/app_state')) response.end(JSON.stringify({ value: 2 }))
      else if (request.url?.endsWith('/activate_app')) {
        response.statusCode = 500
        response.end(JSON.stringify({ value: { message: 'PRIVATE upstream com.example.public redacted-app' } }))
      } else response.end(JSON.stringify({ value: null }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android', 'appium:appPackage': 'com.example.public' } }, AbortSignal.timeout(2_000))
    const failure = await provider.manageApp({ operation: 'activate', appId: 'com.example.public' })
      .then(() => new Error('Expected failure'), (error: unknown) => error as Error & { code?: string })
    expect(failure).toMatchObject({ code: 'app_activate_failed' })
    expect(mayHaveMutated(failure)).toBe(true)
    expect(failure.message).not.toMatch(/PRIVATE|com\.example|redacted-app|upstream/)
    await provider.stop()
  })
})

it.each(['hint-preserved', 'ambiguous-hint', 'oversized', 'focus-changed', 'write-mismatch', 'read-failed'] as const)(
  'Android append safely handles %s without the UIA2 clear-and-hint data loss', async (scenario) => {
    let current = scenario === 'ambiguous-hint' ? 'Search' : scenario === 'oversized' ? 'A'.repeat(512) : 'PUBLIC'
    let activeReads = 0
    const writes: unknown[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString()
      response.setHeader('content-type', 'application/json')
      let value: unknown = null
      if (request.url === '/status') value = { ready: true }
      else if (request.url === '/session') value = { sessionId: 'append', capabilities: { platformName: 'Android' } }
      else if (request.url?.endsWith('/element/active')) value = { 'element-6066-11e4-a52e-4f735466cecf': ++activeReads > 1 && scenario === 'focus-changed' ? 'other' : 'field' }
      else if (request.url?.endsWith('/rect')) value = { x: 0, y: 0, width: 100, height: 50 }
      else if (request.url?.endsWith('/attribute/hint')) value = 'Search'
      else if (request.url?.endsWith('/text')) {
        if (scenario === 'read-failed') { response.statusCode = 500; value = { message: 'PRIVATE upstream' } }
        else value = current
      } else if (request.url?.endsWith('/value')) {
        const payload = JSON.parse(body); writes.push(payload)
        // A hint-bearing UIA2 field loses its existing text in default append mode.
        current = scenario === 'write-mismatch' ? '-MORE' : payload.replace === true ? payload.text : '-MORE'
      } else if (request.url?.endsWith('/clear')) throw new Error('Android append must not clear')
      response.end(JSON.stringify({ value }))
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server port')
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    await provider.start({ provider: 'appium', capabilities: { platformName: 'Android' } }, AbortSignal.timeout(2000))
    const result = await provider.inputText({ mode: 'append', text: '-MORE', expectedBounds: { x: 0, y: 0, width: 100, height: 50 } }).then(() => null, (error: unknown) => error as Error)
    if (scenario === 'hint-preserved') {
      expect(result).toBeNull(); expect(current).toBe('PUBLIC-MORE')
      expect(writes).toEqual([{ text: 'PUBLIC-MORE', replace: true }])
    } else {
      expect(result).toBeInstanceOf(Error)
      expect(String(result)).not.toMatch(/PUBLIC|PRIVATE|Search|MORE/)
      expect(mayHaveMutated(result)).toBe(scenario === 'write-mismatch')
      expect(writes).toHaveLength(scenario === 'write-mismatch' ? 1 : 0)
    }
    await provider.stop()
  },
)
