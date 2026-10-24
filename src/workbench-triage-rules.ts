import { runResultProjection } from './workbench-contracts.js'
import { sha256 } from './content-hash.js'
import type { TestRun } from './workbench-domain.js'
import { TRIAGE_CHECKS, type TriageDirection, type TriageFact, type TriageRoute } from './workbench-triage-contracts.js'

const TYPED_ENVIRONMENT_CODES = new Set(['appium_server_unreachable', 'appium_request_timeout', 'appium_session_command_timeout', 'device-disconnected', 'wda-session-failed', 'session-not-created', 'device-command-timeout', 'transport-disconnected', 'model-service-unavailable', 'model-service-timeout'])
const safeToken = (value: string): string => /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : 'unknown-event'
const safeStep = (value: string): string => /^[A-Za-z0-9/._:-]{1,160}$/.test(value) ? value : `untrusted:${sha256(value).slice(0, 16)}`

export type { TriageAnalysis } from './workbench-triage-contracts.js'
import type { TriageAnalysis } from './workbench-triage-contracts.js'

export interface TriageComparisonContext {
  comparison: { comparability: 'comparable' | 'review-only' | 'unavailable' }
  firstDivergence?: { kind: 'confirmed' | 'observed-with-prior-gap'; step: { index: number; path: string } }
  evidenceCoverage: { dimensions: { partial: number; unavailable: number } }
}

