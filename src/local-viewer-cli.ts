import { isAbsolute } from 'node:path'
import { LocalDeviceRuntime, type LocalDeviceRuntimeOptions } from './local-device-runtime.js'
import { LocalViewerConfigStore, defaultLocalViewerConfigPath, type LocalViewerSettings } from './local-viewer-config.js'
import { resolveMirrorConfig } from './mcp-config.js'
import { PACKAGE_VERSION } from './version.js'

export interface LocalViewerCliIo {
  stdout: { write(value: string): unknown }
}

export interface LocalViewerHandle {
  url: string
  close(): Promise<void>
}

export interface LocalViewerCliDependencies {
  env?: NodeJS.ProcessEnv
  createStore?: (path: string) => Pick<LocalViewerConfigStore, 'load' | 'saveSetup'>
  createRuntime?: (config: LocalViewerSettings['mirror'], options: LocalDeviceRuntimeOptions) => {
    listen(): Promise<void>
    close(): Promise<void>
    viewer: { url: string }
  }
}

export async function startLocalViewerCli(
  args: readonly string[] = process.argv.slice(2),
  io: LocalViewerCliIo = { stdout: process.stdout },
  dependencies: LocalViewerCliDependencies = {},
): Promise<LocalViewerHandle | null> {
  if (args.length === 1 && ['--help', '-h'].includes(args[0] ?? '')) {
    io.stdout.write(localViewerHelpText())
    return null
  }
  if (args.length === 1 && args[0] === '--version') {
    io.stdout.write(`${PACKAGE_VERSION}\n`)
    return null
  }

  const env = dependencies.env ?? process.env
  const parsed = parseOptions(args, env)
  const store = dependencies.createStore?.(parsed.configPath) ?? new LocalViewerConfigStore(parsed.configPath)
  let loaded = await store.load()
  const mirror = resolveMirrorConfig({
    ...loaded.settings.mirror,
    ...(parsed.port !== undefined ? { viewerPort: parsed.port } : {}),
    ...(parsed.scrcpyPath !== undefined ? { androidScrcpyPath: parsed.scrcpyPath } : {}),
    ...(parsed.scrcpyServerPath !== undefined ? { androidScrcpyServerPath: parsed.scrcpyServerPath } : {}),
  })
  const options: LocalDeviceRuntimeOptions = {
    persistSetup: async (input) => {
      const settings = await store.saveSetup(input)
      loaded = { settings, exists: true }
    },
    localSetup: () => ({
      persistenceAvailable: true,
      preferredPlatform: loaded.exists ? loaded.settings.local.preferredPlatform : null,
    }),
  }
  const runtime = dependencies.createRuntime?.(mirror, options) ?? new LocalDeviceRuntime(mirror, options)
  await runtime.listen()
  io.stdout.write(`FlowAssert viewer: ${runtime.viewer.url}\n`)
  return { url: runtime.viewer.url, close: async () => runtime.close() }
}

export function localViewerHelpText(): string {
  return [
    'Usage: flowassert-viewer [--config <absolute-json>] [--port <0-65535>]',
    '',
    'Starts the loopback Viewer. Device checks and Appium startup require an explicit click.',
    `Default config: ${defaultLocalViewerConfigPath()}`,
    '',
  ].join('\n')
}

function parseOptions(args: readonly string[], env: NodeJS.ProcessEnv): {
  configPath: string
  port?: number
  scrcpyPath?: string
  scrcpyServerPath?: string
} {
  let configPath = env.MOBILE_MIRROR_CONFIG?.trim() || defaultLocalViewerConfigPath(env)
  let port = parsePort(env.MOBILE_MIRROR_PORT)
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key || !value) throw startupOptionsError()
    if (key === '--config') configPath = value
    else if (key === '--port') port = parsePort(value)
    else throw startupOptionsError()
  }
  if (!isAbsolute(configPath)) throw startupOptionsError()
  return {
    configPath,
    ...(port !== undefined ? { port } : {}),
    ...absoluteEnvPath(env.MOBILE_MIRROR_SCRCPY_PATH, 'scrcpyPath'),
    ...absoluteEnvPath(env.MOBILE_MIRROR_SCRCPY_SERVER_PATH, 'scrcpyServerPath'),
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw startupOptionsError()
  return port
}

function absoluteEnvPath(value: string | undefined, key: 'scrcpyPath' | 'scrcpyServerPath'): Partial<Record<'scrcpyPath' | 'scrcpyServerPath', string>> {
  if (value === undefined || value.trim() === '') return {}
  if (!isAbsolute(value.trim())) throw startupOptionsError()
  return { [key]: value.trim() }
}

function startupOptionsError(): Error {
  return new Error('Invalid Viewer startup options')
}
