import type { TestRun } from './workbench-domain.js'
import { measurementSchema, type Measurement } from './workbench-runtime-contracts.js'
import type { WorkbenchStore } from './workbench-store.js'
import { FlowAssertionFailure } from './workbench-native-execution.js'

export class PerformanceDeadline extends Error { constructor() { super('performance-deadline') } }
export async function executeMeasurement(input: { id: string; path: string; maxElapsedMs: number }, run: TestRun, store: WorkbenchStore,
  execute: (signal: AbortSignal) => Promise<void>, signal: AbortSignal, now = () => performance.now()): Promise<void> {
  const started = now(), startedAt = new Date().toISOString(), offset = run.steps.length
  const deadlineController = new AbortController()
  const timer = setTimeout(() => deadlineController.abort(new PerformanceDeadline()), input.maxElapsedMs)
  const combined = AbortSignal.any([signal, deadlineController.signal])
  let failure: unknown
  run.stage = 'measure-running'; await store.save(run)
  try { await execute(combined) } catch (error) { failure = error }
  finally { clearTimeout(timer) }
  const elapsedMs = now() - started, steps = run.steps.slice(offset)
  const assertions = steps.filter(step => step.status === 'passed' && ['assert', 'assertEventually', 'assertStable', 'assertBusiness', 'assertVisual', 'assertTextInRegion'].includes(step.kind)).length
  const unknownWrite = run.dispatches?.some(record => record.state === 'unknown')
  const endpointMissing = !assertions || steps.some(step => step.status !== 'passed')
  const infraFailure = unknownWrite || steps.some(step => step.checkpointError || step.verification?.status === 'evidence-conflict' || step.verification?.status === 'evidence-contaminated')
    || (failure !== undefined && !(failure instanceof FlowAssertionFailure) && !(failure instanceof PerformanceDeadline) && failure !== combined.reason)
  const deadline = deadlineController.signal.aborted || elapsedMs > input.maxElapsedMs
  const status = signal.aborted || infraFailure ? 'inconclusive' : deadline ? 'fail' : failure || endpointMissing ? 'inconclusive' : 'pass'
  const reason = signal.aborted ? 'measurement-interrupted' : infraFailure ? 'measurement-observation-failed' : deadline ? 'performance-deadline'
    : failure || endpointMissing ? 'endpoint-not-reached' : 'endpoint-within-budget'
  const report: Measurement = measurementSchema.parse({ schemaVersion: 1, ...input, metric: 'automation-observed-e2e', elapsedMs, startedAt, endedAt: new Date().toISOString(),
    status, reason, startStep: offset + 1, endStep: run.steps.length, assertions,
    evidenceRefs: steps.flatMap(step => step.evidence.filter(file => file.name.endsWith('-report.json') || file.name === 'step-' + step.index + '.png' || file.name === 'step-' + step.index + '.xml').map(file => file.name)) })
  ;(run.measurements ??= []).push(report)
  const file = await store.put(run.id, 'measure-' + run.measurements.length + '.json', JSON.stringify(report), 'application/json')
  run.evidence.push(file)
  if (status !== 'pass') (run.diagnostics ??= []).push({ domain: 'performance', code: reason, phase: 'measure', retryable: false,
    evidenceRefs: [file.name], observedAt: report.endedAt, message: reason })
  const contract = run.productContract
  if (contract?.contractVersion === 2) {
    const dimension = contract.verification.performance
    dimension.status = dimension.status === 'fail' || status === 'fail' ? 'fail' : dimension.status === 'inconclusive' || status === 'inconclusive' ? 'inconclusive' : 'pass'
    dimension.reason = reason; dimension.evidenceRefs.push(file.name)
  }
  await store.save(run)
  if (signal.aborted) signal.throwIfAborted()
  if (status === 'fail') throw new PerformanceDeadline()
  if (failure) throw failure
  if (status !== 'pass') throw new Error(reason)
}
