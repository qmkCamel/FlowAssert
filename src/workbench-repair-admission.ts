import { parseAllDocuments } from 'yaml'
import { RepairError } from './workbench-repair-contracts.js'
import { assertRepairPermission, repairRegistration } from './workbench-repair-project.js'
import { sourceTapIndex, trustedMissingTap } from './workbench-repair-evidence.js'
import { WorkbenchRepair, type RepairProposal } from './workbench-repair.js'
import { stepDigest } from './workbench-tap-facts.js'
import { normalizeScreenSource } from './screen-source-normalizer.js'
import { selectorFields } from './workbench-selector-adapter.js'
import { withinTrustedPage } from './workbench-page-scope.js'
import type { ProjectSnapshot } from './workbench-project.js'
import type { EvidenceFile, RunStep, TestRun } from './workbench-domain.js'
import type { WorkbenchStore } from './workbench-store.js'

export type RepairFailureClass = 'locator-drift-candidate' | 'readiness' | 'product-defect-candidate'
  | 'environment' | 'evidence-gap' | 'unknown'
export interface RepairClassification {
  kind: RepairFailureClass
  sourceRunId: string
  stepIndex?: number
  observation?: EvidenceFile
}

/** Classification is a read-only fact check, not a root-cause claim or execution grant. */
export async function classifyRepairFailure(store: WorkbenchStore, run: TestRun): Promise<RepairClassification> {
  const base = { sourceRunId: run.id }
  if (run.source === 'import' || run.share || run.phase !== 'finished' || run.verdict !== 'fail'
    || run.cleanup !== 'session-retained' || run.resourceCleanup === 'failed'
    || run.productContract?.verification.evidence.status !== 'pass') return { ...base, kind: 'evidence-gap' }
  if (run.dispatches?.some(record => record.state === 'unknown' || record.state === 'dispatched')) return { ...base, kind: 'unknown' }
  const failed = run.steps.find(step => step.status === 'failed')
  if (!failed || failed.checkpointError) return { ...base, kind: 'evidence-gap' }
  if (failed.kind === 'tap') {
    const observation = await trustedMissingTap(store, run, failed)
    return observation ? { ...base, kind: 'locator-drift-candidate', stepIndex: failed.index, observation }
      : { ...base, kind: 'evidence-gap' }
  }
  if (run.diagnostics?.some(item => item.domain === 'device-driver' && /^(?:readiness-|ambiguous-scope)/.test(item.code)))
    return { ...base, kind: 'readiness', stepIndex: failed.index }
  if (run.diagnostics?.some(item => item.domain === 'device-driver' || item.domain === 'model-service'))
    return { ...base, kind: 'environment', stepIndex: failed.index }
  if (['assert', 'assertVisual', 'assertTextInRegion'].includes(failed.kind)
    && failed.evidence.length > 0 && !failed.evidence.some(file => file.incomplete || file.recovered || file.lineage?.integrity !== 'verified'))
    return { ...base, kind: 'product-defect-candidate', stepIndex: failed.index }
  return { ...base, kind: 'unknown', stepIndex: failed.index }
}

const runProvenance = (run: TestRun) => run.productContract?.provenance
function sameKnown(a: { value: string }, b: { value: string }): boolean { return a.value !== 'unknown' && a.value === b.value }
function buildCompatible(source: TestRun, baseline: TestRun, project: ProjectSnapshot): boolean {
  const a = runProvenance(source)?.app, b = runProvenance(baseline)?.app
  if (!a || !b) return false
  if (sameKnown(a.build, b.build)) return true
  return a.binarySha256.source === 'observed' && b.binarySha256.source === 'observed'
    && Boolean(project.repair?.compatibleBuilds.some(pair => pair.from === b.binarySha256.value && pair.to === a.binarySha256.value))
}
function compatibleContext(source: TestRun, baseline: TestRun, project: ProjectSnapshot): boolean {
  const a = runProvenance(source), b = runProvenance(baseline)
  if (!a || !b || source.platform !== baseline.platform || source.provider !== baseline.provider
    || source.yaml !== baseline.yaml || JSON.stringify(source.params ?? {}) !== JSON.stringify(baseline.params ?? {})
    || !sameKnown(a.app.id, b.app.id) || !buildCompatible(source, baseline, project)) return false
  for (const key of ['backendEnvironment', 'testDataVersion', 'resetContractVersion'] as const)
    if (!sameKnown(a.project[key], b.project[key])) return false
  for (const key of ['os', 'driver', 'runtime', 'viewport'] as const)
    if (!sameKnown(a.environment[key], b.environment[key])) return false
  return true
}
function eligiblePostcondition(run: TestRun, tap: RunStep, flowId: string, project: ProjectSnapshot): boolean {
  const index = sourceTapIndex(run, tap)
  if (index === undefined) return false
  const registration = project.repair?.navigation.find(item => item.flow === flowId && item.stepPath === `root/${index + 1}`)
  if (!registration?.page || !registration.allowedTarget) return false
  try {
    const documents = parseAllDocuments(run.yaml)
    if (documents.length !== 2 || documents.some(document => document.errors.length)) return false
    const steps = documents[1]!.toJS({ maxAliasCount: 0 }) as unknown[]
    const post = steps[Number(registration.postconditionPath.split('/')[1]) - 1]
    return Boolean(post && typeof post === 'object' && !Array.isArray(post) && Object.keys(post).length === 1
      && ['assertVisible', 'assertNotVisible', 'assertCount', 'assertReady'].some(key => Object.hasOwn(post, key)))
  } catch { return false }
}