/** Pure, conservative classification of recorded facts. It never interprets free-form messages. */
export function analyzeTriage(run: TestRun, comparison?: TriageComparisonContext, locatorEvidence: readonly string[] = [], manifestSha256 = ''): TriageAnalysis {
  const projection = runResultProjection(run, run.share ? 'not-checked' : 'verified')
  const facts: TriageFact[] = []
  const limitations = new Set<string>()
  let omittedEvidence = 0
  const registered = new Set([...run.evidence, ...run.steps.flatMap(step => step.evidence)].map(file => file.name))
  const add = (input: Omit<TriageFact, 'id'>, ordinal: number) => {
    const evidenceRefs = [...new Set(input.evidenceRefs.filter(ref => registered.has(ref)))].sort()
    omittedEvidence += Math.max(0, input.evidenceRefs.length - evidenceRefs.length)
    const fact: TriageFact = { ...input, evidenceRefs, id: sha256(JSON.stringify([1, manifestSha256, input.source, input.domain, input.code, input.stepKey ?? '', input.stepIndex ?? 0, ordinal])) }
    facts.push(fact)
    return fact
  }
  for (const [index, diagnostic] of (run.diagnostics ?? []).entries()) {
    const code = safeToken(diagnostic.code)
    add({ source: 'run', domain: safeToken(diagnostic.domain), code, phase: safeToken(diagnostic.phase),
      ...(diagnostic.stepKey ? { stepKey: safeStep(diagnostic.stepKey) } : {}),
      templateKey: code, evidenceRefs: diagnostic.evidenceRefs }, index)
  }
  if (run.businessVerification === 'fail' && !facts.some(fact => fact.domain === 'business-assertion')) {
    add({ source: 'run', domain: 'business-assertion', code: 'business-verifier-failed', phase: 'verify', templateKey: 'business-verifier-failed', evidenceRefs: [] }, facts.length)
  }
  for (const step of run.steps) {
    const refs = step.evidence.map(file => file.name)
    if (step.kind === 'assert' && step.status === 'failed') add({ source: 'run', domain: 'ui-assertion', code: 'declared-assertion-failed', phase: 'verify', stepIndex: step.index, ...(step.comparison?.stepKey ? { stepKey: safeStep(step.comparison.stepKey) } : {}), templateKey: 'declared-assertion-failed', evidenceRefs: refs }, facts.length)
    if (step.kind === 'assertVisual' && step.visual?.status === 'fail') add({ source: 'run', domain: 'visual', code: 'declared-visual-failed', phase: 'verify', stepIndex: step.index, templateKey: 'declared-visual-failed', evidenceRefs: refs }, facts.length)
    for (const file of step.evidence) if (file.incomplete || file.recovered || file.lineage?.integrity === 'failed' || file.lineage?.integrity === 'unverified') add({ source: 'run', domain: 'evidence', code: 'step-evidence-unverified', phase: 'capture', stepIndex: step.index, templateKey: 'step-evidence-unverified', evidenceRefs: [file.name] }, facts.length)
  }
  if (locatorEvidence.length) add({ source: 'comparison', domain: 'locator', code: 'unique-anchor-id-change', phase: 'compare', templateKey: 'unique-anchor-id-change', evidenceRefs: [...locatorEvidence] }, facts.length)
  if (run.share) add({ source: 'run', domain: 'evidence', code: 'original-evidence-withheld', phase: 'read', templateKey: 'original-evidence-withheld', evidenceRefs: [] }, facts.length)
  if (projection.evidenceAvailability === 'not-revalidated') limitations.add('derived-not-revalidated')
  if (run.source === 'import') limitations.add('imported-origin-unverified')
  if (projection.readState !== 'supported') limitations.add(projection.readState === 'legacy' ? 'legacy-contract' : 'unsupported-contract')
  if (comparison) {
    if (comparison.comparison.comparability !== 'comparable') limitations.add('comparison-review-only')
    if (comparison.firstDivergence?.kind === 'observed-with-prior-gap') limitations.add('earlier-evidence-gap')
    if (comparison.evidenceCoverage.dimensions.unavailable || comparison.evidenceCoverage.dimensions.partial) limitations.add('comparison-partial')
  } else limitations.add('no-baseline')
  const categories = (direction: TriageDirection): TriageFact[] => {
    switch (direction) {
      case 'product-behavior': return facts.filter(fact => (fact.domain === 'business-assertion' || fact.domain === 'ui-assertion' || fact.domain === 'visual') && fact.code !== 'unknown-event')
      case 'locator-change': return facts.filter(fact => fact.domain === 'locator' && fact.code === 'unique-anchor-id-change')
      case 'environment': return facts.filter(fact => TYPED_ENVIRONMENT_CODES.has(fact.code) || fact.domain === 'cleanup' && fact.code === 'extension-cleanup-failed')
      case 'evidence-gap': return facts.filter(fact => fact.domain === 'evidence')
    }
  }
  const routes: TriageRoute[] = []
  for (const direction of ['product-behavior', 'locator-change', 'environment', 'evidence-gap'] as const) {
    const support = categories(direction)
    if (!support.length) continue
    routes.push({ direction, basis: direction === 'environment' || direction === 'evidence-gap' ? 'supported' : 'hypothesis',
      supportFactIds: support.map(fact => fact.id).slice(0, 48), counterFactIds: [],
      missingRequirements: direction === 'locator-change' ? ['human-review-required'] : [],
      limitations: direction === 'locator-change' && comparison?.comparison.comparability !== 'comparable' ? ['comparison-review-only'] : [],
      nextCheckIds: [...TRIAGE_CHECKS[direction]],
    })
  }
  if (run.share) {
    const gap = routes.find(route => route.direction === 'evidence-gap')
    if (gap) { gap.missingRequirements.push('original-evidence-withheld'); gap.limitations.push('derived-not-revalidated') }
  }
  const routeOrder: Record<TriageDirection, number> = { 'evidence-gap': 0, environment: 1, 'product-behavior': 2, 'locator-change': 3 }
  routes.sort((a, b) => routeOrder[a.direction] - routeOrder[b.direction])
  const firstFailedStep = run.steps.find(step => step.status === 'failed')
  const focus = comparison?.firstDivergence ? { kind: comparison.firstDivergence.kind === 'confirmed' ? 'confirmed-difference' as const : 'observed-with-prior-gap' as const,
    stepIndex: comparison.firstDivergence.step.index + 1, stepKey: safeStep(comparison.firstDivergence.step.path) }
    : firstFailedStep ? { kind: 'recorded-failure' as const, stepIndex: firstFailedStep.index, ...(firstFailedStep.comparison?.stepKey ? { stepKey: safeStep(firstFailedStep.comparison.stepKey) } : {}) }
      : undefined
  const omittedFacts = Math.max(0, facts.length - 48)
  const visible = facts.slice(0, 48)
  const visibleIds = new Set(visible.map(fact => fact.id))
  for (const route of routes) {
    const excluded = route.supportFactIds.filter(id => !visibleIds.has(id)).length
    route.supportFactIds = route.supportFactIds.filter(id => visibleIds.has(id))
    if (excluded) route.limitations.push('support-truncated')
    if (!route.supportFactIds.length) route.basis = 'undetermined'
  }
  if (omittedFacts) limitations.add('facts-truncated')
  if (omittedEvidence) limitations.add('evidence-unregistered')
  const relevant = routes.length > 0 || facts.length > 0 || projection.verdict !== 'pass'
  return {
    ...(projection.reportedVerdict ? { reportedVerdict: projection.reportedVerdict } : {}),
    ...(projection.verdict ? { effectiveVerdict: projection.verdict } : {}),
    verification: { ui: projection.verification.ui.status, business: projection.verification.business.status,
      visual: projection.verification.visual.status, cleanup: projection.verification.cleanup.status, evidence: projection.verification.evidence.status },
    facts: visible, routes: routes.slice(0, 4),
    disposition: !relevant ? 'not-applicable' : routes.some(route => route.basis !== 'undetermined' && route.supportFactIds.length > 0) ? 'actionable' : 'unknown',
    limitations: [...limitations].sort().slice(0, 32), ...(focus ? { focus } : {}),
    omitted: { facts: omittedFacts, evidence: omittedEvidence }, state: omittedFacts || omittedEvidence ? 'partial' : 'complete',
  }
}
