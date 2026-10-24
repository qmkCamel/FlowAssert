import { randomUUID } from 'node:crypto'
import { parseAllDocuments } from 'yaml'
import { sha256 } from './content-hash.js'
import { RepairError, repairPlanSchema, type RepairPlan } from './workbench-repair-contracts.js'
import { repairRegistration } from './workbench-repair-project.js'
import { stepDigest } from './workbench-tap-facts.js'
import { compilePlan } from './workbench-plan.js'
import type { RepairProposal } from './workbench-repair.js'
import type { ProjectSnapshot } from './workbench-project.js'
import type { TestRun } from './workbench-domain.js'
import type { WorkbenchStore } from './workbench-store.js'

function protectedPlan(yaml: string): unknown {
  const docs = parseAllDocuments(yaml)
  if (docs.length !== 2 || docs.some(doc => doc.errors.length)) throw new RepairError('repair-dependency-unresolved')
  const steps = docs[1]!.toJS({ maxAliasCount: 0 })
  if (!Array.isArray(steps)) throw new RepairError('repair-dependency-unresolved')
  return [docs[0]!.toJS({ maxAliasCount: 0 }), steps.map(step => {
    if (!step || typeof step !== 'object' || Object.keys(step).length !== 1 || !('tap' in step)) return step
    const selector = step.tap
    if (!selector || typeof selector !== 'object' || Object.keys(selector).length !== 1) return step
    const key = Object.keys(selector)[0]!
    return ['id', 'accessibilityId'].includes(key) ? { tap: { [key]: '<frozen-navigation-locator>' } } : step
  })]
}

function projectDependencies(project: ProjectSnapshot) {
  const { sha256: _ignored, ...executable } = project
  return stepDigest(executable)
}

function requireKnown(value: { value: string } | undefined) {
  if (!value || value.value === 'unknown') throw new RepairError('repair-dependency-unresolved')
  return value.value
}

function fingerprints(source: TestRun, project: ProjectSnapshot) {
  const provenance = source.productContract?.provenance
  if (!provenance) throw new RepairError('repair-dependency-unresolved')
  const reset = requireKnown(provenance.project.resetContractVersion)
  const backend = requireKnown(provenance.project.backendEnvironment)
  const data = requireKnown(provenance.project.testDataVersion)
  const build = requireKnown(provenance.app.build)
  return {
    protectedAssertionsDigest: stepDigest(protectedPlan(source.yaml)),
    dependencyDigest: projectDependencies(project),
    paramsDigest: stepDigest(source.params ?? {}),
    environmentDigest: stepDigest({ backend, data, platform: source.platform, provider: source.provider,
      os: requireKnown(provenance.environment.os), driver: requireKnown(provenance.environment.driver),
      viewport: requireKnown(provenance.environment.viewport), runtime: requireKnown(provenance.environment.runtime) }),
    resetDigest: stepDigest({ reset, project: project.sha256 }),
    baselineBuild: stepDigest({ build, binary: provenance.app.binarySha256.value, appId: provenance.app.id.value }),
  }
}

