import { QUERY_ROLES, REGIONS } from './screen-query.js'
export type JsonSchema = Readonly<Record<string, unknown>>

export interface ToolRiskAnnotations {
  readonly title: string
  readonly readOnlyHint: boolean
  readonly destructiveHint: boolean
  readonly idempotentHint: boolean
  readonly openWorldHint: boolean
}

export interface MobileMirrorToolContract {
  readonly name: MobileMirrorToolName
  readonly description: string
  readonly inputSchema: JsonSchema & { readonly type: 'object' }
  readonly outputSchema: JsonSchema & { readonly type: 'object' }
  readonly annotations: ToolRiskAnnotations
}

export const MOBILE_MIRROR_TOOL_NAMES = [
  'mobile_mirror_list_devices',
  'mobile_mirror_ios_preflight',
  'mobile_mirror_start',
  'mobile_mirror_status',
  'mobile_mirror_snapshot',
  'mobile_mirror_inspect_screen',
  'mobile_mirror_action',
  'mobile_mirror_manage_app',
  'mobile_mirror_stop',
  'mobile_mirror_query_screen',
  'mobile_mirror_test_catalog',
  'mobile_mirror_run_start',
  'mobile_mirror_run_status',
  'mobile_mirror_run_cancel',
  'mobile_mirror_run_evidence',
  'mobile_mirror_run_diagnostic_context',
  'mobile_mirror_run_triage',
  'mobile_acceptance_get',
  'mobile_external_result_get',
  'mobile_matrix_status',
] as const

export const REPAIR_TOOL_NAMES = [
  'mobile_mirror_repair_plan', 'mobile_mirror_repair_get', 'mobile_mirror_repair_submit',
  'mobile_mirror_repair_verify', 'mobile_mirror_repair_cancel',
] as const
export type MobileMirrorToolName = typeof MOBILE_MIRROR_TOOL_NAMES[number] | typeof REPAIR_TOOL_NAMES[number]

const EMPTY_INPUT_SCHEMA = objectSchema({})
const GENERIC_OBJECT_OUTPUT_SCHEMA = objectSchema({}, [], true)

const START_INPUT_SCHEMA = objectSchema({
  provider: { type: 'string', enum: ['mock', 'appium'], description: 'Defaults to the configured provider.' },
  sessionId: { type: 'string', minLength: 1, description: 'Attach to an existing Appium session instead of creating one.' },
  capabilitiesJson: { type: 'string', minLength: 1, description: 'W3C/Appium alwaysMatch capabilities as a JSON object string.' },
})

const INSPECT_INPUT_SCHEMA = objectSchema({
  structureMode: { type: 'string', enum: ['full', 'summary'], description: 'Full structure (default) or metadata summary; query reuses the complete stored structure.' },
  includeImage: { type: 'boolean', description: 'Also capture and return one fresh PNG image block when policy allows it.' },
})

export const MOBILE_MIRROR_ACTION_VARIANTS = [
  objectSchema({
    kind: { type: 'string', const: 'tap', description: 'Coordinate tap action.' },
    x: { type: 'number', description: 'Tap x coordinate; only for tap.' },
    y: { type: 'number', description: 'Tap y coordinate; only for tap.' },
    observationId: { type: 'string', minLength: 1, description: 'Fresh observation id for strict checks; optional for coordinate actions.' },
    coordinateSpace: { type: 'string', enum: ['viewport', 'snapshot'], description: 'Coordinate space; only for coordinate actions.' },
  }, ['kind', 'x', 'y']),
  objectSchema({
    kind: { type: 'string', const: 'swipe', description: 'Coordinate swipe action.' },
    startX: { type: 'number', description: 'Swipe start x; only for swipe.' },
    startY: { type: 'number', description: 'Swipe start y; only for swipe.' },
    endX: { type: 'number', description: 'Swipe end x; only for swipe.' },
    endY: { type: 'number', description: 'Swipe end y; only for swipe.' },
    durationMs: { type: 'number', minimum: 0, description: 'Swipe duration; only for swipe, defaults to 400 ms.' },
    observationId: { type: 'string', minLength: 1, description: 'Fresh observation id for strict checks; optional for coordinate actions.' },
    coordinateSpace: { type: 'string', enum: ['viewport', 'snapshot'], description: 'Coordinate space; only for coordinate actions.' },
  }, ['kind', 'startX', 'startY', 'endX', 'endY']),
  objectSchema({
    kind: { type: 'string', const: 'back', description: 'Navigate back.' },
    observationId: { type: 'string', minLength: 1, description: 'Fresh observation id for strict checks; optional for back.' },
    coordinateSpace: { type: 'string', enum: ['viewport', 'snapshot'], description: 'Coordinate space; only retained for original compatibility.' },
  }, ['kind']),
  objectSchema({
    kind: { type: 'string', const: 'tap_node', description: 'Tap one exact node from a fresh observation.' },
    observationId: { type: 'string', minLength: 1, description: 'Fresh observation id; required for tap_node.' },
    nodeId: { type: 'string', minLength: 1, description: 'Observation-local node id; only for semantic actions.' },
  }, ['kind', 'observationId', 'nodeId']),
  objectSchema({
    kind: { type: 'string', const: 'input_text', description: 'Input bounded public text into a verified focused ordinary input.' },
    observationId: { type: 'string', minLength: 1, description: 'Fresh observation id; required for input_text.' },
    nodeId: { type: 'string', minLength: 1, description: 'Observation-local input node id; only for semantic actions.' },
    mode: { type: 'string', enum: ['append', 'replace'], description: 'Text input mode; only for input_text.' },
    text: { type: 'string', maxLength: 512, description: 'Public non-secret text; only for input_text. Host history may retain it.' },
  }, ['kind', 'observationId', 'nodeId', 'mode', 'text']),
] as const

