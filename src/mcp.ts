import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Readable, Writable } from 'node:stream'
import { loadStandaloneMcpConfig, resolveStandaloneMcpConfig } from './mcp-config.js'
import { MobileMirrorMcpServer, type MobileMirrorMcpServerOptions } from './mcp-server.js'
import { PACKAGE_VERSION } from './version.js'

export { loadStandaloneMcpConfig, resolveStandaloneMcpConfig } from './mcp-config.js'
export type { McpAdapterConfig, StandaloneMcpConfig } from './mcp-config.js'
export { MobileMirrorMcpServer } from './mcp-server.js'
export type { MobileMirrorMcpServerOptions } from './mcp-server.js'

export interface StdioMcpHandle {
  server: MobileMirrorMcpServer
  close(): Promise<void>
}

export interface StdioMcpOptions extends MobileMirrorMcpServerOptions {
  stdin?: Readable
  stdout?: Writable
  stderr?: Writable
  installProcessSignalHandlers?: boolean
}

export async function startStdioMcpServer(args: readonly string[] = [], options: StdioMcpOptions = {}): Promise<StdioMcpHandle | null> {
  const parsed = parseArgs(args)
  const stdout = options.stdout ?? process.stdout
  if (parsed.mode !== 'server') {
    stdout.write(parsed.mode === 'help' ? helpText() : `${PACKAGE_VERSION}\n`)
    return null
  }

  const config = await loadStandaloneMcpConfig(parsed.configPath)
  const server = new MobileMirrorMcpServer(config, options)
  const stdin = options.stdin ?? process.stdin
  const transport = new StdioServerTransport(stdin, stdout)
  let closePromise: Promise<void> | null = null
  const close = () => {
    closePromise ??= server.close()
    return closePromise
  }
  const closeFromInput = () => { void close() }
  stdin.once('end', closeFromInput)
  stdin.once('close', closeFromInput)

  const signalHandlers = new Map<NodeJS.Signals, () => void>()
  if (options.installProcessSignalHandlers !== false) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = () => { void close().finally(() => { process.exitCode = 0 }) }
      signalHandlers.set(signal, handler)
      process.once(signal, handler)
    }
  }

  try {
    await server.connect(transport)
  } catch (error) {
    stdin.off('end', closeFromInput)
    stdin.off('close', closeFromInput)
    for (const [signal, handler] of signalHandlers) process.off(signal, handler)
    await close().catch(() => undefined)
    throw error
  }

  return {
    server,
    async close() {
      stdin.off('end', closeFromInput)
      stdin.off('close', closeFromInput)
      for (const [signal, handler] of signalHandlers) process.off(signal, handler)
      await close()
    },
  }
}

export async function runMcpCli(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  await startStdioMcpServer(args, {
    logger: (message) => process.stderr.write(`${message}\n`),
  })
}

function parseArgs(args: readonly string[]): { mode: 'server'; configPath?: string } | { mode: 'help' | 'version' } {
  if (args.length === 0) return { mode: 'server' }
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return { mode: 'help' }
  if (args.length === 1 && args[0] === '--version') return { mode: 'version' }
  if (args.length === 2 && args[0] === '--config' && args[1]) return { mode: 'server', configPath: args[1] }
  throw new Error('Invalid MCP command arguments')
}

function helpText(): string {
  return [
    'Usage: flowassert-mcp [--config <json-file>]',
    '',
    'Runs a host-neutral mobile mirror MCP server over stdio.',
    'Use --help or --version only outside MCP transport mode.',
    '',
  ].join('\n')
}
