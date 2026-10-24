import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config, type Config as MirrorConfig } from '../src/config.js'
import { DoctorService } from '../src/doctor.js'
import { resolvePreflightProject } from '../src/preflight-project.js'
import { normalizePreflight } from '../src/environment-preflight.js'
import { BoundedPreflightRunner } from '../src/preflight-host-checks.js'
import { loadTestProject, ocrProjectDigest } from '../src/workbench-project.js'
import { approveOcrRegistration } from '../src/workbench-ocr-approval.js'
import { ocrFixtureEvaluation, ocrFixtureProfile } from './fixtures/ocr-fixture.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'preflight-project-')); roots.push(root)
  await writeFile(join(root, 'smoke.yaml'), 'name: Smoke\nplatform: android\nappId: dev.mobilemirror.fixture\n---\n- assertVisible: {text: Ready}\n')
  const path = join(root, 'project.json')
  await writeFile(path, JSON.stringify({ flows: { smoke: 'smoke.yaml' }, suites: { smoke: { name: 'Smoke', cases: [{ id: 'first', flow: 'smoke' }] } } }))
  const config = Config({ ...Config({} as MirrorConfig), defaultProvider: 'mock', agentTestControl: { enabled: true, projectPath: path, allowedFlows: ['smoke'], allowedSuites: ['smoke'], allowedPlatforms: ['android'], allowedAppIds: ['dev.mobilemirror.fixture'], sharedEvidence: [] } })
  return { root, config }
}

it('derives flow and suite scope from registered source without device/model calls', async () => {
  const { config } = await fixture()
  for (const testRef of ['flow:smoke', 'suite:smoke']) {
    const report = await new DoctorService(config, { runner: { run: async () => { throw new Error('forbidden') } }, appiumStatus: async () => { throw new Error('forbidden') } }).run({ entry: 'mcp', operation: 'test', testRef })
    expect(report.overall).toBe('ready'); expect(report.context).toMatchObject({ provider: 'mock', platform: 'none' })
    expect(report.context.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(report.checks.some(x => /android|ios|dsh|appium/.test(x.id))).toBe(false)
  }
})

it('rejects unknown references, disallowed agents, mismatched platforms and aborts parsing', async () => {
  const { config } = await fixture()
  for (const input of [{ entry: 'mcp' as const, operation: 'test' as const, testRef: 'flow:unknown' }, { operation: 'test' as const, testRef: 'flow:smoke', platform: 'ios' as const }]) {
    await expect(new DoctorService(config).run(input)).rejects.toThrow('preflight_input_invalid')
  }
  const controller = new AbortController(); controller.abort()
  await expect(resolvePreflightProject(normalizePreflight({ operation: 'test', testRef: 'flow:smoke' }), config, controller.signal)).rejects.toThrow()
})

it('bounds nested host commands and never dispatches cancelled queued commands', async () => {
  let active = 0, peak = 0, dispatched = 0
  const runner = new BoundedPreflightRunner({ run: async (_command, _args, options) => {
    active++; peak = Math.max(peak, active); dispatched++
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 30); options?.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true }) })
    active--; return { ok: true, stdout: '', stderr: '', exitCode: 0, aborted: false, timedOut: false }
  } })
  const controller = new AbortController()
  const pending = Array.from({ length: 10 }, () => runner.run('/fixture', [], { signal: controller.signal }))
  controller.abort(); await Promise.allSettled(pending)
  expect(peak).toBe(3); expect(dispatched).toBe(3)
  expect((await runner.run('/fixture', [])).ok).toBe(true)
})

it('registered AI recovery cannot be disabled and checks credentials without model requests', async () => {
  const { root, config } = await fixture()
  await writeFile(join(root, 'smoke.yaml'), 'name: Recovery\nplatform: android\nappId: dev.mobilemirror.fixture\n---\n- recover:\n    id: open\n    policy: navigation\n    step: {tap: {text: Open}}\n    postcondition: {visible: {text: Ready}}\n')
  await writeFile(config.agentTestControl!.projectPath, JSON.stringify({ flows: { smoke: 'smoke.yaml' },
    recoveryModels: { vision: { endpoint: 'http://127.0.0.1:9/chat/completions', model: 'fixture', apiKeyEnv: 'MOBILE_MIRROR_PREFLIGHT_TEST_KEY' } },
    recoveryPolicies: { navigation: { mode: 'auto', platform: 'android', appId: 'dev.mobilemirror.fixture', intent: 'Open navigation', modelRef: 'vision', navigationOnly: true, allowImageSharing: true, page: { text: 'Ready' }, allowedTargets: [{ text: 'Open' }] } },
  }))
  const fetch = vi.fn(async () => { throw new Error('model_request_forbidden') })
  vi.stubGlobal('fetch', fetch); vi.stubEnv('MOBILE_MIRROR_PREFLIGHT_TEST_KEY', '')
  try {
    const input = { operation: 'test' as const, testRef: 'flow:smoke', features: { 'ai-recovery': 'off' as const } }
    const absent = await new DoctorService(config).run(input)
    expect(absent.context.features['ai-recovery']).toBe('required'); expect(absent.overall).toBe('blocked')
    vi.stubEnv('MOBILE_MIRROR_PREFLIGHT_TEST_KEY', 'PRIVATE_CANARY')
    const present = await new DoctorService(config).run(input)
    expect(present.overall).toBe('ready'); expect(JSON.stringify(present)).not.toContain('PRIVATE_CANARY')
    expect(fetch).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs() }
})

it('retains required OCR from an approved registered flow without preparing the helper', async () => {
  const { root, config } = await fixture()
  await writeFile(join(root, 'smoke.yaml'), 'name: OCR\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- assertTextInRegion: {profile: title}\n')
  const definition = { flows: { smoke: 'smoke.yaml' }, ocrProfiles: { title: { profile: ocrFixtureProfile, evaluation: ocrFixtureEvaluation(), page: { text: 'Hello, harness.' } } } }
  await writeFile(config.agentTestControl!.projectPath, JSON.stringify(definition))
  const project = await loadTestProject(config.agentTestControl!.projectPath)
  const approved = approveOcrRegistration(definition.ocrProfiles.title, ocrProjectDigest(project), 'UNIT TEST ONLY', true)
  await writeFile(config.agentTestControl!.projectPath, JSON.stringify({ ...definition, ocrProfiles: { title: approved } }))
  const run = vi.fn(async () => { throw new Error('no_helper_prepare_or_device_commands') })
  const report = await new DoctorService(config, { runner: { run } }).run({ operation: 'test', testRef: 'flow:smoke', features: { ocr: 'off' } })
  expect(report.context.features.ocr).toBe('required'); expect(report.overall).toBe('incomplete')
  expect(report.checks).toContainEqual(expect.objectContaining({ id: 'ocr', code: 'ocr_cache_required', role: 'required' }))
  expect(run).not.toHaveBeenCalled()
})
