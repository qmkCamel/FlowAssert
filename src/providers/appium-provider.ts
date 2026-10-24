import type { AndroidAppiumDefaults, IosWdaDefaults, ViewerMediaConfig } from '../config.js'
import { NodeLoopbackPortAllocator, type LoopbackPortAllocator } from '../loopback-port.js'
import { validatePublicText } from '../semantic-actions.js'
import { markMayHaveMutated, screenError } from '../screen-errors.js'
import { normalizeScreenSource, MAX_SOURCE_BYTES } from '../screen-source-normalizer.js'
import { classifyWdaStartFailure } from '../wda-errors.js'
import type {
  MirrorAction,
  MirrorFrame,
  MirrorProvider,
  MobileAppState,
  ProviderAppControlContext,
  ProviderAppManagementRequest,
  ProviderAppManagementResult,
  ProviderScreenSource,
  ProviderSession,
  ProviderTextInputRequest,
  ProviderRunProvenance,
  ScreenRect,
  ScreenGeometry,
  ScreenObservationImage,
  StartMirrorInput,
  ViewerMediaContext,
  ViewerMediaErrorCode,
} from '../types.js'

interface AppiumEnvelope<T> {
  value?: T
  sessionId?: string
}

interface CreatedSession {
  sessionId?: string
  capabilities?: Record<string, unknown>
}

interface WindowRect {
  x?: number
  y?: number
  width?: number
  height?: number
}

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'
const DEFAULT_WDA_MJPEG_PORT = 9_100

export type AppiumPublicErrorCode =
  | 'appium_server_unreachable'
  | 'appium_request_timeout'
  | 'appium_session_command_timeout'
  | 'appium_session_command_failed'

const APPIUM_PUBLIC_ERROR_MESSAGES: Record<AppiumPublicErrorCode, string> = {
  appium_server_unreachable: 'appium_server_unreachable: Appium is not reachable on the configured loopback address.',
  appium_request_timeout: 'appium_request_timeout: Appium did not answer the request in time.',
  appium_session_command_timeout: 'appium_session_command_timeout: The active Appium session did not answer the command in time.',
  appium_session_command_failed: 'appium_session_command_failed: The active Appium session rejected the command.',
}

export interface AppiumProviderOptions {
  portAllocator?: LoopbackPortAllocator
  adbPath?: string
}

export class AppiumProvider implements MirrorProvider {
  readonly kind = 'appium' as const
  healthCapability(): import('../health-contracts.js').HealthCapability {
    return { schemaVersion: 1, platform: this.#platform, source: this.#platform === 'android' ? 'android-adb-candidate' : 'ios-diagnostics-candidate', sourceVersion: 'unapproved',
      signals: { crash: { supported: false, reason: 'source-completeness-unproven' }, anr: { supported: false, reason: 'source-completeness-unproven' }, hang: { supported: false, reason: 'source-unavailable' } } }
  }
  readonly #baseUrl: string
  readonly #iosWdaDefaults: IosWdaDefaults | undefined
  readonly #androidDefaults: AndroidAppiumDefaults | undefined
  readonly #viewerMedia: ViewerMediaConfig | undefined
  readonly #portAllocator: LoopbackPortAllocator
  readonly #adbPath: string
  #sessionId: string | null = null
  #ownsSession = false
  #platform: 'android' | 'ios' | 'unknown' = 'unknown'
  #targetAppId: string | null = null
  #runProvenance: ProviderRunProvenance | null = null
  #mediaContext: ViewerMediaContext | null = null
  #mediaError: ViewerMediaErrorCode | null = null

  constructor(
    baseUrl: string,
    iosWdaDefaults?: IosWdaDefaults,
    androidDefaults?: AndroidAppiumDefaults,
    viewerMedia?: ViewerMediaConfig,
    options: AppiumProviderOptions = {},
  ) {
    this.#baseUrl = baseUrl.replace(/\/$/, '')
    this.#iosWdaDefaults = iosWdaDefaults
    this.#androidDefaults = androidDefaults
    this.#viewerMedia = viewerMedia
    this.#portAllocator = options.portAllocator ?? new NodeLoopbackPortAllocator()
    this.#adbPath = options.adbPath ?? 'adb'
  }