export const MOBILE_MIRROR_ACTION_INPUT_SCHEMA = {
  type: 'object' as const,
  oneOf: MOBILE_MIRROR_ACTION_VARIANTS,
}

const MANAGE_APP_INPUT_SCHEMA = objectSchema({
  operation: { type: 'string', enum: ['activate', 'terminate'], description: 'Authorized application lifecycle operation.' },
  appId: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9._-]+$', description: 'Exact app id; required for allowlist mode and never returned.' },
}, ['operation'])

const PAGE_PROPERTIES = {
  cursor: { type: 'integer', minimum: 0, maximum: 500 },
  limit: { type: 'integer', minimum: 1, maximum: 50 },
}
const TEST_CATALOG_INPUT_SCHEMA = objectSchema({
  kind: { type: 'string', enum: ['flow', 'suite', 'all'] }, ...PAGE_PROPERTIES,
})
const RUN_START_INPUT_SCHEMA = objectSchema({
  requestId: { type: 'string', minLength: 1, maxLength: 128 },
  target: objectSchema({ kind: { type: 'string', enum: ['flow', 'suite'] }, id: { type: 'string', minLength: 1, maxLength: 64 } }, ['kind', 'id']),
  catalogRevision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  params: { type: 'object', additionalProperties: true },
  tags: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 64 } },
  platform: { type: 'string', enum: ['android', 'ios'] },
}, ['requestId', 'target', 'catalogRevision'])
const RUN_LOOKUP_PROPERTIES = {
  executionId: { type: 'string', minLength: 1 }, requestId: { type: 'string', minLength: 1, maxLength: 128 }, ...PAGE_PROPERTIES,
}
const RUN_STATUS_INPUT_SCHEMA = objectSchema(RUN_LOOKUP_PROPERTIES)
const RUN_CANCEL_INPUT_SCHEMA = objectSchema({ executionId: { type: 'string', minLength: 1 } }, ['executionId'])
const RUN_EVIDENCE_INPUT_SCHEMA = objectSchema({
  ...RUN_LOOKUP_PROPERTIES,
  runId: { type: 'string', minLength: 1 }, artifactId: { type: 'string', minLength: 1 },
  format: { type: 'string', enum: ['metadata', 'text', 'image'] },
})
const RUN_DIAGNOSTIC_CONTEXT_INPUT_SCHEMA = objectSchema({
  comparisonId: { type: 'string', minLength: 36, maxLength: 36, description: 'Registered comparison id.' },
  evidenceRef: { type: 'string', minLength: 1, maxLength: 128, description: 'Optional evidence ref from the returned Diagnostic Context for one bounded metadata drill-down.' },
}, ['comparisonId'])
const RUN_TRIAGE_INPUT_SCHEMA = objectSchema({
  reportId: { type: 'string', minLength: 36, maxLength: 36, description: 'A report already generated explicitly in the local Viewer or CLI.' },
  evidenceRef: { type: 'string', minLength: 1, maxLength: 192, description: 'Optional registered evidence name for authorized metadata only; never returns media or a URL.' },
}, ['reportId'])

