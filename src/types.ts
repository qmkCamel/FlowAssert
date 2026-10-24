export type ProviderKind = 'mock' | 'appium'

export type AppiumRuntimeMode = 'external' | 'managed'

export type AppiumRuntimePhase = 'idle' | 'starting' | 'ready' | 'stopping' | 'error'

export type AppiumRuntimeErrorCode =
  | 'managed_appium_config_invalid'
  | 'managed_appium_listener_conflict'
  | 'managed_appium_start_failed'
  | 'managed_appium_start_timeout'
  | 'managed_appium_exited'
  | 'managed_appium_stop_failed'

export interface AppiumRuntimeState {
  mode: AppiumRuntimeMode
  phase: AppiumRuntimePhase
  owned: boolean
  lastErrorCode: AppiumRuntimeErrorCode | null
}

export type AgentScreenContentPolicy = 'mock-only' | 'structure' | 'image-and-structure'

export type AgentTextInputPolicy = 'mock-only' | 'non-sensitive'

export type AgentAppControlPolicy = 'disabled' | 'session-app' | 'allowlist'

export type ScreenOrientation = 'portrait' | 'landscape' | 'unknown'

export type ScreenObservationPhase = 'idle' | 'capturing'

export type MirrorControlPhase = 'idle' | 'acting' | 'managing-app'

export type ScreenCoordinateSpace = 'viewport' | 'snapshot'

export type MirrorLifecycle = 'idle' | 'connecting' | 'streaming' | 'stopping' | 'error'

export type ViewerMediaMode = 'auto' | 'polling'

export type ViewerMediaPhase = 'idle' | 'ready' | 'starting' | 'live' | 'fallback'

export type ViewerMediaTransport = 'appium-screenshot' | 'scrcpy-h264' | 'wda-mjpeg'

export type ViewerMediaErrorCode =
  | 'viewer_media_unavailable'
  | 'viewer_media_scrcpy_missing'
  | 'viewer_media_scrcpy_version_unsupported'
  | 'viewer_media_port_unavailable'
  | 'viewer_media_protocol_invalid'
  | 'viewer_media_frame_too_large'
  | 'viewer_media_decoder_unsupported'
  | 'viewer_media_stream_ended'

export type ViewerMediaClientFailureCode = 'decoder-unsupported' | 'decoder-failed' | 'render-failed'

export interface ViewerMediaState {
  mode: ViewerMediaMode
  phase: ViewerMediaPhase
  transport: ViewerMediaTransport
  startedAt: string | null
  firstFrameAt: string | null
  lastFrameAt: string | null
  width: number | null
  height: number | null
  targetFps: number | null
  lastErrorCode: ViewerMediaErrorCode | null
}

export type ViewerMediaContext =
  | {
      kind: 'android-scrcpy'
      deviceId: string
      adbPath: string
    }
  | {
      kind: 'ios-wda-mjpeg'
      host: '127.0.0.1'
      port: number
      owned: boolean
    }

export type ViewerMediaPacketKind = 'metadata' | 'session' | 'config' | 'key' | 'delta' | 'jpeg'

export interface ViewerMediaPacket {
  kind: ViewerMediaPacketKind
  bytes: Uint8Array
  ptsUs?: bigint
  width?: number
  height?: number
  codec?: string
  receivedAt?: number
}

export interface ViewerMediaSource {
  readonly transport: Exclude<ViewerMediaTransport, 'appium-screenshot'>
  open(signal: AbortSignal): AsyncIterable<ViewerMediaPacket>
  close(): Promise<void>
}

export interface ViewerMediaSubscription {
  readonly generation: string
  readonly transport: Exclude<ViewerMediaTransport, 'appium-screenshot'>
  readonly contentType: string
  readonly packets: AsyncIterable<ViewerMediaPacket>
  close(): Promise<void>
}

export interface MirrorDevice {
  id: string
  name: string
  platform: 'android' | 'ios' | 'mock' | 'unknown'
  source: 'mock' | 'adb' | 'xctrace' | 'appium-session'
  state: string
}