  async start(input: StartMirrorInput, signal: AbortSignal): Promise<ProviderSession> {
    this.#mediaContext = null
    this.#mediaError = null
    await this.#request('GET', '/status', undefined, signal)

    if (input.sessionId) {
      this.#sessionId = input.sessionId
      this.#ownsSession = false
      const attached = await this.#request<Record<string, unknown>>('GET', `/session/${encodeURIComponent(input.sessionId)}`, undefined, signal)
      const capabilities = attached.value?.capabilities && typeof attached.value.capabilities === 'object'
        ? attached.value.capabilities as Record<string, unknown>
        : attached.value
      this.#platform = platformFromCapabilities(capabilities)
      this.#targetAppId = targetAppIdFromCapabilities(capabilities, this.#platform)
      this.#runProvenance = provenanceFromCapabilities(capabilities, this.#targetAppId)
      this.#configureAttachedMediaContext(capabilities)
      return { sessionId: input.sessionId, deviceName: 'Attached Appium session' }
    }

    if (!input.capabilities || Object.keys(input.capabilities).length === 0) {
      throw new Error('Appium mode requires capabilities or an existing sessionId')
    }

    let capabilities = mergeAndroidAppiumCapabilities(
      mergeIosWdaCapabilities(input.capabilities, this.#iosWdaDefaults),
      this.#androidDefaults,
    )
    let plannedDefaultIosPort = false
    if (this.#viewerMedia?.mode === 'auto' && isIosCapabilities(capabilities)) {
      const requestedPort = mediaPortFromCapabilities(capabilities)
      if (requestedPort === null && !hasMediaPortCapability(capabilities)) {
        const configuredPort = this.#viewerMedia.ios.port
        const port = configuredPort || DEFAULT_WDA_MJPEG_PORT
        const available = configuredPort !== 0 || await this.#portAllocator.isAvailable?.(port, signal) === true
        if (available) {
          capabilities = { ...capabilities, 'appium:mjpegServerPort': port }
          plannedDefaultIosPort = configuredPort === 0
        } else {
          this.#mediaError = 'viewer_media_port_unavailable'
        }
      } else if (requestedPort === null) {
        this.#mediaError = 'viewer_media_port_unavailable'
      }
    }
    let envelope: AppiumEnvelope<CreatedSession>
    try {
      envelope = await this.#createSession(capabilities, signal)
    } catch (error) {
      if (plannedDefaultIosPort && isPortForwardingRace(error)) {
        try {
          capabilities = withoutMediaPortCapabilities(capabilities)
          this.#mediaError = 'viewer_media_port_unavailable'
          envelope = await this.#createSession(capabilities, signal)
        } catch (retryError) {
          throw classifyWdaStartFailure(retryError, sensitiveCapabilityValues(capabilities))
        }
      } else if (isIosCapabilities(capabilities)) {
        throw classifyWdaStartFailure(error, sensitiveCapabilityValues(capabilities))
      } else {
        throw error
      }
    }
    const sessionId = envelope.value?.sessionId ?? envelope.sessionId
    if (!sessionId) throw new Error('Appium did not return a session id')

    this.#sessionId = sessionId
    this.#ownsSession = true
    const observedCapabilities = envelope.value?.capabilities
    const returnedCapabilities = observedCapabilities ?? capabilities
    this.#platform = platformFromCapabilities(returnedCapabilities)
    if (this.#platform === 'unknown') this.#platform = platformFromCapabilities(capabilities)
    // An app-less, non-launching session must not turn a driver-inferred foreground
    // package (for example SpringBoard) into target-app management authority.
    const currentScreenOnly = capabilities['appium:autoLaunch'] === false
      && !capabilities['appium:app'] && !capabilities.app
      && targetAppIdFromCapabilities(capabilities, this.#platform) === null
    this.#targetAppId = currentScreenOnly ? null : targetAppIdFromCapabilities(returnedCapabilities, this.#platform)
      ?? targetAppIdFromCapabilities(capabilities, this.#platform)
    this.#runProvenance = provenanceFromCapabilities(observedCapabilities, targetAppIdFromCapabilities(observedCapabilities, this.#platform))
    await this.#configureOwnedMediaContext(returnedCapabilities, capabilities, signal)
    const deviceName = String(capabilities['appium:deviceName'] ?? capabilities.deviceName ?? 'Appium device')
    return { sessionId, deviceName }
  }

  async #createSession(capabilities: Record<string, unknown>, signal: AbortSignal): Promise<AppiumEnvelope<CreatedSession>> {
    return await this.#request<CreatedSession>('POST', '/session', {
      capabilities: { alwaysMatch: capabilities, firstMatch: [{}] },
    }, signal)
  }

  async stop(signal?: AbortSignal): Promise<void> {
    const sessionId = this.#sessionId
    const ownsSession = this.#ownsSession
    this.#sessionId = null
    this.#ownsSession = false
    this.#platform = 'unknown'
    this.#targetAppId = null
    this.#runProvenance = null
    this.#mediaContext = null
    this.#mediaError = null
    if (sessionId && ownsSession) {
      await this.#request('DELETE', `/session/${encodeURIComponent(sessionId)}`, undefined, signal)
    }
  }

  async frame(signal?: AbortSignal): Promise<MirrorFrame> {
    const sessionId = this.#requireSession()
    const envelope = await this.#request<string>('GET', `/session/${encodeURIComponent(sessionId)}/screenshot`, undefined, signal)
    if (typeof envelope.value !== 'string') throw new Error('Appium returned an invalid screenshot payload')
    return { bytes: Buffer.from(envelope.value, 'base64'), contentType: 'image/png' }
  }

  async snapshot(signal?: AbortSignal): Promise<ScreenObservationImage> {
    const frame = await this.frame(signal)
    const size = pngSize(frame.bytes)
    return { ...frame, contentType: 'image/png', ...size }
  }

  async screenGeometry(signal?: AbortSignal): Promise<ScreenGeometry> {
    const sessionId = this.#requireSession()
    let envelope: AppiumEnvelope<WindowRect>
    try {
      envelope = await this.#request<WindowRect>('GET', `/session/${encodeURIComponent(sessionId)}/window/rect`, undefined, signal)
    } catch (error) {
      throw screenError('screen_geometry_unavailable', error)
    }
    const value = envelope.value
    const coordinates = [value?.x, value?.y, value?.width, value?.height]
    if (coordinates.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
      || value!.width! <= 0 || value!.height! <= 0) {
      throw screenError('screen_geometry_unavailable')
    }
    const viewport = { x: value!.x!, y: value!.y!, width: value!.width!, height: value!.height! }
    try {
      const orientation = await this.#request<string>('GET', `/session/${encodeURIComponent(sessionId)}/orientation`, undefined, signal)
      const normalized = typeof orientation.value === 'string' ? orientation.value.toLowerCase() : ''
      if (normalized === 'portrait' || normalized === 'landscape') {
        return { viewport, orientation: normalized, orientationSource: 'provider' }
      }
    } catch {
      // Drivers may not implement orientation. The viewport is still authoritative.
    }
    return {
      viewport,
      orientation: viewport.width === viewport.height ? 'unknown' : viewport.width > viewport.height ? 'landscape' : 'portrait',
      orientationSource: 'inferred',
    }
  }

  async screenSource(signal?: AbortSignal, options?: { resolveFocus?: boolean }): Promise<ProviderScreenSource> {
    const sessionId = this.#requireSession()
    try {
      const before = this.#platform === 'ios' && options?.resolveFocus ? await this.#focusedElement(signal) : null
      const envelope = await this.#request<string>(
        'GET',
        `/session/${encodeURIComponent(sessionId)}/source`,
        undefined,
        signal,
        MAX_SOURCE_BYTES + 64 * 1024,
      )
      if (typeof envelope.value !== 'string') throw new Error('invalid source payload')
      if (Buffer.byteLength(envelope.value, 'utf8') > MAX_SOURCE_BYTES) throw screenError('screen_observation_too_large')
      if (this.#platform === 'ios' && options?.resolveFocus) {
        const structure = normalizeScreenSource(envelope.value, 'ios')
        const after = before ? await this.#focusedElement(signal) : null
        // Never publish an XML focus flag without an independently stable WDA target.
        for (const node of structure.nodes) if (node.role === 'input') node.focused = false
        if (before && after && !structure.truncated && before.id === after.id
          && before.type === after.type && sameInputRect(before.rect, after.rect)) {
          const matches = structure.nodes.filter((node) => node.role === 'input'
            && node.visible === true && node.enabled === true && node.bounds
            && sameInputRect(node.bounds, after.rect))
          if (matches.length === 1 && matches[0]!.platformRole === after.type) matches[0]!.focused = true
        }
        return { kind: 'xml', platform: 'ios', xml: envelope.value, structure }
      }
      return { kind: 'xml', platform: this.#platform, xml: envelope.value }
    } catch (error) {
      if (error instanceof Error && 'code' in error) throw error
      throw screenError('screen_structure_unavailable', error)
    }
  }

  async #focusedElement(signal?: AbortSignal): Promise<{ id: string; type: string; rect: ScreenRect } | null> {
    try {
      const path = `/session/${encodeURIComponent(this.#requireSession())}`
      const active = await this.#request<unknown>('GET', `${path}/element/active`, undefined, signal, 64 * 1024)
      const id = elementIdFromValue(active.value)
      const element = `${path}/element/${encodeURIComponent(id)}`
      const type = await this.#request<unknown>('GET', `${element}/name`, undefined, signal, 64 * 1024)
      if (typeof type.value !== 'string' || !/^XCUIElementType(?:SearchField|TextField|TextView|TextEditor|SecureTextField)$/.test(type.value)) return null
      const rect = await this.#request<WindowRect>('GET', `${element}/rect`, undefined, signal, 64 * 1024)
      return { id, type: type.value, rect: validRect(rect.value) }
    } catch {
      signal?.throwIfAborted()
      return null
    }
  }

