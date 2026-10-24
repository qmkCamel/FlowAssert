import type { RunYamlFlowResult } from '@appclaw/core/flow/run-yaml-flow'
import { compilePlan, type PlanNode } from './workbench-plan.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { TestRun, Verdict } from './workbench-domain.js'
import { verifyRuntimeEvidence } from './workbench-runtime-evidence.js'
import { verifyHealthReport } from './workbench-health.js'

export function containsVisual(nodes: PlanNode[]): boolean {
  return nodes.some(node => node.kind === 'visual' || node.kind === 'ocr' || node.kind === 'if' && (containsVisual(node.then) || containsVisual(node.else)) || (node.kind === 'repeat' || node.kind === 'measure') && containsVisual(node.steps))
}

/** Deterministic terminal aggregation. Persistence and read-time integrity remain separate. */
export function aggregateRunVerdict(run: TestRun, input: {
  aborted: boolean
  abortReason?: string
  assertionFailure: boolean
  failure?: string
  engineResult: RunYamlFlowResult | null
  declaredVisual: boolean
}): { verdict: Verdict; error?: string } {
  if (input.declaredVisual && run.visualVerification === 'not-performed') run.visualVerification = 'inconclusive'
  const conflict = run.steps.find(step => step.verification && ['evidence-conflict', 'evidence-contaminated'].includes(step.verification.status))?.verification
  const runtime = run.productContract?.contractVersion === 2 ? run.productContract.verification : undefined
  const gates = runtime ? [runtime.ui, runtime.business, runtime.visual, runtime.health, runtime.performance] : []
  const verdict: Verdict = input.aborted
    ? (input.abortReason === 'Cancelled by user' ? 'cancelled' : 'inconclusive')
    : conflict ? conflict.status as Verdict
      : input.assertionFailure || run.businessVerification === 'fail' || run.visualVerification === 'fail' || gates.some(gate => gate.required && gate.status === 'fail') ? 'fail'
        : input.failure || run.visualVerification === 'inconclusive' || gates.some(gate => gate.required && gate.status !== 'pass') ? 'inconclusive'
          : !(input.engineResult?.success ?? (run.productContract?.contractVersion === 2 && run.steps.every(step => step.status === 'passed'))) ? 'fail'
            : run.aiRecovery?.attempts.some(attempt => attempt.status === 'recovered') ? 'recovered' : 'pass'
  const error = input.failure ?? input.engineResult?.reason ?? conflict?.message
  return { verdict, ...(error ? { error } : {}) }
}

export function requireTerminalStepEvidence(run: TestRun, declaredStepCount: number, verdict: Verdict): void {
  // A monotonic budget may expire before the first Worker step is dispatched.
  // Its independently persisted deadline report is failure evidence, not UI success.
  const measuredDeadline = verdict === 'fail' && run.productContract?.contractVersion === 2
    && run.measurements?.some(report => report.status === 'fail' && report.reason === 'performance-deadline')
    && run.evidence.some(file => /^measure-\d+\.json$/.test(file.name))
  if ((!run.steps.length && !measuredDeadline) || (['pass', 'recovered'].includes(verdict) && run.steps.length !== declaredStepCount)) throw new Error('Executor did not complete all declared steps')
  for (const step of run.steps) {
    if ((!step.evidence.some(file => file.contentType === 'image/png') || !step.evidence.some(file => file.name.endsWith('.xml'))) && ['pass', 'recovered'].includes(verdict)) {
      throw new Error(`Step ${step.index}: required evidence missing`)
    }
  }
}

export async function verifyRunEvidence(store: WorkbenchStore, run: TestRun): Promise<void> {
  for (const file of [...run.evidence, ...run.steps.flatMap(step => step.evidence)]) await store.readEvidence(run.id, file)
  if (run.productContract?.contractVersion !== 2 || run.source === 'import') return
  const snapshot = run.evidence.find(file => file.name === 'plan.json')
  if (!snapshot) throw new Error('runtime-plan-evidence-missing')
  const { project } = JSON.parse((await store.readEvidence(run.id, snapshot)).toString())
  const plan = await compilePlan(run.yaml, project, run.params)
  if (JSON.stringify(plan.requiredFeatures) !== JSON.stringify(run.productContract.requiredFeatures)) throw new Error('runtime-feature-conflict')
  await verifyRuntimeEvidence(store, run, plan)
  for (const step of run.steps) {
    if (step.status === 'passed' && ['assertEventually', 'assertStable'].includes(step.kind) && (!step.temporal || step.temporal.result.status !== 'pass')) throw new Error('temporal-decision-missing')
    if (step.status === 'passed' && step.kind === 'restartApp') {
      if (!step.restart || step.restart.status !== 'pass' || step.restart.after !== 'foreground'
        || !['restart-terminate:', 'restart-activate:'].every(prefix => run.dispatches?.some(record => record.operation === prefix + step.restart!.operationId && record.state === 'settled'))) throw new Error('restart-dispatch-conflict')
    }
    if (step.status === 'passed' && step.kind === 'assertBusiness' && (!step.business || step.business.status !== 'pass' || !step.business.samples)) throw new Error('business-decision-missing')
  }
  if (run.health) {
    const file = run.evidence.find(file => file.name === 'health-report.json')
    if (!file || JSON.stringify(JSON.parse((await store.readEvidence(run.id, file)).toString())) !== JSON.stringify(run.health)) throw new Error('health-report-conflict')
    if (run.health.status === 'pass' && (run.health.coverage !== 'complete' || run.health.gaps.length || run.health.violations.length)) throw new Error('health-coverage-conflict')
    await verifyHealthReport(store, run, run.health)
  }
}
