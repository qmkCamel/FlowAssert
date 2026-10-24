import { evaluateStructuredAssertion, parseAndroidPageSource, parseIOSPageSource, resolveElementSelector, parseElementSelector } from './workbench-engine-adapter.js'
import { normalizeScreenSource } from './screen-source-normalizer.js'
import { readinessCondition } from './workbench-readiness.js'
import type { TemporalPredicate } from './workbench-runtime-syntax.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { TestRun, RunStep } from './workbench-domain.js'
import { verifyTemporalFacts } from './workbench-temporal.js'

export function temporalPredicateMatches(source: string, platform: 'android' | 'ios', predicate: TemporalPredicate, blockers: unknown[]): boolean {
  const structure = normalizeScreenSource(source, platform)
  if (structure.truncated) throw new Error('temporal-incomplete-tree')
  if (!structure.nodes.some(node => node.platformRole?.startsWith(platform === 'ios' ? 'XCUIElementType' : 'android.'))) throw new Error('temporal-incomplete-tree')
  if (structure.nodes.some(node => node.sensitive)) throw new Error('temporal-sensitive-tree')
  const elements = platform === 'ios' ? parseIOSPageSource(source, { includeHidden: true }) : parseAndroidPageSource(source)
  if (blockers.some(raw => resolveElementSelector(elements.filter(element => element.visible !== false), parseElementSelector(raw, 'blocker')).matches.length))
    throw new Error('evidence-contaminated')
  if ('ready' in predicate) return readinessCondition(structure, predicate.ready.target, predicate.ready.state)
  const assertion = predicate.native.parsed.steps[0]!
  if (assertion.kind !== 'assert' || !assertion.selector) throw new Error('temporal-predicate-invalid')
  const validateParents = (selector: ReturnType<typeof parseElementSelector>) => {
    for (const key of ['within', 'childOf', 'descendantOf'] as const) {
      const reference = selector[key]
      if (reference === undefined) continue
      const parent = parseElementSelector(typeof reference === 'string' ? { text: reference } : reference, 'temporal parent')
      validateParents(parent)
      if (resolveElementSelector(elements, parent).matches.length !== 1) throw new Error('temporal-scope-unconfirmed')
    }
  }
  validateParents(assertion.selector)
  const matches = resolveElementSelector(elements, assertion.selector).matches
  if (assertion.count === undefined && matches.length > 1) throw new Error('temporal-ambiguous-target')
  return evaluateStructuredAssertion(elements, assertion.selector, assertion.properties, assertion.count).success
}

export async function verifyTemporalEvidence(store: WorkbenchStore, run: TestRun, step: RunStep, predicate: TemporalPredicate, blockers: unknown[]): Promise<void> {
  if (!step.temporal || step.temporal.result.status !== 'pass') return
  const { config, result, report } = step.temporal
  if (!verifyTemporalFacts(config, result)) throw new Error('temporal-facts-invalid')
  const file = step.evidence.find(file => file.name === report)
  if (!file || JSON.stringify(JSON.parse((await store.readEvidence(run.id, file)).toString())) !== JSON.stringify({ config, result, blockers: step.temporal.blockers })) throw new Error('temporal-report-conflict')
  for (const sample of result.samples) {
    const source = step.evidence.find(file => sample.evidenceRefs.includes(file.name) && file.name.endsWith('.xml'))
    if (!source || !sample.evidenceRefs.every(ref => step.evidence.some(file => file.name === ref))) throw new Error('temporal-sample-evidence-missing')
    const matched = temporalPredicateMatches((await store.readEvidence(run.id, source)).toString(), run.platform as 'android' | 'ios', predicate, blockers)
    if (matched !== sample.matched) throw new Error('temporal-sample-conflict')
  }
}
