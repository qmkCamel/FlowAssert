import { REPORT_STYLE_CSP_HASH } from './workbench-report-html.js'
import { DoctorService } from './doctor.js'
import { preflightInputSchema } from './environment-preflight.js'
import { handleWorkbenchRunsHttp } from './viewer-workbench-runs-http.js'
import { ViewerInspectionHttp } from './viewer-inspection-http.js'
import { junitReport } from './workbench-suites.js'
import { loadTestProject } from './workbench-project.js'
import { acceptanceCapabilities, exportAcceptanceProject, exportBusinessTemplate } from './workbench-acceptance-project.js'
import { handleAcceptanceHttp } from './viewer-workbench-acceptance-http.js'
import { handleExternalHttp } from './viewer-workbench-external-http.js'
import { handleOcrHttp } from './viewer-workbench-ocr-http.js'
import { handleMatrixHttp } from './viewer-device-matrix-http.js'
import { compilePlan } from './workbench-plan.js'
import { handleWorkbenchShareHttp } from './viewer-workbench-share-http.js'
import { handleWorkbenchRetentionHttp } from './viewer-workbench-retention-http.js'
import { handleWorkbenchTrendsHttp } from './viewer-workbench-trends-http.js'
import { handleWorkbenchBaselinesHttp } from './viewer-workbench-baselines-http.js'
import { handleWorkbenchTriageHttp } from './viewer-workbench-triage-http.js'
import { handleRepairCasesHttp } from './viewer-workbench-repair-cases-http.js'
import { lintWorkbenchFlow, lintWorkbenchSyntax, validationErrorLine } from './workbench-lint.js'
import { z } from 'zod'
import { TriageError } from './workbench-triage-service.js'
import { RepairError } from './workbench-repair-contracts.js'
import type { TestRunCoordinator } from './test-run-control.js'
import { access, readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Config } from './config.js'
import { errorMessage } from './abort.js'
import {
  ConnectionAssistantError,
  parseConnectionAssistantCancelInput,
  parseConnectionAssistantCheckInput,
  parseConnectionAssistantConnectInput,
  type ConnectionAssistantApi,
} from './connection-assistant.js'
import type { ConnectionAssistantPlatform } from './connection-assistant.js'
import type { MirrorAction, ProviderKind, StartMirrorInput, ViewerMediaClientFailureCode, ViewerMediaPacket } from './types.js'
import type { MirrorService } from './mirror-service.js'
import { WorkbenchApplication } from './workbench-application.js'
import { createDeviceServices } from './device-services.js'
import { closeInOrder } from './lifecycle.js'
import { appiumPublicErrorCode, appiumPublicErrorMessage, type AppiumPublicErrorCode } from './providers/appium-provider.js'
import { encodeH264Envelope } from './scrcpy-protocol.js'
import { ViewerMediaError } from './viewer-media-error.js'
import { ViewerMediaSubscriptionConflict } from './viewer-media-coordinator.js'
import { WdaStartError } from './wda-errors.js'
import { AuthoringError } from './workbench-authoring.js'
import { AcceptanceError } from './workbench-acceptance.js'
import { CaseLibraryError } from './workbench-cases.js'
import { queryReportSummaries } from './workbench-report-query.js'
import { authoringHistory } from './workbench-authoring-history.js'
import { appendAuthoringDocument, describeAuthoringDocument, editAuthoringDocument, editAuthoringHeader, exportAuthoringProject } from './workbench-authoring-document.js'

export interface ViewerMediaRelayDiagnostics {
  transport: 'scrcpy-h264' | 'wda-mjpeg' | null
  streamStartedAt: number | null
  firstFrameAt: number | null
  lastFrameAt: number | null
  frameCount: number
  relayFps: number | null
}

export interface ViewerLocalSetupSummary {
  persistenceAvailable: boolean
  preferredPlatform: ConnectionAssistantPlatform | null
}


