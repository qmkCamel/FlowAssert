import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadStandaloneMcpConfig, resolveStandaloneMcpConfig } from '../src/mcp-config.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('standalone MCP configuration', () => {
  it('uses safe shared defaults and an 8 MiB image limit', () => {
    const config = resolveStandaloneMcpConfig()
    expect(config).toMatchObject({
      mirror: {
        defaultProvider: 'mock',
        agentScreenContentPolicy: 'mock-only',
        agentTextInputPolicy: 'mock-only',
        agentAppControlPolicy: 'disabled',
        agentAllowedAppIds: [],
        appiumRuntimeMode: 'external',
        appiumExecutablePath: '',
        viewerMediaMode: 'auto',
        viewerHost: '127.0.0.1',
        allowHostDeviceDiscovery: false,
        allowHostSigningDiagnostics: false,
        iosWdaAllowProvisioningDeviceRegistration: false,
      },
      mcp: { maxImageBytes: 8 * 1024 * 1024 },
    })
  })

  it('rejects unknown keys and unsafe values without echoing input', () => {
    const secret = '/Users/private/device-config.json'
    for (const input of [
      { unknown: secret },
      { viewerHost: '0.0.0.0' },
      { mcp: { unknown: secret } },
      { mcp: { maxImageBytes: 32 * 1024 * 1024 + 1 } },
      { appiumRuntimeMode: 'managed', appiumExecutablePath: '', appiumUrl: 'http://127.0.0.1:4723' },
      { appiumRuntimeMode: 'managed', appiumExecutablePath: '/trusted/appium', appiumUrl: 'http://remote.example:4723' },
      { agentAllowedAppIds: ['com.example.same', 'com.example.same'] },
      { agentAllowedAppIds: ['com.example/unsafe'] },
      [],
    ]) {
      const error = capture(() => resolveStandaloneMcpConfig(input))
      expect(error.message).toBe('Invalid MCP configuration')
      expect(error.message).not.toContain(secret)
    }
  })

  it('accepts explicit bounded agent policies through the MCP allowlist', () => {
    expect(resolveStandaloneMcpConfig({
      agentTextInputPolicy: 'non-sensitive',
      agentAppControlPolicy: 'allowlist',
      agentAllowedAppIds: ['com.example.public'],
    }).mirror).toMatchObject({
      agentTextInputPolicy: 'non-sensitive',
      agentAppControlPolicy: 'allowlist',
      agentAllowedAppIds: ['com.example.public'],
    })
  })

  it('loads a bounded JSON file and rejects invalid or oversized content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mobile-mirror-mcp-config-'))
    directories.push(directory)
    const valid = join(directory, 'valid.json')
    await writeFile(valid, JSON.stringify({ viewerPort: 0, mcp: { maxImageBytes: 1024 } }))
    await expect(loadStandaloneMcpConfig(valid)).resolves.toMatchObject({ mirror: { viewerPort: 0 }, mcp: { maxImageBytes: 1024 } })

    const invalid = join(directory, 'private-invalid.json')
    await writeFile(invalid, '{invalid')
    await expect(loadStandaloneMcpConfig(invalid)).rejects.toThrow('Invalid MCP configuration')

    const oversized = join(directory, 'private-oversized.json')
    await writeFile(oversized, Buffer.alloc(64 * 1024 + 1, 32))
    const error = await loadStandaloneMcpConfig(oversized).then(
      () => { throw new Error('Expected oversized configuration to fail') },
      (failure: unknown) => failure as Error,
    )
    expect(error.message).toBe('MCP configuration exceeds 64 KiB')
    expect(error.message).not.toContain(directory)
  })

  it('accepts only validated media keys through the MCP allowlist', () => {
    expect(resolveStandaloneMcpConfig({
      viewerMediaMode: 'polling',
      androidScrcpyPath: '/trusted/scrcpy',
      androidScrcpyServerPath: '/trusted/scrcpy-server',
      androidScrcpyMaxSize: 1920,
      androidScrcpyMaxFps: 60,
      androidScrcpyVideoBitRate: 8_000_000,
      iosMjpegPort: 12_345,
      iosMjpegFramerate: 20,
      iosMjpegScalingFactor: 75,
      iosMjpegScreenshotQuality: 50,
    }).mirror).toMatchObject({ viewerMediaMode: 'polling', androidScrcpyMaxFps: 60, iosMjpegPort: 12_345 })
    expect(() => resolveStandaloneMcpConfig({ androidScrcpyPath: 'relative' })).toThrow('Invalid MCP configuration')
  })
})

function capture(operation: () => unknown): Error {
  try {
    operation()
  } catch (error) {
    return error as Error
  }
  throw new Error('Expected operation to fail')
}
