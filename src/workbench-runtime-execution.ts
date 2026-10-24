import { executeExtension } from './workbench-extensions.js'
import { parseBusinessStep, parseTemporalStep } from './workbench-runtime-syntax.js'
import { evaluateTemporal, type TemporalResult } from './workbench-temporal.js'
import { temporalPredicateMatches } from './workbench-temporal-evidence.js'
import { bind, type PlanNode, type ExecutionPlan } from './workbench-plan.js'
import { FlowAssertionFailure } from './workbench-native-execution.js'
import type { WorkbenchDevice } from './workbench-device.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { RunStep, TestRun } from './workbench-domain.js'

export function conjoinBusiness(a: TestRun['businessVerification'], b: TestRun['businessVerification']): TestRun['businessVerification'] {
  return a === 'fail' || b === 'fail' ? 'fail' : a === 'inconclusive' || b === 'inconclusive' ? 'inconclusive'
    : a === 'pass' || b === 'pass' ? 'pass' : 'not-performed'
}

/** Only read observations are repeated. Every mutation stays in WorkbenchDevice. */
export async function executeRuntimeStep(node: Extract<PlanNode, { kind: 'temporal' | 'restart' | 'business' }>, context: {
  store: WorkbenchStore; run: TestRun; step: RunStep; device: WorkbenchDevice; plan: ExecutionPlan; outputs: Record<string, unknown>; signal: AbortSignal
}): Promise<void> {
  const { store, run, step, device, plan, outputs, signal } = context
  const previousSamples = () => run.steps.filter(item => item !== step).reduce((sum, item) => sum + (item.temporal?.result.samples.length ?? item.business?.samples ?? 0), 0)
  const runBytes = () => [...run.evidence, ...run.steps.flatMap(item => item.evidence)].reduce((sum, file) => sum + file.bytes, 0)
  if (node.kind === 'restart') {
    run.stage = 'restart-app'; await store.save(run)
    step.restart = await device.restartApp(node.header.appId, node.timeoutMs, signal)
    return
  }
  const raw = bind(node.raw, bind(node.scope, {}, outputs), outputs)
  if (node.kind === 'temporal') {
    const parsed = await parseTemporalStep(node.operation, raw, node.header)
    run.stage = parsed.step.operation === 'assertStable' ? 'sampling-stable' : 'sampling-eventually'
    let assertionBytes = 0
    const started = performance.now()
    let result: TemporalResult = { schemaVersion: 1, status: 'inconclusive', reason: 'temporal-interrupted',
      mode: parsed.step.operation === 'assertStable' ? 'stable' : 'eventually', windowMs: parsed.step.operation === 'assertStable' ? parsed.step.durationMs : parsed.step.withinMs,
      pollMs: parsed.step.pollMs, maxSampleGapMs: parsed.step.maxSampleGapMs, elapsedMs: 0, samples: [], coverage: 'incomplete' }
    let interrupted: unknown
    try { result = await evaluateTemporal(parsed.step, async (sampleSignal, index) => {
      if (previousSamples() + index > 1024) throw new Error('temporal-run-sample-budget')
      let source = ''; const evidenceRefs: string[] = []
      await device.checkpoint(async part => {
        const bytes = typeof part.bytes === 'string' ? Buffer.byteLength(part.bytes) : part.bytes.byteLength
        if (bytes > 1024 * 1024 || assertionBytes + bytes > 16 * 1024 * 1024
          || runBytes() + bytes > 64 * 1024 * 1024) throw new Error('temporal-evidence-budget')
        assertionBytes += bytes
        const file = await store.put(run.id, 'temporal-' + step.index + '-' + index + '.' + part.kind, part.bytes, part.kind === 'xml' ? 'application/xml' : 'image/png')
        step.evidence.push(file); evidenceRefs.push(file.name)
        if (part.kind === 'xml') source = String(part.bytes)
      }, sampleSignal, node.header.appId)
      if (!source) throw new Error('temporal-source-missing')
      return { matched: temporalPredicateMatches(source, device.platform, parsed.predicate, node.header.blockers), evidenceRefs }
    }, signal, { progress: async snapshot => {
      result = snapshot
      step.message = JSON.stringify({ samples: snapshot.samples.length, elapsedMs: snapshot.samples.at(-1)?.endedMs ?? 0 })
      await store.save(run)
    } }) } catch (error) {
      interrupted = error
      result.status = 'inconclusive'; result.reason = 'temporal-interrupted'; result.coverage = 'incomplete'; result.elapsedMs = performance.now() - started
    }
    const report = 'temporal-' + step.index + '-report.json'
    step.temporal = { config: parsed.step, result, report, blockers: node.header.blockers }
    step.evidence.push(await store.put(run.id, report, JSON.stringify({ config: parsed.step, result, blockers: node.header.blockers }), 'application/json'))
    await store.save(run)
    if (interrupted) throw interrupted
    if (result.status === 'fail') throw new FlowAssertionFailure(result.reason)
    if (result.status !== 'pass') throw new Error(result.reason)
    return
  }
  const config = parseBusinessStep(raw), def = plan.project.extensions[config.ref]
  if (!def || def.role !== 'verify' || !def.observation?.readOnly || !def.observation.repeatable || !def.observation.allowedModes.includes(config.mode)) throw new Error('business-observation-not-authorized')
  run.stage = 'business-observing'
  let samples = 0
  const observe = async (sampleSignal: AbortSignal) => {
    if (previousSamples() + samples + 1 > 1024) throw new Error('business-run-sample-budget')
    const value = await executeExtension(def, config.args, sampleSignal, async () => { throw new Error('business-resource-forbidden') }) as Record<string, unknown>
    if (!value || !['pass', 'fail', 'inconclusive'].includes(String(value.verdict)) || !Object.hasOwn(value, 'expected') || !Object.hasOwn(value, 'actual')
      || typeof value.source !== 'string' || !value.source.trim() || !Array.isArray(value.artifactRefs)) throw new Error('business-result-invalid')
    const bytes = JSON.stringify({ schemaVersion: 1, ref: config.ref, sample: ++samples, result: value })
    if (Buffer.byteLength(bytes) > 1024 * 1024 || runBytes() + Buffer.byteLength(bytes) > 64 * 1024 * 1024) throw new Error('business-evidence-budget')
    const file = await store.put(run.id, 'business-' + step.index + '-' + samples + '.json', bytes, 'application/json')
    step.evidence.push(file)
    if (value.verdict === 'inconclusive') throw new Error('business-observation-inconclusive')
    return { matched: value.verdict === 'pass', evidenceRefs: [file.name] }
  }
  let status: 'pass' | 'fail' | 'inconclusive' = 'inconclusive', reason = 'business-observation-failed'
  const startedMs = performance.now(), report = 'business-' + step.index + '-report.json'
  let sampling: Awaited<ReturnType<typeof evaluateTemporal>> | undefined
  try {
    const temporal = { operation: 'assertEventually' as const, predicate: {}, withinMs: config.withinMs,
      pollMs: config.mode === 'eventually' ? config.pollMs : 100, maxSampleGapMs: config.mode === 'eventually' ? config.maxSampleGapMs : config.withinMs }
    if (config.mode === 'once') {
      const started = performance.now(), deadline = AbortSignal.any([signal, AbortSignal.timeout(config.withinMs)])
      const value = await observe(deadline)
      signal.throwIfAborted()
      if (deadline.aborted || performance.now() - started > config.withinMs) throw new Error('business-late-result')
      status = value.matched ? 'pass' : 'fail'; reason = value.matched ? 'business-satisfied' : 'business-mismatch'
    } else {
      const result = await evaluateTemporal(temporal, observe, signal, { progress: async () => { step.message = JSON.stringify({ samples }); await store.save(run) } })
      sampling = result
      status = result.status; reason = result.reason
    }
  } finally {
    step.business = { ref: config.ref, mode: config.mode, samples, status, reason, report }
    run.businessVerification = conjoinBusiness(run.businessVerification, status)
    step.evidence.push(await store.put(run.id, report, JSON.stringify({ schemaVersion: 1, config, decision: step.business, elapsedMs: performance.now() - startedMs, ...(sampling ? { sampling } : {}) }), 'application/json'))
    await store.save(run)
  }
  if (status === 'fail') throw new FlowAssertionFailure(reason)
  if (status !== 'pass') throw new Error(reason)
}
