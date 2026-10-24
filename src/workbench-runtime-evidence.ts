import { bind, type ExecutionPlan, type PlanNode } from './workbench-plan.js'
import { parseBusinessStep, parseTemporalStep } from './workbench-runtime-syntax.js'
import { verifyTemporalFacts } from './workbench-temporal.js'
import { verifyTemporalEvidence } from './workbench-temporal-evidence.js'
import { measurementSchema } from './workbench-runtime-contracts.js'
import type { TestRun } from './workbench-domain.js'
import type { WorkbenchStore } from './workbench-store.js'

function flatten(nodes: PlanNode[]): PlanNode[] {
  return nodes.flatMap(node => [node, ...(node.kind === 'if' ? [...flatten(node.then), ...flatten(node.else)]
    : node.kind === 'repeat' || node.kind === 'measure' ? flatten(node.steps) : [])])
}

/** Independent replay is fail-closed; imported/derived runs never use this as platform proof. */
export async function verifyRuntimeEvidence(store: WorkbenchStore, run: TestRun, plan: ExecutionPlan): Promise<void> {
  const nodes = flatten(plan.nodes), outputs: Record<string, unknown> = {}
  const prepared = (run.extensionResults ?? []).filter(entry => entry.role === 'prepare')
  plan.header.prepare.forEach((hook, index) => { if (hook.as && prepared[index]?.status === 'pass') outputs[hook.as] = prepared[index]!.result })
  const nodeAt = (path?: string) => nodes.find(node => node.path === path?.replace(/\/iteration-\d+/g, ''))
  const resolved = (node: Extract<PlanNode, { kind: 'temporal' | 'business' }>) => bind(node.raw, bind(node.scope, {}, outputs), outputs)
  for (const step of run.steps) {
    const node = nodeAt(step.path)
    if (step.temporal) {
      if (node?.kind !== 'temporal') throw new Error('temporal-plan-conflict')
      const parsed = await parseTemporalStep(node.operation, resolved(node), node.header)
      if (JSON.stringify(parsed.step) !== JSON.stringify(step.temporal.config)
        || JSON.stringify(node.header.blockers) !== JSON.stringify(step.temporal.blockers)) throw new Error('temporal-config-conflict')
      await verifyTemporalEvidence(store, run, step, parsed.predicate, node.header.blockers)
    }
    if (step.business?.status === 'pass') {
      if (node?.kind !== 'business') throw new Error('business-plan-conflict')
      const config = parseBusinessStep(resolved(node)), file = step.evidence.find(file => file.name === step.business!.report)
      if (!file) throw new Error('business-report-missing')
      const report = JSON.parse((await store.readEvidence(run.id, file)).toString())
      if (report.schemaVersion !== 1 || JSON.stringify(report.config) !== JSON.stringify(config)
        || JSON.stringify(report.decision) !== JSON.stringify(step.business) || !Number.isFinite(report.elapsedMs)
        || report.elapsedMs < 0 || report.elapsedMs > config.withinMs) throw new Error('business-report-conflict')
      const results: Map<string, boolean> = new Map()
      for (let sample = 1; sample <= step.business.samples; sample++) {
        if (sample > 256) throw new Error('business-sample-budget')
        const name = 'business-' + step.index + '-' + sample + '.json', evidence = step.evidence.find(file => file.name === name)
        if (!evidence) throw new Error('business-sample-missing')
        const value = JSON.parse((await store.readEvidence(run.id, evidence)).toString())
        if (value.schemaVersion !== 1 || value.ref !== config.ref || value.sample !== sample
          || !['pass', 'fail'].includes(value.result?.verdict) || !Object.hasOwn(value.result, 'expected')
          || !Object.hasOwn(value.result, 'actual') || typeof value.result.source !== 'string' || !value.result.source.trim()
          || !Array.isArray(value.result.artifactRefs)) throw new Error('business-sample-conflict')
        results.set(name, value.result.verdict === 'pass')
      }
      if (config.mode === 'once') {
        if (results.size !== 1 || ![...results.values()][0]) throw new Error('business-once-conflict')
      } else {
        const sampling = report.sampling
        if (!sampling || sampling.samples.length !== results.size || !verifyTemporalFacts({ operation: 'assertEventually', predicate: {}, ...config }, sampling)
          || sampling.samples.some((sample: { evidenceRefs: string[]; matched: boolean }, index: number) => sample.evidenceRefs.length !== 1
            || sample.evidenceRefs[0] !== 'business-' + step.index + '-' + (index + 1) + '.json'
            || results.get(sample.evidenceRefs[0]) !== sample.matched)) throw new Error('business-sampling-conflict')
      }
    }
  }
  for (const [index, raw] of (run.measurements ?? []).entries()) {
    const report = measurementSchema.parse(raw), node = nodeAt(report.path), file = run.evidence.find(file => file.name === 'measure-' + (index + 1) + '.json')
    if (node?.kind !== 'measure' || node.id !== report.id || node.maxElapsedMs !== report.maxElapsedMs
      || !file || JSON.stringify(JSON.parse((await store.readEvidence(run.id, file)).toString())) !== JSON.stringify(report)) throw new Error('measurement-report-conflict')
    if (report.status !== 'pass') {
      if (report.status === 'fail' && (report.reason !== 'performance-deadline' || report.elapsedMs < report.maxElapsedMs)) throw new Error('measurement-deadline-conflict')
      continue
    }
    const steps = run.steps.filter(step => step.index >= report.startStep && step.index <= report.endStep)
    const assertions = steps.filter(step => step.status === 'passed' && ['assert', 'assertEventually', 'assertStable', 'assertBusiness', 'assertVisual', 'assertTextInRegion'].includes(step.kind)).length
    const evidenceRefs = steps.flatMap(step => step.evidence.filter(file => file.name.endsWith('-report.json')
      || file.name === 'step-' + step.index + '.png' || file.name === 'step-' + step.index + '.xml').map(file => file.name))
    if (report.elapsedMs > report.maxElapsedMs || !assertions || assertions !== report.assertions || !steps.length
      || steps.length !== report.endStep - report.startStep + 1 || steps.some(step => step.status !== 'passed' || !step.path?.startsWith(node.path + '/measure/'))
      || !evidenceRefs.length || JSON.stringify(evidenceRefs) !== JSON.stringify(report.evidenceRefs)) throw new Error('measurement-endpoint-conflict')
  }
  const verification = run.productContract?.contractVersion === 2 ? run.productContract.verification : undefined
  if (verification?.performance.status === 'pass' && (!(run.measurements?.length) || run.measurements.some(report => report.status !== 'pass'))) throw new Error('performance-decision-conflict')
  if (verification?.health.status === 'pass' && run.health?.status !== 'pass') throw new Error('health-decision-missing')
}
