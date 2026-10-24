import { sha256 } from './content-hash.js'
import { RepairError, repairCandidateSchema, repairPlanSchema, type RepairCandidate, type RepairPlan } from './workbench-repair-contracts.js'
import { assertLocatorOnlyDiff } from './workbench-repair-diff.js'
import { assertFrozenPlan } from './workbench-repair-freeze.js'
import { repairRegistration } from './workbench-repair-project.js'
import { sourceTapIndex } from './workbench-repair-evidence.js'
import { compilePlan, type ExecutionPlan } from './workbench-plan.js'
import type { ProjectSnapshot } from './workbench-project.js'
import type { TestRun } from './workbench-domain.js'

/** Derive an in-memory, case-private flow. Caller input never supplies executable YAML. */
export async function compilePrivateLocatorCandidate(plan: RepairPlan, candidate: RepairCandidate,
  source: TestRun, project: ProjectSnapshot): Promise<{ flowId: string; project: ProjectSnapshot; execution: ExecutionPlan }> {
  repairPlanSchema.parse(plan); repairCandidateSchema.parse(candidate)
  if (plan.route !== 'locator-maintenance' || plan.sourceSnapshot.runId !== source.id
    || candidate.sourceRunId !== source.id || source.yaml !== project.flows[source.flowId ?? '']
    || candidate.sourcePlanDigest !== (source.comparison?.planDigest ?? sha256(source.yaml)))
    throw new RepairError('repair-project-changed')
  assertFrozenPlan(plan, source, project)
  const original = source.steps.find(step => step.index === candidate.stepIndex && step.kind === 'tap')
  const sourceIndex = original ? sourceTapIndex(source, original) : undefined
  if (sourceIndex === undefined) throw new RepairError('repair-ineligible')
  try { assertLocatorOnlyDiff(source.yaml, candidate.yaml, sourceIndex) }
  catch { throw new RepairError('repair-invalid-patch') }
  const registration = repairRegistration(project)
  const originalEntry = registration?.policy.navigation.find(item => item.flow === source.flowId && item.stepPath === `root/${sourceIndex + 1}`)
  if (!registration?.policy.enabled || !originalEntry?.page || !originalEntry.allowedTarget
    || registration.policy.allowedFlows.length >= 100 || registration.policy.navigation.length >= 100)
    throw new RepairError('repair-ineligible')
  const flowId = `repairCandidate_${plan.caseId.replaceAll('-', '')}`
  if (Object.hasOwn(project.flows, flowId)) throw new RepairError('repair-project-changed')
  const privateProject = structuredClone(project)
  privateProject.flows[flowId] = candidate.yaml
  privateProject.repair!.allowedFlows.push(flowId)
  privateProject.repair!.navigation.push({ ...originalEntry, flow: flowId })
  privateProject.sha256 = sha256(JSON.stringify({ ...privateProject, sha256: undefined }))
  const execution = await compilePlan(candidate.yaml, privateProject, source.params ?? {})
  if (execution.header.platform !== plan.platform || execution.header.appId !== plan.appId)
    throw new RepairError('repair-invalid-patch')
  return { flowId, project: privateProject, execution }
}
