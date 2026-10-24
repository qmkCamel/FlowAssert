import { createHash } from 'node:crypto'
import { z } from 'zod'
import { RepairError, repairBudgetSchema, repairDigest, repairName } from './workbench-repair-contracts.js'
import { repairSourceRegistrationSchema } from './workbench-repair-source.js'
import type { ProjectSnapshot } from './workbench-project.js'
import { trustedPageScopeSchema } from './workbench-page-scope.js'

const permission = z.enum(['plan', 'submit', 'verify', 'cancel'])
const appId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/)
const unique = <T extends z.ZodTypeAny>(schema: T, max: number) => z.array(schema).max(max).refine(values => new Set(values).size === values.length, 'Duplicate grant')
const targetScope = z.object({ role: z.enum(['application', 'button', 'checkbox', 'image', 'input', 'link', 'list', 'list-item', 'scroll-view', 'switch', 'text']),
  text: z.string().min(1).max(128) }).strict()

/** Read only through the host's local project file, never from tool/HTTP arguments. */
export const repairProjectSchema = z.object({
  enabled: z.boolean().default(false), projectId: repairName,
  permissions: unique(permission, 4).default([]),
  allowedFlows: unique(repairName, 100).default([]),
  allowedPlatforms: unique(z.enum(['android', 'ios']), 2).default([]),
  allowedAppIds: unique(appId, 100).default([]),
  navigation: z.array(z.object({ flow: repairName, stepPath: z.string().regex(/^root\/[1-9]\d{0,3}$/),
    postconditionPath: z.string().regex(/^root\/[1-9]\d{0,3}$/), page: trustedPageScopeSchema.optional(), allowedTarget: targetScope.optional() }).strict()).max(100).default([]),
  compatibleBuilds: z.array(z.object({ from: repairDigest, to: repairDigest }).strict()).max(100).default([]),
  source: repairSourceRegistrationSchema.optional(),
  regressionFlows: unique(repairName, 20).default([]),
  budget: repairBudgetSchema.prefault({}),
}).strict().superRefine((config, ctx) => {
  if (config.enabled && (!config.allowedFlows.length || !config.allowedPlatforms.length || !config.allowedAppIds.length))
    ctx.addIssue({ code: 'custom', message: 'Enabled repair needs explicit flow/platform/App scope' })
  const keys = config.navigation.map(item => `${item.flow}:${item.stepPath}`)
  if (new Set(keys).size !== keys.length || config.navigation.some(item => !config.allowedFlows.includes(item.flow)
    || Number(item.postconditionPath.split('/')[1]) <= Number(item.stepPath.split('/')[1])))
    ctx.addIssue({ code: 'custom', message: 'Navigation needs a unique in-scope step and later postcondition' })
})
export type RepairProjectPolicy = z.infer<typeof repairProjectSchema>
export interface RepairProjectRegistration { policy: RepairProjectPolicy; revision: string }

/** Snapshot identity binds configuration and all currently loaded executable project inputs. */
export function repairRegistration(project: ProjectSnapshot): RepairProjectRegistration | undefined {
  if (!project.repair) return undefined
  const policy = repairProjectSchema.parse(project.repair)
  if ([...policy.allowedFlows, ...policy.regressionFlows].some(id => !Object.hasOwn(project.flows, id))) throw new RepairError('repair-project-changed')
  const { sha256: _declared, ...executable } = project
  return { policy, revision: createHash('sha256').update(JSON.stringify({ project: executable, policy })).digest('hex') }
}

/** A legacy agentTestControl grant is deliberately not an input to this decision. */
export function assertRepairPermission(registration: RepairProjectRegistration | undefined,
  operation: z.infer<typeof permission>, scope: { projectId: string; flowId: string; platform: string; appId: string; revision?: string }): asserts registration is RepairProjectRegistration {
  const policy = registration?.policy
  if (!policy?.enabled || policy.projectId !== scope.projectId || !policy.permissions.includes(operation)
    || !policy.allowedFlows.includes(scope.flowId) || !policy.allowedPlatforms.some(platform => platform === scope.platform)
    || !policy.allowedAppIds.includes(scope.appId)) throw new RepairError('repair-not-found')
  if (scope.revision !== undefined && registration!.revision !== scope.revision) throw new RepairError('repair-project-changed')
}