function unresolvedDynamic(project: ProjectSnapshot, flows: string[]): boolean {
  const dynamic = /\{\{\s*outputs\.|\$\{|\b(?:Date\.now|Math\.random|process\.env)\b/
  return flows.some(yaml => dynamic.test(yaml)) || Object.values(project.extensions).some(extension =>
    Object.keys(extension.credentials).length > 0 || dynamic.test(extension.source))
}

/** Freeze only fully declared inputs. A later change requires a new plan and approval. */
export async function freezeLocatorPlan(store: WorkbenchStore, project: ProjectSnapshot, proposal: RepairProposal,
  caseId: string, flowId: string): Promise<RepairPlan> {
  const registration = repairRegistration(project)
  if (!registration?.policy.enabled || project.flows[flowId] === undefined || !registration.policy.regressionFlows.length
    || registration.policy.regressionFlows.includes(flowId))
    throw new RepairError('repair-dependency-unresolved')
  const snapshots = await Promise.all([store.readOnlySnapshot(proposal.sourceRunId), store.readOnlySnapshot(proposal.baselineRunId)])
  const source = snapshots[0]!.run, baseline = snapshots[1]!.run
  if (source.yaml !== project.flows[flowId] || baseline.yaml !== source.yaml
    || snapshots[0]!.manifestSha256 !== proposal.sourceManifestSha256
    || snapshots[1]!.manifestSha256 !== proposal.baselineManifestSha256) throw new RepairError('repair-project-changed')
  const flowYamls = [source.yaml, ...registration.policy.regressionFlows.map(id => project.flows[id]!)]
  if (unresolvedDynamic(project, flowYamls)) throw new RepairError('repair-dependency-unresolved')
  for (const yaml of flowYamls) {
    const compiled = await compilePlan(yaml, project, yaml === source.yaml ? source.params ?? {} : {})
    if (compiled.header.platform !== source.platform || compiled.header.appId !== source.productContract?.provenance.app.id.value)
      throw new RepairError('repair-dependency-unresolved')
  }
  const frozen = fingerprints(source, project)
  const checks = [
    { id: 'original', kind: 'baseline' as const, inputDigest: stepDigest({ flowId, ...frozen }) },
    { id: 'candidate1', kind: 'candidate' as const, inputDigest: stepDigest({ flowId, candidate: proposal.digest, repeat: 1, ...frozen }) },
    { id: 'candidate2', kind: 'candidate' as const, inputDigest: stepDigest({ flowId, candidate: proposal.digest, repeat: 2, ...frozen }) },
    ...registration.policy.regressionFlows.map((id, index) => ({ id: `regression${index + 1}`, kind: 'regression' as const,
      inputDigest: stepDigest({ id, yaml: project.flows[id], ...frozen }) })),
  ]
  const body = { contractVersion: 1 as const, id: randomUUID(), caseId, projectId: registration.policy.projectId,
    projectRevision: registration.revision, route: 'locator-maintenance' as const,
    sourceSnapshot: { runId: source.id, manifestSha256: snapshots[0]!.manifestSha256 },
    baselineSnapshot: { runId: baseline.id, manifestSha256: snapshots[1]!.manifestSha256 },
    ...frozen, platform: source.platform, appId: source.productContract!.provenance.app.id.value,
    // Appium's owned session does not itself attest whether it is a physical device.
    target: source.provider === 'mock' ? 'mock' as const : 'simulator' as const,
    targetDeviceBinding: stepDigest({ sessionId: source.sessionId, provider: source.provider, platform: source.platform, device: source.deviceName }),
    requiredChecks: checks, budget: registration.policy.budget, createdAt: new Date().toISOString() }
  return repairPlanSchema.parse({ ...body, digest: sha256(JSON.stringify(body)) })
}

/** Code repair freezes software commands separately from post-install mobile flows. */
export async function freezeCodePlan(store: WorkbenchStore, project: ProjectSnapshot,
  sourceRunId: string, caseId: string, flowId: string, repositoryId: string): Promise<RepairPlan> {
  const registration = repairRegistration(project), sourcePolicy = registration?.policy.source
  if (!registration?.policy.enabled || !sourcePolicy || sourcePolicy.repositoryId !== repositoryId
    || project.flows[flowId] === undefined)
    throw new RepairError('repair-capability-unavailable')
  const snapshot = await store.readOnlySnapshot(sourceRunId), source = snapshot.run
  if (source.verdict !== 'fail' || source.phase !== 'finished' || source.yaml !== project.flows[flowId]
    || source.source === 'import' || source.share) throw new RepairError('repair-ineligible')
  const mobileRegressionFlows = registration.policy.regressionFlows
  if (sourcePolicy.builds.length && (!mobileRegressionFlows.length || mobileRegressionFlows.includes(flowId)))
    throw new RepairError('repair-dependency-unresolved')
  const flowYamls = [source.yaml, ...mobileRegressionFlows.map(id => project.flows[id]!)]
  if (unresolvedDynamic(project, flowYamls)) throw new RepairError('repair-dependency-unresolved')
  for (const yaml of flowYamls) {
    const compiled = await compilePlan(yaml, project, yaml === source.yaml ? source.params ?? {} : {})
    if (compiled.header.platform !== source.platform || compiled.header.appId !== source.productContract?.provenance.app.id.value)
      throw new RepairError('repair-dependency-unresolved')
  }
  const frozen = fingerprints(source, project)
  const sourceDigest = stepDigest({ repositoryId, baseCommit: sourcePolicy.baseCommit,
    checks: sourcePolicy.checks, regressionChecks: sourcePolicy.regressionChecks,
    oracleRoot: sourcePolicy.oracleRoot })
  const checks = [
    { id: 'software', kind: 'software' as const, inputDigest: sourceDigest },
    { id: 'original', kind: 'baseline' as const, inputDigest: stepDigest({ flowId, ...frozen, sourceDigest }) },
    { id: 'candidate1', kind: 'candidate' as const, inputDigest: stepDigest({ flowId, ...frozen, sourceDigest, repeat: 1 }) },
    { id: 'candidate2', kind: 'candidate' as const, inputDigest: stepDigest({ flowId, ...frozen, sourceDigest, repeat: 2 }) },
    ...mobileRegressionFlows.map((id, index) => ({ id: `regression${index + 1}`,
      kind: 'regression' as const, inputDigest: stepDigest({ id, yaml: project.flows[id], ...frozen, sourceDigest }) })),
  ]
  const body = { contractVersion: 1 as const, id: randomUUID(), caseId,
    projectId: registration.policy.projectId, projectRevision: registration.revision,
    route: 'product-code' as const, sourceSnapshot: { runId: source.id, manifestSha256: snapshot.manifestSha256 },
    ...frozen, platform: source.platform, appId: source.productContract!.provenance.app.id.value,
    target: source.provider === 'mock' ? 'mock' as const : 'simulator' as const,
    targetDeviceBinding: stepDigest({ sessionId: source.sessionId, provider: source.provider,
      platform: source.platform, device: source.deviceName }),
    requiredChecks: checks, budget: registration.policy.budget, createdAt: new Date().toISOString() }
  return repairPlanSchema.parse({ ...body, digest: sha256(JSON.stringify(body)) })
}

export function assertFrozenPlan(plan: RepairPlan, source: TestRun, project: ProjectSnapshot): void {
  const registration = repairRegistration(project)
  if (!registration || registration.revision !== plan.projectRevision || plan.dependencyDigest !== projectDependencies(project)
    || Object.entries(fingerprints(source, project)).some(([key, digest]) => plan[key as keyof RepairPlan] !== digest)
    || plan.protectedAssertionsDigest !== stepDigest(protectedPlan(source.yaml))) throw new RepairError('repair-project-changed')
}