  async action(action: MirrorAction, signal?: AbortSignal): Promise<void> {
    const sessionId = this.#requireSession()
    const path = `/session/${encodeURIComponent(sessionId)}`
    if (action.kind === 'back') {
      try {
        await this.#request('POST', `${path}/back`, {}, signal)
      } catch (error) {
        throw markMutationUncertain(error)
      }
      return
    }
    if (action.kind !== 'tap' && action.kind !== 'swipe') throw screenError('screen_node_not_actionable')

    const actions = action.kind === 'tap'
      ? pointerSequence([
        { type: 'pointerMove', duration: 0, x: action.x, y: action.y, origin: 'viewport' },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 80 },
        { type: 'pointerUp', button: 0 },
      ])
      : pointerSequence([
        { type: 'pointerMove', duration: 0, x: action.startX, y: action.startY, origin: 'viewport' },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerMove', duration: action.durationMs, x: action.endX, y: action.endY, origin: 'viewport' },
        { type: 'pointerUp', button: 0 },
      ])
    try {
      await this.#request('POST', `${path}/actions`, { actions }, signal)
    } catch (error) {
      throw markMutationUncertain(error)
    }
  }

  async inputText(request: ProviderTextInputRequest, signal?: AbortSignal): Promise<void> {
    const sessionId = this.#requireSession()
    const sessionPath = `/session/${encodeURIComponent(sessionId)}`
    let elementId: string
    let activeRect: ScreenRect
    try {
      const active = await this.#request<unknown>('GET', `${sessionPath}/element/active`, undefined, signal, 64 * 1024)
      elementId = elementIdFromValue(active.value)
      const rect = await this.#request<WindowRect>(
        'GET',
        `${sessionPath}/element/${encodeURIComponent(elementId)}/rect`,
        undefined,
        signal,
        64 * 1024,
      )
      activeRect = validRect(rect.value)
    } catch (error) {
      if (isUnsupportedRequest(error)) throw screenError('screen_text_input_unsupported')
      if (error instanceof InvalidElementTargetError) throw screenError('screen_text_input_target_mismatch')
      throw screenError('screen_text_input_failed')
    }
    if (overlapOfSmallerRect(activeRect, request.expectedBounds) < 0.5) {
      throw screenError('screen_text_input_target_mismatch')
    }

    const elementPath = `${sessionPath}/element/${encodeURIComponent(elementId)}`
    let text = request.text
    const androidAppend = this.#platform === 'android' && request.mode === 'append'
    if (androidAppend) {
      try {
        const current = (await this.#request<unknown>('GET', `${elementPath}/text`, undefined, signal, 64 * 1024)).value
        const hint = (await this.#request<unknown>('GET', `${elementPath}/attribute/hint`, undefined, signal, 64 * 1024)).value
        if (typeof current !== 'string' || (hint !== null && typeof hint !== 'string')) throw screenError('screen_text_input_unsupported')
        // UIA2's default append clears first and discards current text when a hint remains.
        // Equal nonempty text/hint is ambiguous; never guess and overwrite user content.
        if (current && current === hint) throw screenError('screen_text_input_unsupported')
        text = current + request.text
        validatePublicText(text, 'append')
        const active = await this.#request<unknown>('GET', `${sessionPath}/element/active`, undefined, signal, 64 * 1024)
        if (elementIdFromValue(active.value) !== elementId) throw screenError('screen_text_input_target_mismatch')
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && ['screen_text_input_unsupported', 'screen_text_input_target_mismatch'].includes(String(error.code))) throw error
        throw screenError('screen_text_input_failed')
      }
    }
    if (request.mode === 'replace') {
      try {
        await this.#request('POST', `${elementPath}/clear`, {}, signal, 64 * 1024)
      } catch {
        throw markMayHaveMutated(screenError('screen_text_input_partial'))
      }
    }
    try {
      await this.#request('POST', `${elementPath}/value`, this.#platform === 'android' ? { text, replace: true } : { text }, signal, 64 * 1024)
      if (androidAppend) {
        const actual = (await this.#request<unknown>('GET', `${elementPath}/text`, undefined, signal, 64 * 1024)).value
        if (actual !== text) throw screenError('screen_text_input_failed')
      }
    } catch {
      throw markMayHaveMutated(screenError(request.mode === 'replace' ? 'screen_text_input_partial' : 'screen_text_input_failed'))
    }
  }

  appControlContext(): ProviderAppControlContext | null {
    if (!this.#sessionId) return null
    return {
      owned: this.#ownsSession,
      platform: this.#platform,
      targetAppId: this.#targetAppId,
    }
  }

  runProvenance(): ProviderRunProvenance | null {
    return this.#runProvenance ? structuredClone(this.#runProvenance) : null
  }

  async manageApp(request: ProviderAppManagementRequest, signal?: AbortSignal): Promise<ProviderAppManagementResult> {
    const sessionId = this.#requireSession()
    const path = `/session/${encodeURIComponent(sessionId)}`
    const beforeState = await this.#queryAppState(path, request.appId, signal)
    if (beforeState === 'not-installed') throw screenError('app_not_installed')

    if (request.operation === 'activate') {
      if (beforeState === 'foreground') {
        return { beforeState, afterState: beforeState, outcome: 'already-foreground' }
      }
      try {
        if (this.#platform === 'ios' && beforeState === 'not-running') {
          await this.#request('POST', `${path}/execute/sync`, {
            script: 'mobile: launchApp',
            args: [{ bundleId: request.appId }],
          }, signal, 64 * 1024)
        } else {
          await this.#request('POST', `${path}/appium/device/activate_app`, { appId: request.appId }, signal, 64 * 1024)
        }
      } catch {
        throw markMayHaveMutated(screenError('app_activate_failed'))
      }
      const afterState = await this.#queryAppStateAfterMutation(path, request.appId, signal)
      if (afterState !== 'foreground') throw markMayHaveMutated(screenError('app_state_unverified'))
      return { beforeState, afterState, outcome: 'activated' }
    }

    if (beforeState === 'not-running') {
      return { beforeState, afterState: beforeState, outcome: 'already-stopped' }
    }
    try {
      await this.#request('POST', `${path}/appium/device/terminate_app`, {
        appId: request.appId,
        options: { timeout: 5_000 },
      }, signal, 64 * 1024)
    } catch {
      throw markMayHaveMutated(screenError('app_terminate_failed'))
    }
    const afterState = await this.#queryAppStateAfterMutation(path, request.appId, signal)
    if (afterState !== 'not-running') throw markMayHaveMutated(screenError('app_state_unverified'))
    return { beforeState, afterState, outcome: 'terminated' }
  }

  async queryAppState(appId: string, signal?: AbortSignal): Promise<MobileAppState> {
    const context = this.appControlContext()
    if (!context?.owned) throw screenError('app_state_unverified')
    return this.#queryAppState(`/session/${encodeURIComponent(this.#requireSession())}`, appId, signal)
  }

  async #queryAppState(path: string, appId: string, signal?: AbortSignal): Promise<MobileAppState> {
    try {
      const envelope = await this.#request<number>('POST', `${path}/appium/device/app_state`, { appId }, signal, 64 * 1024)
      return appState(envelope.value)
    } catch (error) {
      if (error instanceof InvalidAppStateError) throw screenError('app_state_unverified')
      if (error instanceof Error && 'code' in error) throw error
      throw screenError('app_state_unverified')
    }
  }

  async #queryAppStateAfterMutation(path: string, appId: string, signal?: AbortSignal): Promise<MobileAppState> {
    try {
      return await this.#queryAppState(path, appId, signal)
    } catch {
      throw markMayHaveMutated(screenError('app_state_unverified'))
    }
  }

  mediaContext(): ViewerMediaContext | null {
    return this.#mediaContext ? structuredClone(this.#mediaContext) : null
  }

  mediaContextError(): ViewerMediaErrorCode | null {
    return this.#mediaError
  }

  async #configureOwnedMediaContext(
    returned: Record<string, unknown>,
    requested: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.#viewerMedia?.mode !== 'auto') return
    if (this.#mediaError) return
    if (this.#platform === 'android') {
      const deviceId = deviceIdFromCapabilities(returned) ?? deviceIdFromCapabilities(requested)
      if (this.#viewerMedia.android.scrcpyPath && deviceId) {
        this.#mediaContext = { kind: 'android-scrcpy', deviceId, adbPath: this.#adbPath }
      } else {
        this.#mediaError = 'viewer_media_unavailable'
      }
      return
    }
    if (this.#platform !== 'ios') return
    const port = mediaPortFromCapabilities(returned) ?? mediaPortFromCapabilities(requested)
    if (port === null) {
      this.#mediaError ??= 'viewer_media_port_unavailable'
      return
    }
    try {
      const sessionId = this.#requireSession()
      await this.#request('POST', `/session/${encodeURIComponent(sessionId)}/appium/settings`, {
        settings: {
          mjpegServerFramerate: this.#viewerMedia.ios.framerate,
          mjpegScalingFactor: this.#viewerMedia.ios.scalingFactor,
          mjpegServerScreenshotQuality: this.#viewerMedia.ios.screenshotQuality,
          mjpegFixOrientation: true,
        },
      }, signal, 64 * 1024)
      this.#mediaContext = { kind: 'ios-wda-mjpeg', host: '127.0.0.1', port, owned: true }
    } catch {
      this.#mediaError = 'viewer_media_unavailable'
    }
  }

  #configureAttachedMediaContext(capabilities: Record<string, unknown> | undefined): void {
    if (this.#viewerMedia?.mode !== 'auto' || !capabilities) return
    if (this.#platform === 'android') {
      const deviceId = deviceIdFromCapabilities(capabilities)
      if (this.#viewerMedia.android.scrcpyPath && deviceId) {
        this.#mediaContext = { kind: 'android-scrcpy', deviceId, adbPath: this.#adbPath }
      } else {
        this.#mediaError = 'viewer_media_unavailable'
      }
      return
    }
    if (this.#platform !== 'ios') return
    const port = mediaPortFromCapabilities(capabilities)
    if (port === null) {
      this.#mediaError = 'viewer_media_unavailable'
      return
    }
    this.#mediaContext = { kind: 'ios-wda-mjpeg', host: '127.0.0.1', port, owned: false }
  }

  async #request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    maxResponseBytes = 40 * 1024 * 1024,
  ): Promise<AppiumEnvelope<T>> {
    let response: Response
    try {
      const request: RequestInit = { method }
      if (body !== undefined) {
        request.headers = { 'content-type': 'application/json' }
        request.body = JSON.stringify(body)
      }
      if (signal) request.signal = signal
      response = await fetch(`${this.#baseUrl}${path}`, request)
    } catch (error) {
      throw classifyAppiumTransportFailure(path, signal, error)
    }

    let text: string
    try {
      text = await readBoundedText(response, maxResponseBytes, signal)
    } catch (error) {
      if (error instanceof Error && 'code' in error) throw error
      throw classifyAppiumTransportFailure(path, signal, error)
    }
    let payload: AppiumEnvelope<T> = {}
    if (text) {
      try {
        payload = JSON.parse(text) as AppiumEnvelope<T>
      } catch {
        throw new Error(`Appium returned non-JSON data (${response.status})`)
      }
    }
    if (!response.ok) {
      const value = payload.value as { message?: string } | undefined
      throw new AppiumRequestError(
        response.status,
        value?.message ?? `Appium request failed (${response.status})`,
        isSessionCommandPath(path),
      )
    }
    return payload
  }

  #requireSession(): string {
    if (!this.#sessionId) throw new Error('No active Appium session')
    return this.#sessionId
  }
}

