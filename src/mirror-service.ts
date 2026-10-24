import { randomBytes } from 'node:crypto'
import { parseScreenQuery, queryStructure, structureSummary, ScreenQueryError, type ScreenQueryResult } from './screen-query.js'
import { WorkbenchDevice } from './workbench-device.js'
import { combineSignals, errorMessage } from './abort.js'
import { androidAppiumDefaultsFromConfig, iosWdaDefaultsFromConfig, viewerMediaConfigFromConfig, type Config } from './config.js'
import { createAppiumRuntime, ManagedAppiumError, type AppiumRuntimeLifecycle } from './managed-appium-runtime.js'
import { ObservationStore } from './observation-store.js'
import { AppiumProvider, appiumPublicErrorCode, appiumPublicErrorMessage } from './providers/appium-provider.js'
import { MockProvider } from './providers/mock-provider.js'
import { markMayHaveMutated, mayHaveMutated, screenError, screenErrorCode, ScreenObservationError } from './screen-errors.js'
import { normalizeScreenSource } from './screen-source-normalizer.js'
import { isSensitivePlatformRole, nodeTapPoint, requirePositiveVisibleBounds, validatePublicText } from './semantic-actions.js'
import type {
  MirrorAction,
  AppManagementInput,
  AppManagementResult,
  AppManagementTargetScope,
  MirrorFrame,
  MirrorProvider,
  MirrorState,
  ProviderKind,
  ProviderRepairInstallRequest,
  ProviderRepairInstallReceipt,
  ProviderRepairInstalledIdentity,
  ProviderRunProvenance,
  ScreenObservation,
  ScreenObservationRequest,
  StartMirrorInput,
  ViewerMediaClientFailureCode,
  ViewerMediaSubscription,
} from './types.js'
import { WdaStartError } from './wda-errors.js'
import { ViewerMediaCoordinator, type ViewerMediaCoordinatorOptions } from './viewer-media-coordinator.js'
import { DeviceOwnerClaim, type DeviceOwnerLease } from './device-owner-claim.js'

const ACTION_FRESHNESS_MS = 15_000
const VIEWER_FRAME_TIMEOUT_MS = 5_000

function explicitDeviceIdentity(input: StartMirrorInput): { platform: 'android' | 'ios'; deviceId: string } | null {
  if (input.provider !== 'appium' || input.sessionId || !input.capabilities) return null
  const platformValue = input.capabilities.platformName ?? input.capabilities['appium:platformName']
  const deviceValue = input.capabilities['appium:udid'] ?? input.capabilities.udid
  if (typeof platformValue !== 'string' || typeof deviceValue !== 'string' || !deviceValue.trim()) return null
  const platform = platformValue.toLowerCase()
  return platform === 'android' ? { platform: 'android', deviceId: deviceValue } : platform === 'ios' ? { platform: 'ios', deviceId: deviceValue } : null
}

export class MirrorService {
  readonly #config: Config
  readonly #observations: ObservationStore
  readonly #now: () => number
  #provider: MirrorProvider | null = null
  #runOwner: string | null = null
  #runGroupOwner: string | null = null
  #repairOwner: string | null = null
  #repairReadOnly = false
  #runControlUncertain = false
  #state: MirrorState
  #lastFrame: MirrorFrame | null = null
  #framePromise: Promise<MirrorFrame> | null = null
  #startAbort: AbortController | null = null
  #operationTail: Promise<void> = Promise.resolve()
  #observationInProgress = false
  #lifetimeAbort = new AbortController()
  #sessionAbort = new AbortController()
  #inspectionGenerationToken = randomBytes(16).toString('base64url')
  #sessionGeneration = 0
  #screenEpoch = 0
  #frameRevision = 0
  #latestObservationRevision = 0
  readonly #media: ViewerMediaCoordinator
  readonly #appiumRuntime: AppiumRuntimeLifecycle
  readonly #providerFactory: ((kind: ProviderKind) => MirrorProvider) | undefined
  readonly #deviceClaim: Pick<DeviceOwnerClaim, 'acquire'>
  #deviceLease: DeviceOwnerLease | null = null

