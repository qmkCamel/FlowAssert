import { parseScreenQuery, ScreenQueryError } from './screen-query.js'
import type { Config } from './config.js'
import { discoverDevices } from './device-discovery.js'
import type { IosWdaPreflightService } from './ios-wda-preflight.js'
import type { MirrorService } from './mirror-service.js'
import type { MobileMirrorToolName } from './tool-contracts.js'
import { RepairError, repairId } from './workbench-repair-contracts.js'
import type { WorkbenchRepairCoordinator } from './workbench-repair-coordinator.js'
import { TestRunControlError, type TestEvidenceImage, type TestRunCoordinator, type TestRunStartInput } from './test-run-control.js'
import type {
  AppManagementInput,
  MirrorAction,
  ProviderKind,
  ScreenCoordinateSpace,
  ScreenObservation,
  StartMirrorInput,
} from './types.js'

export const MOBILE_MIRROR_INVALID_ARGUMENTS = 'mobile_mirror_invalid_arguments'

export class MobileMirrorCommandError extends Error {
  readonly code = MOBILE_MIRROR_INVALID_ARGUMENTS

  constructor(message: string) {
    super(message)
    this.name = 'MobileMirrorCommandError'
  }
}

export type MobileMirrorCommandResult =
  | { kind: 'data'; value: object }
  | { kind: 'observation'; value: ScreenObservation; structureMode?: 'full' | 'summary' }
  | { kind: 'artifact-image'; value: TestEvidenceImage }

export interface MobileMirrorCommandDependencies {
  service: MirrorService
  iosWdaPreflight: Pick<IosWdaPreflightService, 'run'>
  discoverDevices?: typeof discoverDevices
  coordinator?: TestRunCoordinator
  repairCases?: WorkbenchRepairCoordinator
}

export class MobileMirrorCommands {
  readonly #config: Config
  readonly #service: MirrorService
  readonly #iosWdaPreflight: Pick<IosWdaPreflightService, 'run'>
  readonly #discoverDevices: typeof discoverDevices
  readonly #coordinator: TestRunCoordinator | undefined
  readonly #repairCases: WorkbenchRepairCoordinator | undefined

  constructor(config: Config, dependencies: MobileMirrorCommandDependencies) {
    this.#config = config
    this.#service = dependencies.service
    this.#iosWdaPreflight = dependencies.iosWdaPreflight
    this.#discoverDevices = dependencies.discoverDevices ?? discoverDevices
    this.#coordinator = dependencies.coordinator
    this.#repairCases = dependencies.repairCases
  }

