import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { evaluateHealthWindow, healthBindingDigest, requireHealthCapability, type HealthBinding, type HealthCapability, type HealthWindow } from '../src/health-contracts.js'
import { readHealthCommand } from '../src/health-command.js'
import { parseAndroidExitHistory } from '../src/android-health-diagnostics.js'
import { executeMeasurement, PerformanceDeadline } from '../src/workbench-measurement.js'
import { FlowAssertionFailure } from '../src/workbench-native-execution.js'
import { createRunProvenance, createRunVerification, enableRuntimeContract, runProductContractSchema } from '../src/workbench-contracts.js'
import type { TestRun } from '../src/workbench-domain.js'
import type { WorkbenchStore } from '../src/workbench-store.js'
import { parseTemporalStep } from '../src/workbench-runtime-syntax.js'
import { temporalPredicateMatches } from '../src/workbench-temporal-evidence.js'

const binding: HealthBinding = { runId: randomUUID(), sessionId: 'fixture', sessionGeneration: 1, appId: 'test.app', attempt: 1 }
const capability: HealthCapability = { schemaVersion: 1, platform: 'mock', source: 'synthetic-health', sourceVersion: '1',
  signals: { crash: { supported: true, reason: 'synthetic-only' } },
  completeness: { processIdentity: true, windowCursors: true, detectableLoss: true, monotonicMapping: true, drainAcknowledgement: true } }
const window = (): HealthWindow => ({ schemaVersion: 1, bindingDigest: healthBindingDigest(binding), startMs: 100, endMs: 200,
  startCursor: 'a', endCursor: 'b', ready: true, drained: true, dropped: 0, rawBytes: 0, gaps: [], events: [],
  maxQueueDepth: 0, clockMapping: 'verified', processes: [{ generation: 'epoch-1', fromMs: 90, toMs: 200 }] })
const event = (overrides = {}) => ({ signal: 'crash' as const, appId: binding.appId, processGeneration: 'epoch-1', sequence: 1,
  atMs: 150, attribution: 'confirmed' as const, bindingDigest: healthBindingDigest(binding), ...overrides })
