import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Config, type Config as MirrorConfig } from '../src/config.js'
import { DoctorService } from '../src/doctor.js'
import { normalizePreflight, planEnvironmentChecks, EnvironmentPreflightService, type PreflightInput } from '../src/environment-preflight.js'
import { checkDshProfile, checkDshVersion } from '../src/preflight-dsh.js'
import { NodeHostCommandRunner, type HostCommandResult } from '../src/host-command-runner.js'
import { runOnboardingCli } from '../src/onboarding-cli.js'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function temp() { const path = await mkdtemp(join(tmpdir(), 'preflight-test-')); directories.push(path); return path }
const ok = (stdout = ''): HostCommandResult => ({ ok: true, stdout, stderr: '', exitCode: 0, timedOut: false, aborted: false })
const config = () => Config({} as MirrorConfig)

describe('scope selection before side effects', () => {
  for (const entry of ['viewer', 'mcp', 'codex', 'cli'] as const) for (const operation of ['runtime', 'report', 'mock'] as const) {
    it(`${entry}/${operation} never touches physical tools or DSH`, async () => {
      const run = vi.fn(async () => { throw new Error('forbidden-command') }), appiumStatus = vi.fn(async () => { throw new Error('forbidden-http') })
      const report = await new DoctorService(config(), { runner: { run }, appiumStatus }).run({ entry, operation })
      expect(report.overall).toBe('ready'); expect(report.schemaVersion).toBe(2)
      expect(run).not.toHaveBeenCalled(); expect(appiumStatus).not.toHaveBeenCalled()
      expect(report.checks.some(x => /dsh|android|ios|scrcpy|appium/.test(x.id))).toBe(false)
    })
  }
  it('normalizes aliases and excludes unrelated platform/capabilities', () => {
    expect(normalizePreflight()).toMatchObject({ entry: 'cli', operation: 'runtime', provider: 'none', platform: 'none' })
    for (const platform of ['android', 'ios'] as const) {
      const plan = planEnvironmentChecks(normalizePreflight({ entry: 'codex', platform }))
      expect(plan.some(x => x.id === platform)).toBe(true)
      expect(plan.some(x => x.id === (platform === 'ios' ? 'android' : 'ios') || x.id === 'dsh-profile' || x.id === 'media')).toBe(false)
    }
    const plan = planEnvironmentChecks(normalizePreflight({ entry: 'dsh', platform: 'all', features: { media: 'required', ocr: 'required', 'ai-recovery': 'required', recording: 'preferred' } }))
    expect(plan.length).toBeLessThanOrEqual(32); expect(new Set(plan.map(x => x.id)).size).toBe(plan.length)
  })
  for (const input of [{ operation: 'mock', platform: 'android' }, { operation: 'report', platform: 'ios' }, { operation: 'connect', provider: 'mock', platform: 'android' }, { features: { random: 'off' } }, { operation: 'test', testRef: '../../evil' }]) {
    it(`rejects incompatible context ${JSON.stringify(input)}`, async () => {
      const run = vi.fn(async () => ok())
      await expect(new DoctorService(config(), { runner: { run } }).run(input as PreflightInput)).rejects.toThrow('preflight_input_invalid')
      expect(run).not.toHaveBeenCalled()
    })
  }
  it('rejects irrelevant DSH/private paths and duplicate CLI flags before construction', async () => {
    const createDoctor = vi.fn(), stdout = vi.fn(), stderr = vi.fn()
    for (const args of [['--dsh-executable', '/trusted/dsh'], ['--operation', 'report', '--platform', 'ios'], ['--target', 'cli', '--target', 'dsh']]) {
      expect(await runOnboardingCli(['doctor', ...args], { stdout: { write: stdout }, stderr: { write: stderr } }, { createDoctor })).toBe(1)
    }
    expect(createDoctor).not.toHaveBeenCalled(); expect(stderr.mock.calls.join()).not.toContain('/trusted')
  })
})

