import { syncBuiltinReferences, hasAgentTombstone } from './workbench-builtin-references.js'
import type { ReferencePublications } from './workbench-evidence-contracts.js'
import { createHash, randomUUID } from 'node:crypto'
import { AcceptanceError, type AcceptanceChannel } from './workbench-acceptance.js'
import sharp from 'sharp'
import type { AgentTestControlConfig } from './config.js'
import type { MirrorService } from './mirror-service.js'
import { compilePlan, inspectFlowHeader, type ExecutionPlan } from './workbench-plan.js'
import { loadTestProject, type ProjectSnapshot } from './workbench-project.js'
import type { WorkbenchService } from './workbench-service.js'
import type { WorkbenchSuites, SuiteRun } from './workbench-suites.js'
import type { WorkbenchComparisonService } from './workbench-comparison.js'
import type { WorkbenchTriageService } from './workbench-triage-service.js'
import { WorkbenchApplication } from './workbench-application.js'
import { matrixSafeSummary } from './device-matrix-contracts.js'
import { closeInOrder } from './lifecycle.js'
import { sha256 } from './workbench-store.js'
import type { EvidenceFile, TestRun } from './workbench-domain.js'
import { productTaskStatusSchema, runResultProjection, type RunResultProjection } from './workbench-contracts.js'

export type TestTarget = { kind: 'flow' | 'suite'; id: string }
export interface TestRunStartInput {
  requestId: string
  target: TestTarget
  catalogRevision: string
  params?: Record<string, unknown>
  tags?: string[]
  platform?: 'android' | 'ios'
}
export interface TestRunStatusInput { executionId?: string; requestId?: string; cursor?: number; limit?: number }
export interface TestRunEvidenceInput extends TestRunStatusInput {
  runId?: string
  artifactId?: string
  format?: 'metadata' | 'text' | 'image'
}

type JournalPhase = 'accepted' | 'running' | 'cancelling' | 'finished'
interface JournalSummary {
  verdict?: string
  exitCode?: number
  stage?: string
  error?: string
  cleanup?: string
  businessVerification?: string
  visualVerification?: string
  evidenceVerification: 'pending' | 'verified' | 'failed'
  completedCases?: number
  totalCases?: number
  resultProjection?: RunResultProjection
}
interface ExecutionJournal {
  referencePublications?: ReferencePublications
  schemaVersion: 1
  executionId: string
  requestId: string
  requestKey: string
  requestHash: string
  input: TestRunStartInput
  target: TestTarget
  projectIdentity: string
  catalogRevision: string
  projectSha256: string
  runId?: string
  suiteId?: string
  phase: JournalPhase
  source: 'agent'
  acceptedAt: string
  startedAt?: string
  endedAt?: string
  summary: JournalSummary
}

export interface TestEvidenceImage {
  metadata: Record<string, unknown>
  bytes: Uint8Array
  contentType: 'image/png'
}

export class TestRunControlError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'TestRunControlError' }
}

export class TestRunCoordinator {
  readonly application: WorkbenchApplication
  readonly #ownsApplication: boolean
  #closePromise: Promise<void> | undefined
  readonly workbench: WorkbenchService
  readonly suites: WorkbenchSuites
  readonly comparisons: WorkbenchComparisonService
  readonly triage: WorkbenchTriageService
  readonly #policy: AgentTestControlConfig
  readonly #acceptance: AcceptanceChannel<ExecutionJournal>
  #closed = false
  readonly #journals: Map<string, ExecutionJournal>
  readonly #requests: Map<string, string>
  #jobs = new Map<string, Promise<void>>()
  #jobErrors: unknown[] = []
  #journalFailures = new Map<string, string>()

