import { parseIOSPageSource } from '@appclaw/core/perception/ios-parser'
import { parseAndroidPageSource } from '@appclaw/core/perception/android-parser'
import { evaluateStructuredAssertion, resolveElementSelector } from '@appclaw/core/flow/selector'
import { semanticStep } from './workbench-comparison.js'
import type { WorkbenchDevice } from './workbench-device.js'
import type { WorkbenchFlow } from './workbench-flow.js'
import { sha256, type WorkbenchStore } from './workbench-store.js'
import type { RunStep, TestRun } from './workbench-domain.js'
import { timed, type TimingObserver } from './workbench-timing.js'
import { readinessCondition } from './workbench-readiness.js'
import { normalizeScreenSource } from './screen-source-normalizer.js'

export interface StepEvent { type: 'step'; step: number; total: number; kind: string; target?: string; status: RunStep['status']; error?: string; message?: string; durationMs?: number }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Independently persists terminal PNG/XML and structured assertion facts. */
export async function recordStepEvidence(store: WorkbenchStore, run: TestRun, event: StepEvent, flow: WorkbenchFlow, device: WorkbenchDevice, timing: TimingObserver): Promise<void> {
  if (event.status === 'running') {
    run.steps.push({ index: event.step, kind: event.kind, ...(event.target ? { target: event.target } : {}), status: 'running', startedAt: new Date().toISOString(), evidence: [] })
    const step = run.steps.at(-1)!
    device.visualCaptureBudget = 8
    device.onVisualAction = async (record, bytes) => {
      step.actionEvidence ??= { version: 1, actions: [] }
      const ordinal = step.actionEvidence.actions.length + 1
      if (bytes) {
        const file = await store.put(run.id, `step-${step.index}-action-${ordinal}-before.png`, bytes, 'image/png')
        step.evidence.push(file); record.before = file.name
      }
      step.actionEvidence.actions.push(record)
      await store.save(run)
      return async dispatch => { record.dispatch = dispatch; await store.save(run) }
    }
  } else {
    delete device.onVisualAction; device.visualCaptureBudget = 0
    const step = run.steps.find(item => item.index === event.step)
    if (!step) throw new Error('Executor emitted a terminal step without a start')
    step.status = event.status; step.endedAt = new Date().toISOString()
    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs >= 0) {
      step.executionMs = Math.round(event.durationMs * 100) / 100
      if (step.kind === 'wait') step.waitMs = step.executionMs
      const deviceMs = (run.timings ?? []).filter(entry => entry.step === step.index && ['geometry', 'locate', 'action', 'png'].includes(entry.phase)).reduce((sum, entry) => sum + entry.durationMs, 0)
      step.executorOtherMs = Math.max(0, Math.round((step.executionMs - deviceMs) * 100) / 100)
    }
    if (event.message) step.message = event.message
    if (event.error) step.error = event.error
    step.captureStartedAt = new Date().toISOString(); step.captures = []
    let source: string | undefined
    try {
      await device.checkpoint(async part => {
        step.captures!.push({ kind: part.kind, startedAt: part.startedAt, endedAt: part.endedAt })
        if (part.kind === 'xml') source = String(part.bytes)
        const file = await timed(timing, 'persist', () => store.put(run.id, `step-${event.step}.${part.kind}`, part.bytes, part.kind === 'png' ? 'image/png' : 'application/xml; charset=utf-8'))
        if (part.kind === 'png') { step.evidence.unshift(file); if (step.actionEvidence) step.actionEvidence.after = file.name }
        else step.evidence.push(file)
        await timed(timing, 'persist', () => store.save(run))
      })
    } catch (error) {
      step.checkpointError = message(error)
      run.diagnostics!.push({ domain: 'evidence', code: 'checkpoint-failed', phase: 'evidence', ...(step.comparison?.stepKey ? { stepKey: step.comparison.stepKey } : {}), retryable: true,
        evidenceRefs: step.evidence.map(file => file.name), observedAt: new Date().toISOString(), message: message(error) })
      throw error
    } finally { step.captureEndedAt = new Date().toISOString() }
    const parsedStep = flow.parsed.steps[event.step - 1]
    const readyStep = flow.readySteps?.[event.step]
    const semanticDigest = semanticStep(readyStep ?? parsedStep ?? { kind: step.kind, target: step.target })
    const ancestry = (step.path ?? 'unknown').split('/').filter(Boolean).filter(part => !/^\d+$/.test(part) && !/^iteration-\d+$/.test(part))
    const iteration = Number(step.path?.match(/iteration-(\d+)/)?.[1])
    const occurrence = run.steps.filter(other => other !== step && other.comparison?.semanticDigest === semanticDigest && other.comparison.ancestry.join('/') === ancestry.join('/')).length + 1
    step.comparison = { stepKey: sha256(`${run.comparison?.planDigest ?? 'unknown'}:${step.path ?? step.index}:${semanticDigest}`), semanticDigest, ancestry, ...(Number.isSafeInteger(iteration) ? { iteration } : {}), occurrence }
    if (readyStep?.operation === 'assertReady') {
      const elements = device.platform === 'ios' ? parseIOSPageSource(source!, { includeHidden: true }) : parseAndroidPageSource(source!)
      const blocked = flow.blockers.some(selector => resolveElementSelector(elements.filter(element => element.visible !== false), selector).matches.length > 0)
      let passed = false
      try { passed = readinessCondition(normalizeScreenSource(source!, device.platform), readyStep.target, readyStep.state) }
      catch { /* incomplete, ambiguous or sensitive checkpoints cannot confirm a pass */ }
      const status = blocked ? 'evidence-contaminated' : passed ? 'pass' : event.status === 'passed' ? 'evidence-conflict' : 'fail'
      step.verification = { status, message: `Semantic assertion checkpoint: ${status}` }
      if (status !== 'pass') run.diagnostics!.push({ domain: 'ui-assertion', code: status, phase: 'verify', stepKey: step.comparison.stepKey,
        retryable: false, evidenceRefs: step.evidence.map(file => file.name), observedAt: new Date().toISOString(), message: step.verification.message })
      if (status === 'evidence-conflict' || status === 'evidence-contaminated') { await store.save(run); throw new Error(step.verification.message) }
    } else if (parsedStep?.kind === 'assert') {
      await timed(timing, 'verify', async () => {
        const elements = device.platform === 'ios' ? parseIOSPageSource(source!, { includeHidden: true }) : parseAndroidPageSource(source!)
        const blocked = flow.blockers.find(selector => resolveElementSelector(elements.filter(element => element.visible !== false), selector).matches.length > 0)
        const check = evaluateStructuredAssertion(elements, parsedStep.selector!, parsedStep.properties, parsedStep.count)
        step.verification = blocked
          ? { status: 'evidence-contaminated', message: `Declared blocker is visible: ${JSON.stringify(blocked)}` }
          : { status: check.success ? 'pass' : event.status === 'passed' ? 'evidence-conflict' : 'fail', message: check.message, diagnostics: check.diagnostics }
        if (step.verification.status !== 'pass') run.diagnostics!.push({ domain: 'ui-assertion', code: step.verification.status, phase: 'verify', ...(step.comparison?.stepKey ? { stepKey: step.comparison.stepKey } : {}), retryable: false,
          evidenceRefs: step.evidence.map(file => file.name), observedAt: new Date().toISOString(), message: step.verification.message })
        if (['evidence-conflict', 'evidence-contaminated'].includes(step.verification.status)) { await store.save(run); throw new Error(step.verification.message) }
      })
    }
  }
  await timed(timing, 'persist', () => store.save(run))
}
