import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { chromium } from '@playwright/test'
import { MOBILE_MIRROR_TOOL_NAMES } from '../src/tool-contracts.js'
// @ts-expect-error The packaged probe is deliberately plain ESM for DSH consumers.
import { createAcceptanceRecord, createExternalAsset, grantExternalAsset, createProbeMatrixRegistry, createProbeMatrix } from './dsh-runtime-probe.mjs'

interface ProbeArgs {
  launcher: string
  screenshot: string
  viewerLocalization: boolean
}

const args = parseArgs(process.argv.slice(2))
const exec = promisify(execFile)
const tempDirectory = await mkdtemp(join(tmpdir(), 'mobile-mirror-mcp-probe-'))
const configPath = join(tempDirectory, 'config.json')
const projectPath = join(tempDirectory, 'project.json')
const registryPath = await createProbeMatrixRegistry(tempDirectory)

try {
  await writeFile(join(tempDirectory, 'fixture.yaml'), 'name: Packed Agent fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
  await writeFile(join(tempDirectory, 'slow.yaml'), 'name: Packed Agent cancel\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- wait: 30\n- assertVisible: {text: "Hello, harness."}\n- done\n')
  await writeFile(projectPath, JSON.stringify({ flows: { fixture: 'fixture.yaml', slow: 'slow.yaml' }, suites: { smoke: { name: 'Packed smoke', cases: [{ id: 'fixture', flow: 'fixture' }] } } }))
  await writeFile(configPath, JSON.stringify({
    viewerPort: 0,
    mockStartupDelayMs: 360,
    agentScreenContentPolicy: 'mock-only',
    agentAppControlPolicy: 'session-app',
    agentTestControl: { enabled: true, projectPath, allowedFlows: ['fixture', 'slow'], allowedSuites: ['smoke'], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: ['flow', 'image'] },
  }), { mode: 0o600 })

  const lifecycle = await runLifecycle(args, configPath)
  await runSignalSmoke(args.launcher, configPath)
  process.stdout.write(`${JSON.stringify({
    toolCount: lifecycle.toolCount,
    revisions: lifecycle.revisions,
    image: lifecycle.image,
    structureNodeCount: lifecycle.structureNodeCount,
    viewerLocalization: lifecycle.viewerLocalization,
    signalCleanup: 'ok',
    packagedYaml: args.viewerLocalization ? 'pass-with-evidence-hashes' : 'not-requested',
    agentTests: lifecycle.agentTests,
    matrix: 'dual-mock-cli-mcp-pass',
  })}\n`)
} finally {
  await rm(tempDirectory, { recursive: true, force: true })
}

async function runLifecycle(args: ProbeArgs, configPath: string) {
  const connected = await connect(args.launcher, configPath)
  try {
    const listed = await connected.client.listTools()
    assert(JSON.stringify(listed.tools.map((tool) => tool.name)) === JSON.stringify(MOBILE_MIRROR_TOOL_NAMES), 'Unexpected MCP tool list')
    const actionSchema = listed.tools.find((tool) => tool.name === 'mobile_mirror_action')?.inputSchema
    const manageContract = listed.tools.find((tool) => tool.name === 'mobile_mirror_manage_app')
    assert(Array.isArray(actionSchema?.oneOf) && actionSchema.oneOf.length === 5, 'MCP action schema must expose five canonical variants')
    assert(manageContract?.annotations?.destructiveHint === true
      && manageContract.annotations.idempotentHint === false
      && manageContract.annotations.openWorldHint === true, 'MCP manage-app annotations are incomplete')
    const progress: number[] = []
    const started = await connected.client.callTool(
      { name: 'mobile_mirror_start', arguments: { provider: 'mock' } },
      CallToolResultSchema,
      { onprogress: (value) => progress.push(value.progress), timeout: 2_000 },
    ) as unknown as CallToolResult
    assert(!started.isError && progress.join(',') === '0,0.5,1', 'Built MCP progress lifecycle is incomplete')

    const compact = await call(connected.client, 'mobile_mirror_inspect_screen', { structureMode: 'summary' })
    assert(!compact.isError && !!compact.structuredContent?.structureSummary && !compact.structuredContent?.structure && compact.content.length === 1, 'Summary projection must omit nodes and images')
    for (const args of [{ op: 'find', role: 'input' }, { op: 'get', nodeId: 'n3' }, { op: 'subtree', nodeId: 'n0' }]) {
      const query = await call(connected.client, 'mobile_mirror_query_screen', { observationId: compact.structuredContent!.observationId, ...args })
      assert(!query.isError && query.content.length === 1 && query.content[0]?.type === 'text' && Array.isArray(query.structuredContent?.nodes), 'Query must be structured data without images')
    }
    await success(connected.client, 'mobile_mirror_action', { kind: 'tap_node', observationId: compact.structuredContent!.observationId, nodeId: 'n3' })
    const browserAsset = await fetch(String((await success(connected.client, 'mobile_mirror_status')).viewerUrl) + '/inspection-query.js')
    assert(browserAsset.ok && !(await browserAsset.text()).includes('node:'), 'Packed browser query asset unavailable')
    const snapshot = await call(connected.client, 'mobile_mirror_snapshot')
    assert(!snapshot.isError, 'Snapshot failed')
    const imageBlocks = snapshot.content.filter((block) => block.type === 'image')
    assert(imageBlocks.length === 1, 'Snapshot must contain one image block')
    const image = imageBlocks[0]
    assert(image?.type === 'image' && image.mimeType === 'image/png', 'Snapshot image must be PNG')
    const bytes = Buffer.from(image.data, 'base64')
    assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Snapshot image has an invalid PNG signature')
    await writeFile(resolve(args.screenshot), bytes)
    assert(!JSON.stringify(snapshot.structuredContent).includes(image.data.slice(0, 24)), 'Canonical snapshot must not contain Base64')

    const inspect = await call(connected.client, 'mobile_mirror_inspect_screen')
    assert(!inspect.isError, 'Inspect failed')
    const nodes = (inspect.structuredContent?.structure as { nodes?: unknown[] } | undefined)?.nodes
    assert(Array.isArray(nodes) && nodes.length > 0, 'Inspect must return bounded structure')
    const observationId = String(inspect.structuredContent?.observationId ?? '')
    const firstRevision = Number(snapshot.structuredContent?.frameRevision)
    await success(connected.client, 'mobile_mirror_action', { kind: 'tap_node', observationId, nodeId: 'n3' })
    const focused = await call(connected.client, 'mobile_mirror_inspect_screen')
    assert(!focused.isError, 'Focused inspect failed')
    const focusedNode = ((focused.structuredContent?.structure as { nodes?: Array<Record<string, unknown>> } | undefined)?.nodes ?? [])
      .find((node) => node.nodeId === 'n3')
    assert(focusedNode?.focused === true, 'Mock public input did not receive focus')
    const marker = 'PUBLIC-MCP-PROBE'
    const input = await call(connected.client, 'mobile_mirror_action', {
      kind: 'input_text',
      observationId: String(focused.structuredContent?.observationId ?? ''),
      nodeId: 'n3',
      mode: 'replace',
      text: marker,
    })
    assert(!input.isError && !JSON.stringify(input.structuredContent).includes(marker), 'Text result echoed the public marker')
    const next = await call(connected.client, 'mobile_mirror_inspect_screen')
    const lastRevision = Number(next.structuredContent?.frameRevision)
    assert(lastRevision > firstRevision, 'Observation revision must advance after the action')
    const nextValue = ((next.structuredContent?.structure as { nodes?: Array<Record<string, unknown>> } | undefined)?.nodes ?? [])
      .find((node) => node.nodeId === 'n3')?.value
    assert(nextValue === marker, 'Re-observe did not confirm the public marker')

    const secure = await call(connected.client, 'mobile_mirror_action', {
      kind: 'input_text',
      observationId: String(next.structuredContent?.observationId ?? ''),
      nodeId: 'n4',
      mode: 'append',
      text: marker,
    })
    assert(secure.isError && JSON.stringify(secure).includes('screen_text_input_sensitive') && !JSON.stringify(secure).includes(marker), 'Secure rejection is missing or echoed text')
    const appended = await call(connected.client, 'mobile_mirror_action', {
      kind: 'input_text',
      observationId: String(next.structuredContent?.observationId ?? ''),
      nodeId: 'n3',
      mode: 'append',
      text: '-APPEND',
    })
    assert(!appended.isError, 'Request-before-mutation rejection incorrectly invalidated the observation')
    const stale = await call(connected.client, 'mobile_mirror_action', {
      kind: 'tap_node', observationId, nodeId: 'n3',
    })
    assert(stale.isError && JSON.stringify(stale).includes('screen_observation_stale'), 'Old observation did not become stale')
    const terminated = await success(connected.client, 'mobile_mirror_manage_app', { operation: 'terminate' })
    assert(terminated.afterState === 'not-running' && !JSON.stringify(terminated).includes('com.example'), 'Mock terminate result is invalid or exposed app id')
    const activated = await success(connected.client, 'mobile_mirror_manage_app', { operation: 'activate' })
    assert(activated.afterState === 'foreground', 'Mock activate result is invalid')
    const afterLifecycle = await call(connected.client, 'mobile_mirror_inspect_screen')
    assert(!afterLifecycle.isError && Number(afterLifecycle.structuredContent?.frameRevision) > lastRevision, 'Session was not observable after application lifecycle')
    const catalog = await success(connected.client, 'mobile_mirror_test_catalog')
    assert(Array.isArray(catalog.items) && catalog.items.length === 3, 'Packed Agent catalog is incomplete')
    const execution = await success(connected.client, 'mobile_mirror_run_start', { requestId: 'packed-flow', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision })
    const finished = await waitExecution(connected.client, String(execution.executionId))
    assert(finished.verdict === 'pass' && finished.evidenceVerification === 'verified', 'Packed Agent flow did not pass')
    const evidence = await success(connected.client, 'mobile_mirror_run_evidence', { executionId: execution.executionId })
    const historical = (evidence.items as Array<Record<string, unknown>>).find((entry) => entry.kind === 'image')
    assert(historical, 'Packed Agent evidence did not include an image')
    const historicalImage = await call(connected.client, 'mobile_mirror_run_evidence', { executionId: execution.executionId, artifactId: historical.artifactId, format: 'image' })
    assert(!historicalImage.isError && historicalImage.content.filter((block) => block.type === 'image').length === 1 && !JSON.stringify(historicalImage.structuredContent).includes('base64'), 'Packed Agent image delivery failed')
    const viewerUrl = String((await success(connected.client, 'mobile_mirror_status')).viewerUrl)
    const triageStart = await fetch(new URL('/api/workbench/triage-jobs', viewerUrl), {
      method: 'POST', headers: { origin: viewerUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), targetRunId: finished.runId }),
    })
    assert(triageStart.status === 202, `Packed Viewer triage start failed: ${await triageStart.clone().text()}`)
    let triageJob = await triageStart.json() as { jobId: string; state: string; reportId?: string }
    for (let attempt = 0; attempt < 100 && triageJob.state !== 'succeeded'; attempt++) {
      assert(!['failed', 'cancelled', 'interrupted'].includes(triageJob.state), `Packed triage failed: ${JSON.stringify(triageJob)}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const response = await fetch(new URL(`/api/workbench/triage-jobs/${triageJob.jobId}`, viewerUrl))
      assert(response.ok, 'Packed Viewer triage status failed')
      triageJob = await response.json() as typeof triageJob
    }
    assert(triageJob.state === 'succeeded' && triageJob.reportId, 'Packed triage did not publish a report')
    const readTriage = await call(connected.client, 'mobile_mirror_run_triage', { reportId: triageJob.reportId })
    assert(!readTriage.isError && readTriage.structuredContent?.reportId === triageJob.reportId
      && readTriage.content.every((block) => block.type === 'text')
      && !/base64|file:\/\/|\/api\/workbench\/triage-reports/.test(JSON.stringify(readTriage.structuredContent)), 'Packed MCP triage projection is invalid')
    const unknownTriage = await call(connected.client, 'mobile_mirror_run_triage', { reportId: randomUUID() })
    assert(unknownTriage.isError && JSON.stringify(unknownTriage).includes('not_found'), 'Packed MCP unknown triage report was enumerable')
    const cli = join(dirname(args.launcher), 'mobile-mirror-cli.mjs')
    const matrixValidation = await exec(process.execPath, [cli, 'matrix', 'validate', 'smoke', '--url', viewerUrl], { timeout: 10000 })
    assert(JSON.parse(matrixValidation.stdout).valid, 'Packaged matrix CLI validation failed')
    const matrix = await createProbeMatrix(viewerUrl)
    const matrixTool = await call(connected.client, 'mobile_matrix_status', { id: matrix.id })
    assert(!matrixTool.isError && matrixTool.structuredContent?.exitCode === 0 && matrixTool.content.every(b => b.type === 'text') && !/base64|storeId|processIdentity|mock-device-/.test(JSON.stringify(matrixTool)), 'Packaged matrix MCP boundary failed')
    const matrixCli = await exec(process.execPath, [cli, 'matrix', 'status', matrix.id, '--url', viewerUrl], { timeout: 10000 })
    assert(JSON.parse(matrixCli.stdout).exitCode === 0, 'Packaged matrix CLI status failed')
    assert((await call(connected.client, 'mobile_matrix_status', { id: randomUUID() })).isError, 'Unknown matrix was disclosed')
    const externalId = await createExternalAsset(viewerUrl) as string
    assert((await call(connected.client, 'mobile_external_result_get', { id: externalId })).isError, 'External asset shared by default')
    await grantExternalAsset(externalId, true, viewerUrl)
    const external = await call(connected.client, 'mobile_external_result_get', { id: externalId })
    assert(!external.isError && external.structuredContent?.id === externalId && external.content.every(block => block.type === 'text') && !/private-test|private-secret/.test(JSON.stringify(external)), 'External safe projection failed')
    await grantExternalAsset(externalId, false, viewerUrl)
    assert((await call(connected.client, 'mobile_external_result_get', { id: externalId })).isError, 'External revocation failed')
    const reportPath = join(await realpath(tempDirectory), 'external.xml')
    await writeFile(reportPath, '<testsuite><testcase name="synthetic-cli"/></testsuite>')
    const imported = await exec(process.execPath, [cli, 'test', 'external-results', 'import', '--report', reportPath, '--adapter', 'junit', '--engine', 'synthetic-probe', '--engine-version', '1', '--reviewed', '--url', viewerUrl], { timeout: 15000 })
    const importedJob = JSON.parse(imported.stdout.trim().split('\n').at(-1)!)
    assert(importedJob.phase === 'finished', 'Packaged CLI external import failed')
    const externalCli = await exec(process.execPath, [cli, 'test', 'external-results', 'show', '--id', importedJob.assetId, '--url', viewerUrl], { timeout: 10000 })
    assert(JSON.parse(externalCli.stdout).availability === 'verified', 'Packaged CLI external bytes not verified')
    const acceptanceId = await createAcceptanceRecord(String(finished.runId), viewerUrl) as string
    const acceptance = await success(connected.client, 'mobile_acceptance_get', { id: acceptanceId })
    assert(acceptance.id === acceptanceId && (acceptance.current as { status: string }).status === 'incomplete' && !acceptance.input && !JSON.stringify(acceptance).includes('base64'), 'Packed MCP acceptance projection failed')
    const unknownAcceptance = await call(connected.client, 'mobile_acceptance_get', { id: randomUUID() })
    assert(unknownAcceptance.isError, 'Packed acceptance query accepted an unknown ID')
    const acceptanceCli = await exec(process.execPath, [cli, 'test', 'acceptance', 'export', '--id', acceptanceId, '--url', viewerUrl, '--format', 'json'], { timeout: 10000 })
      .then(() => { throw new Error('Incomplete acceptance incorrectly exited 0') }, error => error as { code: number; stdout: string })
    assert(acceptanceCli.code === 2 && JSON.parse(acceptanceCli.stdout).current.status === 'incomplete', 'Packed CLI acceptance exit code disagrees with MCP')
    const cliRead = await exec(process.execPath, [cli, 'test', 'triage', 'get', triageJob.jobId, '--url', viewerUrl], { timeout: 10_000 })
    assert(JSON.parse(cliRead.stdout.trim()).reportId === triageJob.reportId, 'Packed CLI could not read the Viewer triage job')
    const cliStart = await exec(process.execPath, [cli, 'test', 'triage', 'start', String(finished.runId), '--url', viewerUrl, '--wait'], { timeout: 15_000 })
    const cliResult = JSON.parse(cliStart.stdout.trim().split('\n').at(-1) ?? '{}')
    assert(cliResult.report?.targetRunId === finished.runId || cliResult.targetRunId === finished.runId, 'Packed CLI did not receive a triage report')
    const suite = await success(connected.client, 'mobile_mirror_run_start', { requestId: 'packed-suite', target: { kind: 'suite', id: 'smoke' }, catalogRevision: catalog.catalogRevision })
    const suiteFinished = await waitExecution(connected.client, String(suite.executionId))
    assert(suiteFinished.verdict === 'pass' && suiteFinished.exitCode === 0, 'Packed Agent suite did not pass')
    const cancellable = await success(connected.client, 'mobile_mirror_run_start', { requestId: 'packed-cancel', target: { kind: 'flow', id: 'slow' }, catalogRevision: catalog.catalogRevision })
    await success(connected.client, 'mobile_mirror_run_cancel', { executionId: cancellable.executionId })
    const cancelled = await waitExecution(connected.client, String(cancellable.executionId))
    assert(cancelled.verdict === 'cancelled', 'Packed Agent cancellation was not retained')
    await success(connected.client, 'mobile_mirror_stop')

    const viewerLocalization = args.viewerLocalization ? await runViewerLocalizationSmoke(viewerUrl) : 'not-requested'
    return {
      toolCount: listed.tools.length,
      revisions: [firstRevision, lastRevision],
      image: {
        width: Number(snapshot.structuredContent?.image && (snapshot.structuredContent.image as Record<string, unknown>).width),
        height: Number(snapshot.structuredContent?.image && (snapshot.structuredContent.image as Record<string, unknown>).height),
        byteLength: bytes.byteLength,
      },
      structureNodeCount: nodes.length,
      progress,
      viewerUrl,
      viewerLocalization,
      agentTests: 'catalog-flow-suite-cancel-evidence-triage',
    }
  } finally {
    await connected.client.close()
    assert(connected.stderr === '', 'MCP server wrote unexpected diagnostics to stderr')
  }
}

async function waitExecution(client: Client, executionId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = await success(client, 'mobile_mirror_run_status', { executionId })
    if (status.phase === 'finished') return status
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Packed Agent execution timed out')
}

async function runViewerLocalizationSmoke(viewerUrl: string): Promise<'ok'> {
  const i18n = await fetch(new URL('/i18n.js', viewerUrl))
  assert(i18n.ok && (await i18n.text()).includes("'zh-CN': Object.freeze(zhCN)"), 'Packed Viewer localization asset is unavailable')
  const bundledChromium = chromium.executablePath()
  const macOsChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const executablePath = existsSync(bundledChromium) ? undefined : existsSync(macOsChrome) ? macOsChrome : undefined
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], ...(executablePath ? { executablePath } : {}) })
  try {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    await page.goto(viewerUrl)
    assert(await page.locator('html').getAttribute('lang') === 'en', 'Packed Viewer did not start in English')
    await page.locator('#language-select').selectOption('zh-CN')
    assert(await page.locator('html').getAttribute('lang') === 'zh-CN', 'Packed Viewer did not switch to Simplified Chinese')
    assert((await page.locator('.control-panel h1').innerText()).includes('看见设备'), 'Packed Viewer Chinese copy is unavailable')
    assert(await page.evaluate(() => localStorage.getItem('mobile-mirror.locale.v1')) === 'zh-CN', 'Packed Viewer did not persist the canonical locale')
    await page.reload()
    assert(await page.locator('html').getAttribute('lang') === 'zh-CN', 'Packed Viewer did not restore the locale after refresh')
    await page.locator('#start-button').click()
    await page.waitForFunction(() => document.querySelector('#connection-label')?.textContent === '镜像中')
    assert(await page.locator('#device-frame').isVisible(), 'Packed Viewer Mock frame is unavailable')
    // Execute the installed worker, then fetch and hash the actual persisted evidence.
    const yaml = await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8')
    const response = await fetch(new URL('/api/runs', viewerUrl), {
      method: 'POST', headers: { origin: viewerUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ yaml, localEvidence: true }),
    })
    assert(response.status === 202, `Packed YAML start failed: ${await response.clone().text()}`)
    const { id } = await response.json() as { id: string }
    let run: import('../src/workbench-store.js').TestRun | undefined
    for (let attempt = 0; attempt < 200; attempt++) {
      run = await (await fetch(new URL(`/api/runs/${id}`, viewerUrl))).json() as import('../src/workbench-store.js').TestRun
      if (run.phase === 'finished') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert(run?.verdict === 'pass' && run.steps.length === 5, `Packed YAML failed: ${JSON.stringify(run)}`)
    const files = [...run.evidence, ...run.steps.flatMap((step) => step.evidence)]
    assert(files.some((file) => file.contentType === 'image/png') && files.some((file) => file.name.endsWith('.xml')), 'Packed worker did not persist screenshot/source evidence')
    for (const file of files) {
      const evidence = await fetch(new URL(`/api/runs/${id}/artifacts/${file.name}`, viewerUrl))
      assert(evidence.ok, 'Packed evidence download failed')
      const bytes = Buffer.from(await evidence.arrayBuffer())
      assert(bytes.length === file.bytes && createHash('sha256').update(bytes).digest('hex') === file.sha256, 'Packed evidence checksum mismatch')
    }
    await page.locator('#stop-button').click()
    await page.waitForFunction(() => document.querySelector('#connection-label')?.textContent === '空闲')
    await context.close()
    return 'ok'
  } finally {
    await browser.close()
  }
}

async function runSignalSmoke(launcher: string, configPath: string): Promise<void> {
  const connected = await connect(launcher, configPath)
  let viewerUrl = ''
  try {
    await success(connected.client, 'mobile_mirror_start', { provider: 'mock' })
    viewerUrl = String((await success(connected.client, 'mobile_mirror_status')).viewerUrl)
    const pid = connected.transport.pid
    assert(pid !== null, 'MCP child pid is unavailable')
    const closed = new Promise<void>((resolve) => { connected.client.onclose = resolve })
    process.kill(pid, 'SIGTERM')
    await withTimeout(closed, 3_000, 'MCP child did not exit after SIGTERM')
    await assertUnavailable(viewerUrl)
  } finally {
    await connected.client.close().catch(() => undefined)
    assert(connected.stderr === '', 'MCP signal smoke wrote unexpected diagnostics to stderr')
  }
}

async function connect(launcher: string, configPath: string) {
  let stderr = ''
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(launcher), '--config', configPath],
    cwd: tempDirectory,
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), MOBILE_MIRROR_RUNS_DIR: join(tempDirectory, 'runs'), MOBILE_MIRROR_MATRIX_REGISTRY: registryPath },
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const client = new Client({ name: 'mobile-mirror-stdio-probe', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  return {
    client,
    transport,
    get stderr() { return stderr },
  }
}

async function call(client: Client, name: string, argumentsValue: Record<string, unknown> = {}): Promise<CallToolResult> {
  return await client.callTool({ name, arguments: argumentsValue }, CallToolResultSchema) as unknown as CallToolResult
}

async function success(client: Client, name: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await call(client, name, argumentsValue)
  assert(!result.isError && result.structuredContent, `${name} failed`)
  return result.structuredContent
}

async function assertUnavailable(url: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(100) })
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Viewer listener remained reachable after MCP process exit')
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds)),
  ])
}

function parseArgs(values: string[]): ProbeArgs {
  let launcher = new URL('./mobile-mirror-mcp.mjs', import.meta.url).pathname
  let screenshot = 'artifacts/screenshots/mobile-mirror-mcp-stdio-final.png'
  let viewerLocalization = false
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index]
    const value = values[index + 1]
    if (!value || (flag !== '--launcher' && flag !== '--screenshot' && flag !== '--viewer-localization')) {
      throw new Error('Usage: mcp-runtime-probe [--launcher <path>] [--screenshot <path>] [--viewer-localization true]')
    }
    if (flag === '--launcher') launcher = value
    else if (flag === '--screenshot') screenshot = value
    else if (value === 'true') viewerLocalization = true
    else throw new Error('--viewer-localization must be true')
  }
  return { launcher, screenshot, viewerLocalization }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