export interface MirrorState {
  lifecycle: MirrorLifecycle
  provider: ProviderKind | null
  sessionId: string | null
  deviceName: string | null
  viewerUrl: string
  frameUpdatedAt: string | null
  lastAction: string | null
  lastError: string | null
  lastErrorCode: string | null
  observation: {
    phase: ScreenObservationPhase
    startedAt: string | null
    lastCompletedAt: string | null
    lastErrorCode: string | null
  }
  control: {
    phase: MirrorControlPhase
    startedAt: string | null
    lastCompletedAt: string | null
    lastErrorCode: string | null
  }
  media: ViewerMediaState
  appiumRuntime: AppiumRuntimeState
  revision: number
}

export interface StartMirrorInput {
  provider: ProviderKind
  capabilities?: Record<string, unknown>
  sessionId?: string
}

type CoordinateObservationBinding = {
  observationId?: string
  coordinateSpace?: ScreenCoordinateSpace
}

type SemanticObservationBinding = {
  observationId: string
  nodeId: string
}

export type TextInputMode = 'append' | 'replace'

export type MirrorAction =
  | (CoordinateObservationBinding & { kind: 'tap'; x: number; y: number })
  | (CoordinateObservationBinding & { kind: 'swipe'; startX: number; startY: number; endX: number; endY: number; durationMs: number })
  | (CoordinateObservationBinding & { kind: 'back' })
  | (SemanticObservationBinding & { kind: 'tap_node' })
  | (SemanticObservationBinding & { kind: 'input_text'; mode: TextInputMode; text: string })

export type AppManagementOperation = 'activate' | 'terminate'

export type MobileAppState = 'not-installed' | 'not-running' | 'background' | 'suspended' | 'foreground'

export type AppManagementTargetScope = 'session-app' | 'allowlist' | 'mock'

export type AppManagementOutcome = 'activated' | 'terminated' | 'already-foreground' | 'already-stopped'

export interface AppManagementInput {
  operation: AppManagementOperation
  appId?: string
}

export interface AppManagementResult {
  operation: AppManagementOperation
  targetScope: AppManagementTargetScope
  beforeState: MobileAppState
  afterState: MobileAppState
  outcome: AppManagementOutcome
  screenEpoch: number
}

export interface ProviderTextInputRequest {
  mode: TextInputMode
  text: string
  expectedBounds: ScreenRect
}

export interface ProviderAppControlContext {
  owned: boolean
  platform: 'android' | 'ios' | 'mock' | 'unknown'
  targetAppId: string | null
}

export interface ProviderAppManagementRequest {
  operation: AppManagementOperation
  appId: string
}

export interface ProviderAppManagementResult {
  beforeState: MobileAppState
  afterState: MobileAppState
  outcome: AppManagementOutcome
}

/** Repair-only maintenance. These capabilities are never exposed as general Agent app controls. */
export interface ProviderRepairInstallRequest {
  artifactPath: string
  artifactDigest: string
  appId: string
  buildMarker: string
  platform: 'android' | 'ios'
}
export interface ProviderRepairInstallReceipt {
  dispatchedAt: string
  completedAt: string
  sessionId: string
  provider: ProviderKind
}
export interface ProviderRepairInstalledIdentity {
  appId: string
  version?: string
  buildMarker?: string
  artifactDigest?: string
  evidence: 'package-digest' | 'app-build-marker' | 'version-only'
  observedAt: string
}

export interface ProviderSession {
  sessionId: string
  deviceName: string
}

export interface ProviderRunProvenance {
  appId?: string
  appVersion?: string
  appBuild?: string
  appBinarySha256?: string
  os?: string
  driver?: string
  viewport?: string
}

export interface MirrorFrame {
  bytes: Uint8Array
  contentType: 'image/png' | 'image/svg+xml'
}

export interface ScreenSize {
  width: number
  height: number
}

export interface ScreenRect extends ScreenSize {
  x: number
  y: number
}

export interface ScreenGeometry {
  viewport: ScreenRect
  orientation: ScreenOrientation
  orientationSource: 'provider' | 'inferred'
}

