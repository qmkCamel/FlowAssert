import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRepair, repairApprovalSchema, repairAttemptSchema, repairBudgetSchema, repairCaseSchema, repairExitCode,
  repairPlanSchema, repairResetSchema, repairVerificationSchema, type RepairPlan } from '../src/workbench-repair-contracts.js'
import { assertRepairPermission, repairProjectSchema, repairRegistration } from '../src/workbench-repair-project.js'
import { emptyProject, loadTestProject } from '../src/workbench-project.js'

const digest = 'a'.repeat(64), other = 'b'.repeat(64)
const now = '2026-10-03T12:00:00.000Z', later = '2026-10-03T12:30:00.000Z'
export function repairPlanFixture(): RepairPlan {
  const body = { contractVersion: 1, id: randomUUID(), caseId: randomUUID(), projectId: 'fixture', projectRevision: digest,
    route: 'locator-maintenance', sourceSnapshot: { runId: randomUUID(), manifestSha256: digest }, baselineSnapshot: { runId: randomUUID(), manifestSha256: other },
    protectedAssertionsDigest: digest, dependencyDigest: digest, paramsDigest: digest, environmentDigest: digest, resetDigest: digest, baselineBuild: digest,
    platform: 'android', appId: 'com.example.fixture', target: 'mock', targetDeviceBinding: digest,
    requiredChecks: [{ id: 'original', kind: 'baseline', inputDigest: digest }, { id: 'candidate1', kind: 'candidate', inputDigest: digest },
      { id: 'candidate2', kind: 'candidate', inputDigest: digest }, { id: 'regression', kind: 'regression', inputDigest: digest }],
    budget: repairBudgetSchema.parse({}), createdAt: now }
  return repairPlanSchema.parse({ ...body, digest: createHash('sha256').update(JSON.stringify(body)).digest('hex') })
}

describe('repair v1 contracts', () => {
  it('strictly validates all envelopes and rejects unknown versions, fields and oversize JSON', () => {
    const plan = repairPlanFixture()
    const approval = repairApprovalSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: plan.caseId, principal: 'local', channel: 'local-viewer',
      level: 'execution', planDigest: digest, patchDigest: other, projectRevision: digest, targetDeviceBinding: digest,
      allowedOperations: ['baseline', 'revalidate', 'regress'], issuedAt: now, expiresAt: later })
    const attempt = repairAttemptSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: plan.caseId, generation: 1,
      requestDigest: digest, patchDigest: other, planDigest: digest, createdAt: now, childRunIds: [], commandReceipts: [], artifactRefs: [],
      baselineRuns: 0, candidateRuns: 0, regressionRuns: 0, executionMs: 0 })
    const reset = repairResetSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: plan.caseId,
      attemptId: attempt.id, generation: 1, checkId: 'original', requestedAt: now, status: 'prepared' })
    const record = repairVerificationSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: plan.caseId, attemptId: attempt.id,
      planDigest: digest, patchDigest: other, checks: [], gaps: [], grade: 'proposal', outcome: 'candidate-only', checkedAt: now })
    const repairCase = repairCaseSchema.parse({ contractVersion: 1, id: plan.caseId, requestId: randomUUID(), requestDigest: digest, owner: 'local',
      projectId: plan.projectId, projectRevision: digest, sourceSnapshot: plan.sourceSnapshot, route: plan.route, planId: plan.id, planDigest: digest,
      phase: 'planning', revision: 1, generation: 0, attempts: [], approvals: [], verificationIds: [], budget: plan.budget, spentExecutionMs: 0,
      createdAt: now, updatedAt: now, expiresAt: later })
    for (const [schema, value] of [[repairPlanSchema, plan], [repairApprovalSchema, approval], [repairAttemptSchema, attempt], [repairResetSchema, reset],
      [repairVerificationSchema, record], [repairCaseSchema, repairCase]] as const) {
      expect(() => parseRepair(schema as typeof repairPlanSchema, value)).not.toThrow()
      expect(() => parseRepair(schema as typeof repairPlanSchema, { ...value, contractVersion: 2 })).toThrow('repair-invalid-contract')
      expect(() => parseRepair(schema as typeof repairPlanSchema, { ...value, reviewed: true })).toThrow('repair-invalid-contract')
    }
    expect(() => parseRepair(repairCaseSchema, { ...repairCase, data: 'x'.repeat(1024 * 1024) })).toThrow('repair-invalid-contract')
    expect(repairCaseSchema.safeParse({ ...repairCase, phase: 'finished' }).success).toBe(false)
    expect(repairCaseSchema.safeParse({ ...repairCase, cancelRequestedAt: now, outcome: 'device-verified' }).success).toBe(false)
    expect(repairAttemptSchema.safeParse({ ...attempt, candidateRuns: 3 }).success).toBe(false)
    expect(repairAttemptSchema.safeParse({ ...attempt, finishedAt: later }).success).toBe(false)
    expect(repairResetSchema.safeParse({ ...reset, status: 'completed' }).success).toBe(false)
    expect(repairResetSchema.safeParse({ ...reset, receipt: { namespaceId: randomUUID(), initialStateSha256: digest,
      sessionId: 'mock', observedAt: later } }).success).toBe(false)
    expect(repairVerificationSchema.safeParse({ ...record, grade: 'device' }).success).toBe(false)
  })

  it('bounds budgets and preserves the baseline and frozen repetitions', () => {
    const plan = repairPlanFixture()
    for (const values of [{ maxAttempts: 3 }, { maxRegressionCases: 21 }, { candidateRuns: 1 }, { executionMs: Infinity }, { evidenceBytes: 0 }])
      expect(repairBudgetSchema.safeParse(values).success).toBe(false)
    expect(repairPlanSchema.safeParse({ ...plan, requiredChecks: plan.requiredChecks.slice(1) }).success).toBe(false)
    expect(repairPlanSchema.safeParse({ ...plan, requiredChecks: [...plan.requiredChecks, plan.requiredChecks[0]] }).success).toBe(false)
    expect(repairPlanSchema.safeParse({ ...plan, route: 'product-code' }).success).toBe(false)
  })

  it('requires a bounded precise approval and never grants execution from a scope approval', () => {
    const value = { contractVersion: 1, id: randomUUID(), caseId: randomUUID(), principal: 'local', channel: 'local-viewer', level: 'scope',
      planDigest: digest, projectRevision: digest, targetDeviceBinding: digest, allowedOperations: ['share-evidence'], issuedAt: now, expiresAt: later }
    expect(repairApprovalSchema.safeParse(value).success).toBe(true)
    for (const change of [{ channel: 'mcp' }, { level: 'execution' }, { allowedOperations: ['revalidate'] },
      { expiresAt: now }, { expiresAt: '2026-10-04T12:00:00.000Z' }, { reviewed: true },
      { level: 'execution', patchDigest: digest, allowedOperations: ['install'] }])
      expect(repairApprovalSchema.safeParse({ ...value, ...change }).success).toBe(false)
    expect(repairApprovalSchema.safeParse({ ...value, level: 'installation', patchDigest: digest, artifactDigest: other, allowedOperations: ['install'] }).success).toBe(true)
  })

  it('does not turn software success into the default device CLI success', () => {
    expect(repairExitCode('software-verified')).toBe(1)
    expect(repairExitCode('software-verified', 'software')).toBe(0)
    expect(repairExitCode('device-verified')).toBe(0)
    expect(repairExitCode('cancelled')).toBe(130)
    for (const outcome of ['candidate-only', 'not-fixed', 'blocked', 'inconclusive', 'budget-exhausted'] as const)
      expect(repairExitCode(outcome, 'software')).toBe(1)
  })
})