describe('bounded execution and aggregation', () => {
  it('treats empty evidence as incomplete and known unsupported recording as blocked', async () => {
    expect((await new EnvironmentPreflightService(async () => []).run(normalizePreflight())).overall).toBe('incomplete')
    const doctor = new DoctorService(config(), { recordingSupported: false })
    expect((await doctor.run({ entry: 'viewer', operation: 'mock', features: { recording: 'required' } })).overall).toBe('blocked')
    expect((await doctor.run({ entry: 'viewer', operation: 'mock', features: { recording: 'preferred' } })).overall).toBe('ready')
  })
  it('never reads report contents and keeps inaccessible private paths out of results', async () => {
    const root = await temp(), path = join(root, 'PRIVATE-report')
    await writeFile(path, 'PRIVATE_CONTENT_NOT_JSON')
    const doctor = new DoctorService(config(), { reportPath: path })
    const report = await doctor.run({ operation: 'report' })
    expect(report.overall).toBe('ready'); expect(JSON.stringify(report)).not.toContain('PRIVATE')
    const absent = await new DoctorService(config(), { reportPath: join(root, 'PRIVATE-missing') }).run({ operation: 'report' })
    expect(absent.overall).toBe('blocked'); expect(JSON.stringify(absent)).not.toContain('PRIVATE')
  })
  it('caps concurrent work and marks timeouts incomplete, never ready', async () => {
    let active = 0, peak = 0
    const run = new EnvironmentPreflightService(async (_item, signal) => {
      active++; peak = Math.max(peak, active)
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { active--; resolve() }, { once: true }))
      return []
    }, 30)
    const report = await run.run(normalizePreflight({ entry: 'dsh', platform: 'all' }))
    expect(peak).toBeLessThanOrEqual(3); expect(report.overall).toBe('incomplete')
    expect(report.checks.some(x => x.status === 'skipped')).toBe(true)
  })
  it('cancels and never dispatches the rest of a plan', async () => {
    const controller = new AbortController(), execute = vi.fn(async () => { controller.abort(); return [] })
    await expect(new EnvironmentPreflightService(execute).run(normalizePreflight({ platform: 'all' }), controller.signal)).rejects.toThrow()
    expect(execute.mock.calls.length).toBeLessThanOrEqual(1)
  })
  it('isolates preferred failure and unknown required conditions', async () => {
    const run = new EnvironmentPreflightService(async item => [{ id: item.id, status: item.feature ? 'blocked' : 'pass', code: 'fixture', suggestion: 'fixture' }])
    const preferred = await run.run(normalizePreflight({ operation: 'mock', features: { ocr: 'preferred' } }))
    expect(preferred.overall).toBe('ready'); expect(preferred.capabilities.ocr?.status).toBe('unavailable')
    expect((await run.run(normalizePreflight({ operation: 'mock', features: { ocr: 'required' } }))).overall).toBe('blocked')
  })
  it('uses real read-only loopback HTTP only when connection is selected', async () => {
    let requests = 0
    const server = createServer((_request, response) => { requests++; response.end(JSON.stringify({ value: { ready: true, build: { version: '3.2.0' } } })) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }, cfg = Config({ appiumUrl: `http://127.0.0.1:${address.port}`, appiumRuntimeMode: 'managed', appiumExecutablePath: '/fixture/appium', adbPath: '/fixture/adb' } as MirrorConfig)
      const run = vi.fn(async (_command: string, args: string[]) => ok(args[0] === 'devices' ? 'List of devices attached\nPRIVATE\tdevice\n' : args[0] === 'driver' ? '{"uiautomator2":{"version":"6.8.0"}}' : '3.2.0'))
      const doctor = new DoctorService(cfg, { runner: { run }, executableAccess: async () => undefined })
      await doctor.run(); expect(requests).toBe(0)
      const report = await doctor.run('android'); expect(requests).toBe(1); expect(report.overall).toBe('ready')
      expect(JSON.stringify(report)).not.toContain('PRIVATE'); expect(run.mock.calls.some(([cmd]) => cmd.includes('xcrun'))).toBe(false)
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('rejects non-loopback endpoints without dispatching HTTP', async () => {
    const appiumStatus = vi.fn(async () => ({ ready: true, version: null }))
    const cfg = config(); cfg.appiumUrl = 'http://untrusted.invalid:4723'
    const report = await new DoctorService(cfg, { runner: { run: async () => ok() }, appiumStatus }).run('android')
    expect(appiumStatus).not.toHaveBeenCalled()
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'appium_endpoint_invalid', status: 'blocked' }))
  })
  it('executes a real bounded child without a shell', async () => {
    const runner = new NodeHostCommandRunner(), result = await runner.run(process.execPath, ['--version'], { timeoutMs: 1000 })
    expect(result.ok).toBe(true)
    const controller = new AbortController(), pending = runner.run(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { signal: controller.signal, timeoutMs: 1000 })
    controller.abort(); expect((await pending).aborted).toBe(true)
  })
})

