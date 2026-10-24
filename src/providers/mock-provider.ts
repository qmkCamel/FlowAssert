import { abortableDelay } from '../abort.js'
import { randomUUID } from 'node:crypto'
import { sha256 } from '../content-hash.js'
import { MockScreenModel, MOCK_SESSION_APP_ID } from '../mock-screen-model.js'
import { markMayHaveMutated, screenError } from '../screen-errors.js'
import type {
  MirrorAction,
  MirrorFrame,
  MirrorProvider,
  ProviderScreenSource,
  ProviderSession,
  ProviderAppControlContext,
  ProviderAppManagementRequest,
  ProviderAppManagementResult,
  ProviderTextInputRequest,
  ProviderRunProvenance,
  ProviderRepairInstallRequest,
  ProviderRepairInstalledIdentity,
  ScreenGeometry,
  ScreenObservationImage,
  StartMirrorInput,
} from '../types.js'

export class MockProvider implements MirrorProvider {
  readonly kind = 'mock' as const
  readonly #startupDelayMs: number
  #model = new MockScreenModel()
  readonly #operationDelayMs: number
  readonly #postMutationDelayMs: number
  readonly #failTextAfterMutation: boolean
  readonly #failAppAfterMutation: boolean
  #connected = false
  #repairInstalled: ProviderRepairInstallRequest | undefined
  #repairSessionId = 'mock-iphone-15'

  constructor(startupDelayMs: number, options: {
    operationDelayMs?: number
    postMutationDelayMs?: number
    failTextAfterMutation?: boolean
    failAppAfterMutation?: boolean
  } = {}) {
    this.#startupDelayMs = startupDelayMs
    this.#operationDelayMs = options.operationDelayMs ?? 0
    this.#postMutationDelayMs = options.postMutationDelayMs ?? 0
    this.#failTextAfterMutation = options.failTextAfterMutation ?? false
    this.#failAppAfterMutation = options.failAppAfterMutation ?? false
  }

  async start(_input: StartMirrorInput, signal: AbortSignal): Promise<ProviderSession> {
    await abortableDelay(this.#startupDelayMs, signal)
    this.#connected = true
    return { sessionId: this.#repairSessionId, deviceName: 'Demo iPhone 15' }
  }

  async stop(): Promise<void> {
    this.#connected = false
  }

  async frame(): Promise<MirrorFrame> {
    this.#requireConnected()
    return { bytes: this.#model.svg(), contentType: 'image/svg+xml' }
  }

  async snapshot(): Promise<ScreenObservationImage> {
    this.#requireConnected()
    return this.#model.png()
  }

  async screenGeometry(): Promise<ScreenGeometry> {
    this.#requireConnected()
    return this.#model.geometry()
  }

  async screenSource(): Promise<ProviderScreenSource> {
    this.#requireConnected()
    return { kind: 'normalized', structure: this.#model.structure() }
  }

  async action(action: MirrorAction): Promise<void> {
    this.#requireConnected()
    this.#model.act(action)
  }

  async inputText(request: ProviderTextInputRequest, signal?: AbortSignal): Promise<void> {
    this.#requireConnected()
    if (this.#operationDelayMs > 0) await abortableDelay(this.#operationDelayMs, signal ?? new AbortController().signal)
    this.#model.inputText(request.mode, request.text)
    if (this.#postMutationDelayMs > 0) {
      try {
        await abortableDelay(this.#postMutationDelayMs, signal ?? new AbortController().signal)
      } catch {
        throw markMayHaveMutated(screenError('screen_text_input_partial'))
      }
    }
    if (this.#failTextAfterMutation) throw markMayHaveMutated(screenError('screen_text_input_partial'))
  }

  appControlContext(): ProviderAppControlContext | null {
    if (!this.#connected) return null
    return { owned: true, platform: 'mock', targetAppId: MOCK_SESSION_APP_ID }
  }

  runProvenance(): ProviderRunProvenance | null {
    if (!this.#connected) return null
    const viewport = this.#model.geometry().viewport
    return {
      appId: MOCK_SESSION_APP_ID,
      appVersion: 'mock-1',
      appBuild: 'mock-1',
      os: 'mock-ios',
      driver: 'mobile-mirror-mock',
      viewport: `${viewport.width}x${viewport.height}`,
    }
  }

  async queryAppState(appId: string): Promise<import('../types.js').MobileAppState> {
    this.#requireConnected()
    return appId === MOCK_SESSION_APP_ID ? 'foreground' : 'not-installed'
  }

  /** Replaces the entire in-memory fixture state; launchApp alone does not do this. */
  async resetRepairFixture(): Promise<{ namespaceId: string; initialStateSha256: string }> {
    this.#requireConnected()
    this.#model = new MockScreenModel()
    return { namespaceId: randomUUID(), initialStateSha256: sha256(JSON.stringify(this.#model.structure())) }
  }

  /** Fixture protocol only. This receipt cannot establish real-device installation. */
  async installRepairArtifact(request: ProviderRepairInstallRequest, signal?: AbortSignal): Promise<void> {
    this.#requireConnected()
    if (request.appId !== MOCK_SESSION_APP_ID) throw new Error('Mock target App mismatch')
    if (this.#operationDelayMs > 0) await abortableDelay(this.#operationDelayMs, signal ?? new AbortController().signal)
    this.#repairInstalled = { ...request }
    if (this.#postMutationDelayMs > 0) await abortableDelay(this.#postMutationDelayMs, signal ?? new AbortController().signal)
  }

  async rebuildRepairSession(signal?: AbortSignal): Promise<ProviderSession> {
    this.#requireConnected()
    signal?.throwIfAborted()
    this.#repairSessionId = `mock-repair-${randomUUID()}`
    return { sessionId: this.#repairSessionId, deviceName: 'Demo iPhone 15' }
  }

  async readRepairInstalledIdentity(appId: string): Promise<ProviderRepairInstalledIdentity> {
    this.#requireConnected()
    const installed = this.#repairInstalled
    return { appId: installed?.appId ?? appId, version: 'mock-1',
      ...(installed ? { buildMarker: installed.buildMarker, artifactDigest: installed.artifactDigest } : {}),
      evidence: installed ? 'package-digest' : 'version-only', observedAt: new Date().toISOString() }
  }

  async manageApp(request: ProviderAppManagementRequest, signal?: AbortSignal): Promise<ProviderAppManagementResult> {
    this.#requireConnected()
    if (this.#operationDelayMs > 0) await abortableDelay(this.#operationDelayMs, signal ?? new AbortController().signal)
    const result = this.#model.manageApp(request)
    if (this.#postMutationDelayMs > 0) {
      try {
        await abortableDelay(this.#postMutationDelayMs, signal ?? new AbortController().signal)
      } catch {
        throw markMayHaveMutated(screenError(request.operation === 'activate' ? 'app_activate_failed' : 'app_terminate_failed'))
      }
    }
    if (this.#failAppAfterMutation) {
      throw markMayHaveMutated(screenError(request.operation === 'activate' ? 'app_activate_failed' : 'app_terminate_failed'))
    }
    return result
  }

  #requireConnected(): void {
    if (!this.#connected) throw new Error('Mock device is not connected')
  }
}
