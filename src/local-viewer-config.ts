import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { Config } from './config.js'
import type { ConnectionAssistantPlatform, ConnectionAssistantSigningInput } from './connection-assistant.js'
import { resolveMirrorConfig } from './mcp-config.js'

const MAX_LOCAL_CONFIG_BYTES = 64 * 1024
const TEAM_ID = /^[A-Za-z0-9]{10}$/
const BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

export interface LocalViewerSettings {
  mirror: Config
  local: {
    preferredPlatform: ConnectionAssistantPlatform | null
  }
}

export interface PersistLocalViewerSetupInput {
  platform: ConnectionAssistantPlatform
  appiumExecutablePath: string
  signing?: ConnectionAssistantSigningInput
}

export class LocalViewerConfigError extends Error {
  constructor() {
    super('Invalid local Viewer configuration')
    this.name = 'LocalViewerConfigError'
  }
}

export function defaultLocalViewerConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const root = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config')
  return join(root, 'deepseek-harness-mobile-mirror', 'viewer.json')
}

export function resolveLocalViewerSettings(input: unknown = {}): LocalViewerSettings {
  if (!isRecord(input) || Object.keys(input).some((key) => key !== 'mirror' && key !== 'local')) throw localConfigError()
  const mirrorInput = input.mirror ?? {}
  const localInput = input.local ?? {}
  if (!isRecord(localInput) || Object.keys(localInput).some((key) => key !== 'preferredPlatform')) throw localConfigError()
  const preferredPlatform = localInput.preferredPlatform ?? null
  if (preferredPlatform !== null && preferredPlatform !== 'android' && preferredPlatform !== 'ios') throw localConfigError()
  try {
    return {
      mirror: resolveMirrorConfig(mirrorInput),
      local: { preferredPlatform },
    }
  } catch {
    throw localConfigError()
  }
}

export class LocalViewerConfigStore {
  readonly path: string

  constructor(path = defaultLocalViewerConfigPath()) {
    if (!isAbsolute(path)) throw localConfigError()
    this.path = path
  }

  async load(): Promise<{ settings: LocalViewerSettings; exists: boolean }> {
    let stat
    try {
      stat = await lstat(this.path)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return { settings: resolveLocalViewerSettings(), exists: false }
      throw localConfigError()
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw localConfigError()
    let text: string
    try {
      text = await readBoundedNoFollow(this.path)
    } catch {
      throw localConfigError()
    }
    try {
      return { settings: resolveLocalViewerSettings(JSON.parse(text)), exists: true }
    } catch {
      throw localConfigError()
    }
  }

  async saveSetup(input: PersistLocalViewerSetupInput): Promise<LocalViewerSettings> {
    if ((input.platform !== 'android' && input.platform !== 'ios') || !isAbsolute(input.appiumExecutablePath)) {
      throw localConfigError()
    }
    if (input.platform === 'ios') {
      if (!input.signing || !TEAM_ID.test(input.signing.teamId)
        || input.signing.wdaBundleId.length > 255 || !BUNDLE_ID.test(input.signing.wdaBundleId)) {
        throw localConfigError()
      }
    } else if (input.signing) {
      throw localConfigError()
    }

    const current = await this.load()
    const settings = resolveLocalViewerSettings({
      mirror: {
        ...current.settings.mirror,
        defaultProvider: 'appium',
        appiumRuntimeMode: 'managed',
        appiumExecutablePath: input.appiumExecutablePath,
        ...(input.signing ? {
          iosWdaXcodeOrgId: input.signing.teamId,
          iosWdaUpdatedBundleId: input.signing.wdaBundleId,
        } : {}),
      },
      local: { preferredPlatform: input.platform },
    })
    await writeAtomicPrivateJson(this.path, settings)
    return settings
  }
}

async function readBoundedNoFollow(path: string): Promise<string> {
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0
  const handle = await open(path, constants.O_RDONLY | noFollow)
  try {
    const bytes = Buffer.alloc(MAX_LOCAL_CONFIG_BYTES + 1)
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > MAX_LOCAL_CONFIG_BYTES) throw localConfigError()
    return bytes.subarray(0, offset).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function writeAtomicPrivateJson(path: string, value: LocalViewerSettings): Promise<void> {
  const parent = dirname(path)
  const temp = join(parent, `.viewer-${randomBytes(12).toString('hex')}.tmp`)
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const parentStat = await lstat(parent)
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw localConfigError()
    await chmod(parent, 0o700)
    try {
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || !stat.isFile()) throw localConfigError()
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error
    }
    const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, path)
    await chmod(path, 0o600)
  } catch {
    await unlink(temp).catch(() => undefined)
    throw localConfigError()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

function localConfigError(): LocalViewerConfigError {
  return new LocalViewerConfigError()
}