export class ViewerServer {
  readonly #config: Config
  readonly #disposeServiceOnClose: boolean
  readonly #disposeAssistantOnClose: boolean
  readonly service: MirrorService
  readonly assistant: ConnectionAssistantApi | null
  readonly #localSetup: () => ViewerLocalSetupSummary
  readonly application: WorkbenchApplication
  readonly #ownsApplication: boolean
  readonly #coordinator: TestRunCoordinator | undefined
  #closePromise: Promise<void> | undefined
  #inspection = new ViewerInspectionHttp()
  #server: Server | null = null
  #listenPromise: Promise<void> | undefined
  #listenerClosed = false
  #externalUploads = 0
  #port: number
  #mediaDiagnostics: Omit<ViewerMediaRelayDiagnostics, 'relayFps'> = {
    transport: null,
    streamStartedAt: null,
    firstFrameAt: null,
    lastFrameAt: null,
    frameCount: 0,
  }

  constructor(config: Config, options: {
    service?: MirrorService
    assistant?: ConnectionAssistantApi | null
    disposeServiceOnClose?: boolean
    disposeAssistantOnClose?: boolean
    workbenchProjectPath?: string
    workbenchRoot?: string
    webTests?: boolean
    recoveryPlanner?: import('./workbench-recovery.js').RecoveryPlanner
    coordinator?: TestRunCoordinator
    application?: WorkbenchApplication
    localSetup?: () => ViewerLocalSetupSummary
  } = {}) {
    this.#config = config
    this.#coordinator = options.coordinator
    if (options.application && options.coordinator && options.application !== options.coordinator.application) throw new TypeError('Viewer application mismatch')
    this.#ownsApplication = !options.application && !options.coordinator
    if (options.service && !Object.hasOwn(options, 'assistant')) {
      throw new TypeError('A custom Viewer service requires an explicit assistant')
    }
    if (!options.service && Object.hasOwn(options, 'assistant')) {
      throw new TypeError('A custom Viewer assistant requires a matching custom service')
    }
    this.#disposeServiceOnClose = options.disposeServiceOnClose ?? options.service === undefined
    this.#disposeAssistantOnClose = options.disposeAssistantOnClose ?? options.service === undefined
    this.#port = config.viewerPort
    this.#localSetup = options.localSetup ?? (() => ({ persistenceAvailable: false, preferredPlatform: null }))
    if (options.service) {
      this.service = options.service
      this.assistant = options.assistant ?? null
    } else {
      const devices = createDeviceServices(config, this.url)
      this.service = devices.service
      this.assistant = devices.assistant
    }
    this.application = options.application ?? options.coordinator?.application ?? new WorkbenchApplication(this.service, {
      ...(options.webTests !== undefined ? { webTests: options.webTests } : {}),
      ...(options.workbenchRoot ? { root: options.workbenchRoot } : {}),
      ...(options.workbenchProjectPath ? { projectPath: options.workbenchProjectPath } : {}),
      ...(options.recoveryPlanner ? { planner: options.recoveryPlanner } : {}),
    })
    if (this.application.workbench.mirror !== this.service) throw new TypeError('Viewer application must use the same device service')
  }

  get workbench() { return this.application.workbench }
  get suites() { return this.application.suites }
  get comparisons() { return this.application.comparisons }
  get triage() { return this.application.triage }
  get trends() { return this.application.trends }
  get share() { return this.application.share }
  get shareJobs() { return this.application.shareJobs }
  get repair() { return this.application.repair }
  get repairCases() { return this.application.repairCases }
  get retention() { return this.application.retention }

  async closeWorkbench(): Promise<void> { if (this.#ownsApplication) await this.application.close() }

  get url(): string {
    const host = this.#config.viewerHost === '::1' ? '[::1]' : this.#config.viewerHost
    return `http://${host}:${this.#port}`
  }

  mediaDiagnostics(): ViewerMediaRelayDiagnostics {
    const snapshot = { ...this.#mediaDiagnostics }
    const durationMs = snapshot.firstFrameAt !== null && snapshot.lastFrameAt !== null
      ? snapshot.lastFrameAt - snapshot.firstFrameAt
      : 0
    return {
      ...snapshot,
      relayFps: snapshot.frameCount >= 2 && durationMs > 0
        ? (snapshot.frameCount - 1) * 1_000 / durationMs
        : null,
    }
  }

  async listen(): Promise<void> {
    if (this.#listenerClosed) throw new Error('Viewer is closed')
    return this.#listenPromise ??= this.#listen()
  }

  async #listen(): Promise<void> {
    if (this.#server) return
    await access(new URL('../viewer/index.html', import.meta.url))
    const server = createServer((request, response) => {
      void this.#handle(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.#config.viewerPort, this.#config.viewerHost, () => resolve())
    })
    this.#server = server
    const address = server.address()
    if (address && typeof address === 'object') this.#port = address.port
    this.service.updateViewerUrl(this.url)
  }

  close(): Promise<void> {
    return this.#closePromise ??= closeInOrder([
      () => this.closeListener(),
      () => this.closeWorkbench(),
      () => { if (this.#disposeAssistantOnClose) this.assistant?.dispose() },
      async () => { if (this.#disposeServiceOnClose) await this.service.dispose() },
    ])
  }

  async closeListener(): Promise<void> {
    this.#listenerClosed = true
    await this.#listenPromise?.catch(() => undefined)
    const server = this.#server
    this.#server = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setSecurityHeaders(response)
    try {
      const url = new URL(request.url ?? '/', this.url)
      if (request.method === 'GET' && url.pathname === '/api/workbench/investigation') {
        assertSameOrigin(request, this.url)
        const runId = z.string().uuid().parse(url.searchParams.get('runId')), followup = url.searchParams.get('followup')
        json(response, 200, await this.application.investigation.inspect(runId, followup ? z.string().uuid().parse(followup) : undefined, requestSignal(request))); return
      }
      if (request.method === 'GET' && url.pathname === '/api/workbench/reports') {
        assertSameOrigin(request, this.url)
        if (new Set(url.searchParams.keys()).size !== [...url.searchParams.keys()].length) throw new Error('Duplicate report query parameter')
        json(response, 200, queryReportSummaries(await this.workbench.reportSummaries(), Object.fromEntries(url.searchParams))); return
      }
      if (request.method === 'GET' && url.pathname === '/api/workbench/history') {
        assertSameOrigin(request, this.url)
        json(response, 200, authoringHistory(await this.workbench.list(), { query: url.searchParams.get('query') ?? '', ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') } : {}) })); return
      }
      if (url.pathname === '/api/workbench/cases' || url.pathname.startsWith('/api/workbench/cases/')) {
        assertSameOrigin(request, this.url)
        const parts = url.pathname.split('/').slice(4), [caseId, action, revisionId] = parts
        if (request.method === 'GET') {
          if (!caseId) { json(response, 200, await this.application.cases.list({ query: url.searchParams.get('query') ?? '', tag: url.searchParams.get('tag') ?? '', archived: url.searchParams.get('archived') === 'true', ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') } : {}) })); return }
          if (parts.length === 1) { json(response, 200, await this.application.cases.get(caseId)); return }
          if (parts.length === 3 && action === 'revisions' && revisionId) { json(response, 200, await this.application.cases.revision(caseId, revisionId)); return }
        }
        if (request.method === 'POST') {
          assertMutationOrigin(request, this.url)
          if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new AuthoringError('authoring-json-required', 415)
          const body = await readJson(request, 80 * 1024)
          if (!caseId) { json(response, 200, await this.application.cases.save(null, body)); return }
          if (parts.length === 2 && action === 'revisions') { json(response, 200, await this.application.cases.save(caseId, body)); return }
          if (parts.length === 2 && action === 'archive') { json(response, 200, await this.application.cases.archive(caseId, body)); return }
        }
        json(response, 404, { code: 'case-route-not-found' }); return
      }
      if (url.pathname.startsWith('/api/workbench/authoring/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'GET' && url.pathname === '/api/workbench/authoring/status') {
          json(response, 200, await this.application.authoring.status(url.searchParams.get('requestId') ?? '')); return
        }
        if (request.method !== 'POST') { json(response, 405, { code: 'authoring-method-not-allowed' }); return }
        assertMutationOrigin(request, this.url)
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new AuthoringError('authoring-json-required', 415)
        const body = await readJson(request, 80 * 1024)
        if (url.pathname === '/api/workbench/authoring/document') { json(response, 200, describeAuthoringDocument(body)); return }
        if (url.pathname === '/api/workbench/authoring/edit') { json(response, 200, editAuthoringDocument(body)); return }
        if (url.pathname === '/api/workbench/authoring/header') { json(response, 200, editAuthoringHeader(body)); return }
        if (url.pathname === '/api/workbench/authoring/append') { json(response, 200, appendAuthoringDocument(body)); return }
        if (url.pathname === '/api/workbench/authoring/export') { json(response, 200, await exportAuthoringProject(body)); return }
        if (url.pathname === '/api/workbench/authoring/validate') { json(response, 200, await this.application.authoring.validate(body)); return }
        if (url.pathname === '/api/workbench/authoring/run') { json(response, 202, await this.application.authoring.run(body, requestSignal(request))); return }
        if (url.pathname === '/api/workbench/authoring/cancel') {
          const input = z.object({ executionId: z.string().uuid() }).strict().parse(body)
          json(response, 202, await this.application.authoring.cancel(input.executionId)); return
        }
        json(response, 404, { code: 'authoring-route-not-found' }); return
      }
      if (url.pathname === '/api/test-project') {
        assertSameOrigin(request,this.url)
        if(request.method!=='GET')throw new Error('Read-only endpoint')
        const project=await loadTestProject(this.workbench.projectPath)
        json(response,200,{flows:Object.keys(project.flows),suites:Object.entries(project.suites).map(([id,suite])=>({id,name:suite.name}))});return
      }
      if(url.pathname==='/api/suites'||url.pathname.startsWith('/api/suites/')) {
        assertSameOrigin(request,this.url)
        const parts=url.pathname.split('/').filter(Boolean),id=parts[2]??''
        if(request.method==='GET'&&parts.length===2){json(response,200,{activeId:this.suites.activeId,runs:await this.suites.list()});return}
        if(request.method==='POST') {
          assertMutationOrigin(request,this.url)
          if(parts.length===2) {
            const body=z.object({id:z.string(),localEvidence:z.literal(true),tags:z.array(z.string()).optional(),platform:z.enum(['android','ios']).optional(),params:z.record(z.unknown()).optional(),parentSuiteId:z.string().optional()}).strict().parse(await readJson(request,80*1024))
            json(response,202,await this.suites.start(body.id,body));return
          }
          if(parts.length===4&&parts[3]==='cancel'){json(response,202,await this.suites.cancel(id));return}
          if(parts.length===4&&parts[3]==='release-evidence'){
            const body=z.object({confirm:z.string()}).strict().parse(await readJson(request,1024))
            if(body.confirm!==`RELEASE SUITE ${id}`)throw new Error('Explicit suite evidence release confirmation is required')
            json(response,200,await this.suites.freezeForRetention(id));return
          }
        }
        if(request.method==='GET'&&parts.length===3){json(response,200,await this.suites.get(id));return}
        if(request.method==='GET'&&parts.length===4&&parts[3]==='junit') {response.writeHead(200,{'content-type':'application/xml; charset=utf-8'});response.end(junitReport(await this.suites.get(id)));return}
        throw new Error('Unknown suite endpoint')
      }
      if (url.pathname.startsWith('/api/workbench/ocr/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        const upload = request.method === 'POST' && url.pathname.endsWith('/preview')
        if (upload && this.#externalUploads >= 2) throw new Error('ocr-upload-busy')
        if (upload) this.#externalUploads++
        try { await handleOcrHttp({ url, method: request.method, application: this.application, readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value) }) }
        finally { if (upload) this.#externalUploads-- }
        return
      }
      if (url.pathname === '/api/workbench/matrices' || url.pathname.startsWith('/api/workbench/matrices/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        await handleMatrixHttp({ url, method: request.method, matrix: this.application.matrix, readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value) })
        return
      }
      if (url.pathname === '/api/workbench/repairs' || url.pathname.startsWith('/api/workbench/repairs/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        const channel = request.headers['x-mobile-mirror-approval-channel'] === 'interactive-cli' ? 'interactive-cli' : 'local-viewer'
        await handleRepairCasesHttp({ pathname: url.pathname, method: request.method, searchParams: url.searchParams,
          channel, service: this.repairCases, readJson: limit => readJson(request, limit),
          json: (status, value) => json(response, status, value) })
        return
      }
      if (url.pathname === '/api/workbench/external-assets' || url.pathname.startsWith('/api/workbench/external-assets/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        const upload = request.method === 'POST' && url.pathname.endsWith('/preview')
        if (upload && this.#externalUploads >= 2) throw new Error('external-busy')
        if (upload) this.#externalUploads++
        try {
        await handleExternalHttp({ url, method: request.method, service: this.application.externalAssets,
          project: async () => { if (!this.#coordinator) throw new Error('external-no-registered-project'); return this.#coordinator.externalProject() },
          readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value),
          download: file => { response.writeHead(200, { 'content-type': file.contentType, 'content-disposition': `attachment; filename="${file.name}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }); response.end(file.bytes) } })
        } finally { if (upload) this.#externalUploads-- }
        return
      }
      if (url.pathname === '/api/workbench/acceptance-records' || url.pathname.startsWith('/api/workbench/acceptance-records/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        const signal = responseSignal(request, response)
          await handleAcceptanceHttp({ url, method: request.method, service: this.application.acceptanceRecords,
            readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value), signal,
            download: (name, type, text) => { response.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'content-disposition': `attachment; filename="${name}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }); response.end(text) } })
        return
      }
      if(url.pathname==='/api/workbench/comparison-candidates') {
        assertSameOrigin(request,this.url);if(request.method!=='GET')throw new Error('Read-only endpoint')
        const runId=url.searchParams.get('runId')??'',cursor=Number(url.searchParams.get('cursor')??0),limit=Number(url.searchParams.get('limit')??20)
        if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid pagination')
        json(response,200,await this.comparisons.candidates(runId,cursor,limit));return
      }
      if (url.pathname === '/api/workbench/triage-jobs' || url.pathname.startsWith('/api/workbench/triage-jobs/') || url.pathname.startsWith('/api/workbench/triage-reports/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        await handleWorkbenchTriageHttp({ pathname: url.pathname, request, service: this.triage,
          readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value) })
        return
      }
      if (url.pathname === '/api/workbench/baselines' || url.pathname === '/api/workbench/baselines/candidate' || url.pathname === '/api/workbench/baselines/approve') {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        await handleWorkbenchBaselinesHttp({ pathname: url.pathname, method: request.method, workbench: this.workbench, readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value) })
        return
      }
      if (url.pathname === '/api/workbench/trends' || url.pathname === '/api/workbench/trends/rebuild' || url.pathname === '/api/workbench/trends/compare') {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        await handleWorkbenchTrendsHttp({ pathname: url.pathname, method: request.method, searchParams: url.searchParams, trends: this.trends, readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value), responseSignal: () => responseSignal(request, response) })
        return
      }
      if (url.pathname.startsWith('/api/workbench/share/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        await handleWorkbenchShareHttp({ request, response, pathname: url.pathname, jobs: this.shareJobs, readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value), responseSignal: () => responseSignal(request, response) })
        return
      }
      if (request.method === 'POST' && (url.pathname === '/api/workbench/repair/suggest' || url.pathname === '/api/workbench/repair/confirm')) {
        assertSameOrigin(request, this.url); assertMutationOrigin(request, this.url)
        const body = z.object({ sourceRunId: z.string().uuid(), baselineRunId: z.string().uuid().optional(), digest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(await readJson(request, 1024))
        if (url.pathname.endsWith('/suggest')) json(response, 200, await this.repair.suggest(body.sourceRunId, body.baselineRunId))
        else {
          if (!body.baselineRunId || !body.digest) throw new Error('Repair confirmation requires a reviewed candidate')
          json(response, 200, await this.repair.confirm(body.sourceRunId, body.baselineRunId, body.digest))
        }
        return
      }
      if (url.pathname === '/api/workbench/retention' || url.pathname.startsWith('/api/workbench/retention/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        await handleWorkbenchRetentionHttp({ pathname: url.pathname, method: request.method, retention: this.retention, readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value) })
        return
      }
      if(url.pathname==='/api/workbench/comparisons'||url.pathname.startsWith('/api/workbench/comparisons/')) {
        assertSameOrigin(request,this.url);const parts=url.pathname.split('/').filter(Boolean),id=parts[3]??''
        if(request.method==='POST'&&parts.length===3){assertMutationOrigin(request,this.url);const body=z.object({baselineRunId:z.string(),targetRunId:z.string(),masks:z.array(z.object({x:z.number().int().nonnegative(),y:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}).strict()).max(20).optional(),slowerByMs:z.number().nonnegative().optional(),slowerByRatio:z.number().nonnegative().optional()}).strict().parse(await readJson(request,16*1024));json(response,202,await this.comparisons.start(body.baselineRunId,body.targetRunId,{...(body.masks?{masks:body.masks}:{}),...(body.slowerByMs!==undefined?{slowerByMs:body.slowerByMs}:{}),...(body.slowerByRatio!==undefined?{slowerByRatio:body.slowerByRatio}:{})}));return}
        if(request.method==='GET'&&parts.length===4){json(response,200,await this.comparisons.get(id));return}
        if(request.method==='POST'&&parts.length===5&&parts[4]==='cancel'){assertMutationOrigin(request,this.url);json(response,202,await this.comparisons.cancel(id));return}
        if(request.method==='GET'&&parts.length===5&&parts[4]==='report'){const bytes=await this.comparisons.reportBytes(id);response.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="comparison-${id}.json"`,'cache-control':'no-store'});response.end(bytes);return}
        if(request.method==='GET'&&parts.length===5&&parts[4]==='diagnostic-context'){json(response,200,await this.comparisons.diagnosticContext(id));return}
        if(request.method==='GET'&&parts.length===6&&parts[4]==='evidence'){json(response,200,await this.comparisons.evidenceDetail(id,decodeURIComponent(parts[5]??'')));return}
        if(request.method==='GET'&&parts.length===6&&parts[4]==='artifacts'){const {file,bytes}=await this.comparisons.readArtifact(id,parts[5]??'');response.writeHead(200,{'content-type':file.contentType,'cache-control':'no-store','content-disposition':`inline; filename="${file.name}"`});response.end(bytes);return}
        throw new Error('Unknown comparison endpoint')
      }
      if (url.pathname === '/api/runs' || url.pathname.startsWith('/api/runs/')) {
        assertSameOrigin(request, this.url)
        if (request.method === 'POST') assertMutationOrigin(request, this.url)
        await handleWorkbenchRunsHttp({ pathname: url.pathname, method: request.method, request, response, workbench: this.workbench, repair: this.repair,
          cases: this.application.cases, origin: this.url,
          sessionId: () => this.service.state().sessionId, readJson: limit => readJson(request, limit), json: (status, value) => json(response, status, value) })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/workbench/acceptance/capabilities') {
        assertSameOrigin(request, this.url)
        json(response, 200, acceptanceCapabilities(await loadTestProject(this.workbench.projectPath))); return
      }
      if (request.method === 'POST' && url.pathname === '/api/workbench/investigation') {
        assertSameOrigin(request, this.url); assertMutationOrigin(request, this.url)
        const body = z.object({ runId: z.string().uuid(), followupRunId: z.string().uuid().optional() }).strict().parse(await readJson(request, 1024))
        const controller = new AbortController(), abort = () => controller.abort()
        response.once('close', abort)
        try { json(response, 200, await this.application.investigation.inspect(body.runId, body.followupRunId, controller.signal)) }
        finally { response.removeListener('close', abort) }
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/workbench/acceptance/fixture-template') {
        assertSameOrigin(request, this.url); assertMutationOrigin(request, this.url)
        z.object({ reviewed: z.literal(true) }).strict().parse(await readJson(request, 1024))
        const archive = await exportBusinessTemplate()
        response.writeHead(200, { 'content-type': 'application/x-tar', 'content-disposition': 'attachment; filename="mobile-business-template.tar"', 'cache-control': 'no-store' })
        response.end(archive); return
      }
      if (request.method === 'POST' && url.pathname === '/api/workbench/acceptance/export') {
        assertSameOrigin(request, this.url); assertMutationOrigin(request, this.url)
        const body = z.object({ yaml: z.string().min(1).max(64 * 1024), params: z.record(z.unknown()).default({}), reviewed: z.literal(true) }).strict().parse(await readJson(request, 80 * 1024))
        const archive = await exportAcceptanceProject(body.yaml, body.params)
        response.writeHead(200, { 'content-type': 'application/x-tar', 'content-disposition': 'attachment; filename="mobile-acceptance.tar"', 'cache-control': 'no-store' })
        response.end(archive); return
      }
      if (request.method === 'POST' && url.pathname === '/api/workbench/drafts/validate') {
        assertSameOrigin(request, this.url); assertMutationOrigin(request, this.url)
        const body = z.object({ yaml: z.string().min(1).max(64 * 1024), params: z.record(z.unknown()).default({}) }).strict().parse(await readJson(request, 80 * 1024))
        const project = await loadTestProject(this.workbench.projectPath)
        const syntax = lintWorkbenchSyntax(body.yaml)
        if (syntax.length) { json(response, 200, { valid: false, blockers: syntax, advice: [] }); return }
        const advice = lintWorkbenchFlow(body.yaml)
        try {
          const plan = await compilePlan(body.yaml, project, body.params)
          json(response, 200, { valid: true, name: plan.header.name, platform: plan.header.platform, appId: plan.header.appId, steps: plan.worstSteps, businessRequired: plan.header.verify.length > 0, blockers: [], advice })
        } catch (error) {
          json(response, 200, { valid: false, blockers: [{ severity: 'error', message: errorMessage(error), line: validationErrorLine(body.yaml, error) }], advice })
        }
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/inspection/capture') {
        await this.#inspection.capture(request, response, this.url, this.service, this.#config.startupTimeoutMs)
        return
      }
      if (request.method === 'GET' && url.pathname === '/inspection-query.js') {
        const data = await readFile(new URL('../lib/viewer/inspection-query.js', import.meta.url))
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); response.end(data); return
      }
      if (request.method === 'GET' && url.pathname === '/report-presentation.js') {
        const data = await readFile(new URL('../lib/viewer/report-presentation.js', import.meta.url))
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); response.end(data); return
      }
      if (request.method === 'GET' && url.pathname === '/selector-adapter.js') {
        const data = await readFile(new URL('../lib/viewer/selector-adapter.js', import.meta.url))
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); response.end(data); return
      }
      if (request.method === 'GET' && url.pathname === '/inspector.js') { await sendFile(response, 'inspector.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        json(response, 200, this.#viewState())
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/start') {
        assertMutationOrigin(request, this.url)
        const body = await readJson(request)
        const provider = providerFrom(body.provider, this.#config.defaultProvider)
        const input: StartMirrorInput = { provider }
        if (typeof body.sessionId === 'string' && body.sessionId) input.sessionId = body.sessionId
        if (typeof body.capabilities === 'object' && body.capabilities !== null && !Array.isArray(body.capabilities)) {
          input.capabilities = body.capabilities as Record<string, unknown>
        }
        json(response, 200, this.#viewState(await this.service.start(input, requestSignal(request))))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/stop') {
        assertMutationOrigin(request, this.url)
        json(response, 200, this.#viewState(await this.service.stop(requestSignal(request))))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/action') {
        assertMutationOrigin(request, this.url)
        const body = await readJson(request)
        json(response, 200, this.#viewState(await this.service.action(parseAction(body), requestSignal(request))))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/frame') {
        const cached = url.searchParams.get('cached') === '1'
        const frame = cached ? this.service.cachedFrame?.() ?? await this.service.frame(requestSignal(request)) : await this.service.frame(requestSignal(request))
        if (!frame) throw new Error('No cached frame is available')
        const frameState = this.service.state()
        response.writeHead(200, {
          'content-type': frame.contentType,
          'cache-control': 'no-store',
          'x-mobile-mirror-frame-status': cached ? 'cached' : frameState.lastErrorCode ? 'stale' : 'fresh',
        })
        response.end(frame.bytes)
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/media/stream') {
        if (url.search) throw new Error('Media stream parameters are not allowed')
        assertSameOrigin(request, this.url)
        await this.#streamMedia(request, response)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/media/client-failure') {
        assertMutationOrigin(request, this.url)
        const body = await readJson(request, 1024)
        if (Object.keys(body).some((key) => key !== 'generation' && key !== 'code')) {
          throw new Error('Invalid media failure report')
        }
        if (typeof body.generation !== 'string' || body.generation.length < 1 || body.generation.length > 64
          || !isClientFailureCode(body.code)) {
          throw new Error('Invalid media failure report')
        }
        const accepted = await this.service.reportMediaClientFailure(body.generation, body.code)
        json(response, accepted ? 202 : 409, { accepted })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/connection-assistant/check') {
        assertMutationOrigin(request, this.url)
        const assistant = this.#requireAssistant()
        const body = await readAssistantJson(request, 1024)
        json(response, 200, await assistantCall(() => assistant.check(parseConnectionAssistantCheckInput(body), requestSignal(request))))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/environment-preflight') {
        assertMutationOrigin(request, this.url)
        const body = z.object({ context: preflightInputSchema, recordingSupported: z.boolean().optional() }).strict().parse(await readJson(request, 4096))
        if (body.context.entry !== undefined && body.context.entry !== 'viewer') throw new Error('Invalid preflight entry')
        const report = await new DoctorService({ ...this.#config, agentTestControl: { ...this.#config.agentTestControl,
          enabled: this.#config.agentTestControl?.enabled ?? false, projectPath: this.workbench.projectPath ?? '',
          allowedFlows: this.#config.agentTestControl?.allowedFlows ?? [], allowedSuites: this.#config.agentTestControl?.allowedSuites ?? [],
          allowedPlatforms: this.#config.agentTestControl?.allowedPlatforms ?? [], allowedAppIds: this.#config.agentTestControl?.allowedAppIds ?? [],
          sharedEvidence: this.#config.agentTestControl?.sharedEvidence ?? [],
        } }, {
          ...(body.context.features?.ocr !== undefined && body.context.features.ocr !== 'off' || body.context.operation === 'test'
            ? { ocrCache: process.env.MOBILE_MIRROR_OCR_CACHE ?? `${this.workbench.store.root}/.ocr-helper` } : {}),
          ...(body.recordingSupported !== undefined ? { recordingSupported: body.recordingSupported } : {}),
        }).run({ ...body.context, entry: 'viewer' }, requestSignal(request))
        json(response, 200, report)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/connection-assistant/connect') {
        assertMutationOrigin(request, this.url)
        const assistant = this.#requireAssistant()
        const body = await readAssistantJson(request, 8192)
        json(response, 200, this.#viewState(await assistantCall(() => assistant.connect(parseConnectionAssistantConnectInput(body), requestSignal(request)))))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/connection-assistant/cancel') {
        assertMutationOrigin(request, this.url)
        const assistant = this.#requireAssistant()
        const body = await readAssistantJson(request, 1024)
        json(response, 200, await assistantCall(async () => assistant.cancel(parseConnectionAssistantCancelInput(body))))
        return
      }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        await sendFile(response, 'index.html', 'text/html; charset=utf-8')
        return
      }
      if (request.method === 'GET' && url.pathname === '/capture.js') {
        await sendFile(response, 'capture.js', 'text/javascript; charset=utf-8')
        return
      }
      if (request.method === 'GET' && url.pathname === '/environment-preflight.js') { await sendFile(response, 'environment-preflight.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/workbench.js') {
        await sendFile(response, 'workbench.js', 'text/javascript; charset=utf-8')
        return
      }
      if (request.method === 'GET' && url.pathname === '/workbench-acceptance.js') { await sendFile(response, 'workbench-acceptance.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/workbench-investigation.js') { await sendFile(response, 'workbench-investigation.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/workbench-change-acceptance.js') { await sendFile(response, 'workbench-change-acceptance.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/workbench-external.js') { await sendFile(response, 'workbench-external.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/workbench-ocr.js') { await sendFile(response, 'workbench-ocr.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/workbench-matrix.js') { await sendFile(response, 'workbench-matrix.js', 'text/javascript; charset=utf-8'); return }
      if (request.method === 'GET' && url.pathname === '/workbench-share.js') {
        await sendFile(response, 'workbench-share.js', 'text/javascript; charset=utf-8')
        return
      }
      if (request.method === 'GET' && ['/journey-web.js', '/report-workbench.js', '/screenshot-playback.js', '/report-catalog.js', '/report-redaction.js', '/report-mask-geometry.js', '/journey.js', '/journey-common.js', '/journey-router.js', '/journey-authoring.js', '/journey-analysis.js', '/workbench-trends.js', '/workbench-retention.js', '/workbench-history.js', '/workbench-results.js', '/workbench-baselines.js', '/workbench-repair.js', '/workbench-comparisons.js', '/workbench-triage.js'].includes(url.pathname)) {
        await sendFile(response, url.pathname.slice(1), 'text/javascript; charset=utf-8')
        return
      }
      if (request.method === 'GET' && url.pathname === '/app.js') {
        await sendFile(response, 'app.js', 'text/javascript; charset=utf-8')
        return
      }
      if (request.method === 'GET' && url.pathname === '/i18n.js') {
        await sendFile(response, 'i18n.js', 'text/javascript; charset=utf-8')
        return
      }
      if (request.method === 'GET' && url.pathname === '/styles.css') {
        await sendFile(response, 'styles.css', 'text/css; charset=utf-8')
        return
      }
      json(response, 404, { error: 'Not found' })
    } catch (error) {
      if (error instanceof AuthoringError || error instanceof AcceptanceError || error instanceof CaseLibraryError) {
        json(response, error instanceof AcceptanceError ? 409 : error.status, { code: error.code, error: error.code })
      } else if (error instanceof RepairError) {
        const status = error.code === 'repair-not-found' ? 404
          : ['repair-revision-conflict', 'repair-request-conflict', 'repair-stale-approval', 'repair-project-changed',
            'repair-reference-invalid', 'repair-unknown-mutation', 'repair-not-reproduced'].includes(error.code) ? 409
          : error.code === 'repair-approval-required' ? 403
          : error.code === 'repair-storage-insufficient' ? 507
          : error.code === 'repair-busy' ? 423
          : error.code === 'repair-capability-unavailable' || error.code === 'repair-interrupted' ? 503 : 400
        json(response, status, { code: error.code, error: error.code })
      } else if (error instanceof TriageError) {
        const status = ['request-conflict', 'stale-input', 'stale-review', 'stale-report', 'report-retired'].includes(error.code) ? 409
          : error.code === 'queue-full' ? 429 : ['evidence-not-found'].includes(error.code) ? 404 : 400
        json(response, status, { code: error.code, error: error.code })
      } else if (error instanceof ConnectionAssistantError) {
        json(response, assistantHttpStatus(error.code), { code: error.code, message: error.message })
      } else if (error instanceof WdaStartError) {
        json(response, 502, { code: error.code, message: error.action })
      } else {
        const appiumCode = appiumPublicErrorCode(error)
        if (appiumCode) {
          json(response, appiumHttpStatus(appiumCode), { code: appiumCode, message: appiumPublicErrorMessage(error) })
        } else {
          json(response, 400, { error: errorMessage(error) })
        }
      }
    }
  }

  #requireAssistant(): ConnectionAssistantApi {
    if (!this.assistant) throw new ConnectionAssistantError('assistant_platform_unsupported')
    return this.assistant
  }

  #viewState(state = this.service.state()): Record<string, unknown> {
    return {
      ...state,
      inspectionContext: this.service.viewerInspectionContext(),
      runOwner: this.service.runOwner ?? null,
      frameIntervalMs: this.#config.frameIntervalMs,
      agentScreenContentPolicy: this.#config.agentScreenContentPolicy,
      agentTextInputPolicy: this.#config.agentTextInputPolicy,
      agentAppControlPolicy: this.#config.agentAppControlPolicy,
      androidIgnoreHiddenApiPolicyError: this.#config.androidIgnoreHiddenApiPolicyError,
      iosWdaProvisioningMutationEnabled: this.#config.iosWdaAllowProvisioningDeviceRegistration,
      localSetup: this.#localSetup(),
    }
  }

  async #streamMedia(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let subscription
    try {
      subscription = this.service.subscribeMedia()
    } catch (error) {
      if (error instanceof ViewerMediaSubscriptionConflict) {
        json(response, 409, { error: 'A Viewer media subscription is already active' })
        return
      }
      if (error instanceof ViewerMediaError) {
        json(response, 503, { error: error.code })
        return
      }
      throw error
    }

    const signal = responseSignal(request, response)
    this.#mediaDiagnostics = {
      transport: subscription.transport,
      streamStartedAt: Date.now(),
      firstFrameAt: null,
      lastFrameAt: null,
      frameCount: 0,
    }
    response.writeHead(200, {
      'content-type': subscription.contentType,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-mobile-mirror-generation': subscription.generation,
    })
    try {
      const iterator = subscription.packets[Symbol.asyncIterator]()
      while (true) {
        const next = await nextPacketOrAbort(iterator, signal)
        if (next.done) break
        const packet = next.value
        if (packet.kind === 'key' || packet.kind === 'delta' || packet.kind === 'jpeg') {
          const now = Date.now()
          this.#mediaDiagnostics = {
            ...this.#mediaDiagnostics,
            firstFrameAt: this.#mediaDiagnostics.firstFrameAt ?? now,
            lastFrameAt: now,
            frameCount: this.#mediaDiagnostics.frameCount + 1,
          }
        }
        const bytes = subscription.transport === 'scrcpy-h264'
          ? encodeH264Envelope(packet, subscription.generation)
          : encodeMjpegPart(packet)
        if (bytes.byteLength === 0) continue
        if (!response.write(bytes)) await waitForDrainOrAbort(response, signal)
      }
      if (!response.writableEnded && !response.destroyed) response.end()
    } catch {
      if (!response.writableEnded && !response.destroyed) response.end()
    } finally {
      await subscription.close()
    }
  }
}

function appiumHttpStatus(code: AppiumPublicErrorCode): number {
  if (code === 'appium_server_unreachable') return 503
  if (code === 'appium_request_timeout' || code === 'appium_session_command_timeout') return 504
  return 502
}

async function sendFile(response: ServerResponse, name: string, contentType: string): Promise<void> {
  const path = new URL(`../viewer/${name}`, import.meta.url)
  const data = await readFile(path)
  response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
  response.end(data)
}

async function readJson(request: IncomingMessage, maxBytes = 65_536): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > maxBytes) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required')
  return parsed as Record<string, unknown>
}

async function readAssistantJson(request: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  try {
    return await readJson(request, maxBytes)
  } catch {
    throw new ConnectionAssistantError('assistant_input_invalid')
  }
}

async function assistantCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ConnectionAssistantError || error instanceof WdaStartError) throw error
    throw new ConnectionAssistantError('assistant_input_invalid')
  }
}

function providerFrom(value: unknown, fallback: ProviderKind): ProviderKind {
  if (value === undefined) return fallback
  if (value === 'mock' || value === 'appium') return value
  throw new Error('provider must be mock or appium')
}

function parseAction(body: Record<string, unknown>): MirrorAction {
  if (body.kind === 'back') return { kind: 'back' }
  if (body.kind === 'tap') {
    return { kind: 'tap', x: requiredNumber(body.x, 'x'), y: requiredNumber(body.y, 'y') }
  }
  if (body.kind === 'swipe') {
    return {
      kind: 'swipe',
      startX: requiredNumber(body.startX, 'startX'),
      startY: requiredNumber(body.startY, 'startY'),
      endX: requiredNumber(body.endX, 'endX'),
      endY: requiredNumber(body.endY, 'endY'),
      durationMs: body.durationMs === undefined ? 400 : requiredNumber(body.durationMs, 'durationMs'),
    }
  }
  throw new Error('kind must be tap, swipe, or back')
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`)
  return value
}

function requestSignal(request: IncomingMessage): AbortSignal {
  const controller = new AbortController()
  request.once('aborted', () => controller.abort(new Error('Client disconnected')))
  return controller.signal
}

function responseSignal(request: IncomingMessage, response: ServerResponse): AbortSignal {
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('Viewer media client disconnected'))
  request.once('aborted', abort)
  response.once('close', abort)
  return controller.signal
}

function assertSameOrigin(request: IncomingMessage, expectedOrigin: string): void {
  const origin = request.headers.origin
  if (origin !== undefined && origin !== expectedOrigin) throw new Error('Cross-origin media request rejected')
  const referer = request.headers.referer
  if (referer !== undefined) {
    let refererOrigin: string
    try {
      refererOrigin = new URL(referer).origin
    } catch {
      throw new Error('Cross-origin media request rejected')
    }
    if (refererOrigin !== expectedOrigin) throw new Error('Cross-origin media request rejected')
  }
}

function assertMutationOrigin(request: IncomingMessage, expectedOrigin: string): void {
  if (request.headers.origin !== expectedOrigin) {
    throw new ConnectionAssistantError('assistant_origin_required')
  }
}

function assistantHttpStatus(code: ConnectionAssistantError['code']): number {
  if (code === 'assistant_context_stale') return 410
  if (code === 'assistant_context_consumed') return 409
  if (code === 'assistant_appium_unavailable' || code === 'assistant_adb_unavailable'
    || code === 'assistant_uiautomator2_unavailable' || code === 'assistant_xcuitest_unavailable'
    || code === 'assistant_persistence_unavailable' || code === 'assistant_persistence_failed') return 503
  return 400
}

function isClientFailureCode(value: unknown): value is ViewerMediaClientFailureCode {
  return value === 'decoder-unsupported' || value === 'decoder-failed' || value === 'render-failed'
}

function encodeMjpegPart(packet: ViewerMediaPacket): Uint8Array {
  if (packet.kind !== 'jpeg') return new Uint8Array()
  const header = Buffer.from(`--mobile-mirror-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${packet.bytes.byteLength}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, Buffer.from(packet.bytes), Buffer.from('\r\n', 'ascii')])
}

async function nextPacketOrAbort(
  iterator: AsyncIterator<ViewerMediaPacket>,
  signal: AbortSignal,
): Promise<IteratorResult<ViewerMediaPacket>> {
  if (signal.aborted) throw signal.reason
  return await new Promise<IteratorResult<ViewerMediaPacket>>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void iterator.next().then(
      (result) => {
        signal.removeEventListener('abort', abort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

async function waitForDrainOrAbort(response: ServerResponse, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off('drain', drain)
      signal.removeEventListener('abort', abort)
    }
    const drain = () => {
      cleanup()
      resolve()
    }
    const abort = () => {
      cleanup()
      reject(signal.reason)
    }
    response.once('drain', drain)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader('content-security-policy', `default-src 'self'; img-src 'self' data: blob:; style-src 'self' '${REPORT_STYLE_CSP_HASH}'; script-src 'self'; connect-src 'self'`)
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('referrer-policy', 'no-referrer')
  response.setHeader('x-frame-options', 'DENY')
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(payload))
}
