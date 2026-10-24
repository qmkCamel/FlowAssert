import { open } from 'node:fs/promises'
import { assertAppiumRuntimeConfig, Config, type Config as MirrorConfig } from './config.js'

const MAX_CONFIG_BYTES = 64 * 1024
const DEFAULT_MCP_MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_MCP_IMAGE_BYTES = 32 * 1024 * 1024

const MIRROR_CONFIG_KEYS = new Set<keyof MirrorConfig>([
  'defaultProvider',
  'agentScreenContentPolicy',
  'agentTextInputPolicy',
  'agentAppControlPolicy',
  'agentAllowedAppIds',
  'appiumUrl',
  'appiumRuntimeMode',
  'appiumExecutablePath',
  'viewerHost',
  'viewerPort',
  'frameIntervalMs',
  'viewerMediaMode',
  'androidScrcpyPath',
  'androidScrcpyServerPath',
  'androidScrcpyMaxSize',
  'androidScrcpyMaxFps',
  'androidScrcpyVideoBitRate',
  'iosMjpegPort',
  'iosMjpegFramerate',
  'iosMjpegScalingFactor',
  'iosMjpegScreenshotQuality',
  'startupTimeoutMs',
  'appiumSessionStartupTimeoutMs',
  'mockStartupDelayMs',
  'allowHostDeviceDiscovery',
  'adbPath',
  'xcrunPath',
  'androidIgnoreHiddenApiPolicyError',
  'iosWdaXcodeOrgId',
  'iosWdaXcodeSigningId',
  'iosWdaUpdatedBundleId',
  'iosWdaXcodeConfigFile',
  'iosWdaAllowProvisioningDeviceRegistration',
  'allowHostSigningDiagnostics',
  'agentTestControl',
  'repairToolsEnabled',
])

export interface McpAdapterConfig {
  maxImageBytes: number
}

export interface StandaloneMcpConfig {
  mirror: MirrorConfig
  mcp: McpAdapterConfig
}

export function resolveMirrorConfig(input: unknown = {}): MirrorConfig {
  if (!isRecord(input)) throw configError()
  if (Object.keys(input).some((key) => !MIRROR_CONFIG_KEYS.has(key as keyof MirrorConfig))) throw configError()
  try {
    return assertAppiumRuntimeConfig(Config(input as unknown as MirrorConfig))
  } catch {
    throw configError()
  }
}

export function resolveStandaloneMcpConfig(input: unknown = {}): StandaloneMcpConfig {
  if (!isRecord(input)) throw configError()
  const mirrorInput: Record<string, unknown> = {}
  let mcpInput: unknown = undefined
  for (const [key, value] of Object.entries(input)) {
    if (key === 'mcp') {
      mcpInput = value
      continue
    }
    if (!MIRROR_CONFIG_KEYS.has(key as keyof MirrorConfig)) throw configError()
    mirrorInput[key] = value
  }

  if (mcpInput !== undefined && !isRecord(mcpInput)) throw configError()
  const mcpRecord = (mcpInput ?? {}) as Record<string, unknown>
  if (Object.keys(mcpRecord).some((key) => key !== 'maxImageBytes')) throw configError()
  const maxImageBytes = mcpRecord.maxImageBytes ?? DEFAULT_MCP_MAX_IMAGE_BYTES
  if (!Number.isInteger(maxImageBytes) || (maxImageBytes as number) < 1 || (maxImageBytes as number) > MAX_MCP_IMAGE_BYTES) {
    throw configError()
  }

  return {
    mirror: resolveMirrorConfig(mirrorInput),
    mcp: { maxImageBytes: maxImageBytes as number },
  }
}

export async function loadStandaloneMcpConfig(path?: string): Promise<StandaloneMcpConfig> {
  if (!path) return resolveStandaloneMcpConfig()
  let text: string
  try {
    text = await readBounded(path)
  } catch (error) {
    if (error instanceof Error && error.message === 'MCP configuration exceeds 64 KiB') throw error
    throw configError()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw configError()
  }
  return resolveStandaloneMcpConfig(parsed)
}

async function readBounded(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1)
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > MAX_CONFIG_BYTES) throw new Error('MCP configuration exceeds 64 KiB')
    return bytes.subarray(0, offset).toString('utf8')
  } finally {
    await handle.close()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function configError(): Error {
  return new Error('Invalid MCP configuration')
}