  constructor(readonly mirror: MirrorService, policy: AgentTestControlConfig, options: {
    root?: string
    workbench?: WorkbenchService
    application?: WorkbenchApplication
    journalWriteHook?: (point: 'temporary-synced' | 'renamed' | 'directory-synced', journal: Readonly<ExecutionJournal>) => void
  } = {}) {
    this.#policy = structuredClone(policy)
    if (options.application && options.workbench) throw new TypeError('Choose an application or a workbench, not both')
    this.#ownsApplication = !options.application
    this.application = options.application ?? new WorkbenchApplication(mirror, {
      ...(options.root ? { root: options.root } : {}),
      ...(policy.projectPath ? { projectPath: policy.projectPath } : {}),
      ...(options.workbench ? { workbench: options.workbench } : {}),
    })
    this.workbench = this.application.workbench
    if (this.workbench.mirror !== mirror) throw new TypeError('Coordinator application must use the same device service')
    this.suites = this.application.suites
    this.comparisons = this.application.comparisons
    this.triage = this.application.triage
    this.#acceptance = this.application.acceptance.channel<ExecutionJournal>('agent', {
      parse(value) {
        const journal = value as ExecutionJournal
        if (!journal || journal.schemaVersion !== 1 || journal.source !== 'agent'
          || !['flow', 'suite'].includes(journal.target?.kind)
          || (!journal.runId && !journal.suiteId)) throw new Error('Invalid Agent execution journal')
        return journal
      },
      recover: async journal => {
        journal.phase = 'finished'; journal.endedAt = new Date().toISOString()
        journal.summary = { evidenceVerification: 'pending', verdict: 'inconclusive', exitCode: 2, error: 'Interrupted; execution was not replayed' }
        await this.#save(journal)
      },
      drain: async () => {
        for (const journal of this.#journals.values()) if (journal.phase !== 'finished') await this.cancel(journal.executionId).catch(() => undefined)
        await Promise.allSettled(this.#jobs.values())
        if (this.#jobErrors.length) throw new AggregateError(this.#jobErrors, 'Agent execution journal persistence failed')
      },
      ...(options.journalWriteHook ? { writeHook: options.journalWriteHook } : {}),
    })
    this.#journals = this.#acceptance.records
    this.#requests = this.#acceptance.requests
  }

  async catalog(input: { kind?: 'flow' | 'suite' | 'all'; cursor?: number; limit?: number } = {}): Promise<object> {
    this.#requireEnabled()
    const { project, revision } = await this.#loadCatalog()
    const kind = input.kind ?? 'all', cursor = boundedCursor(input.cursor), limit = boundedLimit(input.limit)
    const items: object[] = []
    if (kind !== 'suite') {
      for (const id of this.#policy.allowedFlows) {
        const yaml = project.flows[id]
        if (!yaml) continue
        const header = inspectFlowHeader(yaml)
        if (!this.#allowedHeader(header.platform, header.appId)) continue
        items.push({ kind: 'flow', id, name: header.name, platform: header.platform, appId: header.appId, params: header.params })
      }
    }
    if (kind !== 'flow') {
      for (const id of this.#policy.allowedSuites) {
        const suite = project.suites[id]
        if (!suite) continue
        const headers = suite.cases.map((entry) => project.flows[entry.flow]).filter((yaml): yaml is string => typeof yaml === 'string').map(inspectFlowHeader)
        if (!headers.length || headers.some((header) => !this.#allowedHeader(header.platform, header.appId))) continue
        items.push({ kind: 'suite', id, name: suite.name, platforms: [...new Set(headers.map((header) => header.platform))], appIds: [...new Set(headers.map((header) => header.appId))], params: suite.params, caseCount: suite.cases.length })
      }
    }
    const page = items.slice(cursor, cursor + limit)
    return { catalogRevision: revision, items: page, page: { cursor, returned: page.length, total: items.length, ...(cursor + page.length < items.length ? { nextCursor: cursor + page.length } : {}) } }
  }

  async start(input: TestRunStartInput, signal?: AbortSignal): Promise<object> {
    this.#requireEnabled()
    validateStartInput(input)
    return this.#serialized(async () => {
      this.#requireEnabled()
      await this.#init()
      const requestKey = this.#requestKey(input.requestId)
      const requestHash = sha256(stableJson(input))
      let previous: ExecutionJournal | undefined
      try { previous = this.#acceptance.lookup(requestKey, requestHash) }
      catch (error) {
        if (error instanceof AcceptanceError && error.code === 'acceptance-request-conflict') throw fail('request_conflict', 'requestId was already used with different input')
        throw error
      }
      if (previous) return accepted(previous)
      if (signal?.aborted) throw signal.reason
      const { project, revision } = await this.#loadCatalog()
      if (input.catalogRevision !== revision) throw fail('project_changed', 'Registered test project changed; read the catalog again')
      if ([...this.#journals.values()].some((entry) => entry.phase !== 'finished') || this.workbench.activeId || this.suites.activeId) {
        throw fail('device_busy', 'Another test execution is active')
      }
      const prepared = await this.#prepare(input, project)
      this.#acceptance.assertAccepting()
      const executionId = randomUUID(), targetId = randomUUID()
      const now = new Date().toISOString()
      const journal: ExecutionJournal = {
        schemaVersion: 1, executionId, requestId: input.requestId, requestKey, requestHash,
        input: structuredClone(input), target: structuredClone(input.target), projectIdentity: this.#projectIdentity(),
        catalogRevision: revision, projectSha256: project.sha256,
        ...(input.target.kind === 'flow' ? { runId: targetId } : { suiteId: targetId }),
        phase: 'accepted', source: 'agent', acceptedAt: now,
        summary: { evidenceVerification: 'pending' },
      }
      await this.#save(journal)
      this.#acceptance.remember(journal)
      const response = accepted(journal)
      if (signal?.aborted || !this.#acceptance.accepting) {
        journal.phase = 'finished'; journal.endedAt = new Date().toISOString()
        journal.summary = { evidenceVerification: 'pending', verdict: 'cancelled', error: 'Start call cancelled after durable acceptance; execution was not dispatched' }
        await this.#save(journal)
      } else {
        const job = this.#dispatch(journal, project, prepared).catch(error => {
          this.#jobErrors.push(error)
          this.#journalFailures.set(executionId, errorMessage(error))
          journal.phase = 'finished'
          journal.summary = { evidenceVerification: 'failed', verdict: 'inconclusive', exitCode: 2, error: `Execution journal persistence failed: ${errorMessage(error)}` }
        }).finally(() => this.#jobs.delete(executionId))
        this.#jobs.set(executionId, job)
      }
      return response
    })
  }

  async status(input: TestRunStatusInput): Promise<object> {
    await this.#init()
    const journal = this.#find(input)
    return this.#status(journal, input.cursor, input.limit)
  }

  async cancel(executionId: string): Promise<object> {
    await this.#init()
    const journal = this.#journals.get(executionId)
    if (!journal) throw fail('not_found', 'Execution was not found')
    if (journal.phase === 'finished') return this.#status(journal)
    journal.phase = 'cancelling'; await this.#save(journal)
    if (journal.target.kind === 'flow' && journal.runId && this.workbench.activeId === journal.runId) await this.workbench.cancel(journal.runId)
    if (journal.target.kind === 'suite' && journal.suiteId && this.suites.activeId === journal.suiteId) await this.suites.cancel(journal.suiteId)
    return { executionId, cancelRequested: true, phase: journal.phase }
  }

  async evidence(input: TestRunEvidenceInput): Promise<object | TestEvidenceImage> {
    this.#requireEnabled()
    await this.#init()
    const journal = this.#find(input)
    const runs = await this.#executionRuns(journal)
    if (input.runId && !runs.some((run) => run.id === input.runId)) throw fail('artifact_denied', 'Run does not belong to this execution')
    const entries = runs.flatMap((run) => evidenceEntries(run).map(({ file, step }) => ({
      run, file, ...(step === undefined ? {} : { step }), artifactId: artifactId(run.id, file), kind: evidenceKind(file),
    }))).filter((entry) => !input.runId || entry.run.id === input.runId)
    if (!input.artifactId || (input.format ?? 'metadata') === 'metadata') {
      const cursor = boundedCursor(input.cursor), limit = boundedLimit(input.limit)
      const page = entries.slice(cursor, cursor + limit).map((entry) => evidenceMetadata(entry))
      return { executionId: journal.executionId, items: page, page: { cursor, returned: page.length, total: entries.length, ...(cursor + page.length < entries.length ? { nextCursor: cursor + page.length } : {}) } }
    }
    const entry = entries.find((candidate) => candidate.artifactId === input.artifactId)
    if (!entry) throw fail('artifact_denied', 'Artifact does not belong to this execution')
    const format = input.format ?? 'metadata'
    if (format === 'image') return this.#readImage(entry.run, entry.file, journal)
    if (format !== 'text') throw fail('artifact_denied', 'Explicit text or image format is required')
    if (!this.#shared(entry.kind) || entry.file.contentType.startsWith('image/') || entry.file.contentType.startsWith('video/')) throw fail('artifact_denied', 'Artifact text sharing is disabled')
    const bytes = await this.#readVerified(entry.run, entry.file, journal)
    const delivered = bytes.subarray(0, 16 * 1024)
    return { ...evidenceMetadata(entry), text: delivered.toString('utf8'), originalBytes: bytes.byteLength, truncated: delivered.byteLength < bytes.byteLength }
  }

  /** Acceptance IDs do not grant access to arbitrary local history or another project. */
  async externalProject() {
    this.#requireEnabled()
    const project = await this.#loadCatalog()
    return { identity: this.#projectIdentity(), revision: project.revision }
  }
  async externalResult(id: string) {
    const project = await this.externalProject(), service = this.application.externalAssets
    const unavailable = () => fail('not_found', 'External asset was not found or is unavailable')
    try {
      if (!await service.authorized(id, project)) throw unavailable()
      const result = await service.get(id)
      // A grant revoked while bytes were read must not yield a late authorized response.
      if (!await service.authorized(id, await this.externalProject())) throw unavailable()
      return { ...result.summary, availability: result.availability, checkedAt: result.checkedAt }
    } catch { throw unavailable() }
  }
  async matrixStatus(id: string) {
    this.#requireEnabled()
    const unavailable = () => fail('not_found', 'Matrix was not found or is unavailable')
    try {
      const project = await this.#loadCatalog(), cells = await this.application.matrix.authorizedCells(id, project.project)
      if (cells.some(c => !this.#policy.allowedFlows.includes(c.flow) || !this.#allowedHeader(c.header.platform, c.header.appId))) throw unavailable()
      const result = matrixSafeSummary(await this.application.matrix.get(id))
      if ((await this.#loadCatalog()).revision !== project.revision) throw unavailable()
      return result
    } catch { throw unavailable() }
  }
  async acceptanceRecord(id: string, revision?: number, signal?: AbortSignal): Promise<object> {
    this.#requireEnabled()
    await this.#init()
    const unavailable = () => fail('not_found', 'Acceptance record was not found or is unavailable')
    let result: Awaited<ReturnType<WorkbenchApplication['acceptanceRecords']['get']>>
    try { result = await this.application.acceptanceRecords.get(id, revision, signal) } catch { throw unavailable() }
    if (result.input.cells.some(cell => (!cell.runId && !cell.externalResults?.length) || !this.#allowedHeader(cell.platform, cell.appId))) throw unavailable()
    const externalIds = [...new Set(result.input.cells.flatMap(cell => (cell.externalResults ?? []).map(ref => ref.assetId)))]
    for (const assetId of externalIds) if (!await this.application.externalAssets.authorized(assetId, await this.externalProject())) throw unavailable()
    const matrixCells = result.input.cells.filter(cell => cell.matrixCell)
    for (const cell of matrixCells) await this.matrixStatus(cell.matrixCell!.matrixId)
    const ids = [...new Set(result.input.cells.filter(cell => !cell.matrixCell).flatMap(cell => [...(cell.runId ? [cell.runId] : []), ...cell.historyRunIds]))]
    if (!ids.length && !externalIds.length && !matrixCells.length) throw unavailable()
    const project = await this.#loadCatalog()
    for (const runId of ids) {
      signal?.throwIfAborted()
      let run: TestRun
      try { run = (await this.workbench.store.readOnlySnapshot(runId)).run } catch { throw unavailable() }
      if (result.input.cells.some(cell => (cell.runId === runId || cell.historyRunIds.includes(runId)) &&
        (cell.platform !== run.platform || cell.appId !== run.comparison?.appContext.appId))) throw unavailable()
      let owner: ExecutionJournal | undefined
      for (const journal of this.#journals.values()) {
        if (journal.phase !== 'finished' || journal.projectIdentity !== this.#projectIdentity()) continue
        if (journal.runId === runId) { owner = journal; break }
        if (journal.suiteId && journal.suiteId === run.suiteId && (await this.#executionRuns(journal)).some(candidate => candidate.id === runId)) { owner = journal; break }
      }
      if (!owner) throw unavailable()
      const flowId = owner.target.kind === 'flow' ? owner.target.id : run.flowId
      if (!flowId || owner.target.kind === 'flow' && !this.#policy.allowedFlows.includes(flowId)
        || owner.target.kind === 'suite' && (!this.#policy.allowedSuites.includes(owner.target.id) || !project.project.suites[owner.target.id]?.cases.some(entry => entry.flow === flowId))) throw unavailable()
      const yaml = project.project.flows[flowId]
      if (!yaml) throw unavailable()
      const header = inspectFlowHeader(yaml)
      if (!this.#allowedHeader(header.platform, header.appId) || run.flowId !== flowId || run.platform !== header.platform || run.comparison?.appContext.appId !== header.appId) throw unavailable()
    }
    const { input: _input, ...publicResult } = result
    for (const assetId of externalIds) if (!await this.application.externalAssets.authorized(assetId, await this.externalProject())) throw unavailable()
    const allowed = { ui: this.#shared('plan'), business: this.#shared('extension'), visual: this.#shared('image'), cleanup: this.#shared('executor-log'), evidence: Boolean(this.#policy.sharedEvidence.length) }
    const projectSummary = (summary: typeof result.current) => ({ ...summary, cells: summary.cells.map(cell => ({ ...cell,
      title: allowed.ui ? cell.title : cell.id,
      dimensions: Object.fromEntries(Object.entries(cell.dimensions).map(([name, status]) => [name, allowed[name as keyof typeof allowed] ? status : 'withheld'])),
      reasons: cell.reasons.filter(reason => !Object.entries(allowed).some(([domain, shared]) => !shared && reason.startsWith(`${domain}-`))),
    })) })
    return { ...publicResult, generated: projectSummary(result.generated), current: projectSummary(result.current), evidenceDetailBoundary: 'metadata-only; sharing-policy-applied' }
  }

  /** Agent access is read-only and scoped to a registered execution, not a guessable report ID. */
  async triageReport(reportId: string, evidenceRef?: string): Promise<object> {
    this.#requireEnabled()
    await this.#init()
    const unavailable = () => fail('not_found', 'Triage report was not found or is unavailable')
    let current: Awaited<ReturnType<WorkbenchTriageService['getReport']>>
    try { current = await this.triage.getReport(reportId) }
    catch { throw unavailable() }
    const runId = current.report.targetRunId
    let run: TestRun
    try { run = (await this.workbench.store.readOnlySnapshot(runId)).run }
    catch { throw unavailable() }
    let owner: ExecutionJournal | undefined
    for (const journal of this.#journals.values()) {
      if (journal.phase !== 'finished' || journal.projectIdentity !== this.#projectIdentity()) continue
      if (journal.runId === runId) { owner = journal; break }
      if (journal.suiteId && journal.suiteId === run.suiteId) {
        try { if ((await this.#executionRuns(journal)).some(candidate => candidate.id === runId)) { owner = journal; break } }
        catch { throw unavailable() }
      }
    }
    if (!owner) throw unavailable()
    let project: { project: ProjectSnapshot; revision: string }
    try { project = await this.#loadCatalog() }
    catch { throw unavailable() }
    const flowId = owner.target.kind === 'flow' ? owner.target.id : run.flowId
    if (!flowId || owner.target.kind === 'flow' && !this.#policy.allowedFlows.includes(flowId) || owner.target.kind === 'suite' && (!this.#policy.allowedSuites.includes(owner.target.id) || !project.project.suites[owner.target.id]?.cases.some(entry => entry.flow === flowId))) throw fail('not_found', 'Triage report was not found or is unavailable')
    const yaml = project.project.flows[flowId]
    if (!yaml) throw fail('not_found', 'Triage report was not found or is unavailable')
    const header = inspectFlowHeader(yaml)
    if (!this.#allowedHeader(header.platform, header.appId)) throw fail('not_found', 'Triage report was not found or is unavailable')
    if (run.flowId !== flowId || run.platform !== header.platform || run.comparison?.appContext.appId !== header.appId) throw fail('not_found', 'Triage report was not found or is unavailable')
    const allowed = (name: string): boolean => {
      const file = [...run.evidence, ...run.steps.flatMap(step => step.evidence)].find(item => item.name === name)
      return Boolean(file && this.#shared(evidenceKind(file)))
    }
    if (evidenceRef !== undefined) {
      if (!allowed(evidenceRef)) throw fail('artifact_denied', 'Triage evidence metadata is not shared')
      const detail = await this.triage.evidence(reportId, evidenceRef)
      return { reportId, ...detail }
    }
    const sourceKind = (domain: string): ReturnType<typeof evidenceKind> | undefined => {
      if (domain === 'business-assertion' || domain === 'model-service' || domain === 'model-decision') return 'extension'
      if (domain === 'ui-assertion') return 'plan'
      if (domain === 'visual') return 'image'
      if (domain === 'locator') return 'xml'
      if (domain === 'device-driver' || domain === 'cleanup' || domain === 'cancelled') return 'executor-log'
      return undefined
    }
    const hiddenIds = new Set(current.report.facts.filter(fact => {
      const kind = sourceKind(fact.domain)
      return kind ? !this.#shared(kind) || fact.evidenceRefs.some(ref => !allowed(ref)) :
        !this.#policy.sharedEvidence.length || fact.evidenceRefs.some(ref => !allowed(ref))
    }).map(fact => fact.id))
    const facts = current.report.facts.filter(fact => !hiddenIds.has(fact.id))
    const routes = current.report.routes.filter(route => route.supportFactIds.some(id => !hiddenIds.has(id))).map(route => ({ ...route, supportFactIds: route.supportFactIds.filter(id => !hiddenIds.has(id)),
      counterFactIds: route.counterFactIds.filter(id => !hiddenIds.has(id)),
      basis: route.supportFactIds.some(id => hiddenIds.has(id)) ? 'undetermined' : route.basis,
      limitations: route.supportFactIds.some(id => hiddenIds.has(id)) ? [...route.limitations, 'evidence-withheld'] : route.limitations }))
    const summary = { reportId, targetRunId: runId, reportedVerdict: current.report.reportedVerdict,
      ...(current.report.analyzer ? { analyzer: current.report.analyzer } : {}),
      effectiveVerdict: current.report.effectiveVerdict, availability: current.availability, checkedAt: current.checkedAt,
      verification: { ui: this.#shared('plan') ? current.report.verification.ui : 'withheld',
        business: this.#shared('extension') ? current.report.verification.business : 'withheld',
        visual: this.#shared('image') ? current.report.verification.visual : 'withheld',
        cleanup: this.#shared('executor-log') ? current.report.verification.cleanup : 'withheld',
        evidence: this.#policy.sharedEvidence.length ? current.report.verification.evidence : 'withheld' },
      disposition: routes.length ? 'actionable' : hiddenIds.size ? 'unknown' : current.report.disposition,
      ...(hiddenIds.size ? {} : { focus: current.report.focus }), facts, routes,
      limitations: hiddenIds.size ? [...current.report.limitations, 'evidence-withheld'] : current.report.limitations,
      omitted: { ...current.report.omitted, facts: current.report.omitted.facts + hiddenIds.size }, state: current.report.state,
      retired: current.retired, ...(hiddenIds.size ? {} : { semanticDigest: current.report.semanticDigest }) }
    if (Buffer.byteLength(JSON.stringify(summary)) > 24 * 1024) throw fail('artifact_denied', 'Triage summary exceeds Agent budget')
    return summary
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#acceptance.stopAccepting()
    return this.#closePromise = closeInOrder([
      () => this.#acceptance.close(),
      async () => { if (this.#ownsApplication) await this.application.close() },
    ])
  }

  async #prepare(input: TestRunStartInput, project: ProjectSnapshot): Promise<ExecutionPlan | null> {
    const state = this.mirror.state()
    if (state.lifecycle !== 'streaming' || !state.sessionId) throw fail('device_busy', 'Connect an authorized device before starting a test')
    if (input.target.kind === 'flow') {
      if (!this.#policy.allowedFlows.includes(input.target.id) || !project.flows[input.target.id]) throw fail('not_registered', 'Flow is not registered')
      const plan = await compilePlan(project.flows[input.target.id]!, project, input.params ?? {})
      if (!this.#allowedHeader(plan.header.platform, plan.header.appId) || (input.platform && input.platform !== plan.header.platform)) throw fail('not_registered', 'Flow platform or app is not authorized')
      if (this.mirror.testPlatform !== plan.header.platform) throw fail('device_busy', 'Connected device platform does not match the flow')
      return plan
    }
    if (!this.#policy.allowedSuites.includes(input.target.id) || !project.suites[input.target.id]) throw fail('not_registered', 'Suite is not registered')
    const definition = project.suites[input.target.id]!
    for (const entry of definition.cases) {
      const yaml = project.flows[entry.flow]
      if (!yaml) throw fail('not_registered', `Suite references unknown flow ${entry.flow}`)
      const header = inspectFlowHeader(yaml)
      if (!this.#allowedHeader(header.platform, header.appId)) throw fail('not_registered', 'Suite contains an unauthorized platform or app')
      if (input.tags?.length && !input.tags.every((tag) => entry.tags.includes(tag))) continue
      const rows = entry.dataset ? project.datasets[entry.dataset] : [{ id: 'default', params: {} }]
      if (!rows) throw fail('not_registered', `Suite references unknown dataset ${entry.dataset}`)
      for (const row of rows) await compilePlan(yaml, project, { ...definition.params, ...entry.params, ...row.params, ...(input.params ?? {}) })
    }
    return null
  }

  async #dispatch(journal: ExecutionJournal, project: ProjectSnapshot, plan: ExecutionPlan | null): Promise<void> {
    let openGate!: () => void
    const executeGate = new Promise<void>((resolve) => { openGate = resolve })
    try {
      journal.phase = 'running'; journal.startedAt = new Date().toISOString(); await this.#save(journal)
      if (journal.target.kind === 'flow') {
        await this.workbench.start(plan!.yaml, undefined, undefined, { id: journal.runId!, source: 'agent', executeGate, plan: plan!, project, params: plan!.params, flowId:journal.target.id, comparisonKey:`flow:${journal.target.id}` })
        await this.#save(journal)
        if (String(journal.phase) === 'cancelling') await this.workbench.cancel(journal.runId!)
        openGate()
        await this.workbench.wait()
        const run = await this.workbench.get(journal.runId!)
        journal.summary = runSummary(run)
      } else {
        await this.suites.start(journal.target.id, { suiteId: journal.suiteId!, source: 'agent', executeGate, project, params: journal.input.params, tags: journal.input.tags, platform: journal.input.platform })
        if (String(journal.phase) === 'cancelling') await this.suites.cancel(journal.suiteId!)
        openGate()
        await this.suites.wait()
        const suite = await this.suites.get(journal.suiteId!)
        journal.summary = suiteSummary(suite)
      }
    } catch (error) {
      // A failure publishing the dispatched reference must not open a runnable gate.
      if (journal.runId && this.workbench.activeId === journal.runId) await this.workbench.cancel(journal.runId)
      if (journal.suiteId && this.suites.activeId === journal.suiteId) await this.suites.cancel(journal.suiteId).catch(() => undefined)
      openGate()
      if (journal.runId && this.workbench.activeId === journal.runId) await this.workbench.wait()
      if (journal.suiteId && this.suites.activeId === journal.suiteId) await this.suites.wait()
      journal.summary = { evidenceVerification: 'pending', verdict: 'inconclusive', exitCode: 2, error: errorMessage(error) }
    } finally {
      openGate()
      journal.phase = 'finished'; journal.endedAt = new Date().toISOString(); await this.#save(journal)
    }
  }

  async #status(journal: ExecutionJournal, cursor?: number, limit?: number): Promise<object> {
    // Do not advertise a durable terminal result while its final journal is still being synced.
    if (journal.phase === 'finished') await this.#jobs.get(journal.executionId)
    const result: Record<string, unknown> = {
      executionId: journal.executionId, requestId: journal.requestId, target: journal.target, source: journal.source,
      phase: journal.phase, acceptedAt: journal.acceptedAt, startedAt: journal.startedAt, endedAt: journal.endedAt,
      runId: journal.runId, suiteId: journal.suiteId, ...journal.summary,
      nextPollAfterMs: journal.phase === 'finished' ? 0 : 1_000,
    }
    if (journal.target.kind === 'flow' && journal.runId && journal.phase !== 'accepted') {
      try {
        const run = journal.phase === 'finished' ? await this.workbench.get(journal.runId) : await this.workbench.status(journal.runId)
        result.stage = run.stage ?? run.activity?.phase
        result.progress = { completedSteps: run.steps.filter((step) => step.status !== 'running').length, totalSteps: Math.max(run.steps.length, 1), currentStep: run.steps.find((step) => step.status === 'running')?.index }
        result.resultProjection = run.resultProjection
        if (journal.phase === 'finished' && run.resultProjection) {
          result.verdict = run.resultProjection.verdict
          result.exitCode = run.resultProjection.exitCode
          result.visualVerification = run.resultProjection.verification.visual.status
          result.evidenceVerification = run.resultProjection.evidenceAvailability === 'unavailable' ? 'failed' : journal.summary.evidenceVerification
        }
      } catch {
        // The acceptance journal is an independent requestId tombstone. Once the
        // media is trashed/purged, retain its reported verdict but never report a
        // currently clean pass without the original evidence.
        if (journal.phase === 'finished' && journal.summary.resultProjection) {
          result.resultProjection = unavailableProjection(journal.summary.resultProjection)
          result.verdict = 'inconclusive'; result.exitCode = 2; result.evidenceVerification = 'failed'
          result.error = 'Original run evidence is unavailable'
        }
      }
    }
    if (journal.target.kind === 'suite' && journal.suiteId && journal.phase !== 'accepted') {
      try {
        const suite = journal.phase === 'finished' ? await this.suites.get(journal.suiteId) : await this.suites.status(journal.suiteId)
        const start = boundedCursor(cursor), size = boundedLimit(limit)
        const cases = suite.cases.slice(start, start + size).map((entry) => ({ id: entry.id, flow: entry.flow, rowId: entry.rowId,
          status: entry.status, attempts: entry.attempts, ...(entry.resultProjections ? { resultProjections: entry.resultProjections } : {}) }))
        result.cases = cases; result.page = { cursor: start, returned: cases.length, total: suite.cases.length, ...(start + cases.length < suite.cases.length ? { nextCursor: start + cases.length } : {}) }
        if (journal.phase === 'finished') { result.exitCode = suite.exitCode; result.verdict = suite.exitCode === 0 ? 'pass' : suite.exitCode === 130 ? 'cancelled' : suite.exitCode === 1 ? 'fail' : 'inconclusive' }
      } catch { /* durable journal remains queryable before suite manifest exists */ }
    }
    const persistenceError = this.#journalFailures.get(journal.executionId)
    if (persistenceError !== undefined) {
      result.verdict = 'inconclusive'; result.exitCode = 2; result.evidenceVerification = 'failed'
      result.persistence = 'failed'; result.error = `Execution journal persistence failed: ${persistenceError}`
    }
    const rawProgress = result.progress as { completedSteps?: number; totalSteps?: number } | undefined
    const completed = rawProgress?.completedSteps ?? Number(result.completedCases ?? 0)
    const total = rawProgress?.totalSteps ?? Number(result.totalCases ?? (journal.phase === 'finished' ? 1 : 0))
    result.task = productTaskStatusSchema.parse({
      contractVersion: 1,
      taskId: `execution:${journal.executionId}`,
      kind: journal.target.kind === 'flow' ? 'test-run' : 'suite-run',
      phase: journal.phase,
      acceptedAt: journal.acceptedAt,
      ...(journal.startedAt ? { startedAt: journal.startedAt } : {}),
      ...(journal.endedAt ? { endedAt: journal.endedAt } : {}),
      cancelRequested: journal.phase === 'cancelling',
      progress: { stage: String(result.stage ?? journal.phase), completed, total },
      ...(result.verdict || result.exitCode !== undefined ? { result: { ...(result.verdict ? { verdict: result.verdict } : {}), ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}) } } : {}),
    })
    return result
  }

  async #executionRuns(journal: ExecutionJournal): Promise<TestRun[]> {
    if (journal.runId) {
      try { return [await this.workbench.get(journal.runId)] }
      catch { throw fail('artifact_unavailable', 'Original run evidence is unavailable') }
    }
    if (!journal.suiteId) return []
    const suite = await this.suites.get(journal.suiteId)
    return Promise.all(suite.cases.flatMap((entry) => entry.attempts).map((id) => this.workbench.get(id)))
  }

  async #readVerified(run: TestRun, file: EvidenceFile, journal: ExecutionJournal): Promise<Buffer> {
    try { return await this.workbench.store.readEvidence(run.id, file) }
    catch (error) {
      journal.summary.evidenceVerification = 'failed'; journal.summary.verdict = 'inconclusive'; journal.summary.error = `Evidence integrity failure: ${file.name}`
      await this.#save(journal)
      throw fail('artifact_corrupt', 'Artifact integrity verification failed')
    }
  }

  async #readImage(run: TestRun, file: EvidenceFile, journal: ExecutionJournal): Promise<TestEvidenceImage> {
    if (evidenceKind(file) !== 'image' || !this.#shared('image')) throw fail('artifact_denied', 'Historical image sharing is disabled')
    const bytes = await this.#readVerified(run, file, journal)
    const source = sharp(bytes, { failOn: 'error' })
    const metadata = await source.metadata()
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0)
    const scale = pixels > 4_000_000 ? Math.sqrt(4_000_000 / pixels) : 1
    let pipeline = source
    if (scale < 1) pipeline = pipeline.resize({ width: Math.max(1, Math.floor((metadata.width ?? 1) * scale)), height: Math.max(1, Math.floor((metadata.height ?? 1) * scale)), fit: 'inside' })
    let rendered = await pipeline.png({ compressionLevel: 9 }).toBuffer()
    if (rendered.byteLength > 2 * 1024 * 1024) rendered = await sharp(rendered).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png({ palette: true, quality: 85 }).toBuffer()
    if (rendered.byteLength > 2 * 1024 * 1024) throw fail('artifact_denied', 'Image cannot be rendered within the sharing limit')
    const output = await sharp(rendered).metadata()
    return { metadata: { executionId: journal.executionId, runId: run.id, artifactId: artifactId(run.id, file), originalHash: file.sha256, renditionHash: sha256(rendered), originalBytes: file.bytes, bytes: rendered.byteLength, width: output.width, height: output.height }, bytes: rendered, contentType: 'image/png' }
  }

  #shared(kind: ReturnType<typeof evidenceKind>): boolean { return this.#policy.sharedEvidence.includes(kind) }
  #allowedHeader(platform: 'android' | 'ios', appId: string): boolean {
    return (this.#policy.allowedPlatforms.length === 0 || this.#policy.allowedPlatforms.includes(platform))
      && (this.#policy.allowedAppIds.length === 0 || this.#policy.allowedAppIds.includes(appId))
  }
  #requireEnabled(): void { if (!this.#policy.enabled) throw fail('not_enabled', 'Agent test control is disabled') }
  #projectIdentity(): string { return sha256(this.#policy.projectPath) }
  #requestKey(requestId: string): string { return sha256(`${this.#projectIdentity()}\0${requestId}`) }
  async #loadCatalog(): Promise<{ project: ProjectSnapshot; revision: string }> {
    const project = await loadTestProject(this.#policy.projectPath)
    return { project, revision: sha256(stableJson({ project: project.sha256, flows: this.#policy.allowedFlows, suites: this.#policy.allowedSuites, platforms: this.#policy.allowedPlatforms, apps: this.#policy.allowedAppIds })) }
  }
  async #init(): Promise<void> { return this.#acceptance.init() }
  async #save(journal: ExecutionJournal): Promise<void> {
    await this.#acceptance.persist(journal, async write => {
      // Acceptance reserves a future UUID before its manifest exists.
      if (journal.runId && journal.referencePublications === undefined) {
        try { await this.workbench.store.readOnlySnapshot(journal.runId) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await write(journal); return }; throw error }
      }
      if (!journal.runId) { await write(journal); return }
      await syncBuiltinReferences(this.workbench.store, 'workbench:agent', journal.executionId, journal.referencePublications,
        hasAgentTombstone(journal) ? [] : [journal.runId], async publications => {
          await write({ ...journal, referencePublications: publications }); journal.referencePublications = publications
        })
    })
  }
  #find(input: TestRunStatusInput): ExecutionJournal {
    if (Boolean(input.executionId) === Boolean(input.requestId)) throw fail('invalid_arguments', 'Provide exactly one of executionId or requestId')
    const id = input.executionId ?? this.#requests.get(this.#requestKey(input.requestId!))
    const journal = id ? this.#journals.get(id) : undefined
    if (!journal) throw fail('not_found', 'Execution was not found')
    return journal
  }
  async #serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) throw fail('closed', 'Agent test control is closed')
    return this.#acceptance.serialized(operation)
  }
}

function validateStartInput(input: TestRunStartInput): void {
  if (!input || typeof input !== 'object' || !/^[\p{L}\p{N}._:-]{1,128}$/u.test(input.requestId)) throw fail('invalid_arguments', 'requestId must be 1-128 safe opaque characters')
  if (!input.target || !['flow', 'suite'].includes(input.target.kind) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(input.target.id)) throw fail('invalid_arguments', 'Invalid registered target')
  if (!/^[a-f0-9]{64}$/.test(input.catalogRevision)) throw fail('invalid_arguments', 'Invalid catalogRevision')
  if (Buffer.byteLength(JSON.stringify(input)) > 64 * 1024) throw fail('invalid_arguments', 'Request exceeds 64 KiB')
}
function accepted(journal: ExecutionJournal): object { return { executionId: journal.executionId, runId: journal.runId, suiteId: journal.suiteId, phase: journal.phase, acceptedAt: journal.acceptedAt } }
function runSummary(run: TestRun): JournalSummary {
  const result = (run as TestRun & { resultProjection?: RunResultProjection }).resultProjection ?? runResultProjection(run)
  return {
    ...(run.verdict ? { verdict: run.verdict } : {}), exitCode: result.exitCode,
    ...(run.stage ? { stage: run.stage } : {}),
    ...(run.error ? { error: errorMessage(run.error) } : {}),
    cleanup: run.cleanup, businessVerification: run.businessVerification,
    visualVerification: result.verification.visual.status,
    evidenceVerification: result.verification.evidence.status === 'pass' ? 'verified'
      : result.verification.evidence.status === 'not-performed' ? 'pending' : 'failed',
    resultProjection: result,
  }
}
function unavailableProjection(original: RunResultProjection): RunResultProjection {
  const projection = structuredClone(original)
  projection.verdict = 'inconclusive'; projection.clean = false; projection.exitCode = 2
  projection.evidenceAvailability = 'unavailable'; projection.verification.evidence.status = 'fail'
  if (!projection.reasons.some(reason => reason.code === 'evidence-unavailable'))
    projection.reasons.push({ domain: 'evidence', code: 'evidence-unavailable', evidenceRefs: [] })
  return projection
}
function suiteSummary(suite: SuiteRun): JournalSummary { return { ...(suite.exitCode === undefined ? {} : { exitCode: suite.exitCode }), verdict: suite.exitCode === 0 ? 'pass' : suite.exitCode === 1 ? 'fail' : 'inconclusive', ...(suite.error ? { error: errorMessage(suite.error) } : {}), completedCases: suite.cases.filter((entry) => !['queued', 'running'].includes(entry.status)).length, totalCases: suite.cases.length, evidenceVerification: suite.exitCode === 2 ? 'failed' : 'verified' } }
function evidenceEntries(run: TestRun): Array<{ file: EvidenceFile; step?: number }> { return [...run.evidence.map((file) => ({ file })), ...run.steps.flatMap((step) => step.evidence.map((file) => ({ file, step: step.index })))] }
function evidenceKind(file: EvidenceFile): 'flow' | 'plan' | 'extension' | 'executor-log' | 'xml' | 'image' { if (file.contentType === 'image/png') return 'image'; if (file.name.endsWith('.xml')) return 'xml'; if (file.name.startsWith('executor')) return 'executor-log'; if (file.name === 'flow.yaml') return 'flow'; if (file.name === 'plan.json') return 'plan'; return 'extension' }
function artifactId(runId: string, file: EvidenceFile): string { return createHash('sha256').update(`${runId}\0${file.name}\0${file.sha256}`).digest('hex') }
function evidenceMetadata(entry: { run: TestRun; file: EvidenceFile; step?: number; artifactId: string; kind: ReturnType<typeof evidenceKind> }): object { return { artifactId: entry.artifactId, runId: entry.run.id, step: entry.step, kind: entry.kind, contentType: entry.file.contentType, bytes: entry.file.bytes, sha256: entry.file.sha256, recovered: entry.file.recovered === true, incomplete: entry.file.incomplete === true } }
function boundedCursor(value?: number): number { if (value === undefined) return 0; if (!Number.isInteger(value) || value < 0 || value > 500) throw fail('invalid_arguments', 'cursor must be an integer from 0 to 500'); return value }
function boundedLimit(value?: number): number { if (value === undefined) return 20; if (!Number.isInteger(value) || value < 1 || value > 50) throw fail('invalid_arguments', 'limit must be an integer from 1 to 50'); return value }
function stableJson(value: unknown): string { return JSON.stringify(sort(value)) }
function sort(value: unknown): unknown { if (Array.isArray(value)) return value.map(sort); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sort(entry)])); return value }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512) }
function fail(code: string, message: string): TestRunControlError { return new TestRunControlError(`mobile_mirror_${code}`, message) }