export interface ScreenNode {
  nodeId: string
  parentId?: string
  role: 'application' | 'button' | 'checkbox' | 'image' | 'input' | 'link' | 'list' | 'list-item' | 'scroll-view' | 'switch' | 'text' | 'unknown'
  platformRole?: string
  identifier?: string
  name?: string
  text?: string
  value?: string
  sensitive?: boolean
  bounds?: ScreenRect
  visible?: boolean
  enabled?: boolean
  actionable?: boolean
  focused?: boolean
  selected?: boolean
  checked?: boolean
}

export interface ScreenStructure {
  nodes: ScreenNode[]
  truncated: boolean
  truncatedReason?: 'depth-limit' | 'node-limit' | 'field-limit' | 'json-limit'
}

export type ProviderScreenSource =
  | { kind: 'xml'; platform: 'android' | 'ios' | 'unknown'; xml: string; structure?: ScreenStructure }
  | { kind: 'normalized'; structure: ScreenStructure }

export interface ScreenObservationRequest {
  image: boolean
  structure: boolean
}

export interface ScreenObservationImage {
  bytes: Uint8Array
  contentType: 'image/png'
  width: number
  height: number
}

export interface ScreenObservation {
  observationId: string
  sessionGeneration: number
  frameRevision: number
  screenEpoch: number
  capturedAt: string
  captureEndedAt: string
  expiresAt: string
  viewport: ScreenRect
  orientation: ScreenOrientation
  orientationSource: 'provider' | 'inferred'
  image?: ScreenObservationImage
  structure?: ScreenStructure
}

export interface ScreenObservationSummary {
  observationId: string
  frameRevision: number
  screenEpoch: number
  capturedAt: string
  captureEndedAt: string
  expiresAt: string
  viewport: ScreenRect
  orientation: ScreenOrientation
  orientationSource: 'provider' | 'inferred'
  image?: {
    contentType: 'image/png'
    width: number
    height: number
    byteLength: number
    delivery: 'core-memory' | 'deferred-context' | 'mcp-image-content'
  }
  structure?: ScreenStructure
}

export interface MirrorProvider {
  readonly kind: ProviderKind
  start(input: StartMirrorInput, signal: AbortSignal): Promise<ProviderSession>
  stop(signal?: AbortSignal): Promise<void>
  frame(signal?: AbortSignal): Promise<MirrorFrame>
  snapshot(signal?: AbortSignal): Promise<ScreenObservationImage>
  screenGeometry(signal?: AbortSignal): Promise<ScreenGeometry>
  screenSource(signal?: AbortSignal, options?: { resolveFocus?: boolean }): Promise<ProviderScreenSource>
  action(action: MirrorAction, signal?: AbortSignal): Promise<void>
  inputText?(request: ProviderTextInputRequest, signal?: AbortSignal): Promise<void>
  appControlContext?(): ProviderAppControlContext | null
  runProvenance?(): ProviderRunProvenance | null
  manageApp?(request: ProviderAppManagementRequest, signal?: AbortSignal): Promise<ProviderAppManagementResult>
  queryAppState?(appId: string, signal?: AbortSignal): Promise<MobileAppState>
  healthCapability?(): import('./health-contracts.js').HealthCapability
  startHealth?(binding: import('./health-contracts.js').HealthBinding, signals: import('./health-contracts.js').HealthSignal[], signal: AbortSignal): Promise<import('./health-contracts.js').HealthCollector>
  /** Local fixture-only reset. A real provider must supply a separately reviewed reset contract. */
  resetRepairFixture?(): Promise<{ namespaceId: string; initialStateSha256: string }>
  installRepairArtifact?(request: ProviderRepairInstallRequest, signal?: AbortSignal): Promise<void>
  rebuildRepairSession?(signal?: AbortSignal): Promise<ProviderSession>
  readRepairInstalledIdentity?(appId: string, signal?: AbortSignal): Promise<ProviderRepairInstalledIdentity>
  mediaContext?(): ViewerMediaContext | null
  mediaContextError?(): ViewerMediaErrorCode | null
}

export type { ScreenQuerySpec, ScreenQueryInput, ScreenQueryNode, ScreenQueryPage, ScreenQueryResult } from './screen-query.js'