describe('health completeness and source lifecycle', () => {
  it('a malformed completeness map or non-overlapping process epoch cannot be green', () => {
    expect(() => requireHealthCapability({ ...capability, completeness: {} as NonNullable<HealthCapability['completeness']> }, ['crash'])).toThrow()
    expect(evaluateHealthWindow(capability, ['crash'], binding, { ...window(), processes: [{ generation: 'old', fromMs: 0, toMs: 90 }] }).status).toBe('inconclusive')
  })
  it('rejects a readability-only capability even if its supported flag is true', () => {
    const { completeness: _completeness, ...unproven } = capability
    expect(() => requireHealthCapability(unproven, ['crash'])).toThrow('health-source-unsupported')
    expect(() => requireHealthCapability({ ...capability, completeness: { ...capability.completeness!, detectableLoss: false } }, ['crash'])).toThrow('health-source-unsupported')
  })
  it.each([
    { ready: false }, { drained: false }, { maxQueueDepth: 257 }, { dropped: 1 }, { rawBytes: 16 * 1024 * 1024 + 1 },
    { clockMapping: 'uncertain' }, { startCursor: '' }, { processes: [] },
  ])('empty events do not pass with incomplete source facts %j', fault => {
    expect(evaluateHealthWindow(capability, ['crash'], binding, { ...window(), ...fault } as HealthWindow).status).toBe('inconclusive')
  })
  it('excludes confirmed old/cross-app events; process generation and slot must match', () => {
    const w = window(); w.events = [event({ atMs: 50, bindingDigest: 'a'.repeat(64) }), event({ appId: 'other.app' })]
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).status).toBe('pass')
    w.events = [event({ processGeneration: 'reused-pid-new-epoch' })]
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).status).toBe('inconclusive')
    w.events = [event({ bindingDigest: healthBindingDigest({ ...binding, sessionGeneration: 2 }) })]
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).status).toBe('inconclusive')
  })
  it('deduplicates exact events but retains conflict and out-of-order facts', () => {
    const w = window(); w.events = [event({ sequence: 2 }), event(), event()]
    expect(evaluateHealthWindow(capability, ['crash'], binding, w).violations).toHaveLength(2)
    w.events.push(event({ atMs: 160 }))
    const report = evaluateHealthWindow(capability, ['crash'], binding, w)
    expect(report).toMatchObject({ status: 'fail', coverage: 'incomplete' })
    expect(report.gaps).toContain('health-sequence-conflict')
  })
  it('an expected normal exit never suppresses a real nearby crash', () => {
    const operationId = randomUUID(), w = window()
    w.events = [event({ signal: 'normal-exit', operationId }), event({ sequence: 2, atMs: 151, operationId })]
    expect(evaluateHealthWindow(capability, ['crash'], binding, w, [operationId])).toMatchObject({ status: 'fail', expectedExits: 1, violations: [{ signal: 'crash', atMs: 51 }] })
    w.events = [event({ signal: 'unexpected-exit' })]
    expect(evaluateHealthWindow(capability, ['crash'], binding, w)).toMatchObject({ status: 'inconclusive', violations: [], unexpectedExits: 1 })
  })
  it('bounds diagnostic parser and never converts old human-readable history into attributed proof', () => {
    expect(parseAndroidExitHistory('  reason=4 (CRASH)\n  reason=6 (ANR)')).toMatchObject({ records: [{ reason: 'crash', attributed: false }, { reason: 'anr', attributed: false }] })
    expect(parseAndroidExitHistory('x'.repeat(1024 * 1024 + 1))).toMatchObject({ truncated: true, records: [] })
    expect(parseAndroidExitHistory('reason=4 (CRASH)\n'.repeat(257)).truncated).toBe(true)
  })
  it('kills and awaits only its owned non-cooperating diagnostic process', async () => {
    await expect(readHealthCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], new AbortController().signal,
      { timeoutMs: 200, bytes: 1024, killGraceMs: 25 })).rejects.toThrow('health-probe-timeout')
  })
  it('event storms and cancellation cannot return a successful source probe', async () => {
    await expect(readHealthCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(65536));setInterval(()=>{},1000)'], new AbortController().signal,
      { timeoutMs: 1000, bytes: 1024, killGraceMs: 25 })).rejects.toThrow('health-probe-overflow')
    const abort = new AbortController(); setTimeout(() => abort.abort(), 100)
    await expect(readHealthCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], abort.signal)).rejects.toThrow('health-probe-interrupted')
  })
})

describe('temporal negative-observation safety', () => {
  const header = { name: 'scope', platform: 'android', appId: 'test.app' }
  const node = '<node class="android.widget.TextView" text="Ready" resource-id="ready" bounds="[0,0][100,100]" displayed="true"/>'
  const parse = async (predicate: unknown) => (await parseTemporalStep('assertEventually', { predicate, withinMs: 1000, pollMs: 200, maxSampleGapMs: 500 }, header)).predicate
  it('rejects empty/malformed/truncated sources instead of proving absence', async () => {
    const predicate = await parse({ assertNotVisible: { text: 'Missing' } })
    for (const source of ['<hierarchy/>', '<broken>', '<hierarchy>' + node.repeat(501) + '</hierarchy>'])
      expect(() => temporalPredicateMatches(source, 'android', predicate, [])).toThrow()
    expect(temporalPredicateMatches('<hierarchy>' + node + '</hierarchy>', 'android', predicate, [])).toBe(true)
  })
  it('rejects missing parent scope, ambiguity, sensitive nodes and visible blockers', async () => {
    const missing = await parse({ assertNotVisible: { text: 'Missing', within: { id: 'missing-parent' } } })
    expect(() => temporalPredicateMatches('<hierarchy>' + node + '</hierarchy>', 'android', missing, [])).toThrow('temporal-scope-unconfirmed')
    const present = await parse({ assertVisible: { text: 'Ready' } })
    expect(() => temporalPredicateMatches('<hierarchy>' + node.repeat(2) + '</hierarchy>', 'android', present, [])).toThrow('temporal-ambiguous-target')
    expect(() => temporalPredicateMatches('<hierarchy>' + node.replace('displayed=', 'password="true" displayed=') + '</hierarchy>', 'android', present, [])).toThrow('temporal-sensitive-tree')
    expect(() => temporalPredicateMatches('<hierarchy>' + node + '</hierarchy>', 'android', present, [{ text: 'Ready' }])).toThrow('evidence-contaminated')
  })
})