describe('host-only repair registration', () => {
  const scope = { projectId: 'fixture', flowId: 'navigation', platform: 'android', appId: 'com.example.fixture' }
  const config = { enabled: true, projectId: 'fixture', permissions: ['plan'], allowedFlows: ['navigation'],
    allowedPlatforms: ['android'], allowedAppIds: ['com.example.fixture'], navigation: [{ flow: 'navigation', stepPath: 'root/1', postconditionPath: 'root/2' }] }

  it('is disabled by omission and requires independent grants and scope intersections', () => {
    const project = emptyProject()
    expect(repairRegistration(project)).toBeUndefined()
    expect(() => assertRepairPermission(undefined, 'plan', scope)).toThrow('repair-not-found')
    project.flows.navigation = 'unchanged flow'
    project.repair = repairProjectSchema.parse(config)
    const registration = repairRegistration(project)!
    expect(() => assertRepairPermission(registration, 'plan', scope)).not.toThrow()
    expect(() => assertRepairPermission(registration, 'verify', scope)).toThrow('repair-not-found')
    for (const change of [{ projectId: 'other' }, { flowId: 'other' }, { platform: 'ios' }, { appId: 'com.other' }])
      expect(() => assertRepairPermission(registration, 'plan', { ...scope, ...change })).toThrow('repair-not-found')
    expect(() => assertRepairPermission(registration, 'plan', { ...scope, revision: other })).toThrow('repair-project-changed')
    expect(repairProjectSchema.safeParse({ ...config, agentTestControl: { enabled: true } }).success).toBe(false)
    expect(repairProjectSchema.safeParse({ ...config, navigation: [{ flow: 'navigation', stepPath: 'root/2', postconditionPath: 'root/1' }] }).success).toBe(false)
    project.repair.enabled = false
    expect(() => assertRepairPermission(repairRegistration(project), 'plan', scope)).toThrow('repair-not-found')
  })

  it('loads only host configuration and changes revision with executable input or policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'repair-project-'))
    try {
      const path = join(root, 'project.json')
      await writeFile(join(root, 'flow.yaml'), 'first')
      await writeFile(path, JSON.stringify({ flows: { navigation: 'flow.yaml' }, repair: config }))
      const first = repairRegistration(await loadTestProject(path))!
      await writeFile(join(root, 'flow.yaml'), 'second')
      const second = repairRegistration(await loadTestProject(path))!
      expect(first.revision).not.toBe(second.revision)
      await writeFile(path, JSON.stringify({ flows: { navigation: 'flow.yaml' }, repair: { ...config, permissions: ['plan', 'verify'] } }))
      expect(repairRegistration(await loadTestProject(path))!.revision).not.toBe(second.revision)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