  constructor(config: Config, viewerUrl: string, options: {
    now?: () => number
    observations?: ObservationStore
    media?: ViewerMediaCoordinatorOptions
    appiumRuntime?: AppiumRuntimeLifecycle
    providerFactory?: (kind: ProviderKind) => MirrorProvider
    deviceClaim?: Pick<DeviceOwnerClaim, 'acquire'>
  } = {}) {
    this.#config = config
    this.#now = options.now ?? Date.now
    this.#observations = options.observations ?? new ObservationStore({ now: this.#now })
    this.#providerFactory = options.providerFactory
    this.#deviceClaim = options.deviceClaim ?? new DeviceOwnerClaim()
    this.#state = {
      lifecycle: 'idle',
      provider: null,
      sessionId: null,
      deviceName: null,
      viewerUrl,
      frameUpdatedAt: null,
      lastAction: null,
      lastError: null,
      lastErrorCode: null,
      observation: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
      control: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
      media: {
        mode: config.viewerMediaMode,
        phase: 'idle',
        transport: 'appium-screenshot',
        startedAt: null,
        firstFrameAt: null,
        lastFrameAt: null,
        width: null,
        height: null,
        targetFps: null,
        lastErrorCode: null,
      },
      appiumRuntime: {
        mode: config.appiumRuntimeMode,
        phase: 'idle',
        owned: false,
        lastErrorCode: null,
      },
      revision: 0,
    }
    this.#appiumRuntime = options.appiumRuntime ?? createAppiumRuntime(config, {
      onState: (appiumRuntime) => this.#transition({ appiumRuntime }),
    })
    this.#state = { ...this.#state, appiumRuntime: this.#appiumRuntime.state() }
    this.#media = new ViewerMediaCoordinator(viewerMediaConfigFromConfig(config), {
      ...options.media,
      now: options.media?.now ?? this.#now,
      onState: (media) => this.#transition({ media }),
    })
  }

  state(): MirrorState {
    return structuredClone({ ...this.#state, appiumRuntime: this.#appiumRuntime.state() })
  }

  runProvenance(): ProviderRunProvenance & { provider?: string } {
    const observed = this.#provider?.runProvenance?.() ?? {}
    return { ...observed, ...(this.#state.provider ? { provider: this.#state.provider } : {}) }
  }

  updateViewerUrl(viewerUrl: string): void {
    this.#state = { ...this.#state, viewerUrl, revision: this.#state.revision + 1 }
  }

  async start(input: StartMirrorInput, signal?: AbortSignal): Promise<MirrorState> {
    this.#assertNoRun()
    if (this.#state.lifecycle === 'connecting' || this.#state.lifecycle === 'stopping') {
      throw new Error(`Cannot start while mirror is ${this.#state.lifecycle}`)
    }
    if (this.#state.lifecycle === 'streaming') {
      if (this.#state.provider === input.provider) return this.state()
      await this.stop(signal)
    }

    let provider: MirrorProvider | null = null
    const startAbort = new AbortController()
    const startSignal = AbortSignal.any([this.#withLifetime(signal), startAbort.signal])
    this.#startAbort = startAbort
    this.#transition({
      lifecycle: 'connecting',
      provider: input.provider,
      sessionId: null,
      deviceName: null,
      lastError: null,
      lastErrorCode: null,
      observation: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
      control: { phase: 'idle', startedAt: null, lastCompletedAt: null, lastErrorCode: null },
    })

    try {
      const explicitDevice = explicitDeviceIdentity(input)
      if (explicitDevice) this.#deviceLease = await this.#deviceClaim.acquire(explicitDevice.platform, explicitDevice.deviceId)
      if (input.provider === 'appium') await this.#appiumRuntime.ensureReady(input, startSignal)
      provider = this.#createProvider(input.provider)
      const providerStartupTimeoutMs = input.provider === 'appium'
        ? this.#config.appiumSessionStartupTimeoutMs
        : this.#config.startupTimeoutMs
      const session = await provider.start(input, combineSignals(startSignal, providerStartupTimeoutMs))
      startSignal.throwIfAborted()
      this.#provider = provider
      this.#runControlUncertain = false
      this.#sessionGeneration += 1
      this.#inspectionGenerationToken = randomBytes(16).toString('base64url')
      this.#screenEpoch += 1
      this.#sessionAbort = new AbortController()
      this.#latestObservationRevision = 0
      this.#transition({
        lifecycle: 'streaming',
        sessionId: session.sessionId,
        deviceName: session.deviceName,
      })
      await this.frame(startSignal, this.#config.startupTimeoutMs)
      await this.#media.prepare(provider.mediaContext?.() ?? null, provider.mediaContextError?.() ?? null)
      await this.#deviceLease?.markActive()
      return this.state()
    } catch (error) {
      let cleanupFailed = false
      await this.#media.stopSession().catch(() => undefined)
      await provider?.stop().catch(() => { cleanupFailed = true })
      if (input.provider === 'appium') await this.#appiumRuntime.stop().catch(() => { cleanupFailed = true })
      if (!cleanupFailed) { await this.#deviceLease?.release(); this.#deviceLease = null }
      this.#provider = null
      if (startAbort.signal.aborted && startAbort.signal.reason instanceof Error
        && startAbort.signal.reason.message === 'Mirror start cancelled') {
        this.#transition({
          lifecycle: 'idle',
          provider: null,
          sessionId: null,
          deviceName: null,
          lastError: null,
          lastErrorCode: null,
        })
        return this.state()
      }
      this.#transition({
        lifecycle: 'error',
        lastError: appiumPublicErrorMessage(error) ?? errorMessage(error),
        lastErrorCode: error instanceof WdaStartError || error instanceof ManagedAppiumError
          ? error.code
          : appiumPublicErrorCode(error),
      })
      throw error
    } finally {
      if (this.#startAbort === startAbort) this.#startAbort = null
    }
  }

  async stop(signal?: AbortSignal): Promise<MirrorState> {
    this.#assertNoRun()
    const provider = this.#provider
    if (!provider) {
      this.#startAbort?.abort(new Error('Mirror start cancelled'))
      await this.#appiumRuntime.stop()
      this.#transition({
        lifecycle: 'idle',
        provider: null,
        sessionId: null,
        deviceName: null,
        lastError: null,
        lastErrorCode: null,
        observation: { ...this.#state.observation, phase: 'idle', startedAt: null },
        control: { ...this.#state.control, phase: 'idle', startedAt: null },
      })
      return this.state()
    }

    this.#transition({ lifecycle: 'stopping' })
    const managedRuntimeOwned = this.#state.provider === 'appium'
      && this.#appiumRuntime.state().mode === 'managed'
      && this.#appiumRuntime.state().owned
    const previousGeneration = this.#sessionGeneration
    this.#sessionGeneration += 1
    this.#inspectionGenerationToken = randomBytes(16).toString('base64url')
    this.#screenEpoch += 1
    this.#latestObservationRevision = 0
    this.#sessionAbort.abort(screenError('screen_observation_session_mismatch'))
    this.#observations.clearGeneration(previousGeneration)
    await this.#media.stopSession()
    await this.#operationTail.catch(() => undefined)
    let providerError: unknown
    try {
      await provider.stop(combineSignals(this.#withLifetime(signal), this.#config.startupTimeoutMs))
    } catch (error) {
      providerError = error
    }
    try {
      if (this.#state.provider === 'appium') await this.#appiumRuntime.stop()
      // A managed Appium process performs its own active-session cleanup while
      // shutting down. If the explicit DELETE raced with that teardown, the
      // owned process still gives us a bounded, authoritative cleanup path.
      if (providerError && !managedRuntimeOwned) throw providerError
      await this.#deviceLease?.release(); this.#deviceLease = null
      this.#provider = null
      this.#transition({
        lifecycle: 'idle',
        provider: null,
        sessionId: null,
        deviceName: null,
        lastError: null,
        lastErrorCode: null,
        observation: { ...this.#state.observation, phase: 'idle', startedAt: null },
        control: { ...this.#state.control, phase: 'idle', startedAt: null },
      })
      return this.state()
    } catch (error) {
      this.#provider = null
      this.#transition({
        lifecycle: 'error',
        provider: null,
        sessionId: null,
        deviceName: null,
        lastError: appiumPublicErrorMessage(error) ?? errorMessage(error),
        lastErrorCode: appiumPublicErrorCode(error),
        observation: { ...this.#state.observation, phase: 'idle', startedAt: null },
        control: { ...this.#state.control, phase: 'idle', startedAt: null },
      })
      throw error
    }
  }

  get testPlatform(): 'android'|'ios' { const provider=this.#requireProvider(); const context=provider.appControlContext?.(); if(provider.kind!=='mock' && (!context?.owned || !['android','ios'].includes(context.platform))) throw new Error('Tests require an owned Android or iOS session'); return context?.platform==='android'?'android':'ios' }

  get runOwner(): string | null { return this.#runOwner }

  /** Suites and local matrices retain ownership between child runs. */
  reserveRunGroup(owner: string): () => void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner)
      || this.#runOwner || this.#runGroupOwner || this.#repairOwner || this.#state.lifecycle !== 'streaming')
      throw new Error('Device run group is busy')
    this.#runGroupOwner = owner
    let released = false
    return () => {
      if (released) return
      if (this.#runGroupOwner !== owner || this.#runOwner) throw new Error('Device run group still owns device')
      this.#runGroupOwner = null; released = true
    }
  }

  /** Keeps one repair's consecutive child runs isolated from Viewer and other owners. */
  reserveRepair(owner: string): () => Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner) || this.#repairOwner)
      throw new Error('Repair device reservation is busy')
    this.#assertNoRun()
    this.#assertRunControlCertain()
    if (this.#state.lifecycle !== 'streaming') throw new Error('Connect a device before reserving repair control')
    this.#requireProvider()
    if (this.#state.control.phase !== 'idle' || this.#observationInProgress) throw new Error('Device is busy')
    this.#repairOwner = owner
    this.#repairReadOnly = false
    this.#screenEpoch += 1
    let released = false
    return async () => {
      if (released) return
      await this.#operationTail.catch(() => undefined)
      if (this.#runOwner) throw new Error('Repair child run still owns device')
      if (this.#repairOwner !== owner) throw new Error('Repair device reservation changed')
      this.#repairOwner = null; this.#repairReadOnly = false; this.#screenEpoch += 1; released = true
    }
  }

  /** Recovery inspection can acquire the same mutex while control remains fenced. */
  reserveRepairInspection(owner: string): () => Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(owner)
      || this.#repairOwner || this.#runOwner || this.#runGroupOwner || this.#state.lifecycle !== 'streaming')
      throw new Error('Repair inspection lease is busy')
    this.#requireProvider()
    this.#repairOwner = owner; this.#repairReadOnly = true
    let released = false
    return async () => {
      if (released) return
      await this.#operationTail.catch(() => undefined)
      if (this.#repairOwner !== owner) throw new Error('Repair inspection lease changed')
      this.#repairOwner = null; this.#repairReadOnly = false; released = true
    }
  }

  repairMaintenanceAvailable(appId: string, platform: 'android' | 'ios'): boolean {
    const provider = this.#provider, context = provider?.appControlContext?.()
    return this.#state.lifecycle === 'streaming' && Boolean(provider?.installRepairArtifact
      && provider.rebuildRepairSession && provider.readRepairInstalledIdentity
      && context?.owned && context.targetAppId === appId
      && (context.platform === 'mock' || context.platform === platform))
  }

  /** The repair lease is the sole device owner. No direct ADB/Appium side channel is allowed here. */
  async installRepairArtifact(owner: string, request: ProviderRepairInstallRequest,
    signal?: AbortSignal): Promise<ProviderRepairInstallReceipt> {
    if (this.#repairOwner !== owner || this.#repairReadOnly || this.#runOwner || this.#state.control.phase !== 'idle'
      || this.#observationInProgress) throw new Error('Repair maintenance lease is busy')
    this.#assertRunControlCertain()
    const provider = this.#requireProvider(), context = provider.appControlContext?.()
    if (!provider.installRepairArtifact || !provider.rebuildRepairSession || !provider.readRepairInstalledIdentity
      || !context?.owned || context.targetAppId !== request.appId
      || (context.platform !== 'mock' && context.platform !== request.platform))
      throw new Error('Repair installation capability unavailable for this owned session')
    const sessionId = this.#state.sessionId, generation = this.#sessionGeneration
    if (!sessionId || signal?.aborted) throw new Error('Repair installation cancelled before dispatch')
    return this.#runExclusive(async () => {
      if (this.#repairOwner !== owner || this.#runOwner || this.#provider !== provider
        || this.#state.sessionId !== sessionId || this.#sessionGeneration !== generation || signal?.aborted)
        throw new Error('Repair session changed before installation')
      const dispatchedAt = new Date(this.#now()).toISOString()
      try {
        await provider.installRepairArtifact!(request, this.#withLifetime(signal))
        // Provider must explicitly rebuild its control session; merely clearing a screenshot is insufficient.
        const rebuilt = await provider.rebuildRepairSession!(this.#withLifetime(signal))
        if (this.#provider !== provider || this.#repairOwner !== owner || !rebuilt.sessionId
          || signal?.aborted) throw new Error('Repair session changed after installation')
        this.#sessionAbort.abort(screenError('screen_observation_session_mismatch'))
        this.#sessionAbort = new AbortController()
        this.#observations.clearGeneration(generation)
        this.#sessionGeneration += 1
        this.#inspectionGenerationToken = randomBytes(16).toString('base64url')
        this.#screenEpoch += 1
        this.#latestObservationRevision = 0
        this.#lastFrame = null
        this.#transition({ sessionId: rebuilt.sessionId, deviceName: rebuilt.deviceName, frameUpdatedAt: null })
        return { dispatchedAt, completedAt: new Date(this.#now()).toISOString(),
          sessionId: rebuilt.sessionId, provider: provider.kind }
      } catch (error) {
        this.#runControlUncertain = true
        this.#screenEpoch += 1
        this.#lastFrame = null
        throw error
      }
    })
  }

  /** Read-only recovery is allowed through an uncertainty fence; it never retries installation. */
  async readRepairInstalledIdentity(owner: string, appId: string, expected: {
    artifactDigest: string; buildMarker: string
  }): Promise<{ identity: ProviderRepairInstalledIdentity; state: 'verified' | 'mismatch' | 'unverified';
    sessionId: string; provider: ProviderKind }> {
    if (this.#repairOwner !== owner || this.#runOwner) throw new Error('Repair maintenance lease is busy')
    const provider = this.#requireProvider(), sessionId = this.#state.sessionId
    if (!provider.readRepairInstalledIdentity || !sessionId) throw new Error('Repair identity capability unavailable')
    return this.#runExclusive(async () => {
      if (this.#repairOwner !== owner || this.#provider !== provider || this.#state.sessionId !== sessionId)
        throw new Error('Repair session changed before identity read')
      const identity = await provider.readRepairInstalledIdentity!(appId, this.#withLifetime())
      if (this.#provider !== provider || this.#state.sessionId !== sessionId)
        throw new Error('Repair session changed during identity read')
      const state = identity.appId !== appId ? 'mismatch'
        : identity.evidence === 'package-digest' && identity.artifactDigest
          ? identity.artifactDigest === expected.artifactDigest ? 'verified' : 'mismatch'
          : identity.evidence === 'app-build-marker' && identity.buildMarker
            ? identity.buildMarker === expected.buildMarker ? 'verified' : 'mismatch'
            : 'unverified'
      return { identity, state, sessionId, provider: provider.kind }
    })
  }

  /** A Mock-only clean namespace for software fixtures; never attests physical device data. */
  async resetRepairFixture(owner: string): Promise<{ namespaceId: string; initialStateSha256: string; sessionId: string }> {
    if (this.#repairOwner !== owner || this.#repairReadOnly || this.#runOwner)
      throw new Error('Repair owner must exclusively hold an idle device')
    this.#assertRunControlCertain()
    const provider = this.#requireProvider(), sessionId = this.#state.sessionId
    if (provider.kind !== 'mock' || !provider.resetRepairFixture || !sessionId)
      throw new Error('Trusted repair reset is unavailable for this provider')
    return this.#runExclusive(async () => {
      if (this.#repairOwner !== owner || this.#runOwner || this.#provider !== provider || this.#state.sessionId !== sessionId)
        throw new Error('Repair session changed before reset')
      try {
        const receipt = await provider.resetRepairFixture!()
        if (this.#provider !== provider || this.#state.sessionId !== sessionId) throw new Error('Repair session changed during reset')
        this.#screenEpoch += 1
        this.#latestObservationRevision = 0
        this.#lastFrame = null
        return { ...receipt, sessionId }
      } catch (error) {
        this.#runControlUncertain = true
        this.#screenEpoch += 1
        throw error
      }
    })
  }

  /** An unrecorded reset or other uncertain repair side effect blocks later control until reconnect. */
  fenceRepairUnknown(owner: string): void {
    if (this.#repairOwner !== owner) throw new Error('Repair owner changed before uncertainty fence')
    this.#runControlUncertain = true
    this.#screenEpoch += 1
  }

  #assertRunControlCertain(): void {
    if (this.#runControlUncertain) throw new Error('Previous test action outcome is uncertain; disconnect and reconnect before more control')
  }

  #assertNoRun(): void {
    if (this.#runOwner || this.#runGroupOwner || this.#repairOwner)
      throw new Error('Device is reserved by a test run; cancel the run first')
  }

  acquireRun(runId: string, signal: AbortSignal, repairOwner?: string, runGroupOwner?: string): WorkbenchDevice {
    if (this.#runOwner || this.#repairReadOnly || (this.#runGroupOwner && this.#runGroupOwner !== runGroupOwner)
      || (runGroupOwner && this.#runGroupOwner !== runGroupOwner)
      || (this.#repairOwner && this.#repairOwner !== repairOwner)
      || (repairOwner && this.#repairOwner !== repairOwner)) throw new Error('Device is reserved by another owner')
    this.#assertRunControlCertain()
    const provider = this.#requireProvider()
    if (this.#state.control.phase !== 'idle' || this.#observationInProgress) throw new Error('Device is busy')
    const context = provider.appControlContext?.()
    if (provider.kind !== 'mock' && (!context?.owned || !['android', 'ios'].includes(context.platform))) {
      throw new Error('Tests require a workbench-owned Android or iOS session')
    }
    this.#runOwner = runId
    this.#screenEpoch += 1
    const generation = this.#sessionGeneration
    const sessionId = this.#state.sessionId!
    const platform = context?.platform === 'android' ? 'android' : 'ios'
    return new WorkbenchDevice(sessionId, platform, provider,
      <T>(operation: (operationSignal: AbortSignal) => Promise<T>): Promise<T> => this.#runExclusive(async () => {
        signal.throwIfAborted()
        if (this.#runOwner !== runId || this.#provider !== provider || generation !== this.#sessionGeneration) {
          throw new Error('Test session changed')
        }
        // Do not abort a dispatched action on user cancellation: drain it before
        // releasing the lease. The worker is terminated to stop future actions.
        const operationSignal = combineSignals(AbortSignal.any([this.#lifetimeAbort.signal, this.#sessionAbort.signal]), this.#config.startupTimeoutMs)
        return await operation(operationSignal)
      }),
      (uncertain = false) => { this.#screenEpoch += 1; this.#runControlUncertain ||= uncertain },
      async () => {
        await this.#operationTail.catch(() => undefined)
        if (this.#runOwner === runId) { this.#runOwner = null; this.#screenEpoch += 1 }
      },
      signal,
      generation,
      appId => { this.#authorizedAppTarget(provider, { operation: 'terminate', appId }) },
    )
  }

  async observe(request: ScreenObservationRequest, signal?: AbortSignal): Promise<ScreenObservation> {
    this.#assertNoRun()
    if (!request.image && !request.structure) throw screenError('screen_structure_unavailable')
    const provider = this.#requireProvider()
    this.#authorizeObservation(provider.kind, request)
    if (this.#observationInProgress) throw screenError('screen_observation_in_progress')

    this.#observationInProgress = true
    const generation = this.#sessionGeneration
    const epoch = this.#screenEpoch
    const sessionSignal = this.#sessionAbort.signal
    this.#setObservationProgress({
      phase: 'capturing',
      startedAt: new Date(this.#now()).toISOString(),
      lastErrorCode: null,
    })

    try {
      const observation = await this.#runExclusive(async () => {
        this.#assertNoRun()
        if (generation !== this.#sessionGeneration || provider !== this.#provider) {
          throw screenError('screen_observation_session_mismatch')
        }
        const capturedAt = new Date(this.#now()).toISOString()
        const operationSignal = combineSignals(AbortSignal.any([this.#lifetimeAbort.signal, sessionSignal, ...(signal ? [signal] : [])]), this.#config.startupTimeoutMs)
        const geometry = await provider.screenGeometry(operationSignal)
        const image = request.image ? await provider.snapshot(operationSignal) : undefined
        try {
          const source = request.structure ? await provider.screenSource(operationSignal, { resolveFocus: true }) : undefined
          const structure = source
            ? source.kind === 'normalized' ? source.structure : source.structure ?? normalizeScreenSource(source.xml, source.platform)
            : undefined
          const captureEndedAt = new Date(this.#now()).toISOString()

          if (generation !== this.#sessionGeneration || epoch !== this.#screenEpoch || provider !== this.#provider) {
            throw screenError('screen_observation_session_mismatch')
          }
          const nextFrameRevision = this.#frameRevision + 1
          const published = this.#observations.publish({
            sessionGeneration: generation,
            frameRevision: nextFrameRevision,
            screenEpoch: epoch,
            capturedAt,
            captureEndedAt,
            viewport: geometry.viewport,
            orientation: geometry.orientation,
            orientationSource: geometry.orientationSource,
            ...(image ? { image } : {}),
            ...(structure ? { structure } : {}),
          })
          this.#frameRevision = nextFrameRevision
          this.#latestObservationRevision = published.frameRevision
          return published
        } catch (error) {
          image?.bytes.fill(0)
          throw error
        }
      })
      this.#setObservationProgress({
        phase: 'idle',
        startedAt: null,
        lastCompletedAt: observation.captureEndedAt,
        lastErrorCode: null,
      })
      return observation
    } catch (error) {
      const mapped = this.#mapObservationFailure(error, request, generation)
      this.#setObservationProgress({ phase: 'idle', startedAt: null, lastErrorCode: mapped.code })
      throw mapped
    } finally {
      this.#observationInProgress = false
    }
  }

  queryScreen(raw: unknown, signal?: AbortSignal): ScreenQueryResult {
    signal?.throwIfAborted()
    const { observationId, ...spec } = parseScreenQuery(raw)
    if (this.#state.lifecycle !== 'streaming') throw screenError('screen_observation_session_mismatch')
    const provider = this.#requireProvider()
    this.#authorizeObservation(provider.kind, { image: false, structure: true })
    const observation = this.#observations.getForRead(observationId, this.#sessionGeneration)
    if (!observation.structure) throw screenError('screen_structure_unavailable')
    const validUntil = Math.min(Date.parse(observation.captureEndedAt) + ACTION_FRESHNESS_MS, Date.parse(observation.expiresAt))
    const status: ScreenQueryResult['actionBinding']['status'] = observation.screenEpoch !== this.#screenEpoch ? 'screen-changed' : observation.frameRevision !== this.#latestObservationRevision ? 'superseded' : this.#now() > validUntil ? 'action-expired' : 'current'
    try {
      const result = queryStructure({ nodes: observation.structure.nodes, viewport: observation.viewport }, spec, {
        observationId, frameRevision: observation.frameRevision, screenEpoch: observation.screenEpoch,
        capturedAt: observation.capturedAt, captureEndedAt: observation.captureEndedAt, expiresAt: observation.expiresAt,
        op: spec.op, actionBinding: { status, validUntil: new Date(validUntil).toISOString() }, source: structureSummary(observation.structure),
      })
      signal?.throwIfAborted()
      return result
    } catch (error) {
      if (error instanceof ScreenQueryError && error.code !== 'mobile_mirror_invalid_arguments') throw screenError(error.code)
      throw error
    }
  }

  viewerInspectionContext() {
    return this.#state.lifecycle === 'streaming' ? { generationToken: this.#inspectionGenerationToken, screenEpoch: this.#screenEpoch } : null
  }

  async captureViewerInspection(signal?: AbortSignal) {
    this.#assertNoRun()
    const provider = this.#requireProvider()
    if (this.#observationInProgress) throw screenError('screen_observation_in_progress')
    const operationSignal = combineSignals(AbortSignal.any([this.#lifetimeAbort.signal, this.#sessionAbort.signal, ...(signal ? [signal] : [])]), Math.min(this.#config.startupTimeoutMs, 10_000))
    operationSignal.throwIfAborted()
    const generation = this.#sessionGeneration, epoch = this.#screenEpoch, generationToken = this.#inspectionGenerationToken
    this.#observationInProgress = true
    try {
      return await withInspectionAbort(this.#runExclusive(async () => {
        operationSignal.throwIfAborted()
        this.#assertNoRun()
        if (generation !== this.#sessionGeneration || provider !== this.#provider) throw screenError('screen_observation_session_mismatch')
        const capturedAt = new Date(this.#now()).toISOString()
        const before = await provider.screenGeometry(operationSignal)
        const image = await provider.snapshot(operationSignal)
        try {
          const source = await provider.screenSource(operationSignal)
          const structure = source.kind === 'normalized' ? source.structure : normalizeScreenSource(source.xml, source.platform)
          const after = await provider.screenGeometry(operationSignal)
          operationSignal.throwIfAborted()
          if (generation !== this.#sessionGeneration || epoch !== this.#screenEpoch || provider !== this.#provider) throw screenError('screen_observation_session_mismatch')
          if (before.orientation !== after.orientation || ['x', 'y', 'width', 'height'].some(k => before.viewport[k as keyof typeof before.viewport] !== after.viewport[k as keyof typeof after.viewport])) throw screenError('viewer_inspection_geometry_changed')
          const captureEndedAt = new Date(this.#now()).toISOString()
          const controlContext = provider.appControlContext?.()
          const sourcePlatform = source.kind === 'xml' ? source.platform : 'unknown'
          const platform = provider.kind === 'mock' ? 'ios'
            : controlContext?.platform === 'android' || controlContext?.platform === 'ios' ? controlContext.platform
              : sourcePlatform
          return { inspectionId: randomBytes(16).toString('base64url'), generationToken, screenEpoch: epoch, capturedAt, captureEndedAt,
            platform, appId: controlContext?.targetAppId ?? null,
            expiresAt: new Date(this.#now() + 60_000).toISOString(), ...before, image, structure }
        } catch (error) { image.bytes.fill(0); throw error }
      }), operationSignal)
    } finally { this.#observationInProgress = false }
  }

  async action(action: MirrorAction, signal?: AbortSignal): Promise<MirrorState> {
    this.#assertNoRun()
    const provider = this.#requireProvider()
    const generation = this.#sessionGeneration
    const sessionSignal = this.#sessionAbort.signal
    return this.#runExclusive(async () => {
      this.#assertNoRun()
      this.#assertRunControlCertain()
      this.#setControlProgress({
        phase: 'acting',
        startedAt: new Date(this.#now()).toISOString(),
        lastErrorCode: null,
      })
      try {
        if (generation !== this.#sessionGeneration || provider !== this.#provider) {
          throw screenError('screen_observation_session_mismatch')
        }
        const operationSignal = combineSignals(AbortSignal.any([this.#lifetimeAbort.signal, sessionSignal, ...(signal ? [signal] : [])]), this.#config.startupTimeoutMs)
        if (action.kind === 'tap_node') {
          const { observation, node } = this.#semanticNode(action.observationId, action.nodeId, generation)
          if (node.visible !== true || node.enabled !== true || node.actionable !== true) throw screenError('screen_node_not_actionable')
          const point = nodeTapPoint(node.bounds, observation.viewport)
          await provider.action({ kind: 'tap', ...point }, operationSignal)
        } else if (action.kind === 'input_text') {
          this.#authorizeTextInput(provider.kind)
          validatePublicText(action.text, action.mode)
          const { observation, node } = this.#semanticNode(action.observationId, action.nodeId, generation)
          if (node.sensitive === true || isSensitivePlatformRole(node.platformRole)) throw screenError('screen_text_input_sensitive')
          if (node.focused !== true) throw screenError('screen_text_input_not_focused')
          if (node.role !== 'input' || node.visible !== true || node.enabled !== true) throw screenError('screen_node_not_actionable')
          const expectedBounds = requirePositiveVisibleBounds(node.bounds, observation.viewport)
          if (!provider.inputText) throw screenError('screen_text_input_unsupported')
          try {
            await provider.inputText({ mode: action.mode, text: action.text, expectedBounds }, operationSignal)
          } catch (error) {
            throw mapTextInputFailure(error)
          }
        } else {
          const safeAction = this.#validatedCoordinateAction(action, generation)
          await provider.action(safeAction, operationSignal)
        }
        this.#screenEpoch += 1
        this.#transition({ lastAction: describeAction(action), lastError: null, lastErrorCode: null })
        this.#completeControl()
        return this.state()
      } catch (error) {
        if (mayHaveMutated(error)) this.#screenEpoch += 1
        const lastError = fixedControlErrorMessage(error)
        const lastErrorCode = screenErrorCode(error) ?? appiumPublicErrorCode(error)
        this.#transition({ lastError, lastErrorCode })
        this.#completeControl(error)
        throw error
      }
    })
  }

  async manageApp(input: AppManagementInput, signal?: AbortSignal): Promise<AppManagementResult> {
    this.#assertNoRun()
    const provider = this.#requireProvider()
    const generation = this.#sessionGeneration
    const sessionSignal = this.#sessionAbort.signal
    return this.#runExclusive(async () => {
      this.#assertNoRun()
      this.#assertRunControlCertain()
      this.#setControlProgress({
        phase: 'managing-app',
        startedAt: new Date(this.#now()).toISOString(),
        lastErrorCode: null,
      })
      try {
        if (generation !== this.#sessionGeneration || provider !== this.#provider) {
          throw screenError('screen_observation_session_mismatch')
        }
        const authorized = this.#authorizedAppTarget(provider, input)
        if (!provider.manageApp) throw screenError('app_target_unavailable')
        const operationSignal = combineSignals(AbortSignal.any([this.#lifetimeAbort.signal, sessionSignal, ...(signal ? [signal] : [])]), this.#config.startupTimeoutMs)
        let providerResult
        try {
          providerResult = await provider.manageApp({ operation: input.operation, appId: authorized.appId }, operationSignal)
        } catch (error) {
          throw mapAppControlFailure(input.operation, error)
        }
        this.#screenEpoch += 1
        this.#transition({ lastAction: `manage_app(${input.operation})`, lastError: null, lastErrorCode: null })
        this.#completeControl()
        return {
          operation: input.operation,
          targetScope: authorized.scope,
          ...providerResult,
          screenEpoch: this.#screenEpoch,
        }
      } catch (error) {
        if (mayHaveMutated(error)) this.#screenEpoch += 1
        const lastError = fixedControlErrorMessage(error)
        const lastErrorCode = screenErrorCode(error) ?? appiumPublicErrorCode(error)
        this.#transition({ lastError, lastErrorCode })
        this.#completeControl(error)
        throw error
      }
    })
  }

  async frame(signal?: AbortSignal, timeoutMs = Math.min(this.#config.startupTimeoutMs, VIEWER_FRAME_TIMEOUT_MS)): Promise<MirrorFrame> {
    const provider = this.#provider
    if (!provider || this.#state.lifecycle !== 'streaming') {
      if (this.#lastFrame) return this.#lastFrame
      throw new Error('No active mirror session. Start one first.')
    }
    if (!this.#framePromise) {
      const generation = this.#sessionGeneration
      const operationSignal = combineSignals(
        AbortSignal.any([this.#withLifetime(signal), this.#sessionAbort.signal]),
        timeoutMs,
      )
      this.#framePromise = provider.frame(operationSignal)
        .then((frame) => {
          this.#lastFrame = frame
          if (generation === this.#sessionGeneration && provider === this.#provider && this.#state.lifecycle === 'streaming') {
            this.#transition({ frameUpdatedAt: new Date().toISOString(), lastError: null, lastErrorCode: null })
          }
          return frame
        })
        .catch((error) => {
          if (generation === this.#sessionGeneration && provider === this.#provider && this.#state.lifecycle === 'streaming') {
            this.#transition({
              lastError: appiumPublicErrorMessage(error) ?? errorMessage(error),
              lastErrorCode: appiumPublicErrorCode(error),
            })
          }
          if (this.#lastFrame) return this.#lastFrame
          throw error
        })
        .finally(() => {
          this.#framePromise = null
        })
    }
    return this.#framePromise
  }

  cachedFrame(): MirrorFrame | null {
    return this.#lastFrame
      ? { contentType: this.#lastFrame.contentType, bytes: Buffer.from(this.#lastFrame.bytes) }
      : null
  }

  subscribeMedia(): ViewerMediaSubscription {
    this.#requireProvider()
    return this.#media.subscribe()
  }

  async reportMediaClientFailure(generation: string, code: ViewerMediaClientFailureCode): Promise<boolean> {
    return await this.#media.reportClientFailure(generation, code)
  }

  async dispose(): Promise<void> {
    this.#lifetimeAbort.abort(new Error('Mirror service is closing'))
    this.#startAbort?.abort(new Error('Mirror service is closing'))
    const provider = this.#provider
    const managedRuntimeOwned = this.#state.provider === 'appium'
      && this.#appiumRuntime.state().mode === 'managed'
      && this.#appiumRuntime.state().owned
    const previousGeneration = this.#sessionGeneration
    this.#sessionGeneration += 1
    this.#inspectionGenerationToken = randomBytes(16).toString('base64url')
    this.#screenEpoch += 1
    this.#sessionAbort.abort(screenError('screen_observation_session_mismatch'))
    this.#observations.clearGeneration(previousGeneration)
    await this.#media.dispose().catch(() => undefined)
    await this.#operationTail.catch(() => undefined)
    let providerCleanupFailed = false
    let runtimeCleanupFailed = false
    await provider?.stop().catch(() => { providerCleanupFailed = true })
    await this.#appiumRuntime.stop().catch(() => { runtimeCleanupFailed = true })
    if (!runtimeCleanupFailed && (!providerCleanupFailed || managedRuntimeOwned)) {
      await this.#deviceLease?.release().catch(() => undefined)
      this.#deviceLease = null
    }
    this.#provider = null
    this.#observations.clear()
  }

  #createProvider(kind: ProviderKind): MirrorProvider {
    if (this.#providerFactory) return this.#providerFactory(kind)
    if (kind === 'appium') {
      return new AppiumProvider(
        this.#config.appiumUrl,
        iosWdaDefaultsFromConfig(this.#config),
        androidAppiumDefaultsFromConfig(this.#config),
        viewerMediaConfigFromConfig(this.#config),
        { adbPath: this.#config.adbPath },
      )
    }
    return new MockProvider(this.#config.mockStartupDelayMs)
  }

  #withLifetime(signal?: AbortSignal): AbortSignal {
    return signal ? AbortSignal.any([this.#lifetimeAbort.signal, signal]) : this.#lifetimeAbort.signal
  }

  #requireProvider(): MirrorProvider {
    if (!this.#provider || this.#state.lifecycle !== 'streaming') {
      throw new Error('No active mirror session. Start one first.')
    }
    return this.#provider
  }

  #authorizeObservation(kind: ProviderKind, request: ScreenObservationRequest): void {
    if (kind === 'mock') return
    if (this.#config.agentScreenContentPolicy === 'mock-only') throw screenError('screen_observation_disabled')
    if (request.image && this.#config.agentScreenContentPolicy !== 'image-and-structure') {
      throw screenError('screen_image_sharing_disabled')
    }
  }

  #validatedCoordinateAction(
    action: Exclude<MirrorAction, { kind: 'tap_node' } | { kind: 'input_text' }>,
    generation: number,
  ): Exclude<MirrorAction, { kind: 'tap_node' } | { kind: 'input_text' }> {
    if (action.coordinateSpace === 'snapshot' && !action.observationId) {
      throw screenError('screen_coordinate_space_invalid')
    }
    if (!action.observationId) return action

    const observation = this.#requireFreshObservation(action.observationId, generation)
    if (action.kind === 'back') return action

    const coordinateSpace = action.coordinateSpace ?? 'viewport'
    if (coordinateSpace === 'snapshot') {
      if (!observation.image) throw screenError('screen_coordinate_space_invalid')
      if (action.kind === 'tap') {
        return {
          kind: 'tap',
          x: mapSnapshotCoordinate(action.x, observation.image.width, observation.viewport.width),
          y: mapSnapshotCoordinate(action.y, observation.image.height, observation.viewport.height),
          observationId: action.observationId,
          coordinateSpace: 'viewport',
        }
      }
      return {
        kind: 'swipe',
        startX: mapSnapshotCoordinate(action.startX, observation.image.width, observation.viewport.width),
        startY: mapSnapshotCoordinate(action.startY, observation.image.height, observation.viewport.height),
        endX: mapSnapshotCoordinate(action.endX, observation.image.width, observation.viewport.width),
        endY: mapSnapshotCoordinate(action.endY, observation.image.height, observation.viewport.height),
        durationMs: action.durationMs,
        observationId: action.observationId,
        coordinateSpace: 'viewport',
      }
    }

    validateViewportAction(action, observation.viewport.width, observation.viewport.height)
    return action
  }

  #requireFreshObservation(observationId: string, generation: number): ScreenObservation {
    const observation = this.#observations.getForAction(observationId, generation)
    if (observation.frameRevision !== this.#latestObservationRevision || observation.screenEpoch !== this.#screenEpoch) {
      throw screenError('screen_observation_stale')
    }
    if (this.#now() - Date.parse(observation.captureEndedAt) > ACTION_FRESHNESS_MS) {
      throw screenError('screen_observation_expired')
    }
    return observation
  }

  #semanticNode(observationId: string, nodeId: string, generation: number): { observation: ScreenObservation; node: NonNullable<ScreenObservation['structure']>['nodes'][number] } {
    const observation = this.#requireFreshObservation(observationId, generation)
    const node = observation.structure?.nodes.find((candidate) => candidate.nodeId === nodeId)
    if (!node) throw screenError('screen_node_not_found')
    return { observation, node }
  }

  #authorizeTextInput(provider: ProviderKind): void {
    if (provider === 'mock') return
    if (this.#config.agentTextInputPolicy !== 'non-sensitive'
      || this.#config.agentScreenContentPolicy === 'mock-only') {
      throw screenError('screen_text_input_disabled')
    }
  }

  #authorizedAppTarget(provider: MirrorProvider, input: AppManagementInput): { appId: string; scope: AppManagementTargetScope } {
    if (this.#config.agentAppControlPolicy === 'disabled') throw screenError('app_control_disabled')
    const context = provider.appControlContext?.()
    if (!context) throw screenError('app_target_unavailable')
    if (!context.owned) throw screenError('app_control_attached_session_forbidden')
    if (context.platform === 'unknown') throw screenError('app_target_unavailable')

    if (this.#config.agentAppControlPolicy === 'session-app') {
      if (!context.targetAppId) throw screenError('app_target_unavailable')
      if (input.appId !== undefined && input.appId !== context.targetAppId) throw screenError('app_target_not_allowed')
      return { appId: context.targetAppId, scope: context.platform === 'mock' ? 'mock' : 'session-app' }
    }
    if (!input.appId || !this.#config.agentAllowedAppIds.includes(input.appId)) throw screenError('app_target_not_allowed')
    return { appId: input.appId, scope: context.platform === 'mock' ? 'mock' : 'allowlist' }
  }

  #mapObservationFailure(error: unknown, request: ScreenObservationRequest, generation: number): ScreenObservationError {
    if (generation !== this.#sessionGeneration || this.#sessionAbort.signal.aborted) {
      return screenError('screen_observation_session_mismatch')
    }
    if (error instanceof ScreenObservationError) return error
    return screenError(request.image ? 'screen_capture_failed' : 'screen_structure_unavailable', error)
  }

  #setObservationProgress(patch: Partial<MirrorState['observation']>): void {
    this.#transition({ observation: { ...this.#state.observation, ...patch } })
  }

  #setControlProgress(patch: Partial<MirrorState['control']>): void {
    this.#transition({ control: { ...this.#state.control, ...patch } })
  }

  #completeControl(error?: unknown): void {
    this.#setControlProgress({
      phase: 'idle',
      startedAt: null,
      lastCompletedAt: new Date(this.#now()).toISOString(),
      lastErrorCode: error ? screenErrorCode(error) ?? appiumPublicErrorCode(error) : null,
    })
  }

  #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#operationTail.catch(() => undefined).then(operation)
    this.#operationTail = run.then(() => undefined, () => undefined)
    return run
  }

  #transition(patch: Partial<MirrorState>): void {
    this.#state = { ...this.#state, ...patch, revision: this.#state.revision + 1 }
  }
}

function mapSnapshotCoordinate(value: number, imageSize: number, viewportSize: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(imageSize) || !Number.isFinite(viewportSize)
    || imageSize <= 0 || viewportSize <= 0 || value < 0 || value >= imageSize) {
    throw screenError('screen_coordinate_space_invalid')
  }
  const mapped = Math.floor(value * viewportSize / imageSize)
  if (!Number.isFinite(mapped) || mapped < 0 || mapped >= viewportSize) throw screenError('screen_coordinate_space_invalid')
  return mapped
}

function validateViewportAction(
  action: Extract<MirrorAction, { kind: 'tap' } | { kind: 'swipe' }>,
  width: number,
  height: number,
): void {
  const points = action.kind === 'tap'
    ? [[action.x, action.y]]
    : [[action.startX, action.startY], [action.endX, action.endY]]
  if (points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x! < 0 || y! < 0 || x! >= width || y! >= height)) {
    throw screenError('screen_coordinate_space_invalid')
  }
}

function describeAction(action: MirrorAction): string {
  if (action.kind === 'tap') return `tap(${action.x},${action.y})`
  if (action.kind === 'swipe') return `swipe(${action.startX},${action.startY} -> ${action.endX},${action.endY})`
  if (action.kind === 'tap_node') return 'tap_node'
  if (action.kind === 'input_text') return `input_text(${action.mode},${[...action.text].length} code points)`
  return 'back'
}

function mapTextInputFailure(error: unknown): ScreenObservationError {
  if (error instanceof ScreenObservationError) return error
  const mapped = screenError('screen_text_input_failed')
  return mayHaveMutated(error) ? markMayHaveMutated(mapped) : mapped
}

function mapAppControlFailure(operation: AppManagementInput['operation'], error: unknown): ScreenObservationError {
  if (error instanceof ScreenObservationError) return error
  const mapped = screenError(operation === 'activate' ? 'app_activate_failed' : 'app_terminate_failed')
  return mayHaveMutated(error) ? markMayHaveMutated(mapped) : mapped
}

function fixedControlErrorMessage(error: unknown): string {
  return error instanceof ScreenObservationError
    ? error.message
    : appiumPublicErrorMessage(error) ?? 'mobile_mirror_operation_failed: The control operation failed.'
}

function withInspectionAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