class AppiumRequestError extends Error {
  constructor(readonly status: number, message: string, readonly sessionCommand: boolean) {
    super(message)
    this.name = 'AppiumRequestError'
  }
}

export class AppiumPublicError extends Error {
  readonly code: AppiumPublicErrorCode

  constructor(code: AppiumPublicErrorCode, cause?: unknown) {
    super(APPIUM_PUBLIC_ERROR_MESSAGES[code], cause === undefined ? undefined : { cause })
    this.name = 'AppiumPublicError'
    this.code = code
  }
}

export function appiumPublicErrorCode(error: unknown): AppiumPublicErrorCode | null {
  if (error instanceof AppiumPublicError) return error.code
  if (error instanceof AppiumRequestError && error.sessionCommand) return 'appium_session_command_failed'
  return null
}

export function appiumPublicErrorMessage(error: unknown): string | null {
  const code = appiumPublicErrorCode(error)
  return code ? APPIUM_PUBLIC_ERROR_MESSAGES[code] : null
}

function isSessionCommandPath(path: string): boolean {
  return /^\/session\/[^/]+(?:\/|$)/.test(path)
}

function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'TimeoutError'
}

function classifyAppiumTransportFailure(path: string, signal: AbortSignal | undefined, cause: unknown): unknown {
  if (signal?.aborted) {
    if (!isTimeoutReason(signal.reason)) return signal.reason
    return new AppiumPublicError(isSessionCommandPath(path) ? 'appium_session_command_timeout' : 'appium_request_timeout', cause)
  }
  return new AppiumPublicError('appium_server_unreachable', cause)
}

