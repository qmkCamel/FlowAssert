import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const platform = process.env.MOBILE_MIRROR_PLATFORM
const udid = process.env.MOBILE_MIRROR_UDID
if (platform !== 'android' && platform !== 'ios') throw new Error('MOBILE_MIRROR_PLATFORM must be android or ios')
if (!udid) throw new Error('MOBILE_MIRROR_UDID is required')

const evidenceRoot = resolve('artifacts/physical-validation')
const evidencePath = resolve(process.env.MOBILE_MIRROR_EVIDENCE_PATH
  ?? `artifacts/physical-validation/mcp-observation-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
if (!evidencePath.startsWith(`${evidenceRoot}/`)) throw new Error('Evidence path must be inside artifacts/physical-validation')
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 })

const launcher = resolve(process.env.MOBILE_MIRROR_MCP_LAUNCHER ?? 'scripts/mobile-mirror-mcp.mjs')
const tempDirectory = await mkdtemp(join(tmpdir(), 'mobile-mirror-mcp-physical-'))
const configPath = join(tempDirectory, 'config.json')
let stderr = ''
let client: Client | undefined

try {
  await writeFile(configPath, JSON.stringify({
    defaultProvider: 'appium',
    agentScreenContentPolicy: 'image-and-structure',
    appiumUrl: process.env.MOBILE_MIRROR_APPIUM_URL ?? 'http://127.0.0.1:4723',
    viewerPort: 0,
    startupTimeoutMs: 120_000,
    allowHostDeviceDiscovery: false,
    allowHostSigningDiagnostics: false,
    iosWdaAllowProvisioningDeviceRegistration: false,
    mcp: { maxImageBytes: 8 * 1024 * 1024 },
  }), { mode: 0o600 })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launcher, '--config', configPath],
    cwd: process.cwd(),
    stderr: 'pipe',
    maxBufferSize: 12 * 1024 * 1024,
  })
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  client = new Client({ name: 'mobile-mirror-physical-probe', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)

  await success(client, 'mobile_mirror_start', {
    provider: 'appium',
    capabilitiesJson: JSON.stringify(capabilities(platform, udid)),
  })
  const first = await observation(client)
  const x = Math.floor(first.viewport.width / 2)
  await success(client, 'mobile_mirror_action', {
    kind: 'swipe',
    startX: x,
    startY: Math.floor(first.viewport.height * 0.72),
    endX: x,
    endY: Math.floor(first.viewport.height * 0.36),
    durationMs: 500,
    observationId: first.observationId,
    coordinateSpace: 'viewport',
  })
  const second = await observation(client)
  assert(second.frameRevision > first.frameRevision, 'Observation revision did not advance')
  assert(second.screenEpoch > first.screenEpoch, 'Screen epoch did not advance')
  assert(Buffer.compare(first.bytes, second.bytes) !== 0, 'Physical screen image did not change after the safe action')
  await writeFile(evidencePath, second.bytes)
  const stopped = await success(client, 'mobile_mirror_stop')
  assert(stopped.lifecycle === 'idle', 'MCP physical session did not stop cleanly')
  process.stdout.write(`${JSON.stringify({
    platform,
    firstRevision: first.frameRevision,
    finalRevision: second.frameRevision,
    firstEpoch: first.screenEpoch,
    finalEpoch: second.screenEpoch,
    viewport: second.viewport,
    orientation: second.orientation,
    pngBytes: second.bytes.byteLength,
    structureNodes: second.structureNodes,
    structureTruncated: second.structureTruncated,
    coordinateSpace: 'viewport',
    ownedSessionCleaned: true,
    evidence: evidencePath,
  }, null, 2)}\n`)
} finally {
  if (client) {
    await call(client, 'mobile_mirror_stop').catch(() => undefined)
    await client.close().catch(() => undefined)
  }
  await rm(tempDirectory, { recursive: true, force: true })
  if (stderr) process.stderr.write('mobile-mirror physical MCP probe emitted diagnostics\n')
}

async function observation(activeClient: Client) {
  const result = await call(activeClient, 'mobile_mirror_inspect_screen', { includeImage: true })
  assert(!result.isError && result.structuredContent, 'MCP physical observation failed')
  const image = result.content.find((block) => block.type === 'image')
  assert(image?.type === 'image' && image.mimeType === 'image/png', 'MCP observation did not include one PNG')
  const bytes = Buffer.from(image.data, 'base64')
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'MCP observation returned invalid PNG magic bytes')
  const viewport = result.structuredContent.viewport as { width: number; height: number }
  const structure = result.structuredContent.structure as { nodes?: unknown[]; truncated?: boolean }
  assert(Number.isFinite(viewport?.width) && Number.isFinite(viewport?.height), 'MCP observation returned invalid viewport')
  assert(Array.isArray(structure?.nodes) && structure.nodes.length > 0, 'MCP observation returned no structure')
  return {
    observationId: String(result.structuredContent.observationId),
    frameRevision: Number(result.structuredContent.frameRevision),
    screenEpoch: Number(result.structuredContent.screenEpoch),
    orientation: String(result.structuredContent.orientation),
    viewport,
    bytes,
    structureNodes: structure.nodes.length,
    structureTruncated: Boolean(structure.truncated),
  }
}

function capabilities(target: 'android' | 'ios', deviceId: string): Record<string, unknown> {
  if (target === 'android') {
    return {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Android',
      'appium:udid': deviceId,
      'appium:appPackage': 'com.android.settings',
      'appium:appActivity': '.Settings',
      'appium:noReset': true,
      'appium:forceAppLaunch': true,
      'appium:settings': {
        waitForIdleTimeout: 1_000,
      },
    }
  }
  const value: Record<string, unknown> = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': 'iPhone',
    'appium:udid': deviceId,
    'appium:bundleId': 'com.apple.Preferences',
    'appium:noReset': true,
  }
  for (const [environment, key] of [
    ['MOBILE_MIRROR_IOS_TEAM_ID', 'appium:xcodeOrgId'],
    ['MOBILE_MIRROR_IOS_SIGNING_ID', 'appium:xcodeSigningId'],
    ['MOBILE_MIRROR_IOS_WDA_BUNDLE_ID', 'appium:updatedWDABundleId'],
    ['MOBILE_MIRROR_IOS_XCCONFIG', 'appium:xcodeConfigFile'],
  ] as const) {
    const configured = process.env[environment]
    if (configured) value[key] = configured
  }
  return value
}

async function call(activeClient: Client, name: string, argumentsValue: Record<string, unknown> = {}): Promise<CallToolResult> {
  return await activeClient.callTool({ name, arguments: argumentsValue }, CallToolResultSchema, { timeout: 130_000 }) as unknown as CallToolResult
}

async function success(activeClient: Client, name: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await call(activeClient, name, argumentsValue)
  assert(!result.isError && result.structuredContent, `${name} failed`)
  return result.structuredContent
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
