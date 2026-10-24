import { compilePlan, type PlanNode } from './workbench-plan.js'
import { loadTestProject, type ProjectSnapshot } from './workbench-project.js'
import { PreflightInputError, type EnvironmentPreflightContext } from './environment-preflight.js'
import type { Config } from './config.js'
import { createHash } from 'node:crypto'

export interface PreflightProject { project: ProjectSnapshot; ocr: Set<string>; recovery: Set<string> }
export async function resolvePreflightProject(context: EnvironmentPreflightContext, config: Config, signal: AbortSignal): Promise<PreflightProject> {
  const policy = config.agentTestControl
  if (!context.testRef || !policy?.projectPath) throw new PreflightInputError()
  const [kind, id] = context.testRef.split(':') as [string, string]
  if ((context.entry === 'mcp' || context.entry === 'dsh') && (!policy.enabled || !(kind === 'flow' ? policy.allowedFlows : policy.allowedSuites).includes(id))) throw new PreflightInputError()
  signal.throwIfAborted()
  const project = await loadTestProject(policy.projectPath, signal)
  const suite = kind === 'suite' ? project.suites[id] : undefined
  if (kind === 'suite' && !suite) throw new PreflightInputError()
  const entries = suite ? suite.cases.flatMap(item => {
    const rows = item.dataset ? project.datasets[item.dataset] : [{ params: {} }]
    if (!rows) throw new PreflightInputError()
    return rows.map(row => ({ flow: item.flow, params: { ...suite.params, ...item.params, ...row.params } }))
  }) : [{ flow: id, params: {} }]
  if (!entries.length || entries.length > 100) throw new PreflightInputError()
  const platforms = new Set<'android' | 'ios'>(), ocr = new Set<string>(), recovery = new Set<string>()
  const visit = (nodes: PlanNode[]) => { for (const node of nodes) {
    if (node.kind === 'ocr') ocr.add(node.profile)
    if (node.kind === 'recover') recovery.add(node.policy)
    if (node.kind === 'if') { visit(node.then); visit(node.else) }
    if (node.kind === 'repeat' || node.kind === 'measure') visit(node.steps)
  } }
  for (const entry of entries) {
    signal.throwIfAborted()
    const yaml = project.flows[entry.flow]
    if (!yaml) throw new PreflightInputError()
    const plan = await compilePlan(yaml, project, entry.params, signal)
    if ((context.entry === 'mcp' || context.entry === 'dsh') && (!policy.allowedPlatforms.includes(plan.header.platform) || !policy.allowedAppIds.includes(plan.header.appId))) throw new PreflightInputError()
    platforms.add(plan.header.platform); visit(plan.nodes)
  }
  const platform = platforms.size > 1 ? 'all' : [...platforms][0]!
  if (context.platform !== 'none' && context.platform !== platform) throw new PreflightInputError()
  context.provider = context.provider === 'none' ? config.defaultProvider : context.provider
  context.platform = context.provider === 'mock' ? 'none' : platform
  context.revision = createHash('sha256').update(`${context.revision ?? ''}:${project.sha256}`).digest('hex')
  if (ocr.size) context.features.ocr = 'required'
  if (recovery.size) context.features['ai-recovery'] = 'required'
  return { project, ocr, recovery }
}