const SCREEN_RECT_SCHEMA = objectSchema({
  x: { type: 'number' },
  y: { type: 'number' },
  width: { type: 'number' },
  height: { type: 'number' },
}, ['x', 'y', 'width', 'height'])

const SCREEN_NODE_SCHEMA = objectSchema({
  nodeId: { type: 'string' },
  parentId: { type: 'string' },
  role: { type: 'string', enum: ['application', 'button', 'checkbox', 'image', 'input', 'link', 'list', 'list-item', 'scroll-view', 'switch', 'text', 'unknown'] },
  platformRole: { type: 'string' },
  identifier: { type: 'string' },
  name: { type: 'string' },
  text: { type: 'string' },
  value: { type: 'string' },
  sensitive: { type: 'boolean' },
  bounds: SCREEN_RECT_SCHEMA,
  visible: { type: 'boolean' },
  enabled: { type: 'boolean' },
  actionable: { type: 'boolean' },
  focused: { type: 'boolean' },
  selected: { type: 'boolean' },
  checked: { type: 'boolean' },
}, ['nodeId', 'role'])

export const SCREEN_OBSERVATION_OUTPUT_SCHEMA = objectSchema({
  observationId: { type: 'string' },
  frameRevision: { type: 'integer' },
  screenEpoch: { type: 'integer' },
  capturedAt: { type: 'string' },
  captureEndedAt: { type: 'string' },
  expiresAt: { type: 'string' },
  viewport: SCREEN_RECT_SCHEMA,
  orientation: { type: 'string', enum: ['portrait', 'landscape', 'unknown'] },
  orientationSource: { type: 'string', enum: ['provider', 'inferred'] },
  image: objectSchema({
    contentType: { type: 'string', const: 'image/png' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    byteLength: { type: 'integer' },
    delivery: { type: 'string', enum: ['core-memory', 'deferred-context', 'mcp-image-content'] },
  }, ['contentType', 'width', 'height', 'byteLength', 'delivery']),
  structure: objectSchema({
    nodes: { type: 'array', items: SCREEN_NODE_SCHEMA },
    truncated: { type: 'boolean' },
    truncatedReason: { type: 'string', enum: ['depth-limit', 'node-limit', 'field-limit', 'json-limit'] },
  }, ['nodes', 'truncated']),
}, [
  'observationId',
  'frameRevision',
  'screenEpoch',
  'capturedAt',
  'captureEndedAt',
  'expiresAt',
  'viewport',
  'orientation',
  'orientationSource',
])

const SUMMARY_STRUCTURE_SCHEMA = objectSchema({ nodeCount: { type: 'integer' }, truncated: { type: 'boolean' }, truncatedReason: { type: 'string' } }, ['nodeCount', 'truncated'])
const { structure: _structure, ...summaryProperties } = SCREEN_OBSERVATION_OUTPUT_SCHEMA.properties as Record<string, unknown>
export const INSPECT_OUTPUT_SCHEMA = { type: 'object' as const, oneOf: [SCREEN_OBSERVATION_OUTPUT_SCHEMA,
  objectSchema({ ...summaryProperties, structureSummary: SUMMARY_STRUCTURE_SCHEMA }, [...SCREEN_OBSERVATION_OUTPUT_SCHEMA.required as string[], 'structureSummary'])] }
const QUERY_STRING = { type: 'string', minLength: 1, maxLength: 128 }
const QUERY_PAGE = { offset: { type: 'integer', minimum: 0, maximum: 500 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
export const QUERY_INPUT_SCHEMA = { type: 'object' as const, oneOf: [
  objectSchema({ observationId: QUERY_STRING, op: { type: 'string', const: 'find' }, text: QUERY_STRING, identifier: QUERY_STRING,
    textMatch: { type: 'string', enum: ['exact', 'contains'] }, caseSensitive: { type: 'boolean' }, role: { type: 'string', enum: QUERY_ROLES },
    region: { type: 'string', enum: REGIONS }, visibleOnly: { type: 'boolean' }, actionableOnly: { type: 'boolean' }, ...QUERY_PAGE }, ['observationId', 'op']),
  objectSchema({ observationId: QUERY_STRING, op: { type: 'string', const: 'get' }, nodeId: QUERY_STRING }, ['observationId', 'op', 'nodeId']),
  objectSchema({ observationId: QUERY_STRING, op: { type: 'string', const: 'subtree' }, nodeId: QUERY_STRING, depth: { type: 'integer', minimum: 0, maximum: 8 }, ...QUERY_PAGE }, ['observationId', 'op', 'nodeId']),
] }
export const QUERY_OUTPUT_SCHEMA = objectSchema({
  observationId: { type: 'string' }, frameRevision: { type: 'integer' }, screenEpoch: { type: 'integer' }, capturedAt: { type: 'string' }, captureEndedAt: { type: 'string' }, expiresAt: { type: 'string' },
  op: { type: 'string', enum: ['find', 'get', 'subtree'] },
  actionBinding: objectSchema({ status: { type: 'string', enum: ['current', 'superseded', 'screen-changed', 'action-expired'] }, validUntil: { type: 'string' } }, ['status', 'validUntil']),
  source: SUMMARY_STRUCTURE_SCHEMA,
  nodes: { type: 'array', items: objectSchema({ ...SCREEN_NODE_SCHEMA.properties as object, fieldsTruncated: { type: 'array', items: { type: 'string' } }, parentAvailable: { type: 'boolean' }, capturedChildCount: { type: 'integer' } }, ['nodeId', 'role']) },
  page: objectSchema({ offset: { type: 'integer' }, returned: { type: 'integer' }, totalMatches: { type: 'integer' }, nextOffset: { type: 'integer' }, limitedBy: { type: 'array', items: { type: 'string', enum: ['limit', 'bytes'] } }, depthLimited: { type: 'boolean' } }, ['offset', 'returned', 'totalMatches', 'limitedBy', 'depthLimited']),
}, ['observationId', 'frameRevision', 'screenEpoch', 'capturedAt', 'captureEndedAt', 'expiresAt', 'op', 'actionBinding', 'source', 'nodes', 'page'])

const READ_ONLY_HOST: Omit<ToolRiskAnnotations, 'title'> = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
}

export const MOBILE_MIRROR_TOOL_CONTRACTS: readonly MobileMirrorToolContract[] = [
  {
    name: 'mobile_mirror_list_devices',
    description: 'List mobile devices visible to the local runtime. Host adb/xctrace discovery is disabled by default.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { ...READ_ONLY_HOST, title: 'List mobile devices', idempotentHint: true },
  },
  {
    name: 'mobile_mirror_ios_preflight',
    description: 'Run an opt-in, read-only iOS WebDriverAgent signing preflight with sanitized results.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { ...READ_ONLY_HOST, title: 'Check iOS WDA readiness', idempotentHint: true },
  },
  {
    name: 'mobile_mirror_start',
    description: 'Start the local mobile mirror with Mock, a new Appium session, or an attached Appium session.',
    inputSchema: START_INPUT_SCHEMA,
    outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Start mobile mirror', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'mobile_mirror_status',
    description: 'Return the mirror lifecycle, device/session state, observation progress, errors, and loopback Viewer URL.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read mobile mirror status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_mirror_snapshot',
    description: 'Capture one fresh raster observation. Physical-device images require image-and-structure policy.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: SCREEN_OBSERVATION_OUTPUT_SCHEMA,
    annotations: { ...READ_ONLY_HOST, title: 'Capture mobile screen' },
  },
  {
    name: 'mobile_mirror_inspect_screen',
    description: 'Capture a fresh bounded accessibility structure, optionally with one fresh PNG image.',
    inputSchema: INSPECT_INPUT_SCHEMA,
    outputSchema: INSPECT_OUTPUT_SCHEMA,
    annotations: { ...READ_ONLY_HOST, title: 'Inspect mobile screen' },
  },
  {
    name: 'mobile_mirror_action',
    description: 'Send a coordinate action, tap one fresh observed node, or input bounded public text into a verified focused ordinary input.',
    inputSchema: MOBILE_MIRROR_ACTION_INPUT_SCHEMA,
    outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Control mobile device', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'mobile_mirror_manage_app',
    description: 'Activate or terminate one explicitly policy-authorized app in a runtime-owned session.',
    inputSchema: MANAGE_APP_INPUT_SCHEMA,
    outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Manage mobile application', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'mobile_mirror_stop',
    description: 'Stop the mirror and delete only sessions created by this runtime; attached sessions remain running.',
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Stop mobile mirror', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'mobile_mirror_query_screen',
    description: 'Read find/get/subtree from one retained observation without capturing or acting. No match only covers captured nodes; truncated sources are incomplete. Historical readability does not authorize actions.',
    inputSchema: QUERY_INPUT_SCHEMA, outputSchema: QUERY_OUTPUT_SCHEMA,
    annotations: { title: 'Query captured screen', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'mobile_mirror_test_catalog', description: 'List only locally registered and authorized test flows and suites with a revision for safe start.',
    inputSchema: TEST_CATALOG_INPUT_SCHEMA, outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'List registered mobile tests', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_mirror_run_start', description: 'Durably accept one registered flow or suite by idempotent requestId; returns before the test finishes.',
    inputSchema: RUN_START_INPUT_SCHEMA, outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Start registered mobile test', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'mobile_mirror_run_status', description: 'Read bounded progress and the original verdict for one accepted test execution.',
    inputSchema: RUN_STATUS_INPUT_SCHEMA, outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read mobile test status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_mirror_run_cancel', description: 'Explicitly request cancellation and bounded cleanup for one accepted test execution.',
    inputSchema: RUN_CANCEL_INPUT_SCHEMA, outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Cancel mobile test', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'mobile_mirror_run_evidence', description: 'List verified execution evidence metadata or read one explicitly authorized text/image artifact.',
    inputSchema: RUN_EVIDENCE_INPUT_SCHEMA, outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read mobile test evidence', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_mirror_run_diagnostic_context', description: 'Read the deterministic Diagnostic Context for one completed comparison, or inspect one registered evidence reference without returning raw media.',
    inputSchema: RUN_DIAGNOSTIC_CONTEXT_INPUT_SCHEMA, outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read run comparison facts', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_mirror_run_triage', description: 'Read an existing evidence-guided triage report or one authorized evidence metadata entry. This never starts analysis, changes a verdict, or returns raw media.',
    inputSchema: RUN_TRIAGE_INPUT_SCHEMA, outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read mobile test triage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_acceptance_get', description: 'Read one existing change-acceptance revision and its current evidence availability, scoped to authorized registered test executions. No publication, device action, raw evidence or media.',
    inputSchema: objectSchema({ id: { type: 'string', format: 'uuid' }, revision: { type: 'integer', minimum: 1, maximum: 100 } }, ['id']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read change acceptance', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_external_result_get', description: 'Read safe metadata for one external test report explicitly authorized to the current registered project version. Never executes a runner or returns raw report text or attachments.',
    inputSchema: objectSchema({ id: { type: 'string', format: 'uuid' } }, ['id']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read authorized external result', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'mobile_matrix_status', description: 'Read a bounded matrix status for the currently authorized project and registered flows. Preserves all attempts and evidence gaps; never starts, cancels or retries devices, returns media, or changes the single-device target.',
    inputSchema: objectSchema({ id: { type: 'string', format: 'uuid' } }, ['id']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read local device matrix', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
] as const

/** Additional tools are absent from the default 20-tool surface. No approval operation exists here. */
export const REPAIR_TOOL_CONTRACTS: readonly MobileMirrorToolContract[] = [
  { name: 'mobile_mirror_repair_plan', description: 'Create a bounded locator or code repair case from a registered local failure; code handoff waits for local scope approval.',
    inputSchema: objectSchema({ requestId: { type: 'string', format: 'uuid' }, sourceRunId: { type: 'string', format: 'uuid' },
      baselineRunId: { type: 'string', format: 'uuid', description: 'Required for locator-maintenance only.' },
      flowId: { type: 'string', minLength: 1, maxLength: 64 },
      route: { type: 'string', enum: ['locator-maintenance', 'product-code'] },
      repositoryId: { type: 'string', minLength: 1, maxLength: 64, description: 'Required for product-code; logical trusted ID, never a path.' } },
    ['requestId', 'sourceRunId', 'flowId']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Plan bounded repair', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'mobile_mirror_repair_get', description: 'Read a redacted repair status under the current project scope; never returns raw media or private paths.',
    inputSchema: objectSchema({ caseId: { type: 'string', format: 'uuid' } }, ['caseId']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Read repair status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'mobile_mirror_repair_submit', description: 'Submit a bounded source patch for an approved version-1 host request; no host success verdict is accepted.',
    inputSchema: objectSchema({ caseId: { type: 'string', format: 'uuid' }, expectedRevision: { type: 'integer', minimum: 1 },
      submission: objectSchema({ protocolVersion: { type: 'integer', const: 1 },
        requestId: { type: 'string', format: 'uuid' }, caseId: { type: 'string', format: 'uuid' },
        attemptId: { type: 'string', format: 'uuid' }, generation: { type: 'integer', minimum: 1 },
        repositoryId: { type: 'string', minLength: 1, maxLength: 64 },
        baseCommit: { type: 'string', pattern: '^[a-f0-9]{40}$' },
        requestDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        patchDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        patch: { type: 'string', maxLength: 524288 },
        host: objectSchema({ kind: { type: 'string', enum: ['codex-mcp', 'deepseek-harness-cordis'] },
          version: { type: 'string', minLength: 1, maxLength: 64 },
          pluginVersion: { type: 'string', minLength: 1, maxLength: 64 } },
        ['kind', 'version', 'pluginVersion']) },
      ['protocolVersion', 'requestId', 'caseId', 'attemptId', 'generation', 'repositoryId',
        'baseCommit', 'requestDigest', 'patchDigest', 'patch', 'host']) },
    ['caseId', 'expectedRevision', 'submission']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Submit repair patch', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  { name: 'mobile_mirror_repair_verify', description: 'Consume a local exact-patch approval to start frozen Mock locator or independent trusted-local source software verification; no device install.',
    inputSchema: objectSchema({ caseId: { type: 'string', format: 'uuid' }, expectedRevision: { type: 'integer', minimum: 1 } },
    ['caseId', 'expectedRevision']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Start approved repair verification', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
  { name: 'mobile_mirror_repair_cancel', description: 'Cancel an authorized repair; completion waits for actual child exit.',
    inputSchema: objectSchema({ caseId: { type: 'string', format: 'uuid' }, expectedRevision: { type: 'integer', minimum: 1 } },
    ['caseId', 'expectedRevision']), outputSchema: GENERIC_OBJECT_OUTPUT_SCHEMA,
    annotations: { title: 'Cancel repair', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
] as const

export function mobileMirrorToolContract(name: MobileMirrorToolName): MobileMirrorToolContract {
  return [...MOBILE_MIRROR_TOOL_CONTRACTS, ...REPAIR_TOOL_CONTRACTS].find((contract) => contract.name === name)!
}

export function dshParameters(schema: JsonSchema): Record<string, unknown> {
  if (Array.isArray(schema.oneOf)) return dshVariantParameters(schema.oneOf)
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [])
  return Object.fromEntries(Object.entries(properties).map(([name, value]) => [
    name,
    isRecord(value) && required.has(name) ? { ...dshOutputSchema(value), required: true } : dshOutputSchema(value as JsonSchema),
  ]))
}

function dshVariantParameters(variants: readonly unknown[]): Record<string, unknown> {
  const objectVariants = variants.filter(isRecord)
  const propertyNames = new Set<string>()
  for (const variant of objectVariants) {
    if (isRecord(variant.properties)) Object.keys(variant.properties).forEach((name) => propertyNames.add(name))
  }
  const output: Record<string, unknown> = {}
  for (const name of propertyNames) {
    const properties = objectVariants
      .map((variant) => isRecord(variant.properties) ? variant.properties[name] : undefined)
      .filter(isRecord)
    if (properties.length === 0) continue
    let property = dshOutputSchema(properties[0]!)
    const constValues = properties.map((entry) => entry.const).filter((value): value is string => typeof value === 'string')
    if (constValues.length > 0) {
      property = { ...property, type: 'string', enum: [...new Set(constValues)] }
      delete property.const
    }
    const requiredEverywhere = objectVariants.length > 0 && objectVariants.every((variant) => {
      const required = Array.isArray(variant.required) ? variant.required : []
      return required.includes(name)
    })
    output[name] = requiredEverywhere ? { ...property, required: true } : property
  }
  return output
}

export function dshOutputSchema(schema: JsonSchema): Record<string, unknown> {
  if (!isRecord(schema)) return schema as Record<string, unknown>
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [])
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'required') continue
    if (key === 'properties' && isRecord(value)) {
      output.properties = Object.fromEntries(Object.entries(value).map(([name, property]) => {
        const converted = isRecord(property) ? dshOutputSchema(property) : property
        return [name, isRecord(converted) && required.has(name) ? { ...converted, required: true } : converted]
      }))
      continue
    }
    if (key === 'items' && isRecord(value)) {
      output.items = dshOutputSchema(value)
      continue
    }
    if (['type', 'enum', 'const', 'description', 'title', 'default', 'examples', 'additionalProperties', 'oneOf'].includes(key)) {
      output[key] = key === 'oneOf' && Array.isArray(value)
        ? value.map((entry) => dshOutputSchema(entry as JsonSchema))
        : value
    }
  }
  // DSH rc.1 infers the union type from its branches and rejects a sibling type.
  if (Array.isArray(output.oneOf)) delete output.type
  return output
}

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
  additionalProperties = false,
) {
  return {
    type: 'object' as const,
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