function markMutationUncertain(error: unknown): object {
  if (error !== null && typeof error === 'object') return markMayHaveMutated(error)
  return markMayHaveMutated(new AppiumPublicError('appium_session_command_failed', error))
}

class InvalidElementTargetError extends Error {}

class InvalidAppStateError extends Error {}

function elementIdFromValue(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidElementTargetError()
  const candidate = (value as Record<string, unknown>)[W3C_ELEMENT_KEY]
    ?? (value as Record<string, unknown>).ELEMENT
  if (typeof candidate !== 'string' || candidate.length === 0) throw new InvalidElementTargetError()
  return candidate
}

function validRect(value: WindowRect | undefined): ScreenRect {
  if (!value || [value.x, value.y, value.width, value.height]
    .some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
    || value.width! <= 0 || value.height! <= 0) {
    throw new InvalidElementTargetError()
  }
  return { x: value.x!, y: value.y!, width: value.width!, height: value.height! }
}

function overlapOfSmallerRect(left: ScreenRect, right: ScreenRect): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  const smallerArea = Math.min(left.width * left.height, right.width * right.height)
  return smallerArea > 0 ? width * height / smallerArea : 0
}

function isUnsupportedRequest(error: unknown): boolean {
  return error instanceof AppiumRequestError && [404, 405, 501].includes(error.status)
}

