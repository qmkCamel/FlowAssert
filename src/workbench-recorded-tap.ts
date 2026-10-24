import { parseAllDocuments } from 'yaml'
import { repairRegistration } from './workbench-repair-project.js'
import { LocalTapFailure, tapFactSchema, type SourceStepIdentity, type TapResolution } from './workbench-tap-facts.js'
import type { ExecutionPlan, PlanNode } from './workbench-plan.js'
import type { WorkbenchFlow } from './workbench-flow.js'
import type { WorkbenchDevice } from './workbench-device.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { TestRun } from './workbench-domain.js'
import type { StepEvent } from './workbench-step-evidence.js'
import type { TrustedPageScope } from './workbench-page-scope.js'

/** Local project registration only. Candidate YAML and merely similar flows are not enrolled. */
export function recordedTapIndices(plan: ExecutionPlan, run: TestRun, node: Extract<PlanNode, { kind: 'leaf' }>): Set<number> {
  const policy = repairRegistration(plan.project)?.policy
  if (!policy?.enabled || !policy.allowedPlatforms.includes(plan.header.platform) || !policy.allowedAppIds.includes(plan.header.appId)) return new Set()
  const flows = policy.allowedFlows.filter(id => plan.project.flows[id] === plan.yaml && (!run.flowId || run.flowId === id))
  if (flows.length !== 1) return new Set()
  const docs = parseAllDocuments(plan.yaml), steps = docs[1]!.toJS({ maxAliasCount: 0 }) as unknown[]
  const paths = new Set(policy.navigation.filter(entry => {
    if (entry.flow !== flows[0]) return false
    const assertion = steps[Number(entry.postconditionPath.split('/')[1]) - 1]
    return assertion && typeof assertion === 'object' && Object.keys(assertion).length === 1
      && ['assertVisible', 'assertNotVisible', 'assertCount', 'assertReady'].some(key => Object.hasOwn(assertion, key))
  }).map(entry => entry.stepPath))
  return new Set(node.sourceSteps.flatMap((source, index) => {
    const raw = node.raw[index]
    if (!source.topLevel || !source.static || !paths.has(source.path) || !raw || typeof raw !== 'object' || !('tap' in raw) || Object.keys(raw).length !== 1) return []
    const selector = raw.tap
    return selector && typeof selector === 'object' && Object.keys(selector).length === 1
      && Object.entries(selector).some(([key, value]) => ['id', 'accessibilityId'].includes(key) && typeof value === 'string' && value.length > 0) ? [index] : []
  }))
}

export function sliceNativeBlock(block: WorkbenchFlow, start: number, end: number): WorkbenchFlow {
  return { ...block, parsed: { ...block.parsed, steps: block.parsed.steps.slice(start, end) },
    inputModes: Object.fromEntries(Object.entries(block.inputModes).filter(([index]) => Number(index) > start && Number(index) <= end).map(([index, mode]) => [Number(index) - start, mode])) }
}

/** Called inside WorkbenchService's existing run lease and capacity reservation. */
export async function executeRecordedTap(input: {
  store: WorkbenchStore; run: TestRun; flow: WorkbenchFlow; block: WorkbenchFlow; localIndex: number
  path: string; source: SourceStepIdentity; selector: unknown; appId: string; blockers: unknown[]
  scope?: { page: TrustedPageScope; allowedTarget: { role: string; text: string } }
  device: WorkbenchDevice; signal: AbortSignal; recordStep: (event: StepEvent) => Promise<void>
}): Promise<void> {
  const { store, run, flow, device, signal, recordStep } = input
  const index = flow.parsed.steps.length + 1
  flow.parsed.steps.push(input.block.parsed.steps[input.localIndex]!)
  flow.blockers = input.block.blockers
  device.path = input.path
  await recordStep({ type: 'step', step: index, total: index, kind: 'tap', status: 'running' })
  const step = run.steps.at(-1)!
  step.path = input.path; step.sourceStep = input.source; step.sourceLine = input.source.line
  const dispatchStart = device.dispatches.length, startedAt = new Date().toISOString()
  let resolution: TapResolution | undefined, failure: unknown
  const observationFile = `step-${index}-tap-source.xml`, resolutionFile = `step-${index}-tap-resolution.json`
  try {
    await device.recordedNavigationTap(input.selector, input.appId, input.blockers, signal, async (xml, resolved) => {
      step.evidence.push(await store.put(run.id, observationFile, xml, 'application/xml; charset=utf-8'))
      step.evidence.push(await store.put(run.id, resolutionFile, JSON.stringify(resolved), 'application/json'))
      await store.save(run)
      resolution = resolved
    }, input.scope)
  } catch (error) { failure = error }
  if (resolution) {
    const writes = device.dispatches.slice(dispatchStart)
    const dispatch = writes.every(write => write.state === 'not-dispatched') ? 'not-dispatched'
      : writes.length === 1 && writes[0]!.state === 'settled' ? 'settled' : 'unknown'
    const outcome = dispatch === 'unknown' ? 'unknown' : signal.aborted ? 'cancelled' : failure === undefined ? 'passed'
      : failure instanceof LocalTapFailure && failure.code !== 'tap-not-ready' ? failure.code : 'blocked'
    const fact = tapFactSchema.parse({ version: 1, producer: 'local-navigation-tap', runId: run.id, stepIndex: index,
      source: input.source, sessionId: device.sessionId, sessionGeneration: device.sessionGeneration, resolution,
      dispatchStart, dispatchEnd: device.dispatches.length, dispatch, outcome, observationFile, resolutionFile,
      startedAt, completedAt: new Date().toISOString() })
    // A fact is visible only after its immutable evidence bytes have been published.
    step.evidence.push(await store.put(run.id, `step-${index}-tap-fact.json`, JSON.stringify(fact), 'application/json'))
    step.tapFact = fact
    await store.save(run)
  }
  try {
    await recordStep({ type: 'step', step: index, total: index, kind: 'tap', status: failure === undefined ? 'passed' : 'failed',
      ...(failure === undefined ? {} : { error: failure instanceof Error ? failure.message : String(failure) }) })
  } catch (error) { failure ??= error }
  if (failure !== undefined) throw failure
}
