import type { RunTiming, TimingPhase } from './workbench-timing.js'
import type { ReferencePublications } from './workbench-evidence-contracts.js'
import type { RecoveryAttempt } from './workbench-recovery.js'
import type { EvidenceLineage, RunProductContract, RunResultProjection } from './workbench-contracts.js'
import type { TemporalResult, TemporalStep } from './workbench-temporal.js'
import type { Measurement } from './workbench-runtime-contracts.js'
import type { SourceStepIdentity, TapFact } from './workbench-tap-facts.js'

export type Verdict = 'pass' | 'recovered' | 'fail' | 'cancelled' | 'inconclusive' | 'evidence-conflict' | 'evidence-contaminated'
export interface EvidenceFile { name: string; sha256: string; bytes: number; contentType: string; recovered?: boolean; incomplete?: boolean; lineage?: EvidenceLineage }
export interface ExtensionResult { ref: string; role: string; status: 'running'|'pass'|'fail'|'inconclusive'; startedAt: string; endedAt?: string; result?: unknown; error?: string }
export interface VideoRequest { captureId: string; sessionId: string; startedAt: string }
export interface RunVideo extends VideoRequest {
  owner: string; status: 'pending' | 'complete' | 'partial' | 'unavailable'
  durationMs?: number; reason?: string; file?: EvidenceFile
}
export interface DispatchRecord { operation: string; path: string; sessionId: string; sessionGeneration: number; startedAt: string; endedAt?: string; state: 'not-dispatched' | 'dispatched' | 'settled' | 'unknown' }
export interface RunStep {
  actionEvidence?: { version: 1; actions: RecordedVisualAction[]; after?: string }
  sourceStep?: SourceStepIdentity
  tapFact?: TapFact
  index: number; kind: string; path?: string; sourceLine?: number; target?: string; status: 'running' | 'passed' | 'failed'
  startedAt: string; endedAt?: string; message?: string; error?: string
  recoveredBy?: string
  evidence: EvidenceFile[]; captureStartedAt?: string; captureEndedAt?: string
  executionMs?: number; waitMs?: number; executorOtherMs?: number; checkpointError?: string
  captures?: { kind: 'png' | 'xml'; startedAt: string; endedAt: string }[]
  verification?: { status: 'pass' | 'fail' | 'evidence-conflict' | 'evidence-contaminated'; message: string; diagnostics?: unknown }
  visual?: { status: 'pass' | 'fail' | 'inconclusive'; message: string; profile: string; revision: number; rulesVersion: 1; referenceSha256: string; comparedPixels: number; differentPixels: number; ratio?: number }
  ocr?: { status: 'pass' | 'fail' | 'inconclusive'; reason: string; profileDigest: string; approvalDigest: string; sourceSha256: string; completedAt: string }
  temporal?: { config: TemporalStep; result: TemporalResult; report: string; blockers: unknown[] }
  business?: { status: 'pass' | 'fail' | 'inconclusive'; reason: string; ref: string; mode: 'once' | 'eventually'; samples: number; report: string }
  restart?: { operationId: string; status: 'pass' | 'inconclusive'; before: string; after?: string }
  comparison?: { stepKey: string; semanticDigest: string; ancestry: string[]; iteration?: number; occurrence: number }
}
export interface RecordedVisualAction {
  kind: 'tap' | 'swipe'; before?: string; capturedAt: string
  viewport: { x: number; y: number; width: number; height: number }
  image?: { width: number; height: number }
  points: { x: number; y: number }[]
  dispatch: 'not-dispatched' | 'settled' | 'unknown'; reason?: string
}
export interface RunDiagnostic {
  domain: 'business-assertion'|'ui-assertion'|'visual'|'device-driver'|'model-service'|'model-decision'|'policy'|'evidence'|'cleanup'|'cancelled'|'health'|'performance'|'unknown'
  code: string; phase: string; stepKey?: string; retryable: boolean; evidenceRefs: string[]; observedAt: string; message: string
}
export interface RunComparisonIdentity {
  contractVersion: 1; logicalTestKey: string; inputDigest: string; inputKeyId: string; planDigest: string
  executionContext: { platform: TestRun['platform']; provider: string; deviceName: string; os: string; runtime: string; viewport: string|'unknown' }
  appContext: { appId: string; version: string|'unknown'; build: string|'unknown' }
  implementationDigest: string|'unknown'
}
export interface TestRun {
  authoringOrigin?: { caseId: string; revisionId: string; inputDigest: string }
  referencePublications?: ReferencePublications
  schemaVersion: 1; id: string; parentRunId?: string; name: string; yaml: string; engine: string
  runtime?: { node: string; os: string; arch: string; workbenchVersion: string; workerSha256: string }
  phase: 'running' | 'cancelling' | 'finalizing' | 'finished'; verdict?: Verdict
  startedAt: string; endedAt?: string; sessionId: string; deviceName: string; platform: 'android' | 'ios' | 'unknown'; provider: string
  verificationScope: 'declared-ui-assertions'; visualVerification: 'not-performed' | 'pass' | 'fail' | 'inconclusive'; businessVerification: 'not-performed' | 'pass' | 'fail' | 'inconclusive'
  steps: RunStep[]; evidence: EvidenceFile[]; error?: string; cleanup: 'pending' | 'session-retained' | 'failed'
  timings?: RunTiming[]; activity?: { phase: TimingPhase; step?: number; startedAt: string }
  stage?: string
  extensionResults?: ExtensionResult[]
  resourceCleanup?: 'pending'|'pass'|'failed'
  suiteId?: string; flowId?: string; caseId?: string; attempt?: number
  params?: Record<string, unknown>
  video?: RunVideo
  recovery?: { at: string; reason: string }
  aiRecovery?: { attempts: RecoveryAttempt[] }
  dispatches?: DispatchRecord[]
  source?: 'viewer' | 'agent' | 'import'
  share?: { shareId: string; reportedVerdict: Verdict; verification: 'not-revalidated'; withheld: string[]; requiredFeatures?: import('./workbench-runtime-contracts.js').RuntimeFeature[] }
  repair?: { sourceRunId: string; baselineRunId: string; sourcePlanDigest: string; proposalDigest: string; sourceManifestSha256: string; baselineManifestSha256: string; sourceEvidenceSha256: string; baselineEvidenceSha256: string; before: string; after: string; confirmedAt: string }
  comparison?: RunComparisonIdentity
  diagnostics?: RunDiagnostic[]
  controlEvents?: { kind:'branch'|'loop'; path:string; result:string; observedAt:string }[]
  productContract?: RunProductContract
  measurements?: Measurement[]
  health?: import('./health-contracts.js').HealthReport
  /** Read-only response projection; never persisted into the original run manifest. */
  resultProjection?: RunResultProjection
}
