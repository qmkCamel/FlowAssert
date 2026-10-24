import { describe, expect, it, vi } from 'vitest'
import { resolveStandaloneMcpConfig } from '../src/mcp-config.js'
import { runOnboardingCli } from '../src/onboarding-cli.js'
import { renderOnboardingConfig, safeTemplate } from '../src/onboarding-config.js'
import { PACKAGE_VERSION } from '../src/version.js'
import { normalizePreflight } from '../src/environment-preflight.js'

describe('onboarding config', () => {
  it('renders complete safe DSH and MCP defaults', () => {
    const dsh = renderOnboardingConfig({ target: 'dsh', platform: 'mock' })
    for (const fragment of [
      '- id: mobile-mirror',
      "defaultProvider: 'mock'",
      "agentScreenContentPolicy: 'mock-only'",
      "appiumRuntimeMode: 'external'",
      "appiumExecutablePath: ''",
      'allowHostDeviceDiscovery: false',
      'allowHostSigningDiagnostics: false',
      'iosWdaAllowProvisioningDeviceRegistration: false',
    ]) expect(dsh).toContain(fragment)

    const mcp = JSON.parse(renderOnboardingConfig({ target: 'mcp', platform: 'mock' }))
    expect(resolveStandaloneMcpConfig(mcp)).toMatchObject({
      mirror: safeTemplate('mock'),
      mcp: { maxImageBytes: 8 * 1024 * 1024 },
    })
  })

  it('keeps physical templates mock-only and uses public placeholders', () => {
    expect(safeTemplate('android')).toMatchObject({
      agentScreenContentPolicy: 'mock-only',
      allowHostDeviceDiscovery: false,
      appiumExecutablePath: '/ABSOLUTE/PATH/TO/APPIUM',
      androidScrcpyPath: '/ABSOLUTE/PATH/TO/SCRCPY-4.1',
    })
    expect(safeTemplate('ios')).toMatchObject({
      agentScreenContentPolicy: 'mock-only',
      allowHostSigningDiagnostics: false,
      iosWdaAllowProvisioningDeviceRegistration: false,
      iosWdaXcodeOrgId: 'REPLACE_WITH_TEAM_ID',
    })
  })

  it('quotes absolute Codex paths without registering anything', () => {
    expect(renderOnboardingConfig({
      target: 'codex',
      packageRoot: "/opt/FlowAssert/it's-ready",
      configPath: '/tmp/mobile mirror.json',
    })).toBe("codex mcp add mobile-mirror -- node '/opt/FlowAssert/it'\"'\"'s-ready/scripts/mobile-mirror-mcp.mjs' --config '/tmp/mobile mirror.json'\n")
    expect(() => renderOnboardingConfig({ target: 'codex', packageRoot: '.', configPath: '/tmp/config.json' })).toThrow('absolute')
  })
})

describe('onboarding CLI', () => {
  it('prints help/version and rejects unknown arguments before doctor creation', async () => {
    const io = captureIo()
    const createDoctor = vi.fn()
    expect(await runOnboardingCli(['--version'], io.io, { createDoctor })).toBe(0)
    expect(io.stdout()).toBe(`${PACKAGE_VERSION}\n`)
    expect(createDoctor).not.toHaveBeenCalled()

    io.clear()
    expect(await runOnboardingCli(['unknown', '--secret', '/private/path'], io.io, { createDoctor })).toBe(1)
    expect(io.stderr()).toBe('Invalid mobile mirror command. Use --help for supported options.\n')
    expect(io.stderr()).not.toContain('/private')
    expect(createDoctor).not.toHaveBeenCalled()
  })

  it('renders canonical doctor JSON and propagates blocked exit code', async () => {
    const io = captureIo()
    const report = {
      schemaVersion: 2 as const,
      context: normalizePreflight({ platform: 'android' }),
      checkedAt: '2026-10-07T00:00:00.000Z',
      scope: 'environment-prerequisites-only' as const,
      capabilities: {},
      overall: 'blocked' as const,
      platform: 'android' as const,
      checks: [{ id: 'adb', role: 'required' as const, status: 'blocked' as const, code: 'adb_unavailable', suggestion: 'Configure ADB.' }],
    }
    const createDoctor = vi.fn(() => ({ run: async () => report }))
    expect(await runOnboardingCli(['doctor', '--platform', 'android', '--format', 'json'], io.io, { createDoctor })).toBe(2)
    expect(JSON.parse(io.stdout())).toEqual(report)
    expect(createDoctor).toHaveBeenCalledTimes(1)
  })

  it('prints configs but never writes files or starts a server', async () => {
    const io = captureIo()
    expect(await runOnboardingCli(['config', '--target', 'mcp', '--platform', 'mock'], io.io)).toBe(0)
    expect(resolveStandaloneMcpConfig(JSON.parse(io.stdout())).mirror.defaultProvider).toBe('mock')
  })
  it('returns 130 and removes its SIGINT listener when a check is cancelled', async () => {
    const io = captureIo(), before = process.listenerCount('SIGINT')
    const run = vi.fn(async (_input, signal?: AbortSignal) => {
      queueMicrotask(() => process.emit('SIGINT'))
      return await new Promise<never>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('private-error')), { once: true }))
    })
    expect(await runOnboardingCli(['doctor'], io.io, { createDoctor: () => ({ run }) })).toBe(130)
    expect(io.stdout()).toBe(''); expect(io.stderr()).toBe('Environment check cancelled.\n')
    expect(process.listenerCount('SIGINT')).toBe(before)
  })
})

function captureIo() {
  let output = ''
  let errors = ''
  return {
    io: {
      stdout: { write(value: string) { output += value } },
      stderr: { write(value: string) { errors += value } },
    },
    stdout: () => output,
    stderr: () => errors,
    clear() { output = ''; errors = '' },
  }
}