function appState(value: unknown): MobileAppState {
  if (value === 0) return 'not-installed'
  if (value === 1) return 'not-running'
  if (value === 2) return 'background'
  if (value === 3) return 'suspended'
  if (value === 4) return 'foreground'
  throw new InvalidAppStateError()
}

async function readBoundedText(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw screenError('screen_observation_too_large')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw screenError('screen_observation_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.byteLength < 24 || signature.some((value, index) => bytes[index] !== value)) {
    throw screenError('screen_capture_failed')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width <= 0 || height <= 0) throw screenError('screen_capture_failed')
  return { width, height }
}

function platformFromCapabilities(capabilities: Record<string, unknown> | undefined): 'android' | 'ios' | 'unknown' {
  const platform = capabilities?.platformName
  if (typeof platform !== 'string') return 'unknown'
  if (platform.toLowerCase() === 'android') return 'android'
  if (platform.toLowerCase() === 'ios') return 'ios'
  return 'unknown'
}

function targetAppIdFromCapabilities(
  capabilities: Record<string, unknown> | undefined,
  platform: 'android' | 'ios' | 'unknown',
): string | null {
  const value = platform === 'android'
    ? capabilities?.['appium:appPackage'] ?? capabilities?.appPackage
    : platform === 'ios' ? capabilities?.['appium:bundleId'] ?? capabilities?.bundleId : undefined
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,255}$/.test(value) ? value : null
}

