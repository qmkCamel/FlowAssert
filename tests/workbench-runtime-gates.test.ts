import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateTemporal, verifyTemporalFacts, temporalStepSchema, type SampleClock } from '../src/workbench-temporal.js'
import { compilePlan } from '../src/workbench-plan.js'
import { loadTestProject } from '../src/workbench-project.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { evaluateHealthWindow, healthBindingDigest, type HealthBinding, type HealthCapability, type HealthWindow } from '../src/workbench-health.js'
import { runResultProjection } from '../src/workbench-contracts.js'
import { startRuntimeBusinessFixture } from '../fixtures/runtime/business-server.js'
import onlyOnce from '../examples/business-http/verify-only-once.mjs'
import { createServer } from 'node:http'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchShare } from '../src/workbench-share.js'
import { junitReport, type SuiteRun } from '../src/workbench-suites.js'
import { NativeAcceptanceSources } from '../src/workbench-change-source.js'
import { acceptanceFixture } from './fixtures/acceptance-fixture.js'

const header = 'name: Runtime gates\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n'
const stable = { operation: 'assertStable' as const, predicate: { assertVisible: { text: 'Hello, harness.' } }, durationMs: 1000, pollMs: 100, maxSampleGapMs: 200 }
const eventually = { operation: 'assertEventually' as const, predicate: stable.predicate, withinMs: 1000, pollMs: 100, maxSampleGapMs: 200 }
function fakeClock() {
  let ms = 0
  const clock: SampleClock = { now: () => ms, wait: async delay => { ms += delay } }
  return { clock, advance: (delay: number) => { ms += delay }, now: () => ms }
}
const cleanups: (() => Promise<void>)[] = []
class PublicFixtureProvider extends MockProvider {
  override async screenSource() {
    const source = await super.screenSource()
    if (source.kind === 'normalized') source.structure.nodes = source.structure.nodes.filter(node => !node.sensitive)
    return source
  }
}
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup(provider = new PublicFixtureProvider(0), config = {}, available?: () => Promise<number>) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-runtime-gates-'))
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0, ...config }), 'http://127.0.0.1', { providerFactory: () => provider })
  await mirror.start({ provider: 'mock' })
  const workbench = new WorkbenchService(mirror, { store: new WorkbenchStore(root, available) })
  cleanups.push(async () => { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
  return { mirror, workbench, root }
}
describe('bounded temporal sampler', () => {
  it('accepts a match completed exactly at the monotonic cutoff, never after it', async () => {
    const clock = fakeClock()
    const boundary = await evaluateTemporal(eventually, async () => { if (clock.now() === 900) clock.advance(100); return { matched: clock.now() === 1000, evidenceRefs: ['boundary.xml'] } }, new AbortController().signal, clock)
    expect(boundary).toMatchObject({ status: 'pass', elapsedMs: 1000 })
    expect(verifyTemporalFacts(eventually, boundary)).toBe(true)
  })
  it('passes only actual delayed matching before deadline, independent of wall clock', async () => {
    const clock = fakeClock()
    const result = await evaluateTemporal(eventually, async () => ({ matched: clock.now() >= 900, evidenceRefs: ['sample.xml'] }), new AbortController().signal, clock)
    expect(result).toMatchObject({ status: 'pass', elapsedMs: 900, coverage: 'complete' })
    expect(verifyTemporalFacts(eventually, result)).toBe(true)
    result.samples.at(-1)!.endedMs = 1001
    expect(verifyTemporalFacts(eventually, result)).toBe(false)
  })
  it('fails a fully covered never-matching deadline, but not a late observation', async () => {
    const clock = fakeClock()
    const result = await evaluateTemporal(eventually, async () => ({ matched: false, evidenceRefs: [] }), new AbortController().signal, clock)
    expect(result.status).toBe('fail')
    const late = fakeClock()
    expect((await evaluateTemporal(eventually, async () => { late.advance(1001); return { matched: true, evidenceRefs: [] } }, new AbortController().signal, late)).status).toBe('inconclusive')
  })
  it.each([0, 5])('stable fails first counterexample without restarting its window (sample %s)', async bad => {
    const clock = fakeClock()
    const result = await evaluateTemporal(stable, async (_signal, index) => ({ matched: index !== bad + 1, evidenceRefs: [] }), new AbortController().signal, clock)
    expect(result).toMatchObject({ status: 'fail', reason: 'temporal-counterexample' })
    expect(result.samples).toHaveLength(bad + 1)
  })
  it('stable requires multiple samples spanning the entire duration', async () => {
    const clock = fakeClock()
    const result = await evaluateTemporal(stable, async () => ({ matched: true, evidenceRefs: ['sample.xml'] }), new AbortController().signal, clock)
    expect(result).toMatchObject({ status: 'pass', elapsedMs: 1000 })
    expect(verifyTemporalFacts(stable, result)).toBe(true)
    result.samples = result.samples.slice(1)
    expect(verifyTemporalFacts(stable, result)).toBe(false)
  })
  it('pause, incomplete observations, and cancellation never pass', async () => {
    const clock = fakeClock()
    expect((await evaluateTemporal(stable, async () => { clock.advance(201); return { matched: true, evidenceRefs: [] } }, new AbortController().signal, clock)).reason).toBe('temporal-sampling-gap')
    expect((await evaluateTemporal(eventually, async () => { throw new Error('source-lost') }, new AbortController().signal)).reason).toBe('source-lost')
    const abort = new AbortController(); abort.abort(new Error('Cancelled'))
    await expect(evaluateTemporal(stable, async () => ({ matched: true, evidenceRefs: [] }), abort.signal)).rejects.toThrow('Cancelled')
  })
  it('rejects gap inversion, unbounded samples and unexpected fields', () => {
    expect(temporalStepSchema.safeParse({ ...stable, pollMs: 500 }).success).toBe(false)
    expect(temporalStepSchema.safeParse({ ...stable, durationMs: 60000 }).success).toBe(false)
    expect(temporalStepSchema.safeParse({ ...stable, resetOnMismatch: true }).success).toBe(false)
  })
})
describe('runtime compiler and execution', () => {
  it('cancellation retains completed sample facts and never dispatches the next action', async () => {
    const { workbench, mirror } = await setup()
    const started = await workbench.start(header + '- assertStable: { predicate: { assertVisible: { text: "Hello, harness." } }, durationMs: 20000, pollMs: 200, maxSampleGapMs: 1000 }\n- tap: { accessibilityId: action-card }\n- assertVisible: { text: "Hello, harness." }')
    await expect.poll(async () => (await workbench.get(started.id)).steps.some(step => step.message?.includes('samples'))).toBe(true)
    await workbench.cancel(started.id); await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run).toMatchObject({ verdict: 'cancelled', steps: [{ temporal: { result: { status: 'inconclusive', reason: 'temporal-interrupted' } } }] })
    const step = run.steps[0]!, report = step.evidence.find(file => file.name === step.temporal!.report)!
    expect(JSON.parse((await workbench.store.readEvidence(run.id, report)).toString()).result.samples.length).toBeGreaterThan(0)
    expect(run.steps.some(step => step.kind === 'tap')).toBe(false)
    expect(mirror.runOwner).toBeNull()
  }, 15000)
  it('compiles the published persistence and two-submit examples with explicit fixed inputs', async () => {
    const project = await loadTestProject()
    const definition = JSON.parse(await readFile('examples/runtime/project.json.example', 'utf8'))
    project.extensions.onlyOnce = { ...definition.extensions.onlyOnce, source: await readFile('examples/business-http/verify-only-once.mjs', 'utf8'), sha256: 'a'.repeat(64) }
    const params = { businessKey: '550e8400-e29b-41d4-a716-446655440000', base: 'http://127.0.0.1:4000', owner: 'fixture-owner' }
    expect((await compilePlan(await readFile('examples/runtime/two-submit.yaml.example', 'utf8'), project, params)).requiredFeatures).toContain('step-business-v1')
    expect((await compilePlan(await readFile('examples/runtime/persistence.yaml.example', 'utf8'), project)).requiredFeatures).toContain('app-restart-v1')
    await expect(compilePlan(header + '- assertVisible: { text: "Hello, harness." }\n- assertBusiness: { ref: onlyOnce, mode: eventually, withinMs: 3000, pollMs: 200, maxSampleGapMs: 1000, args: { base: "http://127.0.0.1:4000", id: "550e8400-e29b-41d4-a716-446655440000", owner: "fixture-owner", expectedAmount: 1200, windowMs: 1000 } }', project)).rejects.toThrow('mode-forbidden')
  })
  it('uses effective subflow blockers and rejects corrupted scope metadata on read', async () => {
    const project = await loadTestProject()
    project.flows.child = header.replace('---', 'blockers: [{ text: "Never present" }]\n---') + '- assertEventually: { predicate: { assertVisible: { text: "Hello, harness." } }, withinMs: 2000, pollMs: 200, maxSampleGapMs: 1000 }'
    const { workbench } = await setup()
    const started = await workbench.start(header + '- runFlow: { ref: child }', undefined, undefined, { project })
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run.verdict, run.error).toBe('pass')
    expect(run.steps[0]!.temporal!.blockers).toEqual([{ text: 'Never present' }])
    run.steps[0]!.temporal!.blockers = []
    await workbench.store.save(run)
    expect((await workbench.get(run.id)).resultProjection).toMatchObject({ verdict: 'inconclusive', evidenceAvailability: 'unavailable' })
  }, 15000)
  it.each(['policy', 'capability'] as const)('rejects restart %s before any action or ownership', async denial => {
    class Unowned extends PublicFixtureProvider { override appControlContext() { return null } }
    const { workbench, mirror } = await setup(denial === 'capability' ? new Unowned(0) : undefined, { agentAppControlPolicy: denial === 'policy' ? 'disabled' : 'session-app' })
    await expect(workbench.start(header + '- tap: { accessibilityId: action-card }\n- restartApp: { timeoutMs: 5000 }\n- assertVisible: { text: "Hello, harness." }')).rejects.toThrow()
    expect(mirror.runOwner).toBeNull()
  })
  it.each(['ready', 'drain', 'close', 'late-drain'] as const)('a health %s fault never publishes a healthy pass and always closes its owned collector', async fault => {
    let closed = false
    class FaultyHealth extends PublicFixtureProvider {
      healthCapability() { return capability }
      async startHealth(binding: HealthBinding) {
        let start = performance.now()
        return {
          ready: async () => { if (fault === 'ready') throw new Error('not-ready'); start = performance.now() },
          stopAndDrain: async (signal: AbortSignal) => {
            if (fault === 'drain') throw new Error('drain-unconfirmed')
            if (fault === 'late-drain') await new Promise(resolve => { signal.addEventListener('abort', () => resolve(undefined), { once: true }) })
            const end = performance.now()
            return { ...window(), startMs: start, endMs: end, processes: [{ generation: 'p1', fromMs: start, toMs: end }], bindingDigest: healthBindingDigest(binding) }
          },
          close: async () => { closed = true; if (fault === 'close') throw new Error('owned-close-failed') },
        }
      }
    }
    const { workbench, mirror } = await setup(new FaultyHealth(0))
    const started = await workbench.start(header.replace('---', 'runtimeGates: { health: { signals: [crash], tailMs: 0 } }\n---') + '- assertVisible: { text: "Hello, harness." }')
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(closed).toBe(true)
    expect(mirror.runOwner).toBeNull()
    expect(run).toMatchObject({ verdict: 'inconclusive', health: { status: 'inconclusive', coverage: 'incomplete' } })
    if (fault === 'ready') expect(run.steps).toHaveLength(0)
    if (fault === 'late-drain') expect(run.health!.reason).toBe('health-drain-unconfirmed')
  }, 15000)
  it('keeps each measured loop instance and the original failure instead of reporting the fastest run', async () => {
    const { workbench } = await setup()
    const loop = await workbench.start(header + '- repeat: { times: 2, steps: [ { measure: { id: repeated, maxElapsedMs: 5000, steps: [ { assertVisible: { text: "Hello, harness." } } ] } } ] }')
    await workbench.wait()
    expect(await workbench.get(loop.id)).toMatchObject({ verdict: 'pass', measurements: [{ id: 'repeated', status: 'pass' }, { id: 'repeated', status: 'pass' }] })
    const bad = await workbench.start(header + '- measure: { id: original, maxElapsedMs: 100, steps: [ { wait: 1 }, { assertVisible: { text: "Hello, harness." } } ] }')
    await workbench.wait()
    const followup = await workbench.start(header + '- measure: { id: original, maxElapsedMs: 5000, steps: [ { assertVisible: { text: "Hello, harness." } } ] }', bad.id)
    await workbench.wait()
    const original = await workbench.get(bad.id)
    expect(original.verdict, JSON.stringify(original)).toBe('fail')
    expect((await workbench.get(followup.id)).verdict).toBe('pass')
  }, 20000)
  it('step business pass cannot erase a failed header verifier; late once output stays uncertain', async () => {
    const project = await loadTestProject(), string = { type: 'string' as const }
    project.extensions.query = { module: 'query.mjs', role: 'verify', timeoutMs: 3000, credentials: {},
      input: { type: 'object', properties: { mismatch: { type: 'boolean' }, delay: { type: 'number' } } },
      output: { type: 'object', properties: { verdict: string, expected: string, actual: string, source: string, artifactRefs: { type: 'array', items: string } }, required: ['verdict','expected','actual','source','artifactRefs'] },
      observation: { readOnly: true, repeatable: true, allowedModes: ['once'] }, sha256: 'a'.repeat(64),
      source: 'export default async ({mismatch=false,delay=0})=>{await new Promise(r=>setTimeout(r,delay));return {verdict:mismatch?"fail":"pass",expected:"fixed",actual:mismatch?"wrong":"fixed",source:"trusted-read",artifactRefs:[]}}' }
    const { workbench } = await setup()
    const body = '- assertVisible: { text: "Hello, harness." }\n- assertBusiness: { ref: query, withinMs: 2000 }'
    const started = await workbench.start(header.replace('---', 'verify: [{ ref: query, args: { mismatch: true } }]\n---') + body, undefined, undefined, { project })
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run).toMatchObject({ verdict: 'fail', businessVerification: 'fail' })
    expect(run.steps.find(step => step.business)?.business?.status).toBe('pass')
    const late = await workbench.start(header + body.replace('withinMs: 2000', 'withinMs: 100, args: { delay: 500 }'), undefined, undefined, { project })
    await workbench.wait()
    expect(await workbench.get(late.id)).toMatchObject({ verdict: 'inconclusive', businessVerification: 'inconclusive' })
  }, 15000)
  it('health + temporal + restart + measure use one owner, and private material damage removes health proof', async () => {
    class Combined extends PublicFixtureProvider {
      healthCapability() { return capability }
      async startHealth(binding: HealthBinding) {
        let start = 0
        return { ready: async () => { start = performance.now() },
          stopAndDrain: async () => ({ ...window(), startMs: start, endMs: performance.now(), processes: [{ generation: 'p1', fromMs: start, toMs: performance.now() }], bindingDigest: healthBindingDigest(binding) }),
          close: async () => {} }
      }
    }
    const { workbench, root, mirror } = await setup(new Combined(0), { agentAppControlPolicy: 'session-app' })
    const started = await workbench.start(header.replace('---', 'runtimeGates: { health: { signals: [crash], tailMs: 0 } }\n---')
      + '- measure: { id: combined, maxElapsedMs: 10000, steps: [ { restartApp: { timeoutMs: 5000 } }, { assertEventually: { predicate: { assertVisible: { text: "Hello, harness." } }, withinMs: 2000, pollMs: 200, maxSampleGapMs: 1000 } } ] }')
    await workbench.wait()
    expect(await workbench.get(started.id)).toMatchObject({ verdict: 'pass', health: { status: 'pass' }, measurements: [{ status: 'pass' }] })
    expect(mirror.runOwner).toBeNull()
    await writeFile(join(root, started.id, 'private', 'health-window.json'), '{}')
    expect((await workbench.get(started.id)).resultProjection).toMatchObject({ verdict: 'inconclusive', evidenceAvailability: 'unavailable' })
  }, 15000)
  it.each([Number.NaN, 256 * 1024 * 1024])('rejects capacity %s before device ownership or writes', async capacity => {
    const { workbench, mirror } = await setup(undefined, {}, async () => capacity)
    await expect(workbench.start(header + '- assertEventually: { predicate: { assertVisible: { text: "Hello, harness." } }, withinMs: 1000, pollMs: 200, maxSampleGapMs: 1000 }')).rejects.toThrow(/storage-/)
    expect(mirror.runOwner).toBeNull()
  })
  it('a corrupted saved sample is unavailable through result and acceptance reads', async () => {
    const { workbench, root } = await setup()
    const started = await workbench.start(header + '- assertEventually: { predicate: { assertVisible: { text: "Hello, harness." } }, withinMs: 1000, pollMs: 200, maxSampleGapMs: 1000 }')
    await workbench.wait()
    expect((await workbench.get(started.id)).verdict).toBe('pass')
    const step = (await workbench.get(started.id)).steps.find(step => step.temporal)!
    const xml = step.evidence.find(file => file.name.startsWith('temporal-') && file.name.endsWith('.xml'))!
    await writeFile(join(root, started.id, xml.name), '<broken>')
    expect((await workbench.get(started.id)).resultProjection).toMatchObject({ verdict: 'inconclusive', evidenceAvailability: 'unavailable' })
    const input = acceptanceFixture().input; input.cells[0]!.runId = started.id
    const lease = await new NativeAcceptanceSources(workbench.store).acquire(input)
    try { expect(lease.sources.get(started.id)?.availability).toBe('unavailable') } finally { lease.release() }
  }, 15000)
  it('routes runtime sharing through v4 and native archives through v3 without upgrading imports to health proof', async () => {
    const { workbench } = await setup()
    const started = await workbench.start(header + '- measure: { id: endpoint, maxElapsedMs: 5000, steps: [ { assertVisible: { text: "Hello, harness." } } ] }')
    await workbench.wait()
    const run = await workbench.get(started.id)
    const share = new WorkbenchShare(workbench.store), options = { files: [{ name: run.steps[0]!.evidence.find(file => file.name === 'step-1.xml')!.name }] }
    const preview = await share.preview(run.id, options), archive = await share.export(run.id, options, preview.digest, true)
    expect(archive).toMatchObject({ version: 4, sharing: { rulesVersion: 2, requiredFeatures: ['e2e-measure-v1'] } })
    const serialized = JSON.stringify(archive)
    expect(serialized).not.toContain(run.sessionId)
    expect(serialized).not.toContain('measure-1.json')
    const imported = await workbench.store.importArchive(archive)
    expect(runResultProjection(imported).clean).toBe(false)
    const native = { format: 'mobile-mirror-run', version: 3, run, files: await Promise.all([...run.evidence, ...run.steps.flatMap(step => step.evidence)].map(async file =>
      ({ name: file.name, sha256: file.sha256, bytes: file.bytes, contentType: file.contentType, base64: (await workbench.store.readEvidence(run.id, file)).toString('base64') }))) }
    expect(native.version).toBe(3)
    expect(runResultProjection(await workbench.store.importArchive(native)).verdict).toBe('inconclusive')
    const suite = { name: 'runtime', cases: [{ id: 'case', status: 'pass', attempts: [run.id], resultProjections: [run.resultProjection] }] } as SuiteRun
    expect(junitReport(suite)).toContain('performanceStatus" value="pass')
    expect(junitReport(suite)).toContain('healthStatus" value="not-performed')
  }, 15000)
  it('recovers a host SIGKILL during a runtime observation as interrupted, never resumed or green', async () => {
    const { workbench } = await setup()
    const started = await workbench.start(header + '- measure: { id: endpoint, maxElapsedMs: 5000, steps: [ { assertVisible: { text: "Hello, harness." } } ] }')
    await workbench.wait()
    const seed = await workbench.get(started.id); delete seed.resultProjection
    seed.phase = 'running'; seed.steps[0]!.status = 'running'
    const interruptedRoot = await mkdtemp(join(tmpdir(), 'runtime-killed-'))
    const code = `import { WorkbenchStore } from './src/workbench-store.ts'; import { persistHealthJournal } from './src/workbench-health.ts';
      const store = new WorkbenchStore(${JSON.stringify(interruptedRoot)}); await store.init(); const run = ${JSON.stringify(seed)};
      await store.save(run); await persistHealthJournal(store, run, {runId:run.id,appId:'com.example.mobilemirror.mock',sessionId:run.sessionId,sessionGeneration:1,attempt:1}, 'observing');
      process.stdout.write('READY\\n'); setInterval(()=>{},1000);`
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes })
    try {
      await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('child not ready: ' + stderr)), 10000)
        child.stdout.on('data', bytes => { if (String(bytes).includes('READY')) { clearTimeout(timeout); resolve() } }); child.once('exit', () => { clearTimeout(timeout); reject(new Error(stderr)) }) })
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
      const recovered = new WorkbenchStore(interruptedRoot)
      try { await recovered.init(); expect(await recovered.get(seed.id)).toMatchObject({ verdict: 'inconclusive', recovery: {}, productContract: { verification: { performance: { status: 'inconclusive', reason: 'runtime-interrupted' } } } }) }
      finally { await recovered.close() }
    } finally { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited }; await rm(interruptedRoot, { recursive: true, force: true }) }
  }, 20000)
  it('keeps legacy plans unchanged, and versions opt-in features once', async () => {
    const project = await loadTestProject()
    const old = await compilePlan(header + '- assertVisible: { text: "Hello, harness." }', project)
    expect(old.requiredFeatures).toBeUndefined()
    const plan = await compilePlan(header + '- measure:\n    id: save\n    maxElapsedMs: 5000\n    steps:\n      - assertStable:\n          predicate: { assertVisible: { text: "Hello, harness." } }\n          durationMs: 1000\n          pollMs: 100\n          maxSampleGapMs: 500', project)
    expect(plan.requiredFeatures).toEqual(['e2e-measure-v1', 'temporal-ui-v1'])
    expect(plan.nodes[0]).toMatchObject({ kind: 'measure', line: 5 })
  })
  it.each([
    '- assertStable: { predicate: { tap: { text: Bad } }, durationMs: 1000, pollMs: 100, maxSampleGapMs: 200 }',
    '- measure: { id: x, maxElapsedMs: 1000, steps: [ { wait: 1 } ] }',
    '- measure: { id: x, maxElapsedMs: 1000, steps: [ { measure: { id: y, maxElapsedMs: 100, steps: [ { assertVisible: { text: x } } ] } } ] }',
    '- assertBusiness: { ref: untrusted, withinMs: 1000 }',
    '- measure: { id: x, maxElapsedMs: 1000, steps: [ { assertVisible: { text: x } } ] }\n- measure: { id: x, maxElapsedMs: 1000, steps: [ { assertVisible: { text: x } } ] }',
    '- repeat: { times: 20, steps: [ { repeat: { times: 20, steps: [ { measure: { id: x, maxElapsedMs: 1000, steps: [ { assertVisible: { text: x } } ] } } ] } } ] }',
  ])('rejects unsafe runtime declaration: %s', async steps => {
    await expect(compilePlan(header + steps, await loadTestProject())).rejects.toThrow()
  })
  it('rejects unknown and cross-platform health signals instead of silently dropping them', async () => {
    const project = await loadTestProject()
    for (const signals of ['unknown', 'anr']) await expect(compilePlan(header.replace('---', 'runtimeGates: { health: { signals: [' + signals + '] } }\n---') + '- assertVisible: { text: "Hello, harness." }', project)).rejects.toThrow()
  })
  it('runs stable + measure with material replay and fails closed on unknown features', async () => {
    const { workbench } = await setup()
    const run = await workbench.start(header + '- measure:\n    id: stable\n    maxElapsedMs: 5000\n    steps:\n      - assertStable:\n          predicate: { assertVisible: { text: "Hello, harness." } }\n          durationMs: 800\n          pollMs: 200\n          maxSampleGapMs: 1000')
    await workbench.wait()
    const finished = await workbench.get(run.id)
    expect(finished, JSON.stringify(finished)).toMatchObject({ verdict: 'pass', productContract: { contractVersion: 2, verification: { performance: { status: 'pass' } } } })
    expect(finished.measurements?.[0]?.assertions).toBe(1)
    const corrupt = structuredClone(finished)
    ;(corrupt.productContract as any).requiredFeatures.push('future-feature')
    expect(runResultProjection(corrupt).readState).toBe('unsupported')
    expect(runResultProjection(corrupt).clean).toBe(false)
  }, 15000)
  it('a fast wrong endpoint never produces a performance pass', async () => {
    const { workbench } = await setup()
    const started = await workbench.start(header + '- measure: { id: wrong, maxElapsedMs: 10000, steps: [ { assertVisible: { text: Impossible } } ] }')
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run.verdict).toBe('fail')
    expect(run.measurements?.[0]).toMatchObject({ status: 'inconclusive', reason: 'endpoint-not-reached' })
  }, 15000)
  it('rejects unsupported health before prepare or action', async () => {
    const { workbench, mirror } = await setup()
    await expect(workbench.start(header.replace('---', 'runtimeGates: { health: { signals: [crash] } }\n---') + '- assertVisible: { text: "Hello, harness." }')).rejects.toThrow('health-source-unsupported')
    expect(mirror.runOwner).toBeNull()
  })
  it('restart obeys the existing explicit session-app policy, retains data and does not retry uncertain writes', async () => {
    const provider = new MockProvider(0)
    const { workbench } = await setup(provider, { agentAppControlPolicy: 'session-app' })
    const started = await workbench.start(header + '- tap: { accessibilityId: action-card }\n- restartApp: { timeoutMs: 5000 }\n- assertVisible: { text: "3 actions received" }')
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run, JSON.stringify(run)).toMatchObject({ verdict: 'pass' })
    expect(run.dispatches?.filter(record => record.operation.startsWith('restart-'))).toHaveLength(2)
  }, 15000)
  it('fences an uncertain terminate instead of dispatching activate or a later tap', async () => {
    const provider = new MockProvider(0, { failAppAfterMutation: true })
    const { workbench, mirror } = await setup(provider, { agentAppControlPolicy: 'session-app' })
    const started = await workbench.start(header + '- restartApp: { timeoutMs: 5000 }\n- tap: { accessibilityId: action-card }\n- assertVisible: { text: "Hello, harness." }')
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run.verdict).toBe('inconclusive')
    expect(run.dispatches).toHaveLength(1)
    expect(run.dispatches?.[0]?.state).toBe('unknown')
    await expect(mirror.action({ kind: 'back' })).rejects.toThrow(/uncertain/)
  }, 15000)
  it.each(['unknown', 'cancel'] as const)('fences an activate %s outcome without a later action or retry', async fault => {
    let activating = false
    class ActivateFault extends PublicFixtureProvider {
      override async manageApp(request: Parameters<MockProvider['manageApp']>[0], signal?: AbortSignal) {
        const result = await super.manageApp(request, signal)
        if (request.operation === 'activate') {
          activating = true
          if (fault === 'cancel') {
            await new Promise(resolve => { signal!.addEventListener('abort', () => resolve(undefined), { once: true }) })
            signal!.throwIfAborted()
          }
          throw new Error('activate-outcome-unknown')
        }
        return result
      }
    }
    const { workbench, mirror } = await setup(new ActivateFault(0), { agentAppControlPolicy: 'session-app' })
    const started = await workbench.start(header + '- restartApp: { timeoutMs: 5000 }\n- tap: { accessibilityId: action-card }\n- assertVisible: { text: "Hello, harness." }')
    if (fault === 'cancel') { await expect.poll(() => activating).toBe(true); await workbench.cancel(started.id) }
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run.verdict).toBe(fault === 'cancel' ? 'cancelled' : 'inconclusive')
    expect(run.dispatches?.map(entry => entry.state)).toEqual(['settled', 'unknown'])
    expect(run.steps.some(step => step.kind === 'tap')).toBe(false)
    await expect(mirror.action({ kind: 'back' })).rejects.toThrow(/uncertain/)
  }, 15000)
  it('eventual business mismatch may repeat; a typed read failure cannot turn green', async () => {
    let reads = 0
    const server = createServer((_req, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ ready: ++reads > 2 })) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })
    const address = server.address() as { port: number }
    const project = await loadTestProject()
    const string = { type: 'string' as const }, output = { type: 'object' as const, properties: { verdict: string, expected: string, actual: string, source: string, artifactRefs: { type: 'array' as const, items: string } }, required: ['verdict', 'expected', 'actual', 'source', 'artifactRefs'] }
    project.extensions.query = { module: 'query.mjs', role: 'verify', timeoutMs: 2000, credentials: {}, input: { type: 'object', properties: { base: string }, required: ['base'] }, output,
      observation: { readOnly: true, repeatable: true, allowedModes: ['once', 'eventually'] }, sha256: 'a'.repeat(64),
      source: 'export default async ({base}) => { const value=await (await fetch(base)).json(); return {verdict:value.ready?"pass":"fail",expected:"ready",actual:String(value.ready),source:"trusted-read",artifactRefs:[]}; }' }
    const { workbench } = await setup()
    const flow = header + '- assertVisible: { text: "Hello, harness." }\n- assertBusiness: { ref: query, args: { base: "http://127.0.0.1:' + address.port + '" }, mode: eventually, withinMs: 3000, pollMs: 200, maxSampleGapMs: 1000 }'
    const started = await workbench.start(flow, undefined, undefined, { project })
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run, run.error).toMatchObject({ verdict: 'pass', businessVerification: 'pass' })
    expect(run.steps.find(step => step.kind === 'assertBusiness')?.business?.samples).toBe(3)
    project.extensions.query.source = 'export default async () => { throw new Error("read failed") }'
    const failed = await workbench.start(flow, undefined, undefined, { project })
    await workbench.wait()
    expect((await workbench.get(failed.id)).businessVerification).toBe('inconclusive')
  }, 15000)
  it('health tail and close-drain precede final publication and private window is independently replayed', async () => {
    let closed = false
    class HealthFixture extends PublicFixtureProvider {
      healthCapability() { return { ...capability, platform: 'mock' as const } }
      async startHealth(binding: HealthBinding) {
        let start = 0
        return {
          ready: async () => { start = performance.now() },
          stopAndDrain: async () => ({ ...window(), startMs: start, endMs: performance.now(), processes: [{ generation: 'p1', fromMs: start, toMs: performance.now() }], bindingDigest: healthBindingDigest(binding) }),
          close: async () => { closed = true },
        }
      }
    }
    const { workbench, root } = await setup(new HealthFixture(0))
    const started = await workbench.start(header.replace('---', 'runtimeGates: { health: { signals: [crash], tailMs: 800 } }\n---') + '- assertVisible: { text: "Hello, harness." }')
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run, run.error).toMatchObject({ verdict: 'pass', health: { status: 'pass', coverage: 'complete' } })
    expect(closed).toBe(true)
    expect(JSON.parse(await readFile(join(root, started.id, 'private', 'health.json'), 'utf8')).phase).toBe('finished')
  }, 15000)
  it('a healthy window cannot conceal resource cleanup failure', async () => {
    class Healthy extends PublicFixtureProvider {
      healthCapability() { return capability }
      async startHealth(binding: HealthBinding) {
        const start = performance.now()
        return { ready: async () => {}, stopAndDrain: async () => { const end = performance.now(); return { ...window(), startMs: start, endMs: end,
          processes: [{ generation: 'p1', fromMs: start, toMs: end }], bindingDigest: healthBindingDigest(binding) } }, close: async () => {} }
      }
    }
    const project = await loadTestProject(), shape = { type: 'object' as const, properties: {}, required: [] }
    project.extensions.seed = { module: 'seed.mjs', role: 'prepare', timeoutMs: 2000, credentials: {}, input: shape, output: shape, cleanup: 'clean', sha256: 'a'.repeat(64), source: 'export default async(_,ctx)=>{await ctx.registerCleanup({});return {}}' }
    project.extensions.clean = { module: 'clean.mjs', role: 'cleanup', timeoutMs: 2000, credentials: {}, input: shape, output: shape, sha256: 'b'.repeat(64), source: 'export default async()=>{throw new Error("cleanup failed")}' }
    const { workbench } = await setup(new Healthy(0))
    const started = await workbench.start(header.replace('---', 'prepare: [{ ref: seed }]\nruntimeGates: { health: { signals: [crash], tailMs: 0 } }\n---') + '- assertVisible: { text: "Hello, harness." }', undefined, undefined, { project })
    await workbench.wait()
    expect(await workbench.get(started.id)).toMatchObject({ verdict: 'inconclusive', health: { status: 'pass' }, resourceCleanup: 'failed', resultProjection: { clean: false, verification: { cleanup: { status: 'fail' } } } })
  }, 15000)
  it('a crash delivered by final drain remains failed even with successful UI and a close fault', async () => {
    class LateCrash extends PublicFixtureProvider {
      healthCapability() { return capability }
      async startHealth(binding: HealthBinding) {
        const start = performance.now(), digest = healthBindingDigest(binding)
        return { ready: async () => {}, stopAndDrain: async () => {
          const end = performance.now()
          return { ...window(), startMs: start, endMs: end, processes: [{ generation: 'p1', fromMs: start, toMs: end }], bindingDigest: digest,
            events: [{ signal: 'crash' as const, appId: binding.appId, processGeneration: 'p1', sequence: 1, atMs: end - 1, attribution: 'confirmed' as const, bindingDigest: digest }] }
        }, close: async () => { throw new Error('owned-close-failed') } }
      }
    }
    const { workbench } = await setup(new LateCrash(0))
    const started = await workbench.start(header.replace('---', 'runtimeGates: { health: { signals: [crash], tailMs: 0 } }\n---') + '- assertVisible: { text: "Hello, harness." }')
    await workbench.wait()
    const run = await workbench.get(started.id)
    expect(run).toMatchObject({ verdict: 'fail', health: { status: 'fail', coverage: 'incomplete', gaps: ['health-close-failed'] }, resultProjection: { verdict: 'fail', clean: false, exitCode: 1,
      verification: { ui: { status: 'pass' }, health: { status: 'fail' } } } })
    const suite = { name: 'runtime', cases: [{ id: 'case', status: 'fail', attempts: [run.id], resultProjections: [run.resultProjection] }] } as SuiteRun
    expect(junitReport(suite)).toContain('healthStatus" value="fail')
    expect(junitReport(suite)).toContain('<failure')
  }, 15000)
})