function run(): TestRun {
  const at = new Date().toISOString()
  const result: TestRun = { schemaVersion: 1, id: randomUUID(), name: 'synthetic', yaml: '', engine: 'synthetic', phase: 'running', startedAt: at,
    sessionId: 's', deviceName: 'fixture', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions',
    visualVerification: 'not-performed', businessVerification: 'not-performed', steps: [], evidence: [], cleanup: 'pending',
    productContract: { contractVersion: 1, summaryRulesVersion: 1, provenance: createRunProvenance({ capturedAt: at, platform: 'ios', appId: 'test.app', runtime: 'test' }), verification: createRunVerification(false) } }
  enableRuntimeContract(result, ['e2e-measure-v1'], false, true)
  return result
}
const store = { save: async () => {}, put: async (_id: string, name: string, bytes: string, contentType: string) => ({ name, sha256: 'a'.repeat(64), bytes: Buffer.byteLength(bytes), contentType }) } as unknown as WorkbenchStore
const passedStep = (r: TestRun) => r.steps.push({ index: r.steps.length + 1, kind: 'assert', status: 'passed', startedAt: new Date().toISOString(),
  evidence: [{ name: 'step-1.png', sha256: 'a'.repeat(64), bytes: 1, contentType: 'image/png' }, { name: 'step-1.xml', sha256: 'b'.repeat(64), bytes: 1, contentType: 'application/xml' }] })
describe('monotonic measurement and required v2 features', () => {
  it('equal threshold is pass; the endpoint includes required evidence rather than just a UI callback', async () => {
    const r = run(); let clock = 0
    await executeMeasurement({ id: 'equal', path: 'root/1', maxElapsedMs: 1000 }, r, store, async () => { passedStep(r); clock = 1000 }, new AbortController().signal, () => clock)
    expect(r.measurements?.[0]).toMatchObject({ status: 'pass', elapsedMs: 1000, assertions: 1 })
  })
  it('a confirmed over-budget endpoint fails, while a provider failure remains uncertain', async () => {
    const r = run(); let clock = 0
    await expect(executeMeasurement({ id: 'late', path: 'root/1', maxElapsedMs: 1000 }, r, store, async () => { passedStep(r); clock = 1001 }, new AbortController().signal, () => clock)).rejects.toBeInstanceOf(PerformanceDeadline)
    expect(r.measurements?.[0]?.status).toBe('fail')
    const infra = run(); clock = 0
    await expect(executeMeasurement({ id: 'infra', path: 'root/1', maxElapsedMs: 1000 }, infra, store, async () => { clock = 1001; throw new Error('device disconnected') }, new AbortController().signal, () => clock)).rejects.toThrow('device disconnected')
    expect(infra.measurements?.[0]?.status).toBe('inconclusive')
  })
  it('an empty branch, prior assertion or fast failure cannot satisfy this block', async () => {
    const r = run(); passedStep(r)
    await expect(executeMeasurement({ id: 'empty', path: 'root/2', maxElapsedMs: 1000 }, r, store, async () => {}, new AbortController().signal)).rejects.toThrow('endpoint-not-reached')
    expect(r.measurements?.[0]?.assertions).toBe(0)
    const failed = run()
    await expect(executeMeasurement({ id: 'wrong', path: 'root/1', maxElapsedMs: 1000 }, failed, store, async () => { throw new FlowAssertionFailure('wrong state') }, new AbortController().signal)).rejects.toThrow('wrong state')
    expect(failed.measurements?.[0]).toMatchObject({ status: 'inconclusive', reason: 'endpoint-not-reached' })
  })
  it('required feature/dimension downgrade and unknown versions fail closed', () => {
    const r = run(), contract = structuredClone(r.productContract!)
    if (contract.contractVersion !== 2) throw new Error('test setup')
    contract.verification.performance.required = false
    expect(runProductContractSchema.safeParse(contract).success).toBe(false)
    expect(runProductContractSchema.safeParse({ ...r.productContract, contractVersion: 3 }).success).toBe(false)
  })
})