function provenanceFromCapabilities(capabilities: Record<string, unknown> | undefined, appId: string | null): ProviderRunProvenance {
  const platform = publicCapability(capabilities?.platformName)
  const platformVersion = publicCapability(capabilities?.['appium:platformVersion'] ?? capabilities?.platformVersion)
  const automationName = publicCapability(capabilities?.['appium:automationName'] ?? capabilities?.automationName)
  const appVersion = publicCapability(capabilities?.['mobileMirror:appVersion'] ?? capabilities?.appVersion)
  const appBuild = publicCapability(capabilities?.['mobileMirror:appBuild'] ?? capabilities?.appBuild)
  const appBinarySha256 = capabilities?.['mobileMirror:appBinarySha256']
  return {
    ...(appId ? { appId } : {}),
    ...(appVersion ? { appVersion } : {}),
    ...(appBuild ? { appBuild } : {}),
    ...(typeof appBinarySha256 === 'string' && /^[a-f0-9]{64}$/.test(appBinarySha256) ? { appBinarySha256 } : {}),
    ...(platform ? { os: platformVersion ? `${platform} ${platformVersion}` : platform } : {}),
    ...(automationName ? { driver: automationName } : {}),
  }
}

function publicCapability(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ +()-]{0,159}$/.test(value) ? value : undefined
}