describe('fixed-expectation only-once verifier', () => {
  it.each([
    [{}, 'pass'],
    [{ duplicate: true }, 'fail'],
    [{ amount: 999 }, 'fail'],
    [{ owner: 'wrong-owner' }, 'fail'],
    [{ delayedDuplicateMs: 250 }, 'fail'],
  ] as const)('two explicit submissions with fault %j yield %s without suite retries', async (fault, expected) => {
    const server = await startRuntimeBusinessFixture(fault)
    try {
      const url = server.base + '/test/orders/' + server.key
      await fetch(url, { method: 'POST' }); await fetch(url, { method: 'POST' })
      expect(await onlyOnce({ base: server.base, id: server.key, expectedAmount: 1200, owner: server.owner, windowMs: 500 })).toMatchObject({ verdict: expected })
    } finally { await server.close() }
  })
  it('does not conceal cleanup failure or a missing order', async () => {
    const server = await startRuntimeBusinessFixture({ cleanupFailure: true })
    try {
      expect(await onlyOnce({ base: server.base, id: server.key, expectedAmount: 1200, owner: server.owner, windowMs: 500 })).toMatchObject({ verdict: 'fail' })
      expect((await fetch(server.base + '/test/orders/' + server.key, { method: 'DELETE' })).status).toBe(500)
    } finally { await server.close() }
  })
})

