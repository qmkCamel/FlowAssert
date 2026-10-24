import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config as ConfigSchema, type Config } from '../src/config.js'
import { registerTools } from '../src/tools.js'
import { MOBILE_MIRROR_TOOL_CONTRACTS, dshParameters } from '../src/tool-contracts.js'
import type { ScreenObservationSummary } from '../src/types.js'
import { ViewerServer } from '../src/viewer-server.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const viewers: ViewerServer[] = []
const runtimes: LocalDeviceRuntime[] = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(viewers.splice(0).map((viewer) => viewer.close()))
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

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
  mockStartupDelayMs: 0,
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

type RegisteredTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: { schema: unknown }
  execute(args: Record<string, unknown>, exec: { signal: AbortSignal; deferContext(context: unknown): void }): Promise<unknown>
}

describe('screen observation tools', () => {
  it('delivers verified historical evidence through a DSH attachment without binary JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-dsh-agent-')); temporaryDirectories.push(root)
    const projectPath = join(root, 'project.json')
    await writeFile(join(root, 'fixture.yaml'), 'name: DSH fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    await writeFile(projectPath, JSON.stringify({ flows: { fixture: 'fixture.yaml' } }))
    const agentConfig = ConfigSchema({ ...config, agentTestControl: {
      enabled: true, projectPath, allowedFlows: ['fixture'], allowedSuites: [], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: ['image'],
    } } as Config)
    const runtime = new LocalDeviceRuntime(agentConfig, { workbenchRoot: join(root, 'runs') }); runtimes.push(runtime)
    const registered: RegisteredTool[] = [], saved: Uint8Array[] = [], deferred: unknown[] = []
    registerTools({ tools: { register: (tool) => registered.push(tool as RegisteredTool) }, attachments: {
      imageLimits: { maxImageBytes: 8 * 1024 * 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 8 * 1024 * 1024, maxImagePixels: 4_000_000, mediaTypes: ['image/png'] },
      async saveImage(input) { saved.push(Uint8Array.from(input.data)); return { attachmentId: AttachmentId('historical-image'), mediaType: 'image/png', bytes: input.data.byteLength, width: 390, height: 844 } },
    } }, runtime.commands, agentConfig, { defineTool: (definition) => definition, createUserMessage })
    const exec = { signal: new AbortController().signal, deferContext: (value: unknown) => deferred.push(value) }
    const execute = async (name: string, args: Record<string, unknown> = {}) => registered.find((tool) => tool.name === name)!.execute(args, exec)
    await execute('mobile_mirror_start', { provider: 'mock' })
    const catalog = JSON.parse(String(await execute('mobile_mirror_test_catalog')))
    const accepted = JSON.parse(String(await execute('mobile_mirror_run_start', { requestId: 'dsh-evidence', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision })))
    await expect.poll(async () => JSON.parse(String(await execute('mobile_mirror_run_status', { executionId: accepted.executionId }))).phase, { timeout: 10_000 }).toBe('finished')
    const evidence = JSON.parse(String(await execute('mobile_mirror_run_evidence', { executionId: accepted.executionId })))
    const image = evidence.items.find((entry: { kind: string }) => entry.kind === 'image')
    const metadata = String(await execute('mobile_mirror_run_evidence', { executionId: accepted.executionId, artifactId: image.artifactId, format: 'image' }))
    expect(saved).toHaveLength(1); expect(deferred).toHaveLength(1)
    expect(metadata).toContain('renditionHash'); expect(metadata).not.toContain('base64'); expect(metadata).not.toContain('historical-image')
    const second = JSON.parse(String(await execute('mobile_mirror_run_start', { requestId: 'dsh-evidence-2', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision })))
    await expect.poll(async () => JSON.parse(String(await execute('mobile_mirror_run_status', { executionId: second.executionId }))).phase, { timeout: 10_000 }).toBe('finished')
    const firstStatus=JSON.parse(String(await execute('mobile_mirror_run_status',{executionId:accepted.executionId}))),secondStatus=JSON.parse(String(await execute('mobile_mirror_run_status',{executionId:second.executionId})))
    const privateFailure = await runtime.coordinator.workbench.get(secondStatus.runId)
    privateFailure.verdict = 'fail'
    privateFailure.businessVerification = 'fail'
    privateFailure.diagnostics = [{ domain: 'business-assertion', code: 'verifier-fail', phase: 'verify', retryable: false,
      evidenceRefs: [], observedAt: new Date().toISOString(), message: 'private billing secret' }]
    await runtime.coordinator.workbench.store.save(privateFailure)
    expect(firstStatus).toMatchObject({task:{contractVersion:1,kind:'test-run',phase:'finished',result:{exitCode:0}}})
    const started=await runtime.coordinator.comparisons.start(firstStatus.runId,secondStatus.runId)
    await expect.poll(async()=> (await runtime.coordinator.comparisons.get(started.id)).state,{timeout:10_000}).toMatch(/completed|partial/)
    const throughTool=JSON.parse(String(await execute('mobile_mirror_run_diagnostic_context',{comparisonId:started.id})))
    expect(throughTool).toEqual(await runtime.coordinator.comparisons.diagnosticContext(started.id));expect(runtime.viewer.comparisons).toBe(runtime.coordinator.comparisons)
    expect(throughTool.subject).toMatchObject({flowId:'fixture'})
    expect(JSON.stringify(throughTool)).not.toContain(root);expect(JSON.stringify(throughTool)).not.toContain('base64')
    const ref=throughTool.drillDown.evidenceRefs[0],detail=JSON.parse(String(await execute('mobile_mirror_run_diagnostic_context',{comparisonId:started.id,evidenceRef:ref})))
    expect(detail).toMatchObject({id:ref,artifactUrl:expect.stringMatching(/^\/api\/runs\//)})
    const triageJob = await runtime.coordinator.triage.start({ requestId: '5d3b7d88-2d14-4ed1-8147-526f59e0d426', targetRunId: secondStatus.runId })
    await expect.poll(async () => (await runtime.coordinator.triage.getJob(triageJob.jobId)).state, { timeout: 10_000 }).toBe('succeeded')
    const triageReportId = (await runtime.coordinator.triage.getJob(triageJob.jobId)).reportId!
    const triage = JSON.parse(String(await execute('mobile_mirror_run_triage', { reportId: triageReportId })))
    expect(triage).toMatchObject({ reportId: triageReportId, disposition: 'unknown' })
    expect(triage.facts).toEqual([])
    expect(triage.routes).toEqual([])
    expect(triage.verification.business).toBe('withheld')
    expect(JSON.stringify(triage)).not.toContain('private billing secret')
    expect(JSON.stringify(triage)).not.toContain('verifier-fail')
    expect(JSON.stringify(triage)).not.toContain(root)
    await expect(execute('mobile_mirror_run_triage', { reportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).rejects.toThrow()
  }, 15_000)

  it('returns canonical JSON and defers exactly one image context without Base64', async () => {
    const registered: RegisteredTool[] = []
    const saved: Uint8Array[] = []
    const deferred: unknown[] = []
    const viewer = new ViewerServer(config)
    viewers.push(viewer)
    registerTools({
      tools: { register: (tool) => registered.push(tool as RegisteredTool) },
      attachments: {
        imageLimits: {
          maxImageBytes: 8 * 1024 * 1024,
          maxImagesPerMessage: 1,
          maxMessageImageBytes: 8 * 1024 * 1024,
          maxImagePixels: 2_000_000,
          mediaTypes: ['image/png'],
        },
        async saveImage(input) {
          saved.push(Uint8Array.from(input.data))
          return {
            attachmentId: AttachmentId('opaque-attachment'),
            mediaType: 'image/webp',
            bytes: Math.floor(input.data.byteLength / 2),
            width: 195,
            height: 422,
            originalDimensions: { width: 390, height: 844 },
          }
        },
      },
    }, viewer, config, {
      defineTool: (definition) => definition,
      createUserMessage,
    })
    expect(registered.map((tool) => tool.name)).toEqual(MOBILE_MIRROR_TOOL_CONTRACTS.map((contract) => contract.name))
    for (const contract of MOBILE_MIRROR_TOOL_CONTRACTS) {
      expect(registered.find((tool) => tool.name === contract.name)).toMatchObject({
        description: contract.description,
        parameters: dshParameters(contract.inputSchema),
      })
    }

    const execute = (name: string, args: Record<string, unknown> = {}) => registered.find((tool) => tool.name === name)!.execute(args, {
      signal: new AbortController().signal,
      deferContext: (context) => deferred.push(context),
    })
    await execute('mobile_mirror_start', { provider: 'mock' })
    const snapshot = await execute('mobile_mirror_snapshot') as ScreenObservationSummary
    expect(snapshot).toMatchObject({
      viewport: { width: 390, height: 844 },
      image: { delivery: 'deferred-context', contentType: 'image/png', width: 390, height: 844 },
    })
    expect(saved).toHaveLength(1)
    expect([...saved[0]!.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(deferred).toHaveLength(1)
    expect(deferred[0]).toMatchObject({
      role: 'user',
      source: { kind: 'mobile-mirror', form: 'notice' },
      content: [{ type: 'text' }, {
        type: 'image',
        attachment: {
          attachmentId: AttachmentId('opaque-attachment'),
          mediaType: 'image/webp',
          width: 195,
          height: 422,
          originalDimensions: { width: 390, height: 844 },
        },
      }],
    })
    const canonical = JSON.stringify(snapshot)
    expect(canonical).not.toContain('opaque-attachment')
    expect(canonical).not.toContain('base64')
    expect(canonical).not.toContain('/Users/')

    const structure = await execute('mobile_mirror_inspect_screen') as ScreenObservationSummary
    expect(structure.structure?.nodes).not.toHaveLength(0)
    expect(structure.image).toBeUndefined()
    expect(saved).toHaveLength(1)
    expect(deferred).toHaveLength(1)
  })

  it('registers all contracts and executes the Mock semantic lifecycle without echoing text', async () => {
    const registered: RegisteredTool[] = []
    const semanticConfig: Config = { ...config, agentAppControlPolicy: 'session-app' }
    const viewer = new ViewerServer(semanticConfig)
    viewers.push(viewer)
    registerTools({ tools: { register: (tool) => registered.push(tool as RegisteredTool) } }, viewer, semanticConfig, {
      defineTool: (definition) => definition,
    })
    expect(registered).toHaveLength(20)
    const execute = (name: string, args: Record<string, unknown> = {}) => registered.find((tool) => tool.name === name)!.execute(args, {
      signal: new AbortController().signal,
      deferContext: () => undefined,
    })
    await execute('mobile_mirror_start', { provider: 'mock' })
    const compact = await execute('mobile_mirror_inspect_screen', { structureMode: 'summary' }) as { observationId: string; structureSummary: object; structure?: unknown }
    expect(compact.structureSummary).toBeTruthy(); expect(compact.structure).toBeUndefined()
    for (const args of [{ op: 'find' }, { op: 'get', nodeId: 'n3' }, { op: 'subtree', nodeId: 'n0' }]) {
      const query = await execute('mobile_mirror_query_screen', { observationId: compact.observationId, ...args }) as { nodes: unknown[] }
      expect(Array.isArray(query.nodes)).toBe(true)
    }
    const initial = await execute('mobile_mirror_inspect_screen') as ScreenObservationSummary
    await execute('mobile_mirror_action', { kind: 'tap_node', observationId: initial.observationId, nodeId: 'n3' })
    const focused = await execute('mobile_mirror_inspect_screen') as ScreenObservationSummary
    const marker = 'PUBLIC-DSH-MARKER'
    const input = String(await execute('mobile_mirror_action', {
      kind: 'input_text', observationId: focused.observationId, nodeId: 'n3', mode: 'replace', text: marker,
    }))
    expect(input).not.toContain(marker)
    const refreshed = await execute('mobile_mirror_inspect_screen') as ScreenObservationSummary
    const secureMarker = 'PRIVATE-SECURE-DSH'
    const secureFailure = await execute('mobile_mirror_action', {
      kind: 'input_text', observationId: refreshed.observationId, nodeId: 'n4', mode: 'append', text: secureMarker,
    }).then(() => new Error('Expected secure input rejection'), (error: unknown) => error as Error & { code?: string })
    expect(secureFailure).toMatchObject({ code: 'screen_text_input_sensitive' })
    expect(JSON.stringify(secureFailure)).not.toContain(secureMarker)
    const managed = String(await execute('mobile_mirror_manage_app', { operation: 'terminate' }))
    expect(managed).toContain('not-running')
    expect(managed).not.toContain('com.example')
    await execute('mobile_mirror_stop')
  })

  it('does not defer context when attachment saving fails', async () => {
    const registered: RegisteredTool[] = []
    const deferred = vi.fn()
    const viewer = new ViewerServer(config)
    viewers.push(viewer)
    registerTools({
      tools: { register: (tool) => registered.push(tool as RegisteredTool) },
      attachments: {
        imageLimits: {
          maxImageBytes: 8 * 1024 * 1024,
          maxImagesPerMessage: 1,
          maxMessageImageBytes: 8 * 1024 * 1024,
          maxImagePixels: 2_000_000,
          mediaTypes: ['image/png'],
        },
        async saveImage() {
          throw new Error('private attachment path')
        },
      },
    }, viewer, config, { defineTool: (definition) => definition, createUserMessage })
    const exec = { signal: new AbortController().signal, deferContext: deferred }
    await registered.find((tool) => tool.name === 'mobile_mirror_start')!.execute({ provider: 'mock' }, exec)
    await expect(registered.find((tool) => tool.name === 'mobile_mirror_snapshot')!.execute({}, exec)).rejects.toMatchObject({
      code: 'screen_attachment_failed',
    })
    expect(deferred).not.toHaveBeenCalled()
  })

  it('does not defer a half-published image context when cancellation wins during save', async () => {
    const registered: RegisteredTool[] = []
    const deferred = vi.fn()
    let releaseSave!: () => void
    let markSaveStarted!: () => void
    const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve })
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    const viewer = new ViewerServer(config)
    viewers.push(viewer)
    registerTools({
      tools: { register: (tool) => registered.push(tool as RegisteredTool) },
      attachments: {
        imageLimits: {
          maxImageBytes: 8 * 1024 * 1024,
          maxImagesPerMessage: 1,
          maxMessageImageBytes: 8 * 1024 * 1024,
          maxImagePixels: 2_000_000,
          mediaTypes: ['image/png'],
        },
        async saveImage(input) {
          markSaveStarted()
          await saveGate
          return { attachmentId: AttachmentId('saved-before-cancel'), mediaType: 'image/png', bytes: input.data.byteLength, width: 390, height: 844 }
        },
      },
    }, viewer, config, { defineTool: (definition) => definition, createUserMessage })
    const startExec = { signal: new AbortController().signal, deferContext: deferred }
    await registered.find((tool) => tool.name === 'mobile_mirror_start')!.execute({ provider: 'mock' }, startExec)
    const controller = new AbortController()
    const snapshot = registered.find((tool) => tool.name === 'mobile_mirror_snapshot')!.execute({}, {
      signal: controller.signal,
      deferContext: deferred,
    })
    await saveStarted
    controller.abort(new Error('cancelled by caller'))
    releaseSave()
    await expect(snapshot).rejects.toThrow('cancelled by caller')
    expect(deferred).not.toHaveBeenCalled()
  })
})

 it('registers all contracts with the real Harness rc.2 schema compiler', () => {
  const viewer = new ViewerServer(config)
  viewers.push(viewer)
  const registered: unknown[] = []
  registerTools({ tools: { register: (tool) => registered.push(tool) } }, viewer, config, {
    defineTool: (definition) => defineTool(definition as never),
  })
  expect(registered).toHaveLength(20)
})
