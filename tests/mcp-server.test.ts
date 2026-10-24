import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStandaloneMcpConfig, type StandaloneMcpConfig } from '../src/mcp-config.js'
import { MobileMirrorMcpServer } from '../src/mcp-server.js'
import { MOBILE_MIRROR_TOOL_NAMES, REPAIR_TOOL_NAMES } from '../src/tool-contracts.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'

type Connected = { client: Client; server: MobileMirrorMcpServer }
const connected: Connected[] = []
const httpServers: Array<ReturnType<typeof createServer>> = []
const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(connected.splice(0).map(async ({ client, server }) => {
    await client.close().catch(() => undefined)
    await server.close()
  }))
  await Promise.all(httpServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function connect(config: StandaloneMcpConfig = resolveStandaloneMcpConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), options = {}): Promise<Connected> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = new MobileMirrorMcpServer(config, options)
  const client = new Client({ name: 'mobile-mirror-test', version: '1.0.0' }, { capabilities: {} })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const pair = { client, server }
  connected.push(pair)
  return pair
}

describe('host-neutral MCP server', () => {
  it('runs registered test catalog, idempotent start, status and evidence through MCP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-mcp-agent-')); tempDirectories.push(root)
    const projectPath = join(root, 'project.json')
    await writeFile(join(root, 'fixture.yaml'), 'name: MCP fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    await writeFile(projectPath, JSON.stringify({ flows: { fixture: 'fixture.yaml' } }))
    const config = resolveStandaloneMcpConfig({ viewerPort: 0, mockStartupDelayMs: 0, agentTestControl: {
      enabled: true, projectPath, allowedFlows: ['fixture'], allowedSuites: [], allowedPlatforms: ['ios'],
      allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: ['flow', 'image'],
    } })
    const runtime = new LocalDeviceRuntime(config.mirror, { workbenchRoot: join(root, 'runs') })
    const { client } = await connect(config, { runtime })
    await callTool(client, { name: 'mobile_mirror_start', arguments: { provider: 'mock' } })
    const catalog = await callTool(client, { name: 'mobile_mirror_test_catalog', arguments: {} })
    const revision = String(catalog.structuredContent?.catalogRevision)
    const start = await callTool(client, { name: 'mobile_mirror_run_start', arguments: { requestId: 'mcp-run-1', target: { kind: 'flow', id: 'fixture' }, catalogRevision: revision } })
    expect(start.structuredContent).toMatchObject({ phase: 'accepted' })
    const executionId = String(start.structuredContent?.executionId)
    await expect.poll(async () => (await callTool(client, { name: 'mobile_mirror_run_status', arguments: { executionId } })).structuredContent?.phase, { timeout: 10_000 }).toBe('finished')
    const status = await callTool(client, { name: 'mobile_mirror_run_status', arguments: { executionId } })
    expect(status.structuredContent).toMatchObject({ verdict: 'pass', evidenceVerification: 'verified', task: { contractVersion: 1, kind: 'test-run', phase: 'finished', result: { exitCode: 0 } } })
    const evidence = await callTool(client, { name: 'mobile_mirror_run_evidence', arguments: { executionId } })
    expect((evidence.structuredContent?.items as unknown[]).length).toBeGreaterThan(0)
    const imageEntry = (evidence.structuredContent?.items as Array<{ artifactId: string; kind: string }>).find((entry) => entry.kind === 'image')!
    const image = await callTool(client, { name: 'mobile_mirror_run_evidence', arguments: { executionId, artifactId: imageEntry.artifactId, format: 'image' } })
    expect(image.content.filter((block) => block.type === 'image')).toHaveLength(1)
    expect(JSON.stringify(image.structuredContent)).not.toContain('base64')
  }, 15_000)

  it('advertises only tools and the same shared contracts', async () => {
    const { client } = await connect()
    expect(client.getServerVersion()).toMatchObject({ name: 'mobile-mirror', version: '0.1.0-alpha.2' })
    expect(client.getServerCapabilities()).toEqual({ tools: {} })
    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual(MOBILE_MIRROR_TOOL_NAMES)
    expect(listed.tools.every((tool) => tool.inputSchema.type === 'object' && tool.outputSchema?.type === 'object')).toBe(true)
    expect(listed.tools.find((tool) => tool.name === 'mobile_mirror_action')?.annotations).toMatchObject({ destructiveHint: true, openWorldHint: true })
    expect(listed.tools.find((tool) => tool.name === 'mobile_mirror_action')?.inputSchema.oneOf).toHaveLength(5)
    expect(listed.tools.find((tool) => tool.name === 'mobile_mirror_manage_app')?.annotations).toMatchObject({
      destructiveHint: true, idempotentHint: false, openWorldHint: true,
    })
    await expect(client.listResources()).rejects.toThrow(/method not found/i)
  })

  it('advertises exactly five opt-in repair tools, never approval, and hides them after project revocation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-mcp-repair-')); tempDirectories.push(root)
    const projectPath = join(root, 'project.json')
    const policy = { enabled: true, projectId: 'sample', permissions: ['plan', 'verify', 'cancel'],
      allowedFlows: ['demo'], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'] }
    await writeFile(join(root, 'demo.yaml'), 'name: Demo\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- done\n')
    await writeFile(projectPath, JSON.stringify({ flows: { demo: 'demo.yaml' }, repair: policy }))
    const config = resolveStandaloneMcpConfig({ viewerPort: 0, repairToolsEnabled: true,
      agentTestControl: { projectPath } })
    const runtime = new LocalDeviceRuntime(config.mirror, { workbenchRoot: join(root, 'runs') })
    const { client } = await connect(config, { runtime })
    const repairTools = (await client.listTools()).tools
    expect(repairTools.map(tool => tool.name)).toEqual([...MOBILE_MIRROR_TOOL_NAMES, ...REPAIR_TOOL_NAMES])
    expect(repairTools.find(tool => tool.name === 'mobile_mirror_repair_submit')?.inputSchema).toMatchObject({
      properties: { submission: { properties: { requestId: { format: 'uuid' },
        generation: { type: 'integer' }, patchDigest: { pattern: '^[a-f0-9]{64}$' },
        host: { properties: { kind: { enum: ['codex-mcp', 'deepseek-harness-cordis'] } } } } } },
    })
    expect((await callTool(client, { name: 'mobile_mirror_repair_submit', arguments: {
      caseId: '11111111-1111-4111-8111-111111111111', requestDigest: 'a'.repeat(64), patch: 'fake',
    } })).content).toEqual([{ type: 'text', text: expect.stringContaining('repair-capability-unavailable') }])
    await writeFile(projectPath, JSON.stringify({ flows: { demo: 'demo.yaml' }, repair: { ...policy, enabled: false } }))
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(MOBILE_MIRROR_TOOL_NAMES)
    expect((await callTool(client, { name: 'mobile_mirror_repair_get', arguments: {
      caseId: '11111111-1111-4111-8111-111111111111',
    } })).isError).toBe(true)
  })

  it('runs the complete Mock semantic node, text, secure rejection, and app lifecycle', async () => {
    const marker = 'PUBLIC-MCP-MARKER'
    const { client } = await connect(resolveStandaloneMcpConfig({
      viewerPort: 0,
      mockStartupDelayMs: 0,
      agentAppControlPolicy: 'session-app',
    }))
    await client.listTools()
    await expectData(client, 'mobile_mirror_start', { provider: 'mock' }, { lifecycle: 'streaming' })
    const initial = await callTool(client, { name: 'mobile_mirror_inspect_screen', arguments: {} })
    await expectData(client, 'mobile_mirror_action', {
      kind: 'tap_node', observationId: initial.structuredContent?.observationId, nodeId: 'n3',
    }, { lastAction: 'tap_node' })
    const focused = await callTool(client, { name: 'mobile_mirror_inspect_screen', arguments: {} })
    const inputResult = await callTool(client, {
      name: 'mobile_mirror_action',
      arguments: { kind: 'input_text', observationId: focused.structuredContent?.observationId, nodeId: 'n3', mode: 'replace', text: marker },
    })
    expect(inputResult.isError).not.toBe(true)
    expect(text(inputResult)).not.toContain(marker)
    const afterInput = await callTool(client, { name: 'mobile_mirror_inspect_screen', arguments: {} })
    expect(JSON.stringify(afterInput.structuredContent)).toContain(marker)

    await expectData(client, 'mobile_mirror_action', {
      kind: 'tap_node', observationId: afterInput.structuredContent?.observationId, nodeId: 'n4',
    }, { lastAction: 'tap_node' })
    const secureFocused = await callTool(client, { name: 'mobile_mirror_inspect_screen', arguments: {} })
    const secure = await callTool(client, {
      name: 'mobile_mirror_action',
      arguments: { kind: 'input_text', observationId: secureFocused.structuredContent?.observationId, nodeId: 'n4', mode: 'append', text: marker },
    })
    expect(secure.isError).toBe(true)
    expect(text(secure)).toContain('screen_text_input_sensitive')
    expect(text(secure)).not.toContain(marker)

    const terminated = await callTool(client, { name: 'mobile_mirror_manage_app', arguments: { operation: 'terminate' } })
    expect(terminated.structuredContent).toMatchObject({ operation: 'terminate', targetScope: 'mock', afterState: 'not-running' })
    expect(JSON.stringify(terminated.structuredContent)).not.toContain('com.example')
    await expectData(client, 'mobile_mirror_manage_app', { operation: 'activate' }, { afterState: 'foreground' })
    await expectData(client, 'mobile_mirror_stop', {}, { lifecycle: 'idle' })
  })

  it('completes a Mock image, structure, bound action, stale rejection, and stop loop', async () => {
    const { client } = await connect()
    await client.listTools()
    await expectData(client, 'mobile_mirror_start', { provider: 'mock' }, { lifecycle: 'streaming' })

    const snapshot = await callTool(client, { name: 'mobile_mirror_snapshot', arguments: {} })
    expect(snapshot.isError).not.toBe(true)
    expect(snapshot.content[0]).toMatchObject({ type: 'text' })
    const images = snapshot.content.filter((block) => block.type === 'image')
    expect(images).toHaveLength(1)
    const image = images[0]!
    expect(image.type === 'image' && [...Buffer.from(image.data, 'base64').subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(snapshot.structuredContent).toMatchObject({ image: { delivery: 'mcp-image-content' }, frameRevision: 1 })
    const canonical = JSON.stringify(snapshot.structuredContent)
    expect(canonical).not.toContain(image.type === 'image' ? image.data.slice(0, 24) : 'impossible')

    const inspect = await callTool(client, { name: 'mobile_mirror_inspect_screen', arguments: {} })
    expect(inspect.content.filter((block) => block.type === 'image')).toHaveLength(0)
    expect((inspect.structuredContent?.structure as { nodes?: unknown[] } | undefined)?.nodes?.length).toBeGreaterThan(0)
    const observationId = String(inspect.structuredContent?.observationId)
    await expectData(client, 'mobile_mirror_action', { kind: 'tap', x: 120, y: 240, observationId }, { lastAction: 'tap(120,240)' })
    const stale = await callTool(client, { name: 'mobile_mirror_action', arguments: { kind: 'back', observationId } })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('screen_observation_stale')

    const next = await callTool(client, { name: 'mobile_mirror_snapshot', arguments: {} })
    expect(Number(next.structuredContent?.frameRevision)).toBeGreaterThan(Number(snapshot.structuredContent?.frameRevision))
    await expectData(client, 'mobile_mirror_stop', {}, { lifecycle: 'idle' })
  })

  it('returns bounded stable errors without structured or image leakage', async () => {
    const config = resolveStandaloneMcpConfig({ viewerPort: 0, mockStartupDelayMs: 0, mcp: { maxImageBytes: 1 } })
    const { client } = await connect(config)
    await client.listTools()
    const invalid = await callTool(client, { name: 'mobile_mirror_start', arguments: { provider: 'private-provider' } })
    expect(invalid.isError).toBe(true)
    expect(invalid.structuredContent).toBeUndefined()
    expect(text(invalid)).toContain('mobile_mirror_invalid_arguments')
    expect(text(invalid)).not.toContain('private-provider')

    await callTool(client, { name: 'mobile_mirror_start', arguments: { provider: 'mock' } })
    const tooLarge = await callTool(client, { name: 'mobile_mirror_snapshot', arguments: {} })
    expect(tooLarge.isError).toBe(true)
    expect(text(tooLarge)).toContain('screen_observation_too_large')
    expect(tooLarge.content.every((block) => block.type === 'text')).toBe(true)
    const unknown = await callTool(client, { name: 'mobile_mirror_unknown', arguments: {} })
    expect(unknown.isError).toBe(true)
    expect(text(unknown)).toContain('mobile_mirror_tool_not_found')
  })

  it('emits progress after 300 ms and supports caller cancellation', async () => {
    const progress: Array<{ progress: number; message?: string | undefined }> = []
    const { client } = await connect(resolveStandaloneMcpConfig({ viewerPort: 0, mockStartupDelayMs: 360 }), { progressDelayMs: 300 })
    await client.listTools()
    await callTool(
      client,
      { name: 'mobile_mirror_start', arguments: { provider: 'mock' } },
      { onprogress: (value) => progress.push(value), timeout: 2_000 },
    )
    expect(progress.map((item) => item.progress)).toEqual([0, 0.5, 1])
    expect(progress[1]?.message).toContain('connecting')
    await callTool(client, { name: 'mobile_mirror_stop', arguments: {} })

    const slow = await connect(resolveStandaloneMcpConfig({ viewerPort: 0, mockStartupDelayMs: 2_000 }))
    await slow.client.listTools()
    const controller = new AbortController()
    const call = callTool(
      slow.client,
      { name: 'mobile_mirror_start', arguments: { provider: 'mock' } },
      { signal: controller.signal, timeout: 3_000 },
    )
    setTimeout(() => controller.abort(), 20)
    await expect(call).rejects.toThrow(/abort/i)
    const status = await callTool(slow.client, { name: 'mobile_mirror_status', arguments: {} })
    expect(status.content[0]?.type).toBe('text')
  })

  it('aborts active adapter requests and releases the Viewer when the server closes', async () => {
    const pair = await connect(resolveStandaloneMcpConfig({ viewerPort: 0, mockStartupDelayMs: 2_000 }))
    await pair.client.listTools()
    const viewerUrl = pair.server.runtime.viewer.url
    const start = callTool(pair.client, { name: 'mobile_mirror_start', arguments: { provider: 'mock' } }, { timeout: 3_000 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await pair.server.close()
    await expect(start).rejects.toThrow(/closed|abort|cancel/i)
    await expect(fetch(viewerUrl)).rejects.toThrow()
  })

  it('keeps status and stop available during a slow observation and preserves the last frame', async () => {
    const progress: Array<{ progress: number; message?: string | undefined }> = []
    let beginRect!: () => void
    const rectStarted = new Promise<void>((resolve) => { beginRect = resolve })
    const requests: string[] = []
    const png = Buffer.alloc(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.writeUInt32BE(10, 16)
    png.writeUInt32BE(20, 20)
    const appium = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'slow', capabilities: { platformName: 'Android' } } }))
      else if (request.url?.endsWith('/screenshot')) response.end(JSON.stringify({ value: png.toString('base64') }))
      else if (request.url?.endsWith('/window/rect')) {
        beginRect()
        setTimeout(() => response.end(JSON.stringify({ value: { x: 0, y: 0, width: 10, height: 20 } })), 1_000)
      } else if (request.url?.endsWith('/orientation')) response.end(JSON.stringify({ value: 'PORTRAIT' }))
      else if (request.url?.endsWith('/source')) response.end(JSON.stringify({ value: '<hierarchy><node class="android.widget.Button" text="Safe" bounds="[0,0][10,20]"/></hierarchy>' }))
      else response.end(JSON.stringify({ value: null }))
    })
    httpServers.push(appium)
    await new Promise<void>((resolve) => appium.listen(0, '127.0.0.1', resolve))
    const address = appium.address()
    if (!address || typeof address === 'string') throw new Error('Missing Appium port')
    const { client } = await connect(resolveStandaloneMcpConfig({
      viewerPort: 0,
      mockStartupDelayMs: 0,
      appiumUrl: `http://127.0.0.1:${address.port}`,
      agentScreenContentPolicy: 'structure',
      startupTimeoutMs: 2_000,
    }), { progressDelayMs: 300 })
    await client.listTools()
    const started = await callTool(client, {
      name: 'mobile_mirror_start',
      arguments: { provider: 'appium', capabilitiesJson: '{"platformName":"Android"}' },
    })
    const lastFrameAt = String(started.structuredContent?.frameUpdatedAt)

    const inspect = callTool(
      client,
      { name: 'mobile_mirror_inspect_screen', arguments: {} },
      { onprogress: (value) => progress.push(value), timeout: 2_000 },
    )
    await rectStarted
    await new Promise((resolve) => setTimeout(resolve, 330))
    const duringCapture = await callTool(client, { name: 'mobile_mirror_status', arguments: {} })
    expect(duringCapture.structuredContent).toMatchObject({ lifecycle: 'streaming', observation: { phase: 'capturing' } })

    const stopped = await callTool(client, { name: 'mobile_mirror_stop', arguments: {} })
    const interrupted = await inspect
    expect(interrupted.isError).toBe(true)
    expect(text(interrupted)).toContain('screen_observation_session_mismatch')
    expect(stopped.structuredContent).toMatchObject({ lifecycle: 'idle', frameUpdatedAt: lastFrameAt })
    expect(progress.map((item) => item.progress)).toEqual([0, 0.5, 1])
    expect(progress[1]?.message).toContain('capturing')
    expect(requests).toContain('DELETE /session/slow')
    expect((await client.listTools()).tools).toHaveLength(20)
  })

  it('preserves owned and attached Appium session cleanup through MCP', async () => {
    const requests: string[] = []
    const png = Buffer.alloc(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.writeUInt32BE(10, 16)
    png.writeUInt32BE(20, 20)
    const appium = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'owned', capabilities: { platformName: 'Android' } } }))
      else if (request.url === '/session/external') response.end(JSON.stringify({ value: { capabilities: { platformName: 'Android' } } }))
      else if (request.url?.endsWith('/screenshot')) response.end(JSON.stringify({ value: png.toString('base64') }))
      else response.end(JSON.stringify({ value: null }))
    })
    httpServers.push(appium)
    await new Promise<void>((resolve) => appium.listen(0, '127.0.0.1', resolve))
    const address = appium.address()
    if (!address || typeof address === 'string') throw new Error('Missing Appium port')
    const { client } = await connect(resolveStandaloneMcpConfig({
      viewerPort: 0,
      mockStartupDelayMs: 0,
      appiumUrl: `http://127.0.0.1:${address.port}`,
    }))
    await client.listTools()
    await callTool(client, {
      name: 'mobile_mirror_start',
      arguments: { provider: 'appium', capabilitiesJson: '{"platformName":"Android"}' },
    })
    await callTool(client, { name: 'mobile_mirror_stop', arguments: {} })
    await callTool(client, { name: 'mobile_mirror_start', arguments: { provider: 'appium', sessionId: 'external' } })
    await callTool(client, { name: 'mobile_mirror_stop', arguments: {} })
    expect(requests).toContain('DELETE /session/owned')
    expect(requests).not.toContain('DELETE /session/external')
  })

  it('deletes only owned Appium sessions when the MCP process closes', async () => {
    const requests: string[] = []
    const png = Buffer.alloc(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.writeUInt32BE(10, 16)
    png.writeUInt32BE(20, 20)
    const appium = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.setHeader('content-type', 'application/json')
      if (request.url === '/status') response.end(JSON.stringify({ value: { ready: true } }))
      else if (request.url === '/session' && request.method === 'POST') response.end(JSON.stringify({ value: { sessionId: 'close-owned', capabilities: { platformName: 'Android' } } }))
      else if (request.url === '/session/close-external') response.end(JSON.stringify({ value: { capabilities: { platformName: 'Android' } } }))
      else if (request.url?.endsWith('/screenshot')) response.end(JSON.stringify({ value: png.toString('base64') }))
      else response.end(JSON.stringify({ value: null }))
    })
    httpServers.push(appium)
    await new Promise<void>((resolve) => appium.listen(0, '127.0.0.1', resolve))
    const address = appium.address()
    if (!address || typeof address === 'string') throw new Error('Missing Appium port')
    const config = resolveStandaloneMcpConfig({
      viewerPort: 0,
      mockStartupDelayMs: 0,
      appiumUrl: `http://127.0.0.1:${address.port}`,
    })

    const owned = await connect(config)
    await owned.client.listTools()
    await callTool(owned.client, {
      name: 'mobile_mirror_start',
      arguments: { provider: 'appium', capabilitiesJson: '{"platformName":"Android"}' },
    })
    await owned.server.close()

    const attached = await connect(config)
    await attached.client.listTools()
    await callTool(attached.client, {
      name: 'mobile_mirror_start',
      arguments: { provider: 'appium', sessionId: 'close-external' },
    })
    await attached.server.close()
    expect(requests).toContain('DELETE /session/close-owned')
    expect(requests).not.toContain('DELETE /session/close-external')
  })
})

async function expectData(client: Client, name: string, args: Record<string, unknown>, expected: object): Promise<void> {
  const result = await callTool(client, { name, arguments: args })
  expect(result.isError).not.toBe(true)
  expect(result.structuredContent).toMatchObject(expected)
  expect(JSON.parse(text(result))).toEqual(result.structuredContent)
}

function text(result: CallToolResult): string {
  const block = result.content[0]
  if (!block || block.type !== 'text') throw new Error('Missing text result')
  return block.text
}

async function callTool(
  client: Client,
  params: { name: string; arguments?: Record<string, unknown> },
  options?: RequestOptions,
): Promise<CallToolResult> {
  return await client.callTool(params, CallToolResultSchema, options) as unknown as CallToolResult
}
