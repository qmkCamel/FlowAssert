import { safeReportSummary, type ReportSummary } from './workbench-report-presentation.js'
import { syncBuiltinReferences } from './workbench-builtin-references.js'
import { loadTestProject, ocrProjectDigest, type ProjectSnapshot } from './workbench-project.js'
import { closeInOrder } from './lifecycle.js'
import { compilePlan, bind, nativeYaml, type ExecutionPlan, type PlanNode, type Condition } from './workbench-plan.js'
import { WorkbenchVideoArchive, parseVideoRequest, type VideoRequest } from './workbench-video.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PACKAGE_VERSION } from './version.js'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import { parseIOSPageSource } from './workbench-engine-adapter.js'
import { parseAndroidPageSource } from './workbench-engine-adapter.js'
import { resolveElementSelector, parseElementSelector } from './workbench-engine-adapter.js'
import type { RunYamlFlowResult } from './workbench-engine-adapter.js'
import type { MirrorService } from './mirror-service.js'
import { TargetFailure, type WorkbenchDevice } from './workbench-device.js'
import { boundedProposal, planRecovery, RecoveryRejected, RecoveryProtocolError, type RecoveryPlanner, type RecoveryAttempt } from './workbench-recovery.js'
import { WORKBENCH_WORKER_URL, parseWorkbenchFlow, WORKBENCH_ENGINE, type WorkbenchFlow } from './workbench-flow.js'
import { WorkbenchStore, sha256, validRunId } from './workbench-store.js'
import type { TestRun } from './workbench-domain.js'
import { ComparisonIdentityService } from './workbench-comparison.js'
import { timed, type TimingObserver } from './workbench-timing.js'
import { assertRequiredProvenance, createRunProvenance, createRunVerification, enableRuntimeContract, markEvidenceVerificationFailure, runResultProjection } from './workbench-contracts.js'
import { executeRuntimeStep } from './workbench-runtime-execution.js'
import { executeMeasurement } from './workbench-measurement.js'
import { evaluateHealthWindow, healthBindingDigest, persistHealthJournal, persistHealthWindow, type HealthBinding, type HealthCollector } from './workbench-health.js'
import { setTimeout as sleep } from 'node:timers/promises'
import type { RepairProposal } from './workbench-repair.js'
import { compareVisual } from './workbench-visual.js'
import { WorkbenchBaselines } from './workbench-baselines.js'
import { aggregateRunVerdict, containsVisual, requireTerminalStepEvidence, verifyRunEvidence } from './workbench-run-finalization.js'
import { recordStepEvidence, type StepEvent } from './workbench-step-evidence.js'
import { executeRecordedTap, recordedTapIndices, sliceNativeBlock } from './workbench-recorded-tap.js'
import { LocalTapFailure, type SourceStepIdentity } from './workbench-tap-facts.js'
import { createRunHooks } from './workbench-run-hooks.js'
import { executeNativeBlock, FlowAssertionFailure } from './workbench-native-execution.js'
import { parseReadyStep, ReadinessFailure } from './workbench-readiness.js'
import { WorkbenchOcr } from './workbench-ocr.js'
import { doctorOcr } from './workbench-ocr-helper.js'
import { ocrHash, type OcrIdentity } from './workbench-ocr-contracts.js'
import { requireOcrApproval } from './workbench-ocr-approval.js'
import { persistOcrEvidence } from './workbench-ocr-evidence.js'
import { isWebRun, webCaseSchema, type WebTestRun, type WorkbenchRun } from './workbench-web-contracts.js'
import { executeWebRun } from './workbench-web-runtime.js'

export interface OcrRuntime { preview: WorkbenchOcr['preview']; identity(): Promise<OcrIdentity>; close(): Promise<void> }
function ocrNodes(nodes: PlanNode[]): Extract<PlanNode, { kind: 'ocr' }>[] {
  return nodes.flatMap(node => node.kind === 'ocr' ? [node] : node.kind === 'if' ? [...ocrNodes(node.then), ...ocrNodes(node.else)] : node.kind === 'repeat' || node.kind === 'measure' ? ocrNodes(node.steps) : [])
}
function runtimeNodes(nodes: PlanNode[]): PlanNode[] {
  return nodes.flatMap(node => [node, ...(node.kind === 'if' ? [...runtimeNodes(node.then), ...runtimeNodes(node.else)] : node.kind === 'repeat' || node.kind === 'measure' ? runtimeNodes(node.steps) : [])])
}