const capability: HealthCapability = { schemaVersion: 1, platform: 'mock', source: 'mock-health', sourceVersion: '1', signals: { crash: { supported: true, reason: 'synthetic-only' } },
  completeness: { processIdentity: true, windowCursors: true, detectableLoss: true, monotonicMapping: true, drainAcknowledgement: true } }
const binding: HealthBinding = { runId: 'r', appId: 'test.app', sessionId: 's', sessionGeneration: 1, attempt: 1 }
const window = (): HealthWindow => ({ schemaVersion: 1, bindingDigest: healthBindingDigest(binding), startMs: 10, endMs: 100, startCursor: '1', endCursor: '2', ready: true, drained: true, dropped: 0, rawBytes: 0, gaps: [], events: [],
  maxQueueDepth: 0, clockMapping: 'verified', processes: [{ generation: 'p1', fromMs: 0, toMs: 100 }] })
describe('capability-gated health truth table', () => {
  it('requires explicit coverage and drain, including empty event streams', () => {
    expect(evaluateHealthWindow(capability, ['crash'], binding, window()).status).toBe('pass')
    const w = window(); w.drained = false
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).status).toBe('inconclusive')
    w.drained = true; w.dropped = 1
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).reason).toBe('health-source-loss')
  })
  it('keeps an attributed violation despite loss and never suppresses a restart-adjacent crash', () => {
    const w = window(); w.dropped = 1
    w.events.push({ signal: 'crash', appId: binding.appId, processGeneration: 'p1', sequence: 1, atMs: 50, attribution: 'confirmed', bindingDigest: w.bindingDigest })
    const report = evaluateHealthWindow(capability, ['crash'], binding, w)
    expect(report).toMatchObject({ status: 'fail', coverage: 'incomplete', violations: [{ signal: 'crash', atMs: 40 }] })
  })
  it('isolates app/window/session identities and flags uncertain attribution', () => {
    const w = window()
    w.events.push({ signal: 'crash', appId: 'another.app', processGeneration: 'p1', sequence: 1, atMs: 50, attribution: 'confirmed', bindingDigest: w.bindingDigest })
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).status).toBe('pass')
    w.events[0]!.appId = binding.appId; w.events[0]!.bindingDigest = 'f'.repeat(64)
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).reason).toBe('health-attribution-uncertain')
  })
})
