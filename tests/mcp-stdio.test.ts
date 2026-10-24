import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { startStdioMcpServer } from '../src/mcp.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('stdio MCP entrypoint', () => {
  it('keeps help and version outside protocol mode and rejects mixed arguments', async () => {
    let output = ''
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk)
        callback()
      },
    })
    await expect(startStdioMcpServer(['--help'], { stdout })).resolves.toBeNull()
    expect(output).toContain('Usage: flowassert-mcp')
    output = ''
    await expect(startStdioMcpServer(['--version'], { stdout })).resolves.toBeNull()
    expect(output).toBe('0.1.0-alpha.2\n')
    await expect(startStdioMcpServer(['--help', '--version'], { stdout })).rejects.toThrow('Invalid MCP command arguments')
  })

  it('converges EOF and explicit close without protocol-channel output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mobile-mirror-mcp-stdio-'))
    directories.push(directory)
    const configPath = join(directory, 'config.json')
    await writeFile(configPath, JSON.stringify({ viewerPort: 0, mockStartupDelayMs: 0 }))
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let protocolOutput = ''
    stdout.on('data', (chunk) => { protocolOutput += String(chunk) })
    const handle = await startStdioMcpServer(['--config', configPath], {
      stdin,
      stdout,
      installProcessSignalHandlers: false,
    })
    if (!handle) throw new Error('Expected MCP handle')
    const viewerUrl = handle.server.runtime.viewer.url
    expect((await fetch(viewerUrl)).status).toBe(200)
    stdin.end()
    await eventuallyUnavailable(viewerUrl)
    await Promise.all([handle.close(), handle.close()])
    expect(protocolOutput).toBe('')
  })
})

async function eventuallyUnavailable(url: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(50) })
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Viewer listener remained reachable after stdin EOF')
}