async function scopedNavigation(store: WorkbenchStore, run: TestRun, tap: RunStep, flowId: string,
  project: ProjectSnapshot, selector: { key: 'id' | 'accessibilityId'; value: string }): Promise<boolean> {
  const index = sourceTapIndex(run, tap)
  if (index === undefined) return false
  const registration = project.repair?.navigation.find(item => item.flow === flowId && item.stepPath === `root/${index + 1}`)
  if (!registration?.page || !registration.allowedTarget) return false
  const xml = tap.evidence.find(item => item.name === tap.tapFact?.observationFile && item.lineage?.kind === 'original'
    && item.lineage.integrity === 'verified' && !item.incomplete && !item.recovered)
  if (!xml || run.platform === 'unknown') return false
  try {
    const tree = normalizeScreenSource((await store.readEvidence(run.id, xml)).toString(), run.platform)
    if (tree.truncated) return false
    const targets = tree.nodes.filter(node => node.role === registration.allowedTarget!.role
      && node.text === registration.allowedTarget!.text && node.visible === true && node.enabled === true && !node.sensitive
      && selectorFields(node, run.platform as 'android' | 'ios')[selector.key] === selector.value)
    return targets.length === 1 && withinTrustedPage(tree, registration.page, targets[0]!)
  } catch { return false }
}

async function sameFrozenProject(store: WorkbenchStore, run: TestRun, project: ProjectSnapshot): Promise<boolean> {
  const file = run.evidence.find(item => item.name === 'plan.json' && item.lineage?.kind === 'original'
    && item.lineage.integrity === 'verified' && !item.incomplete && !item.recovered)
  if (!file || file.bytes > 2 * 1024 * 1024) return false
  try {
    const snapshot = JSON.parse((await store.readEvidence(run.id, file)).toString()) as { yaml?: unknown; project?: unknown; params?: unknown }
    return snapshot.yaml === run.yaml && stepDigest(snapshot.project) === stepDigest(project)
      && stepDigest(snapshot.params) === stepDigest(run.params ?? {})
  } catch { return false }
}

/** Full, current-project candidate admission. A successful result remains only a proposal. */
export async function admitLocatorProposal(store: WorkbenchStore, project: ProjectSnapshot, sourceRunId: string,
  baselineRunId: string, flowId: string): Promise<RepairProposal> {
  const [{ run: source }, { run: baseline }] = await Promise.all([
    store.readOnlySnapshot(sourceRunId), store.readOnlySnapshot(baselineRunId),
  ])
  const registration = repairRegistration(project)
  if (!registration || project.flows[flowId] !== source.yaml || (source.flowId && source.flowId !== flowId))
    throw new RepairError('repair-not-found')
  const scope = { projectId: registration.policy.projectId, flowId, platform: source.platform, appId: runProvenance(source)?.app.id.value ?? '' }
  assertRepairPermission(registration, 'plan', scope)
  const classified = await classifyRepairFailure(store, source)
  if (classified.kind !== 'locator-drift-candidate') throw new RepairError(classified.kind === 'evidence-gap' ? 'repair-evidence-unavailable' : 'repair-ineligible')
  const failed = source.steps.find(step => step.index === classified.stepIndex)!
  if (!eligiblePostcondition(source, failed, flowId, project) || !await sameFrozenProject(store, source, project)
    || !await sameFrozenProject(store, baseline, project) || source.steps.some(step => step !== failed && step.status === 'failed')
    || baseline.phase !== 'finished' || baseline.verdict !== 'pass' || baseline.source === 'import' || baseline.share
    || baseline.cleanup !== 'session-retained' || baseline.resourceCleanup === 'failed'
    || baseline.productContract?.verification.evidence.status !== 'pass' || !compatibleContext(source, baseline, project))
    throw new RepairError('repair-ineligible')
  const proposal = await new WorkbenchRepair(store).suggest(sourceRunId, baselineRunId)
  if (proposal.status !== 'candidate') throw new RepairError('repair-ineligible')
  const baselineTap = baseline.steps.find(step => step.kind === 'tap' && sourceTapIndex(baseline, step) === sourceTapIndex(source, failed))
  if (!baselineTap || !await scopedNavigation(store, source, failed, flowId, project, proposal.after)
    || !await scopedNavigation(store, baseline, baselineTap, flowId, project, proposal.before))
    throw new RepairError('repair-ineligible')
  return proposal
}