describe('explicit DSH target', () => {
  it('checks the exact executable and rejects every unrecognized version', async () => {
    const root = await temp(), path = join(root, 'dsh')
    await writeFile(path, '#!/bin/sh\nprintf "0.2.0-rc.2\\n"\n'); await chmod(path, 0o700)
    expect((await checkDshVersion({ executable: path }, new NodeHostCommandRunner(), new AbortController().signal))[0]?.status).toBe('pass')
    for (const version of ['0.2.0-rc.1', '0.2.0-alpha.9', '0.2.0', '0.2.0-rc.2\nPRIVATE']) {
      const run = vi.fn(async () => ok(version))
      const report = await checkDshVersion({ executable: path }, { run }, new AbortController().signal)
      expect(report[0]?.status).toBe('blocked'); expect(run.mock.calls.length).toBe(1); expect(JSON.stringify(report)).not.toContain('PRIVATE')
    }
  })
  it('validates only selected manifests and keeps activation unverified', async () => {
    const root = await temp(), plugin = join(root, 'node_modules/flowassert')
    await mkdir(plugin, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['flowassert'] } } }))
    const peers = { '@deepseek-ai/cordis': '~4.0.4', '@deepseek-ai/dsh-attachment': '0.2.0-rc.2', '@deepseek-ai/dsh-llm': '0.2.0-rc.2', '@deepseek-ai/dsh-tools': '0.2.0-rc.2' }
    await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: 'flowassert', peerDependencies: peers }))
    for (const [name, version] of Object.entries(peers)) { const dir = join(root, 'node_modules', name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: version.replace('~', '') })) }
    await writeFile(join(root, 'cordis.patch.yml'), 'secret: PRIVATE_NEVER_READ')
    expect(await checkDshProfile({ profileRoot: root }, new AbortController().signal)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'pass', code: 'dsh_peer_metadata_ready' }), expect.objectContaining({ status: 'manual', code: 'dsh-profile-unverified' })]))
    await writeFile(join(root, 'node_modules/@deepseek-ai/dsh-tools/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.1.0' }))
    expect((await checkDshProfile({ profileRoot: root }, new AbortController().signal))[0]?.code).toBe('dsh_peer_mismatch')
    // rc.2 installation peers take precedence over a conflicting profile copy.
    const installation = join(root, 'installation'), executable = join(installation, 'bin/dsh.mjs')
    await mkdir(join(installation, 'bin'), { recursive: true }); await writeFile(executable, 'throw new Error("must not import")')
    await writeFile(join(installation, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }))
    for (const [name, version] of Object.entries(peers)) { const dir = join(installation, 'node_modules', name); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: version.replace('~', '') })) }
    const link = join(root, 'selected-dsh'); await symlink(executable, link)
    expect(await checkDshProfile({ profileRoot: root, executable: link }, new AbortController().signal)).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'dsh_peer_metadata_ready' })]))
    await writeFile(join(installation, 'node_modules/@deepseek-ai/dsh-tools/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.1.0' }))
    expect((await checkDshProfile({ profileRoot: root, executable: link }, new AbortController().signal))[0]?.code).toBe('dsh_peer_mismatch')
  })
  it('rejects missing, cyclic and oversized metadata without exposing contents', async () => {
    const root = await temp()
    await symlink('package.json', join(root, 'package.json'))
    expect((await checkDshProfile({ profileRoot: root }, new AbortController().signal))[0]?.status).toBe('manual')
    const other = await temp(); await writeFile(join(other, 'package.json'), 'PRIVATE'.repeat(160000))
    expect(JSON.stringify(await checkDshProfile({ profileRoot: other }, new AbortController().signal))).not.toContain('PRIVATE')
  })
})