  async execute(name: MobileMirrorToolName, rawArgs: unknown, signal?: AbortSignal): Promise<MobileMirrorCommandResult> {
    const args = argumentObject(rawArgs)
    switch (name) {
      case 'mobile_mirror_list_devices':
        assertOnlyKeys(args, [])
        return { kind: 'data', value: await this.listDevices(signal) }
      case 'mobile_mirror_ios_preflight':
        assertOnlyKeys(args, [])
        return { kind: 'data', value: await this.iosPreflight(signal) }
      case 'mobile_mirror_start':
        return { kind: 'data', value: await this.#service.start(startInput(args, this.#config.defaultProvider), signal) }
      case 'mobile_mirror_status':
        assertOnlyKeys(args, [])
        return { kind: 'data', value: this.#service.state() }
      case 'mobile_mirror_snapshot':
        assertOnlyKeys(args, [])
        return { kind: 'observation', value: await this.#service.observe({ image: true, structure: false }, signal) }
      case 'mobile_mirror_inspect_screen':
        return { kind: 'observation', value: await this.#service.observe(inspectInput(args), signal), structureMode: args.structureMode === 'summary' ? 'summary' : 'full' }
      case 'mobile_mirror_query_screen': {
        try { return { kind: 'data', value: this.#service.queryScreen(parseScreenQuery(args), signal) } }
        catch (error) { if (error instanceof ScreenQueryError && error.code === MOBILE_MIRROR_INVALID_ARGUMENTS) throw invalid('Invalid screen query arguments'); throw error }
      }
      case 'mobile_mirror_action':
        return { kind: 'data', value: await this.#service.action(actionInput(args), signal) }
      case 'mobile_mirror_manage_app':
        return { kind: 'data', value: await this.#service.manageApp(appManagementInput(args), signal) }
      case 'mobile_mirror_stop':
        assertOnlyKeys(args, [])
        return { kind: 'data', value: await this.#service.stop(signal) }
      case 'mobile_mirror_test_catalog':
        assertOnlyKeys(args, ['kind', 'cursor', 'limit'])
        return { kind: 'data', value: await this.#tests().catalog({
          ...(args.kind === undefined ? {} : { kind: enumArg(args.kind, 'kind', ['flow', 'suite', 'all']) }),
          ...(args.cursor === undefined ? {} : { cursor: integerArg(args.cursor, 'cursor') }),
          ...(args.limit === undefined ? {} : { limit: integerArg(args.limit, 'limit') }),
        }) }
      case 'mobile_mirror_run_start':
        return { kind: 'data', value: await this.#tests().start(runStartInput(args), signal) }
      case 'mobile_mirror_run_status':
        return { kind: 'data', value: await this.#tests().status(runLookupInput(args)) }
      case 'mobile_mirror_run_cancel':
        assertOnlyKeys(args, ['executionId'])
        return { kind: 'data', value: await this.#tests().cancel(nonEmptyStringArg(args.executionId, 'executionId')) }
      case 'mobile_mirror_run_evidence': {
        const value = await this.#tests().evidence(runEvidenceInput(args))
        return 'bytes' in value ? { kind: 'artifact-image', value } : { kind: 'data', value }
      }
      case 'mobile_mirror_run_diagnostic_context': {
        assertOnlyKeys(args, ['comparisonId', 'evidenceRef'])
        const comparisonId=nonEmptyStringArg(args.comparisonId,'comparisonId')
        const evidenceRef=args.evidenceRef===undefined?undefined:nonEmptyStringArg(args.evidenceRef,'evidenceRef')
        return {kind:'data',value:evidenceRef===undefined?await this.#tests().comparisons.diagnosticContext(comparisonId):await this.#tests().comparisons.evidenceDetail(comparisonId,evidenceRef)}
      }
      case 'mobile_mirror_run_triage': {
        assertOnlyKeys(args, ['reportId', 'evidenceRef'])
        const reportId = nonEmptyStringArg(args.reportId, 'reportId')
        const evidenceRef = args.evidenceRef === undefined ? undefined : nonEmptyStringArg(args.evidenceRef, 'evidenceRef')
        return { kind: 'data', value: await this.#tests().triageReport(reportId, evidenceRef) }
      }
      case 'mobile_acceptance_get': {
        assertOnlyKeys(args, ['id', 'revision'])
        return { kind: 'data', value: await this.#tests().acceptanceRecord(nonEmptyStringArg(args.id, 'id'), args.revision === undefined ? undefined : integerArg(args.revision, 'revision'), signal) }
      }
      case 'mobile_external_result_get': {
        assertOnlyKeys(args, ['id'])
        return { kind: 'data', value: await this.#tests().externalResult(nonEmptyStringArg(args.id, 'id')) }
      }
      case 'mobile_matrix_status': {
        assertOnlyKeys(args, ['id'])
        return { kind: 'data', value: await this.#tests().matrixStatus(nonEmptyStringArg(args.id, 'id')) }
      }
      case 'mobile_mirror_repair_plan': {
        assertOnlyKeys(args, ['requestId', 'sourceRunId', 'baselineRunId', 'flowId', 'route', 'repositoryId'])
        const requestId = repairUuid(args.requestId), sourceRunId = repairUuid(args.sourceRunId)
        const flowId = nonEmptyStringArg(args.flowId, 'flowId')
        if (args.route === 'product-code' && args.baselineRunId !== undefined
          || args.route !== 'product-code' && args.repositoryId !== undefined)
          throw invalid('Repair route arguments conflict')
        if (args.route !== undefined && args.route !== 'product-code' && args.route !== 'locator-maintenance')
          throw invalid('Invalid repair route')
        const value = args.route === 'product-code'
          ? await this.#repairs().createCode({ requestId, sourceRunId, flowId,
            repositoryId: nonEmptyStringArg(args.repositoryId, 'repositoryId') }, 'local')
          : await this.#repairs().create({ requestId, sourceRunId, flowId,
            baselineRunId: repairUuid(args.baselineRunId) }, 'local')
        return { kind: 'data', value: await this.#repairs().getForAgent(value.id) }
      }
      case 'mobile_mirror_repair_get': {
        assertOnlyKeys(args, ['caseId'])
        return { kind: 'data', value: await this.#repairs().getForAgent(repairUuid(args.caseId)) }
      }
      case 'mobile_mirror_repair_submit': {
        if (!Object.hasOwn(args, 'submission')) throw new RepairError('repair-capability-unavailable')
        assertOnlyKeys(args, ['caseId', 'expectedRevision', 'submission'])
        const id = repairUuid(args.caseId)
        const detail = await this.#repairs().getForAgent(id, 'plan')
        if (detail.route !== 'product-code') throw new RepairError('repair-capability-unavailable')
        const accepted = await this.#repairs().submitCodePatch(id, 'local', integerArg(args.expectedRevision, 'expectedRevision'), args.submission)
        return { kind: 'data', value: { caseId: accepted.id, revision: accepted.revision,
          phase: accepted.phase, candidateDigest: (await this.#repairs().getForAgent(id)).candidateDigest } }
      }
      case 'mobile_mirror_repair_verify': {
        assertOnlyKeys(args, ['caseId', 'expectedRevision'])
        const id = repairUuid(args.caseId), revision = integerArg(args.expectedRevision, 'expectedRevision')
        await this.#repairs().getForAgent(id, 'verify')
        const current = await this.#repairs().get(id, 'local')
        const accepted = current.case.route === 'product-code'
          ? await this.#repairs().acceptCode(id, 'local', revision)
          : await this.#repairs().acceptMock(id, 'local', revision)
        return { kind: 'data', value: { caseId: accepted.id, revision: accepted.revision, phase: accepted.phase } }
      }
      case 'mobile_mirror_repair_cancel': {
        assertOnlyKeys(args, ['caseId', 'expectedRevision'])
        const id = repairUuid(args.caseId), revision = integerArg(args.expectedRevision, 'expectedRevision')
        await this.#repairs().getForAgent(id, 'cancel')
        const accepted = await this.#repairs().cancel(id, 'local', revision)
        return { kind: 'data', value: { caseId: accepted.id, revision: accepted.revision, phase: accepted.phase,
          outcome: accepted.outcome ?? null } }
      }
    }
  }

  #repairs(): WorkbenchRepairCoordinator {
    if (!this.#config.repairToolsEnabled || !this.#repairCases) throw new RepairError('repair-capability-unavailable')
    return this.#repairCases
  }

  #tests(): TestRunCoordinator {
    if (!this.#coordinator) throw new TestRunControlError('mobile_mirror_not_enabled', 'Agent test control is unavailable')
    return this.#coordinator
  }

  async listDevices(signal?: AbortSignal): Promise<object> {
    return {
      devices: await this.#discoverDevices(this.#config, signal),
      hostDiscoveryEnabled: this.#config.allowHostDeviceDiscovery,
      appiumUrl: this.#config.appiumUrl,
    }
  }

  async iosPreflight(signal?: AbortSignal): Promise<object> {
    return await this.#iosWdaPreflight.run(signal)
  }
}

export function startInput(args: Record<string, unknown>, fallback: ProviderKind): StartMirrorInput {
  assertOnlyKeys(args, ['provider', 'sessionId', 'capabilitiesJson'])
  const provider = args.provider === undefined ? fallback : enumArg(args.provider, 'provider', ['mock', 'appium'])
  const input: StartMirrorInput = { provider }
  if (args.sessionId !== undefined) input.sessionId = nonEmptyStringArg(args.sessionId, 'sessionId')
  if (args.capabilitiesJson !== undefined) input.capabilities = parseCapabilities(nonEmptyStringArg(args.capabilitiesJson, 'capabilitiesJson'))
  return input
}

export function inspectInput(args: Record<string, unknown>): { image: boolean; structure: true } {
  assertOnlyKeys(args, ['includeImage', 'structureMode'])
  if (args.structureMode !== undefined) enumArg(args.structureMode, 'structureMode', ['full', 'summary'])
  if (args.includeImage !== undefined && typeof args.includeImage !== 'boolean') {
    throw invalid('includeImage must be a boolean')
  }
  return { image: args.includeImage === true, structure: true }
}

export function actionInput(args: Record<string, unknown>): MirrorAction {
  const kind = enumArg(args.kind, 'kind', ['tap', 'swipe', 'back', 'tap_node', 'input_text'])
  if (kind === 'tap_node') {
    assertOnlyKeys(args, ['kind', 'observationId', 'nodeId'])
    return {
      kind,
      observationId: nonEmptyStringArg(args.observationId, 'observationId'),
      nodeId: nonEmptyStringArg(args.nodeId, 'nodeId'),
    }
  }
  if (kind === 'input_text') {
    assertOnlyKeys(args, ['kind', 'observationId', 'nodeId', 'mode', 'text'])
    const mode = enumArg(args.mode, 'mode', ['append', 'replace'])
    const text = publicTextArg(args.text, mode)
    return {
      kind,
      observationId: nonEmptyStringArg(args.observationId, 'observationId'),
      nodeId: nonEmptyStringArg(args.nodeId, 'nodeId'),
      mode,
      text,
    }
  }

  const coordinateKeys = ['kind', 'x', 'y', 'startX', 'startY', 'endX', 'endY', 'durationMs', 'observationId', 'coordinateSpace'] as const
  assertOnlyKeys(args, kind === 'tap'
    ? ['kind', 'x', 'y', 'observationId', 'coordinateSpace']
    : kind === 'swipe' ? coordinateKeys : ['kind', 'observationId', 'coordinateSpace'])
  const binding = coordinateBinding(args)
  if (kind === 'back') return { kind, ...binding }
  if (kind === 'tap') return { kind, x: numberArg(args.x, 'x'), y: numberArg(args.y, 'y'), ...binding }
  const durationMs = args.durationMs === undefined ? 400 : numberArg(args.durationMs, 'durationMs')
  if (durationMs < 0) throw invalid('durationMs must be non-negative')
  return {
    kind,
    startX: numberArg(args.startX, 'startX'),
    startY: numberArg(args.startY, 'startY'),
    endX: numberArg(args.endX, 'endX'),
    endY: numberArg(args.endY, 'endY'),
    durationMs,
    ...binding,
  }
}

export function appManagementInput(args: Record<string, unknown>): AppManagementInput {
  assertOnlyKeys(args, ['operation', 'appId'])
  const operation = enumArg(args.operation, 'operation', ['activate', 'terminate'])
  return {
    operation,
    ...(args.appId === undefined ? {} : { appId: appIdArg(args.appId) }),
  }
}

function coordinateBinding(args: Record<string, unknown>): { observationId?: string; coordinateSpace?: ScreenCoordinateSpace } {
  const coordinateSpace: ScreenCoordinateSpace | undefined = args.coordinateSpace === undefined
    ? undefined
    : enumArg(args.coordinateSpace, 'coordinateSpace', ['viewport', 'snapshot'])
  return {
    ...(args.observationId === undefined ? {} : { observationId: nonEmptyStringArg(args.observationId, 'observationId') }),
    ...(coordinateSpace ? { coordinateSpace } : {}),
  }
}

function publicTextArg(value: unknown, mode: 'append' | 'replace'): string {
  if (typeof value !== 'string') throw invalid('text is required and must be a string')
  if ((mode === 'append' && value.length === 0)
    || [...value].length > 512
    || Buffer.byteLength(value, 'utf8') > 4 * 1024
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)) {
    throw invalid('text must be bounded public text without control characters')
  }
  return value
}

function appIdArg(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,255}$/.test(value)) {
    throw invalid('appId must be an exact bounded application id')
  }
  return value
}

function argumentObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('tool arguments must be a JSON object')
  return value as Record<string, unknown>
}

function parseCapabilities(value: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw invalid('capabilitiesJson must contain valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalid('capabilitiesJson must contain a JSON object')
  }
  return parsed as Record<string, unknown>
}

function assertOnlyKeys(args: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(args).find((key) => !allowed.includes(key))
  if (unknown) throw invalid(`unknown argument: ${unknown}`)
}

function enumArg<const T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalid(`${name} must be one of: ${allowed.join(', ')}`)
  return value as T
}

function nonEmptyStringArg(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(`${name} must be a non-empty string`)
  return value
}

function repairUuid(value: unknown): string {
  const checked = repairId.safeParse(value)
  if (!checked.success) throw invalid('A valid repair UUID is required')
  return checked.data
}

function numberArg(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${name} is required and must be a finite number`)
  return value
}

function integerArg(value: unknown, name: string): number {
  const number = numberArg(value, name)
  if (!Number.isInteger(number)) throw invalid(`${name} must be an integer`)
  return number
}

function runStartInput(args: Record<string, unknown>): TestRunStartInput {
  assertOnlyKeys(args, ['requestId', 'target', 'catalogRevision', 'params', 'tags', 'platform'])
  if (!args.target || typeof args.target !== 'object' || Array.isArray(args.target)) throw invalid('target must be an object')
  const target = args.target as Record<string, unknown>
  assertOnlyKeys(target, ['kind', 'id'])
  const params = args.params === undefined ? undefined : argumentObject(args.params)
  const tags = args.tags === undefined ? undefined : stringArrayArg(args.tags, 'tags')
  return {
    requestId: nonEmptyStringArg(args.requestId, 'requestId'),
    target: { kind: enumArg(target.kind, 'target.kind', ['flow', 'suite']), id: nonEmptyStringArg(target.id, 'target.id') },
    catalogRevision: nonEmptyStringArg(args.catalogRevision, 'catalogRevision'),
    ...(params ? { params } : {}), ...(tags ? { tags } : {}),
    ...(args.platform === undefined ? {} : { platform: enumArg(args.platform, 'platform', ['android', 'ios']) }),
  }
}

function runLookupInput(args: Record<string, unknown>) {
  assertOnlyKeys(args, ['executionId', 'requestId', 'cursor', 'limit'])
  return {
    ...(args.executionId === undefined ? {} : { executionId: nonEmptyStringArg(args.executionId, 'executionId') }),
    ...(args.requestId === undefined ? {} : { requestId: nonEmptyStringArg(args.requestId, 'requestId') }),
    ...(args.cursor === undefined ? {} : { cursor: integerArg(args.cursor, 'cursor') }),
    ...(args.limit === undefined ? {} : { limit: integerArg(args.limit, 'limit') }),
  }
}

function runEvidenceInput(args: Record<string, unknown>) {
  assertOnlyKeys(args, ['executionId', 'requestId', 'runId', 'artifactId', 'format', 'cursor', 'limit'])
  return {
    ...runLookupInput(Object.fromEntries(Object.entries(args).filter(([key]) => ['executionId', 'requestId', 'cursor', 'limit'].includes(key)))),
    ...(args.runId === undefined ? {} : { runId: nonEmptyStringArg(args.runId, 'runId') }),
    ...(args.artifactId === undefined ? {} : { artifactId: nonEmptyStringArg(args.artifactId, 'artifactId') }),
    ...(args.format === undefined ? {} : { format: enumArg(args.format, 'format', ['metadata', 'text', 'image']) }),
  }
}

function stringArrayArg(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) throw invalid(`${name} must be an array of non-empty strings`)
  return value as string[]
}

function invalid(message: string): MobileMirrorCommandError {
  return new MobileMirrorCommandError(message)
}
