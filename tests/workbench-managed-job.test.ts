import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { runManagedWorkbenchJob } from '../src/workbench-managed-job.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture(step = '- assertVisible: {text: "Hello, harness."}\n- done\n') {
  const root = await mkdtemp(join(tmpdir(), 'mobile-mirror-job-')); roots.push(root)
  const projectPath = join(root, 'project.json'), flowPath = join(root, 'flow.yaml'), configPath = join(root, 'config.json'), connectionPath = join(root, 'connection.json'), reportDir = join(root, 'reports')
  await writeFile(flowPath, `name: Managed fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n${step}`)
  await writeFile(projectPath, JSON.stringify({ flows: { fixture: 'flow.yaml' }, suites: { smoke: { name: 'Managed smoke', cases: [{ id: 'fixture', flow: 'fixture' }] } } }))
  await writeFile(configPath, JSON.stringify({
    viewerHost: '127.0.0.1', viewerPort: 0, mockStartupDelayMs: 0,
    agentTestControl: { enabled: true, projectPath, allowedFlows: ['fixture'], allowedSuites: ['smoke'], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: [] },
  }))
  await writeFile(connectionPath, JSON.stringify({ provider: 'mock' }))
  return { root, configPath, connectionPath, reportDir }
}

describe('managed workbench job', () => {
  it('owns a loopback Mock runtime and writes truthful JSON/JUnit reports', async () => {
    const input = await fixture()
    const record = await runManagedWorkbenchJob({ suiteId: 'smoke', configPath: input.configPath, connectionPath: input.connectionPath, reportDir: input.reportDir, budgets: { startupMs: 5_000, totalMs: 15_000, shutdownMs: 5_000, pollMs: 50 } })
    expect(record).toMatchObject({ suiteExitCode: 0, jobExitCode: 0, recording: 'not-performed', errors: [], task: { phase: 'finished', result: { exitCode: 0 } } })
    expect(record.suite?.cases[0]).toMatchObject({ status: 'pass', attempts: [expect.any(String)] })
    const files = await readdir(input.reportDir)
    expect(files.sort()).toEqual([`${record.id}.job.json`, `${record.id}.junit.xml`, 'runs'])
    expect(JSON.parse(await readFile(join(input.reportDir, `${record.id}.job.json`), 'utf8'))).toMatchObject({ suiteExitCode: 0, jobExitCode: 0 })
    expect(await readFile(join(input.reportDir, `${record.id}.junit.xml`), 'utf8')).toContain('<testsuite')
  }, 20_000)

  it('keeps a clean suite result but returns infrastructure failure when reports cannot be written', async () => {
    const input = await fixture()
    const record = await runManagedWorkbenchJob({ suiteId: 'smoke', configPath: input.configPath, connectionPath: input.connectionPath, reportDir: input.reportDir, budgets: { startupMs: 5_000, totalMs: 15_000, shutdownMs: 5_000, pollMs: 50 } }, {
      writeReports: async () => { throw new Error('synthetic report failure') },
    })
    expect(record).toMatchObject({ suiteExitCode: 0, jobExitCode: 2, suite: { exitCode: 0 }, errors: [{ phase: 'report', message: 'synthetic report failure' }] })
  }, 20_000)

  it('cancels on an external signal, drains the accepted suite, and does not replay it', async () => {
    const input = await fixture('- wait: 30\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    const controller = new AbortController()
    const pending = runManagedWorkbenchJob({ suiteId: 'smoke', configPath: input.configPath, connectionPath: input.connectionPath, reportDir: input.reportDir, signal: controller.signal, budgets: { startupMs: 5_000, totalMs: 15_000, shutdownMs: 5_000, pollMs: 50 } })
    await expect.poll(async () => {
      try {
        const files = await readdir(join(input.reportDir, 'runs', 'suites'))
        const manifest = JSON.parse(await readFile(join(input.reportDir, 'runs', 'suites', files.find((file) => file.endsWith('.json'))!), 'utf8'))
        return manifest.cases?.[0]?.attempts?.length ?? 0
      } catch { return 0 }
    }, { timeout: 5_000 }).toBe(1)
    controller.abort(new Error('test interrupt'))
    const record = await pending
    expect(record.jobExitCode).toBe(130)
    expect(record.suite?.cases[0]?.attempts).toHaveLength(1)
    expect(record.errors.some((entry) => entry.phase === 'execution')).toBe(true)
  }, 20_000)

  it('gives timeout and shutdown uncertainty precedence over a suite result', async () => {
    const input = await fixture('- wait: 30\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    const record = await runManagedWorkbenchJob({ suiteId: 'smoke', configPath: input.configPath, connectionPath: input.connectionPath, reportDir: input.reportDir, budgets: { startupMs: 5_000, totalMs: 1_000, shutdownMs: 5_000, pollMs: 50 } })
    expect(record.jobExitCode).toBe(2)
    expect(record.errors.some((entry) => entry.message.includes('timeout'))).toBe(true)
  }, 20_000)

  it('keeps the suite pass but fails the job when owned runtime cleanup fails', async () => {
    const input = await fixture()
    const record = await runManagedWorkbenchJob({ suiteId: 'smoke', configPath: input.configPath, connectionPath: input.connectionPath, reportDir: input.reportDir, budgets: { startupMs: 5_000, totalMs: 15_000, shutdownMs: 5_000, pollMs: 50 } }, {
      createRuntime: (config, workbenchRoot) => {
        const runtime = new LocalDeviceRuntime(config, { workbenchRoot })
        const close = runtime.close.bind(runtime)
        runtime.close = async () => { await close(); throw new Error('synthetic shutdown failure') }
        return runtime
      },
    })
    expect(record).toMatchObject({ suiteExitCode: 0, jobExitCode: 2, errors: [{ phase: 'shutdown', message: 'synthetic shutdown failure' }] })
  }, 20_000)

  it('handles SIGINT in a child process with bounded cancellation and no replay', async () => {
    const input = await fixture('- wait: 30\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/managed-job-cli-child.ts', 'smoke', input.configPath, input.connectionPath, input.reportDir], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    await expect.poll(() => stdout.includes('READY'), { timeout: 5_000 }).toBe(true)
    await expect.poll(async () => {
      try {
        const files = await readdir(join(input.reportDir, 'runs', 'suites'))
        const manifest = JSON.parse(await readFile(join(input.reportDir, 'runs', 'suites', files.find((file) => file.endsWith('.json'))!), 'utf8'))
        return manifest.cases?.[0]?.attempts?.length ?? 0
      } catch { return 0 }
    }, { timeout: 5_000 }).toBe(1)
    child.kill('SIGINT')
    const code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
    expect(code, stderr).toBe(130)
    const record = JSON.parse(stdout.trim().split('\n').at(-1)!)
    expect(record).toMatchObject({ jobExitCode: 130, suite: { cases: [{ attempts: [expect.any(String)] }] } })
  }, 20_000)
})