interface ActiveRun { run: TestRun; abort: AbortController; worker: Worker | null; done: Promise<void> }
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export class WorkbenchService {
  readonly store: WorkbenchStore
  readonly videos: WorkbenchVideoArchive
  readonly baselines: WorkbenchBaselines
  readonly ocr: OcrRuntime
  #active: ActiveRun | null = null
  #webActive: { run: WebTestRun; abort: AbortController; done: Promise<void> } | null = null
  readonly webEnabled: boolean
  #starting = false
  #startIdle: Promise<void> = Promise.resolve()
  #closed = false
  #closePromise: Promise<void> | undefined
  #unsavedRun: TestRun | null = null
  readonly projectPath: string | undefined
  suiteOwner: string | null = null
  #releaseSuiteDeviceGroup: (() => void) | null = null
  readonly #createWorker: (url: URL, options: WorkerOptions) => Worker
  readonly #planner: RecoveryPlanner
  readonly #comparisonIdentity: ComparisonIdentityService
  constructor(readonly mirror: MirrorService, options: { root?: string; store?: WorkbenchStore; projectPath?: string; planner?: RecoveryPlanner; ocrCache?: string; ocr?: OcrRuntime; createWorker?: (url: URL, options: WorkerOptions) => Worker; webTests?: boolean } = {}) {
    this.webEnabled = process.env.MOBILE_MIRROR_WEB_CHILD !== '1' && (options.webTests ?? process.env.MOBILE_MIRROR_WEB_TESTS === '1')
    const root = options.root ?? process.env.MOBILE_MIRROR_RUNS_DIR ?? join(homedir(), '.local', 'share', 'mobile-mirror', 'runs')
    if (!isAbsolute(root)) throw new Error('MOBILE_MIRROR_RUNS_DIR must be absolute')
    this.projectPath = options.projectPath ?? process.env.MOBILE_MIRROR_TEST_PROJECT
    this.store = options.store ?? new WorkbenchStore(root)
    const cache = options.ocrCache ?? process.env.MOBILE_MIRROR_OCR_CACHE ?? join(root, '.ocr-helper')
    const recognizer = new WorkbenchOcr(cache)
    this.ocr = options.ocr ?? { preview: recognizer.preview.bind(recognizer), identity: async () => (await doctorOcr(cache, AbortSignal.timeout(10_000))).identity, close: () => recognizer.close() }
    this.baselines = new WorkbenchBaselines(this.store, this.projectPath)
    this.#comparisonIdentity = new ComparisonIdentityService(this.store.root)
    this.videos = new WorkbenchVideoArchive(this.store)
    this.#createWorker = options.createWorker ?? ((url, options) => new Worker(url, options))
    this.#planner = options.planner ?? planRecovery
  }
  reserveSuite(id:string): void {
    if(this.#starting||this.#active||this.#webActive||this.suiteOwner||this.#closed)throw new Error('A test is already running')
    this.#releaseSuiteDeviceGroup=this.mirror.reserveRunGroup(id);this.suiteOwner=id
  }
  releaseSuite(id:string): void {
    if(this.suiteOwner!==id)throw new Error('Suite owner changed')
    this.#releaseSuiteDeviceGroup?.();this.#releaseSuiteDeviceGroup=null;this.suiteOwner=null
  }
  get activeId(): string | null { return this.#active?.run.id ?? this.#webActive?.run.id ?? null }
  async records(): Promise<WorkbenchRun[]> {
    // Preserve native active/unsaved projections while adding typed Web history.
    const native = await this.list()
    const web = (await this.store.listRecords()).filter(isWebRun)
    return [...native, ...web].sort((a,b)=>b.startedAt.localeCompare(a.startedAt))
  }
  async record(id: string): Promise<WorkbenchRun> {
    await this.store.init(); const run = await this.store.getRecord(id)
    if (!isWebRun(run)) return this.get(id)
    if (run.phase === 'finished') try { for (const file of [...run.evidence, ...run.steps.flatMap(step => step.evidence)]) await this.store.readEvidence(id, file) }
    catch (error) { run.verdict = 'inconclusive'; run.error = `Web evidence unavailable: ${String(error)}` }
    return run
  }
  async startWeb(value: unknown, origin: WebTestRun['authoringOrigin'], requestId: string, aOrigin: string, parentRunId?: string): Promise<WebTestRun> {
    if (!this.webEnabled) throw new Error('Web tests disabled. Explicitly enable MOBILE_MIRROR_WEB_TESTS=1; native flows are unaffected.')
    const input = webCaseSchema.parse(value)
    if (this.#closed || this.#starting) throw new Error('Workbench busy or closed')
    this.#starting = true
    let finishStart!: () => void; this.#startIdle = new Promise<void>(done => { finishStart = done })
    try {
      await this.store.init()
      const prior = (await this.store.listRecords()).find((run): run is WebTestRun => isWebRun(run) && run.requestId === requestId)
      if (prior) { if (prior.authoringOrigin.inputDigest !== origin.inputDigest || prior.parentRunId !== parentRunId) throw new Error('Web request conflict'); return prior }
      if (this.#active || this.#webActive || this.suiteOwner) throw new Error('A test is already running')
      if (parentRunId) { const parent = await this.store.getRecord(parentRunId); if (!isWebRun(parent) || parent.authoringOrigin.caseId !== origin.caseId || parent.phase !== 'finished') throw new Error('Invalid Web retry parent') }
      const run: WebTestRun = { schemaVersion: 1, executionKind: 'web', id: randomUUID(), requestId, name: input.name, platform: 'web', engine: 'agent-browser', source: 'viewer', phase: 'running', startedAt: new Date().toISOString(), steps: [], evidence: [], input, authoringOrigin: origin,
        visualReview: { status: 'needs-review' }, independentCheck: 'pending', baseline: 'not-compared', cleanup: 'pending',
        resources: { owner: this.store.ownerGeneration, aPid: process.pid, aRoot: this.store.root, sessions: [] }, ...(parentRunId ? { parentRunId } : {}) }
      const release = await this.store.reserveEvidence(`web:${run.id}`, 128 * 1024 * 1024)
      try { await this.store.saveRecord(run) } catch (error) { release(); throw error }
      const active = { run, abort: new AbortController(), done: Promise.resolve() }; this.#webActive = active
      active.done = (async () => {
        const budget = setTimeout(() => active.abort.abort(new Error('Web suite budget exceeded')), 20 * 60 * 1000)
        try { await executeWebRun(this.store, run, active.abort.signal, aOrigin) }
        catch (error) { run.error = message(error) }
        finally {
          clearTimeout(budget); run.phase = 'finished'; run.endedAt = new Date().toISOString()
          run.verdict = active.abort.signal.aborted ? (active.abort.signal.reason?.message === 'Cancelled by user' ? 'cancelled' : 'inconclusive')
            : run.steps.some(step => step.checks.some(check => !check.pass)) ? 'fail' : 'inconclusive'
          try { await this.store.saveRecord(run) } finally { release(); if (this.#webActive === active) this.#webActive = null }
        }
      })()
      // Errors cannot create an unhandled rejection; the persisted non-terminal record recovers conservatively.
      void active.done.catch(() => {})
      return structuredClone(run)
    } finally { this.#starting = false; finishStart() }
  }
  async list(): Promise<TestRun[]> {
    await this.store.init()
    const runs = await this.store.list()
    if (this.#unsavedRun) {
      const index = runs.findIndex((r) => r.id === this.#unsavedRun!.id)
      if (index >= 0) runs[index] = structuredClone(this.#unsavedRun)
      else runs.unshift(structuredClone(this.#unsavedRun))
    }
    if (this.#active) {
      const index = runs.findIndex((r) => r.id === this.#active!.run.id)
      if (index >= 0) runs[index] = structuredClone(this.#active.run)
    }
    return runs
  }
  async reportSummaries(): Promise<ReportSummary[]> {
    await this.store.init()
    const summaries = await this.store.listReportSummaries(10_000)
    for (const run of [this.#unsavedRun, this.#active?.run]) {
      if (!run) continue
      const index = summaries.findIndex(item => item.id === run.id), summary = safeReportSummary(run)
      if (index >= 0) summaries[index] = summary
      else summaries.unshift(summary)
    }
    return summaries
  }
  /** alreadyLeased is for owner-internal callers holding this run's read lease and mutation gate. */
  async get(id: string, options: { alreadyLeased?: boolean } = {}): Promise<TestRun> {
    await this.store.init()
    const run = this.#active?.run.id === id ? structuredClone(this.#active.run)
      : this.#unsavedRun?.id === id ? structuredClone(this.#unsavedRun) : await this.store.get(id)
    let evidenceAvailability: 'verified' | 'unavailable' | 'not-checked' = 'not-checked'
    let integrityError: string | undefined
    if (run.phase === 'finished') {
      let release: (() => void) | undefined
      try {
        if (options.alreadyLeased) { if (!this.store.hasReadLease(run.id)) throw new Error('runtime-read-lease-missing') }
        else release = await this.store.lease([run.id])
        await verifyRunEvidence(this.store, run); evidenceAvailability = 'verified'
      }
      catch (error) { evidenceAvailability = 'unavailable'; integrityError = message(error) }
      finally { release?.() }
    }
    const resultProjection = runResultProjection(run, evidenceAvailability)
    if (integrityError) { run.verdict = resultProjection.verdict ?? 'inconclusive'; run.error = integrityError; markEvidenceVerificationFailure(run) }
    if (run.video) run.video = (await this.videos.view(run))!
    return Object.assign(run, { resultProjection })
  }
  async status(id: string): Promise<TestRun> {
    await this.store.init()
    const run = this.#active?.run.id === id ? structuredClone(this.#active.run)
      : this.#unsavedRun?.id === id ? structuredClone(this.#unsavedRun) : await this.store.get(id)
    return Object.assign(run, { resultProjection: runResultProjection(run) })
  }
  async start(yaml: string, parentRunId?: string, videoRequest?: VideoRequest, options: { id?: string; source?: 'viewer'|'agent'; executeGate?: Promise<void>; params?: Record<string,unknown>; project?: ProjectSnapshot; plan?: ExecutionPlan; suiteId?: string; flowId?: string; caseId?: string; attempt?: number; comparisonKey?: string; repair?: RepairProposal; repairOwner?: string; authoringOrigin?: TestRun['authoringOrigin']; expectedTarget?: { sessionId: string; generationToken: string } } = {}): Promise<TestRun> {
    if (this.suiteOwner && options.suiteId !== this.suiteOwner) throw new Error('A suite is already running')
    if (this.#closed) throw new Error('Workbench is closed')
    if (this.#starting || this.#active || this.#webActive) throw new Error('A test is already running')
    this.#starting = true
    let finishStart!: () => void
    this.#startIdle = new Promise<void>((resolve) => { finishStart = resolve })
    let device: WorkbenchDevice | undefined
    let candidate: TestRun | null = null
    let releaseParentLease: (() => void) | undefined
    let releaseEvidenceReservation: (() => void) | undefined
    try {
      await this.store.init()
      if (parentRunId) releaseParentLease = await this.store.lease([parentRunId])
      const project = structuredClone(options.project ?? await this.baselines.applyApproved(await loadTestProject(this.projectPath)))
      const plan = options.plan ? { ...options.plan, project } : await compilePlan(yaml, project, options.params)
      const visualRequired = containsVisual(plan.nodes)
      const flow: WorkbenchFlow = { yaml, parsed: { meta: {name:plan.header.name,platform:plan.header.platform,appId:plan.header.appId}, phases: [], steps: [] }, blockers: [], inputModes: {} }
      const workerSha256 = sha256(await readFile(WORKBENCH_WORKER_URL))
      if (parentRunId) await this.store.get(parentRunId)
      if (options.repair) {
        const repair = options.repair
        if (parentRunId !== repair.sourceRunId || yaml !== repair.yaml
          || (await this.store.readOnlySnapshot(repair.sourceRunId)).manifestSha256 !== repair.sourceManifestSha256
          || (await this.store.readOnlySnapshot(repair.baselineRunId)).manifestSha256 !== repair.baselineManifestSha256) throw new Error('Repair proposal became stale before execution')
      }
      if (this.#closed) throw new Error('Workbench is closed')
      const id = options.id ?? randomUUID()
      validRunId(id)
      releaseEvidenceReservation = await this.store.reserveEvidence(`run:${id}`, (plan.header.runtimeGates?.health ? 82 : 64) * 1024 * 1024)
      const startedAt = new Date().toISOString()
      const observedProvenance = this.mirror.runProvenance()
      const provenance = createRunProvenance({
        capturedAt: startedAt,
        appId: plan.header.appId,
        platform: plan.header.platform,
        runtime: PACKAGE_VERSION,
        observed: observedProvenance,
        declared: project.provenance,
      })
      assertRequiredProvenance(provenance, project.provenance.required)
      const textNodes = ocrNodes(plan.nodes)
      if (textNodes.length) {
        const identity = await this.ocr.identity()
        for (const node of textNodes) {
          const registered = requireOcrApproval(project.ocrProfiles?.[node.profile], ocrProjectDigest(project), identity)
          if (!registered.profile.builds.includes(provenance.app.build.value)) throw new Error('ocr-build-outside-approved-scope')
        }
        if (this.#closed) throw new Error('Workbench is closed')
      }
      const abort = new AbortController()
      if (options.expectedTarget && (this.mirror.state().sessionId !== options.expectedTarget.sessionId
        || this.mirror.viewerInspectionContext()?.generationToken !== options.expectedTarget.generationToken)) throw new Error('authoring-target-changed')
      device = this.mirror.acquireRun(id, abort.signal, options.repairOwner, options.suiteId)
      if (device.platform !== flow.parsed.meta.platform) throw new Error('YAML platform does not match the connected device')
      for (const node of runtimeNodes(plan.nodes)) if (node.kind === 'restart') device.assertRestartSupported(node.header.appId)
      if (plan.header.runtimeGates?.health) device.assertHealthSupported(plan.header.runtimeGates.health.signals)
      const state = this.mirror.state()
      const video = videoRequest ? parseVideoRequest(videoRequest, device.sessionId) : undefined
      const run: TestRun = {
        ...(video ? { video: { ...video, owner: this.videos.owner, status: 'pending' as const } } : {}),
        schemaVersion: 1, id, source: options.source ?? 'viewer', params: plan.params, ...(options.authoringOrigin ? { authoringOrigin: options.authoringOrigin } : {}), ...(options.flowId ? {flowId:options.flowId}:{}), ...(options.suiteId ? {suiteId:options.suiteId,caseId:options.caseId,attempt:options.attempt}:{}), ...(parentRunId ? { parentRunId } : {}),
        ...(options.repair ? { repair: { sourceRunId: options.repair.sourceRunId, baselineRunId: options.repair.baselineRunId, sourcePlanDigest: options.repair.sourcePlanDigest, proposalDigest: options.repair.digest,
          sourceManifestSha256: options.repair.sourceManifestSha256, baselineManifestSha256: options.repair.baselineManifestSha256, sourceEvidenceSha256: options.repair.failureEvidence.sha256, baselineEvidenceSha256: options.repair.baselineEvidence.sha256,
          before: `${options.repair.before.key}:${options.repair.before.value}`, after: `${options.repair.after.key}:${options.repair.after.value}`, confirmedAt: startedAt } } : {}),
        name: flow.parsed.meta.name!, yaml,
        runtime: { node: process.version, os: process.platform, arch: process.arch, workbenchVersion: PACKAGE_VERSION, workerSha256 },
        engine: WORKBENCH_ENGINE, phase: 'running', startedAt,
        sessionId: device.sessionId, deviceName: state.deviceName ?? 'Unknown', platform: device.platform,
        provider: state.provider ?? 'unknown', verificationScope: 'declared-ui-assertions',
        visualVerification: 'not-performed', businessVerification: 'not-performed', steps: [], evidence: [], cleanup: 'pending',
        diagnostics: [], controlEvents: [],
        productContract: { contractVersion: 1, summaryRulesVersion: 1, provenance, verification: createRunVerification(plan.header.verify.length > 0) },
      }
      run.productContract!.verification.visual.required = visualRequired
      if (plan.requiredFeatures?.length) enableRuntimeContract(run, plan.requiredFeatures, !!plan.header.runtimeGates?.health, plan.requiredFeatures.includes('e2e-measure-v1'))
      if (plan.requiredFeatures?.includes('step-business-v1')) run.productContract!.verification.business.required = true
      run.comparison = await this.#comparisonIdentity.create(plan, run, provenance, options.comparisonKey)
      candidate = run
      if (parentRunId) await this.store.withMutationGate(() => syncBuiltinReferences(this.store, 'workbench:child', run.id, undefined, [parentRunId], async publications => {
        const published = { ...run, referencePublications: publications }
        await this.store.save(published); run.referencePublications = publications
      }))
      else await this.store.save(run)
      run.evidence.push(await this.store.put(id, 'flow.yaml', yaml, 'text/yaml; charset=utf-8'))
      run.evidence.push(await this.store.put(id, 'plan.json', JSON.stringify({yaml,project,params:plan.params}), 'application/json'))
      await this.store.save(run)
      if (this.#closed) throw new Error('Workbench closed during run setup')
      const active: ActiveRun = { run, abort, worker: null, done: Promise.resolve() }
      this.#active = active
      const releaseReservation = releaseEvidenceReservation
      releaseEvidenceReservation = undefined
      active.done = (options.executeGate ?? Promise.resolve()).then(() => this.#execute(active, device!, flow, plan)).finally(() => {
        releaseReservation?.()
        if (this.#active === active) this.#active = null
      })
      return structuredClone(run)
    } catch (error) {
      await device?.release()
      if (candidate) {
        candidate.phase = 'finished'; candidate.verdict = 'inconclusive'; candidate.error = message(error)
        candidate.endedAt = new Date().toISOString(); candidate.cleanup = 'session-retained'
        try { await this.store.save(candidate) } catch { this.#unsavedRun = candidate }
      }
      throw error
    } finally { releaseEvidenceReservation?.(); releaseParentLease?.(); this.#starting = false; finishStart() }
  }
  async replay(id:string):Promise<TestRun> {
    const release=await this.store.lease([id])
    try {
    const previous=await this.get(id)
    const file=previous.evidence.find(e=>e.name==='plan.json')
    if(!file)throw new Error('Run has no executable snapshot')
    const snapshot=JSON.parse((await this.store.readEvidence(id,file)).toString()) as {yaml:string;project:ProjectSnapshot;params:Record<string,unknown>}
    return await this.start(snapshot.yaml,id,undefined,{project:snapshot.project,params:snapshot.params})
    } finally { release() }
  }
  async cancelRecord(id: string): Promise<WorkbenchRun> {
    if (this.#webActive?.run.id !== id) return this.cancel(id)
    const active = this.#webActive; active.run.phase = 'cancelling'; active.abort.abort(new Error('Cancelled by user'))
    await this.store.saveRecord(active.run); return structuredClone(active.run)
  }
  async cancel(id: string): Promise<TestRun> {
    const active = this.#active
    if (!active || active.run.id !== id) throw new Error('Run is not active')
    active.run.phase = 'cancelling'
    active.abort.abort(new Error('Cancelled by user'))
    return structuredClone(active.run)
  }
  async wait(): Promise<void> { await Promise.all([this.#active?.done, this.#webActive?.done]) }
  stopAccepting(): void { this.#closed = true }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    return this.#closePromise = closeInOrder([
      async () => { await this.#startIdle; if (this.#webActive) { this.#webActive.abort.abort(new Error('Workbench shutting down')); await this.#webActive.done }; if (this.#active) { this.#active.abort.abort(new Error('Workbench shutting down')); await this.#active.done } },
      () => this.videos.close(),
      () => this.baselines.close(),
      () => this.ocr.close(),
      () => this.store.close(),
    ])
  }
  async #execute(active: ActiveRun, device: WorkbenchDevice, flow: WorkbenchFlow, plan: ExecutionPlan): Promise<void> {
    const { run, abort } = active
    const timeout = setTimeout(() => abort.abort(new Error('Run exceeded 10 minute limit')), 600_000)
    let result: RunYamlFlowResult | null = null
    let failure: string | null = null
    let assertionFailure = false
    let timingStep: number | undefined
    run.timings = []
    const timing: TimingObserver = {
      start: (phase) => {
        const step = timingStep
        run.activity = { phase, ...(step ? { step } : {}), startedAt: new Date().toISOString() }
      },
      end: (entry) => {
        const step = timingStep
        run.timings!.push({ ...entry, ...(step ? { step } : {}) })
        delete run.activity
      },
    }
    device.timing = timing
    run.dispatches = device.dispatches
    device.onDispatch = () => this.store.save(run)
    const { outputs, resources, persistResources, invoke, hooks } = createRunHooks(this.store, run, plan)
    const healthConfig = plan.header.runtimeGates?.health
    const healthBinding: HealthBinding = { runId: run.id, sessionId: device.sessionId, sessionGeneration: device.sessionGeneration, appId: plan.header.appId, attempt: run.attempt ?? 1 }
    let collector: HealthCollector | undefined
    let healthReady = false
    const runBlock = async (block: WorkbenchFlow, path: string, sourceLines: number[], blockSignal = abort.signal, sourceSteps?: SourceStepIdentity[], pathOffset = 0) => {
      result = await executeNativeBlock({ store: this.store, run, flow, block, path, sourceLines, sourceSteps, pathOffset, device, timing,
        signal: blockSignal, createWorker: this.#createWorker, setWorker: worker => { active.worker = worker },
        setTimingStep: step => { timingStep = step },
        recordStep: event => this.#step(run, event, flow, device, timing) })
    }
    const check = async (condition:Condition,scope:Record<string,unknown>,path:string, signal = abort.signal):Promise<boolean> => {
      signal.throwIfAborted()
      const value=bind(condition,bind(scope,{},outputs),outputs) as Condition
      const index=flow.parsed.steps.length+1
      flow.parsed.steps.push({kind:'wait',seconds:0})
      await this.#step(run,{type:'step',step:index,total:index,kind:'condition',status:'running'},flow,device,timing)
      run.steps.at(-1)!.path=path
      await this.#step(run,{type:'step',step:index,total:index,kind:'condition',status:'passed'},flow,device,timing)
      const step=run.steps.at(-1)!
      let answer:boolean
      if('platform' in value)answer=value.platform===device.platform
      else if('equals' in value)answer=JSON.stringify(value.equals[0])===JSON.stringify(value.equals[1])
      else {
        const source=(await this.store.readEvidence(run.id,step.evidence.find(e=>e.name.endsWith('.xml'))!)).toString()
        const elements=device.platform==='ios'?parseIOSPageSource(source,{includeHidden:true}):parseAndroidPageSource(source)
        const selector=parseElementSelector('visible' in value?value.visible:value.notVisible,'condition')
        const visible=resolveElementSelector(elements.filter(e=>e.visible!==false),selector).matches.length>0
        answer='visible' in value?visible:!visible
      }
      step.message=JSON.stringify({condition:value,result:answer});await this.store.save(run);return answer
    }
    const recover = async (node: Extract<PlanNode, {kind:'recover'}>, path: string, signal = abort.signal) => {
      signal.throwIfAborted()
      const index = flow.parsed.steps.length + 1
      flow.parsed.steps.push({kind:'tap', label:node.id, selector:parseElementSelector(node.tap,'navigation tap')})
      flow.blockers = node.postcondition.blockers
      device.path = path
      await this.#step(run,{type:'step',step:index,total:index,kind:'tap',status:'running'},flow,device,timing)
      const original = run.steps.at(-1)!; original.path=path; original.sourceLine=node.line
      const before = device.dispatches.length
      try {
        await device.navigationTap(node.tap,node.header.appId,plan.project.recoveryPolicies[node.policy]!,signal)
        await this.#step(run,{type:'step',step:index,total:index,kind:'tap',status:'passed'},flow,device,timing)
      } catch (error) {
        if(original.status==='running')await this.#step(run,{type:'step',step:index,total:index,kind:'tap',status:'failed',error:message(error)},flow,device,timing)
        if (!(error instanceof TargetFailure) || error.code!=='target-not-found' || device.dispatches.length!==before) throw error
        if(run.aiRecovery?.attempts.length)throw new FlowAssertionFailure('Run recovery budget exhausted')
        const policy=plan.project.recoveryPolicies[node.policy]!, model=plan.project.recoveryModels[policy.modelRef]!
        const attempt:RecoveryAttempt={id:randomUUID(),path,originalStep:index,policy:node.policy,model:model.model,status:'observing',startedAt:new Date().toISOString(),proposals:[],requests:0,dispatchBefore:before,dispatchAfterFailure:device.dispatches.length}
        run.aiRecovery={attempts:[attempt]}
        const deadline=AbortSignal.any([signal,AbortSignal.timeout(30_000)])
        const progress=async(status:RecoveryAttempt['status'])=>{attempt.status=status;run.stage=`recovery-${status}`;await this.store.save(run)}
        try {
          let dispatched=false
          for(let request=0;request<2;request++) {
            deadline.throwIfAborted();await progress('observing')
            const observation=await device.recoveryObserve(policy,deadline)
            const elements=device.platform==='ios'?parseIOSPageSource(observation.source,{includeHidden:true}):parseAndroidPageSource(observation.source)
            if(flow.blockers.some(selector=>resolveElementSelector(elements.filter(e=>e.visible!==false),selector).matches.length>0)) {
              original.verification={status:'evidence-contaminated',message:'Declared blocker prevents AI recovery'}
              throw new RecoveryRejected(original.verification.message)
            }
            const prefix=`ai-recovery-${index}-${request+1}`
            run.evidence.push(await this.store.put(run.id,`${prefix}.png`,Buffer.from(observation.image,'base64'),'image/png'))
            run.evidence.push(await this.store.put(run.id,`${prefix}.xml`,observation.source,'application/xml'))
            run.evidence.push(await this.store.put(run.id,`${prefix}.json`,JSON.stringify({...observation,image:undefined,source:undefined,policy,model,promptVersion:1,backend:'structured-planner'}),'application/json'))
            attempt.requests++;await progress('planning')
            const proposal=await boundedProposal(this.#planner,observation,policy,model,AbortSignal.any([deadline,AbortSignal.timeout(10_000)]),usage=>{(attempt.usage??=[]).push(usage)})
            attempt.proposals.push(proposal);await progress('validating')
            if(proposal.decision==='abstain'){run.diagnostics!.push({domain:'model-decision',code:'abstain',phase:'recovery',...(original.comparison?.stepKey?{stepKey:original.comparison.stepKey}:{}),retryable:false,evidenceRefs:run.evidence.filter(e=>e.name.startsWith(`ai-recovery-${index}-`)).map(e=>e.name),observedAt:new Date().toISOString(),message:proposal.reason});throw new RecoveryRejected(proposal.reason)}
            if(policy.mode==='suggest'){run.diagnostics!.push({domain:'policy',code:'suggest-only',phase:'recovery',...(original.comparison?.stepKey?{stepKey:original.comparison.stepKey}:{}),retryable:false,evidenceRefs:[],observedAt:new Date().toISOString(),message:'Automatic recovery is disabled by policy'});throw new RecoveryRejected('Suggestion recorded; automatic recovery is disabled')}
            await progress('executing')
            dispatched=await device.recoveryTap(observation,proposal.action.nodeId,policy,deadline)
            if(dispatched)break
          }
          if(!dispatched)throw new RecoveryRejected('Page changed beyond replanning budget')
          const recoveredIndex=flow.parsed.steps.length+1
          flow.parsed.steps.push({kind:'wait',seconds:0})
          await this.#step(run,{type:'step',step:recoveredIndex,total:recoveredIndex,kind:'recovery-tap',status:'running'},flow,device,timing)
          await this.#step(run,{type:'step',step:recoveredIndex,total:recoveredIndex,kind:'recovery-tap',status:'passed'},flow,device,timing)
          await progress('verifying')
          deadline.throwIfAborted()
          await runBlock(node.postcondition,`${path}/postcondition`,[node.line],deadline)
          deadline.throwIfAborted()
          original.recoveredBy=attempt.id;attempt.status='recovered'
        } catch(recoveryError) {
          attempt.status='rejected';attempt.reason=message(recoveryError)
          if(recoveryError instanceof RecoveryProtocolError && recoveryError.output!==undefined)attempt.rejectedOutput=recoveryError.output
          if(recoveryError instanceof RecoveryProtocolError)run.diagnostics!.push({domain:'model-service',code:'invalid-response',phase:'recovery',retryable:true,evidenceRefs:[],observedAt:new Date().toISOString(),message:attempt.reason})
          const noWrites=device.dispatches.slice(before).every(record=>record.state==='not-dispatched')
          if(recoveryError instanceof RecoveryRejected || (!abort.signal.aborted && noWrites && (deadline.aborted || (recoveryError instanceof DOMException && recoveryError.name==='TimeoutError'))))throw new FlowAssertionFailure(attempt.reason)
          throw recoveryError
        } finally {
          attempt.endedAt=new Date().toISOString();run.stage='execute'
          run.evidence.push(await this.store.put(run.id,`ai-recovery-${index}-result.json`,JSON.stringify(attempt),'application/json'))
          await this.store.save(run)
        }
        return
      }
      await runBlock(node.postcondition,`${path}/postcondition`,[node.line], signal)
    }
    const walk=async(nodes:PlanNode[],suffix='', walkSignal = abort.signal):Promise<void>=> {
      for(const node of nodes) {
        walkSignal.throwIfAborted()
        if(run.steps.length>1000)throw new Error('Runtime step budget exceeded')
        const path=node.path+suffix
        if (node.kind === 'measure') {
          await executeMeasurement({ id: node.id, path, maxElapsedMs: node.maxElapsedMs }, run, this.store, signal => walk(node.steps, suffix, signal), walkSignal)
        } else if (node.kind === 'temporal' || node.kind === 'restart' || node.kind === 'business') {
          const index = flow.parsed.steps.length + 1
          const kind = node.kind === 'temporal' ? node.operation : node.kind === 'restart' ? 'restartApp' : 'assertBusiness'
          flow.parsed.steps.push({ kind: 'wait', seconds: 0 }); device.path = path
          await this.#step(run, { type: 'step', step: index, total: index, kind, status: 'running' }, flow, device, timing)
          const step = run.steps.at(-1)!; step.path = path; step.sourceLine = node.line
          try {
            await executeRuntimeStep(node, { store: this.store, run, step, device, plan, outputs, signal: walkSignal })
            await this.#step(run, { type: 'step', step: index, total: index, kind, status: 'passed' }, flow, device, timing)
          } catch (error) {
            if (step.status === 'running') {
              try { await this.#step(run, { type: 'step', step: index, total: index, kind, status: 'failed', error: message(error) }, flow, device, timing) }
              catch { /* Preserve original cause; partial evidence is retained. */ }
            }
            throw error
          }
        } else if(node.kind==='ocr') {
          const registration = requireOcrApproval(plan.project.ocrProfiles?.[node.profile], ocrProjectDigest(plan.project), await this.ocr.identity())
          const index = flow.parsed.steps.length + 1
          flow.parsed.steps.push({ kind: 'wait', seconds: 0 }); device.path = path
          await this.#step(run, { type: 'step', step: index, total: index, kind: 'assertTextInRegion', status: 'running' }, flow, device, timing)
          const step = run.steps.at(-1)!; step.path = path; step.sourceLine = node.line
          try {
            await this.#step(run, { type: 'step', step: index, total: index, kind: 'assertTextInRegion', status: 'passed' }, flow, device, timing)
            const screenshot = step.evidence.find(file => file.name === `step-${index}.png`), xml = step.evidence.find(file => file.name === `step-${index}.xml`)
            if (!screenshot || !xml) throw new Error('ocr-checkpoint-missing')
            const source = (await this.store.readEvidence(run.id, xml)).toString('utf8')
            const elements = device.platform === 'ios' ? parseIOSPageSource(source, { includeHidden: true }) : parseAndroidPageSource(source)
            const page = resolveElementSelector(elements.filter(e => e.visible !== false), parseElementSelector(registration.page, 'OCR page'))
            const blocked = node.header.blockers.some(value => resolveElementSelector(elements.filter(e => e.visible !== false), parseElementSelector(value, 'OCR blocker')).matches.length > 0)
            if (page.matches.length !== 1 || blocked) throw new Error('ocr-page-precondition-unconfirmed')
            const preview = await this.ocr.preview(await this.store.readEvidence(run.id, screenshot), registration.profile, walkSignal)
            const evidence = await persistOcrEvidence(this.store, run, step, registration.profile, preview, walkSignal)
            step.ocr = { ...evidence.decision, profileDigest: preview.profileDigest, approvalDigest: ocrHash(registration.approval), sourceSha256: preview.imageSha256, completedAt: preview.completedAt }
            if (preview.decision.status === 'fail') throw new FlowAssertionFailure(preview.decision.reason)
            if (preview.decision.status !== 'pass') throw new Error(preview.decision.reason)
            if (run.visualVerification === 'not-performed') run.visualVerification = 'pass'
            await this.store.save(run)
          } catch (error) {
            run.visualVerification = error instanceof FlowAssertionFailure || run.visualVerification === 'fail' ? 'fail' : 'inconclusive'
            step.status = 'failed'; step.error = message(error)
            run.diagnostics!.push({ domain: 'visual', code: step.ocr?.reason ?? 'ocr-unconfirmed', phase: 'verify', evidenceRefs: step.evidence.map(file => file.name), observedAt: new Date().toISOString(), message: message(error), retryable: false })
            await this.store.save(run); throw error
          }
        } else if(node.kind==='visual') {
          const profile = plan.project.visualProfiles?.[node.profile]
          if (!profile) throw new Error('Visual profile became unavailable')
          const index = flow.parsed.steps.length + 1
          flow.parsed.steps.push({ kind: 'wait', seconds: 0 })
          device.path = path
          await this.#step(run, { type: 'step', step: index, total: index, kind: 'assertVisual', status: 'running' }, flow, device, timing)
          const step = run.steps.at(-1)!; step.path = path; step.sourceLine = node.line
          try {
            await this.#step(run, { type: 'step', step: index, total: index, kind: 'assertVisual', status: 'passed' }, flow, device, timing)
            const screenshot = step.evidence.find(file => file.contentType === 'image/png')
            const result = screenshot
              ? await compareVisual(profile, await this.store.readEvidence(run.id, screenshot), run.productContract!.provenance.app.build.value, 'unknown', walkSignal)
              : { status: 'inconclusive' as const, message: 'Visual screenshot is unavailable', comparedPixels: 0, differentPixels: 0, rulesVersion: 1 as const, revision: profile.revision, referenceSha256: profile.referenceSha256 }
            step.visual = { ...result, profile: node.profile }
            step.evidence.push(await this.store.put(run.id, `visual-reference-${index}.png`, Buffer.from(profile.referenceBase64, 'base64'), 'image/png'))
            run.visualVerification = result.status === 'fail' ? 'fail' : result.status === 'inconclusive' && run.visualVerification !== 'fail' ? 'inconclusive' : run.visualVerification === 'not-performed' ? 'pass' : run.visualVerification
            if (result.status !== 'pass') {
              step.status = 'failed'; step.error = result.message
              run.diagnostics!.push({ domain: 'visual', code: `visual-${result.status}`, phase: 'verify', evidenceRefs: step.evidence.map(file => file.name), observedAt: new Date().toISOString(), message: result.message, retryable: false })
            }
            await this.store.save(run)
            if (result.status === 'fail') throw new FlowAssertionFailure(result.message)
            if (result.status === 'inconclusive') throw new Error(result.message)
          } catch (error) {
            if (!step.visual) { run.visualVerification = 'inconclusive'; step.status = 'failed'; step.error = message(error); await this.store.save(run) }
            throw error
          }
        } else if(node.kind==='ready') {
          const ready = parseReadyStep(bind(node.raw, bind(node.scope, {}, outputs), outputs))
          const index = flow.parsed.steps.length + 1, kind = ready.operation === 'assertReady' ? 'assert' : ready.operation
          flow.parsed.steps.push({ kind: 'wait', seconds: 0 })
          ;(flow.readySteps ??= {})[index] = ready
          flow.blockers = node.header.blockers.map(value => parseElementSelector(value, 'blocker'))
          device.path = path; timingStep = index
          await this.#step(run, { type: 'step', step: index, total: index, kind, status: 'running', target: JSON.stringify(ready.target) }, flow, device, timing)
          const step = run.steps.at(-1)!; step.path = path; step.sourceLine = node.line
          const started = performance.now()
          try {
            await device.executeReady(ready, walkSignal)
            await this.#step(run, { type: 'step', step: index, total: index, kind, status: 'passed', durationMs: performance.now() - started }, flow, device, timing)
          } catch (error) {
            if (step.status === 'running') {
              try { await this.#step(run, { type: 'step', step: index, total: index, kind, status: 'failed', error: message(error), durationMs: performance.now() - started }, flow, device, timing) }
              catch { /* checkpoint failures already recorded; preserve the original failure below */ }
            }
            if (error instanceof ReadinessFailure) {
              run.diagnostics!.push({ domain: 'device-driver', code: error.code, phase: 'execute', retryable: false,
                ...(step.comparison?.stepKey ? { stepKey: step.comparison.stepKey } : {}), evidenceRefs: step.evidence.map(file => file.name), observedAt: new Date().toISOString(), message: error.code })
              throw new FlowAssertionFailure(error.code)
            }
            throw error
          } finally { timingStep = undefined }
        } else if(node.kind==='leaf') {
          const block=node.dynamic?await parseWorkbenchFlow(nativeYaml(node.header,bind(node.raw,bind(node.scope,{},outputs),outputs)),true):node.validated
          const selected = recordedTapIndices(plan, run, node)
          let start = 0
          for (const localIndex of selected) {
            if (localIndex > start) await runBlock(sliceNativeBlock(block, start, localIndex), path, node.sourceLines.slice(start, localIndex), walkSignal, node.sourceSteps.slice(start, localIndex), start)
            timingStep = flow.parsed.steps.length + 1
            try {
              const registration = plan.project.repair?.navigation.find(item => item.flow === run.flowId
                && item.stepPath === node.sourceSteps[localIndex]!.path)
              await executeRecordedTap({ store: this.store, run, flow, block, localIndex, path: `${path}/${localIndex + 1}`,
                source: node.sourceSteps[localIndex]!, selector: (node.raw[localIndex] as { tap: unknown }).tap,
                appId: node.header.appId, blockers: node.header.blockers, device, signal: walkSignal,
                ...(registration?.page && registration.allowedTarget
                  ? { scope: { page: registration.page, allowedTarget: registration.allowedTarget } } : {}),
                recordStep: event => this.#step(run, event, flow, device, timing) })
            } catch (error) {
              if (error instanceof LocalTapFailure && error.code !== 'tap-not-ready') throw new FlowAssertionFailure(error.code)
              throw error
            } finally { timingStep = undefined }
            start = localIndex + 1
          }
          if (start < block.parsed.steps.length) await runBlock(sliceNativeBlock(block, start, block.parsed.steps.length), path, node.sourceLines.slice(start), walkSignal, node.sourceSteps.slice(start), start)

        } else if(node.kind==='recover')await recover(node,path,walkSignal)
        else if(node.kind==='if'){const answer=await check(node.condition,node.scope,path,walkSignal);run.controlEvents!.push({kind:'branch',path,result:answer?'then':'else',observedAt:new Date().toISOString()});await this.store.save(run);await walk(answer?node.then:node.else,suffix,walkSignal)}
        else if (node.kind === 'repeat') {
          let satisfied=false
          for(let i=0;i<node.times;i++) {
            if(node.condition && await check(node.condition,node.scope,`${path}/check-${i}`,walkSignal)){satisfied=true;break}
            run.controlEvents!.push({kind:'loop',path,result:`iteration-${i+1}`,observedAt:new Date().toISOString()});await this.store.save(run);await walk(node.steps,`${suffix}/iteration-${i+1}`,walkSignal)
          }
          if(node.condition && !satisfied && !await check(node.condition,node.scope,`${path}/check-final`,walkSignal))throw new FlowAssertionFailure('Repeat exhausted without satisfying condition')
        }
      }
    }
    try {
      if (healthConfig) {
        run.stage = 'health-preparing'
        await persistHealthJournal(this.store, run, healthBinding, 'preparing'); await this.store.save(run)
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(5000)])
        collector = await device.startHealth(healthBinding, healthConfig.signals, signal)
        await collector.ready(signal); signal.throwIfAborted()
        healthReady = true
        await persistHealthJournal(this.store, run, healthBinding, 'observing')
      }
      await hooks(plan.header.prepare, 'prepare', abort.signal)
      run.stage = 'execute'; await this.store.save(run)
      await walk(plan.nodes)
      if (!run.steps.some(step => ['assert', 'assertEventually', 'assertStable'].includes(step.kind) && step.status === 'passed')) throw new Error('No UI assertion was executed')
      if (run.productContract?.contractVersion === 2 && runtimeNodes(plan.nodes).some(node => node.kind === 'measure' && !run.measurements?.some(report => report.id === node.id)))
        Object.assign(run.productContract.verification.performance, { status: 'inconclusive', reason: 'measurement-not-executed' })
      await hooks(plan.header.verify, 'verify', abort.signal)
      if (healthConfig && healthConfig.tailMs) {
        run.stage = 'health-observing'; await this.store.save(run)
        await sleep(healthConfig.tailMs, undefined, { signal: abort.signal })
      }
    } catch (error) { failure = message(error); assertionFailure = error instanceof FlowAssertionFailure || error instanceof TargetFailure;if(error instanceof TargetFailure||!run.diagnostics!.length)run.diagnostics!.push({domain:error instanceof TargetFailure?'device-driver':'unknown',code:error instanceof TargetFailure?error.code:'execution-failed',phase:run.stage??'execute',retryable:error instanceof TargetFailure,evidenceRefs:[],observedAt:new Date().toISOString(),message:failure}) }
    finally {
      clearTimeout(timeout)
      let healthClosed = false
      try { if (healthConfig && collector) {
        run.stage = 'health-draining'; await this.store.save(run)
        await persistHealthJournal(this.store, run, healthBinding, 'draining')
        try {
          const drainSignal = AbortSignal.timeout(5000)
          const window = await collector.stopAndDrain(drainSignal)
          drainSignal.throwIfAborted()
          if (!healthReady) { window.ready = false; window.gaps.push('health-ready-unconfirmed') }
          if (abort.signal.aborted) window.gaps.push('health-window-interrupted')
          const capability = device.assertHealthSupported(healthConfig.signals)
          const operations = device.dispatches.filter(record => record.state === 'settled' && record.operation.startsWith('restart-terminate:')).map(record => record.operation.slice('restart-terminate:'.length))
          run.health = evaluateHealthWindow(capability, healthConfig.signals, healthBinding, window, operations)
          run.health.windowSha256 = await persistHealthWindow(this.store, run, { binding: healthBinding, capability, window, operations })
        } catch {
          run.health = { schemaVersion: 1, status: 'inconclusive', reason: 'health-drain-unconfirmed', source: device.assertHealthSupported(healthConfig.signals).source,
            sourceVersion: device.assertHealthSupported(healthConfig.signals).sourceVersion, signals: healthConfig.signals, bindingDigest: healthBindingDigest(healthBinding),
            durationMs: 0, coverage: 'incomplete', gaps: ['health-drain-unconfirmed'], violations: [], expectedExits: 0, unexpectedExits: 0 }
        } finally {
          try {
            const closeSignal = AbortSignal.timeout(5000)
            await collector.close(closeSignal); closeSignal.throwIfAborted()
          } catch {
            run.health!.coverage = 'incomplete'; run.health!.gaps.push('health-close-failed')
            if (run.health!.status !== 'fail') { run.health!.status = 'inconclusive'; run.health!.reason = 'health-close-failed' }
          }
          healthClosed = true
        }
        const file = await this.store.put(run.id, 'health-report.json', JSON.stringify(run.health), 'application/json'); run.evidence.push(file)
        if (run.health.status !== 'pass') run.diagnostics!.push({ domain: 'health', code: run.health.reason, phase: 'health-draining',
          retryable: false, evidenceRefs: [file.name], observedAt: new Date().toISOString(), message: run.health.reason })
        if (run.productContract?.contractVersion === 2) Object.assign(run.productContract.verification.health,
          { status: run.health.status, reason: run.health.reason, evidenceRefs: [file.name] })
        await persistHealthJournal(this.store, run, healthBinding, 'finished')
      } } catch (error) {
        failure ??= message(error)
        if (run.productContract?.contractVersion === 2 && run.productContract.verification.health.status !== 'fail')
          Object.assign(run.productContract.verification.health, { status: 'inconclusive', reason: 'health-material-unavailable' })
      } finally { if (collector && !healthClosed) { try { await collector.close(AbortSignal.timeout(5000)) } catch (error) { failure ??= message(error) } } }
      const cleanupAbort=new AbortController(), cleanupTimer=setTimeout(()=>cleanupAbort.abort(new Error('Cleanup budget exceeded')),30_000)
      try {
        for(let index=resources.length-1;index>=0;index--) {
          cleanupAbort.signal.throwIfAborted()
          const resource=resources[index]!
          try {
            await invoke({ref:resource.ref,args:{}},'cleanup',cleanupAbort.signal,resource.token)
            resources.splice(index,1);await persistResources()
          } catch(error) { failure??=message(error) }
        }
        run.resourceCleanup=resources.length?'failed':'pass'
      } catch(error){run.resourceCleanup='failed';failure??=message(error)}
      finally {clearTimeout(cleanupTimer)}
      timingStep = undefined
      delete run.activity
      run.phase = 'finalizing'
      try { await device.release(); run.cleanup = 'session-retained' }
      catch (error) { run.cleanup = 'failed'; failure ??= message(error);run.diagnostics!.push({domain:'cleanup',code:'session-release-failed',phase:'cleanup',retryable:true,evidenceRefs:[],observedAt:new Date().toISOString(),message:message(error)}) }
      for (const step of run.steps) {
        if (step.status === 'running') { step.status = 'failed'; step.endedAt = new Date().toISOString(); step.error = failure ?? 'Interrupted' }
      }
      const engineResult = result as RunYamlFlowResult | null
      const outcome = aggregateRunVerdict(run, { aborted: abort.signal.aborted, ...(abort.signal.aborted ? { abortReason: message(abort.signal.reason) } : {}),
        assertionFailure, ...(failure ? { failure } : {}), engineResult, declaredVisual: containsVisual(plan.nodes) })
      let verdict = outcome.verdict
      if (outcome.error) run.error = outcome.error
      try {
        requireTerminalStepEvidence(run, flow.parsed.steps.length, verdict)
        await timed(timing, 'verify', () => verifyRunEvidence(this.store, run))
      } catch (error) { if (verdict !== 'cancelled') verdict = 'inconclusive'; run.error = message(error) }
      run.verdict = verdict; run.phase = 'finished'; run.endedAt = new Date().toISOString()
      if(verdict==='cancelled')run.diagnostics!.push({domain:'cancelled',code:'user-cancelled',phase:run.stage??'execute',retryable:false,evidenceRefs:[],observedAt:run.endedAt,message:'Cancelled by user'})
      try { await this.store.save(run) }
      catch (error) { run.verdict = 'inconclusive'; run.error = `Report could not be saved: ${message(error)}`; this.#unsavedRun = structuredClone(run) }
    }
  }
  async #step(run: TestRun, event: StepEvent, flow: WorkbenchFlow, device: WorkbenchDevice, timing: TimingObserver): Promise<void> {
    await recordStepEvidence(this.store, run, event, flow, device, timing)
  }
}