const IOS_WDA_CAPABILITIES = [
  ['appium:xcodeOrgId', 'xcodeOrgId'],
  ['appium:xcodeSigningId', 'xcodeSigningId'],
  ['appium:updatedWDABundleId', 'updatedBundleId'],
  ['appium:xcodeConfigFile', 'xcodeConfigFile'],
] as const

export function mergeIosWdaCapabilities(
  requested: Record<string, unknown>,
  defaults?: IosWdaDefaults,
): Record<string, unknown> {
  const merged = { ...requested }
  // Local routing metadata is not a WebDriver capability or device attestation.
  delete merged['mobileMirror:deviceKind']
  if (!defaults || !isIosCapabilities(requested) || requested['mobileMirror:deviceKind'] === 'simulator') return merged
  for (const [capability, configKey] of IOS_WDA_CAPABILITIES) {
    if (!Object.hasOwn(requested, capability) && defaults[configKey] !== '') {
      merged[capability] = defaults[configKey]
    }
  }
  if (!Object.hasOwn(requested, 'appium:allowProvisioningDeviceRegistration')
    && defaults.allowProvisioningDeviceRegistration) {
    merged['appium:allowProvisioningDeviceRegistration'] = true
  }
  return merged
}

export function mergeAndroidAppiumCapabilities(
  requested: Record<string, unknown>,
  defaults?: AndroidAppiumDefaults,
): Record<string, unknown> {
  if (!defaults || !isAndroidCapabilities(requested)) return { ...requested }

  const merged = { ...requested }
  if (!Object.hasOwn(requested, 'appium:ignoreHiddenApiPolicyError')) {
    merged['appium:ignoreHiddenApiPolicyError'] = defaults.ignoreHiddenApiPolicyError
  }
  return merged
}

function isIosCapabilities(capabilities: Record<string, unknown>): boolean {
  return typeof capabilities.platformName === 'string' && capabilities.platformName.toLowerCase() === 'ios'
}

function isAndroidCapabilities(capabilities: Record<string, unknown>): boolean {
  return typeof capabilities.platformName === 'string' && capabilities.platformName.toLowerCase() === 'android'
}

function hasMediaPortCapability(capabilities: Record<string, unknown>): boolean {
  return Object.hasOwn(capabilities, 'appium:mjpegServerPort') || Object.hasOwn(capabilities, 'mjpegServerPort')
}

function mediaPortFromCapabilities(capabilities: Record<string, unknown> | undefined): number | null {
  const value = capabilities?.['appium:mjpegServerPort'] ?? capabilities?.mjpegServerPort
  return Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65_535 ? value as number : null
}

function withoutMediaPortCapabilities(capabilities: Record<string, unknown>): Record<string, unknown> {
  const next = { ...capabilities }
  delete next['appium:mjpegServerPort']
  delete next.mjpegServerPort
  return next
}

function deviceIdFromCapabilities(capabilities: Record<string, unknown>): string | null {
  const value = capabilities['appium:udid'] ?? capabilities.udid
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null
}

function sensitiveCapabilityValues(capabilities: Record<string, unknown>): unknown[] {
  return [
    capabilities['appium:udid'],
    capabilities.udid,
    capabilities['appium:xcodeOrgId'],
    capabilities['appium:xcodeSigningId'],
    capabilities['appium:updatedWDABundleId'],
    capabilities['appium:xcodeConfigFile'],
  ]
}

function isPortForwardingRace(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /(?:address already in use|eaddrinuse|port[^\n]{0,40}(?:busy|in use)|forward[^\n]{0,40}fail)/i.test(error.message)
}

function pointerSequence(actions: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [{
    type: 'pointer',
    id: 'finger1',
    parameters: { pointerType: 'touch' },
    actions,
  }]
}

// WDA XML rounds coordinates; tolerate at most one logical point per edge.
function sameInputRect(a: ScreenRect, b: ScreenRect): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1
    && Math.abs(a.x + a.width - b.x - b.width) <= 1
    && Math.abs(a.y + a.height - b.y - b.height) <= 1
}
