import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { evaluateLocatorVerification } from '../src/workbench-repair-verification.js'
import { repairExitCode, repairPlanSchema, type RepairCheckReceipt } from '../src/workbench-repair-contracts.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
function fixture(target: 'mock' | 'simulator' | 'physical' = 'mock') {
  const caseId = randomUUID(), planId = randomUUID(), attemptId = randomUUID(), patchDigest = digest('patch')
  const requiredChecks = ['original', 'candidate1', 'candidate2', 'regression1'].map((id, index) =>
    ({ id, kind: (index === 0 ? 'baseline' : index === 3 ? 'regression' : 'candidate') as 'baseline' | 'candidate' | 'regression', inputDigest: digest(id) }))
  const body = { contractVersion: 1 as const, id: planId, caseId, projectId: 'sample', projectRevision: digest('revision'),
    route: 'locator-maintenance' as const, sourceSnapshot: { runId: randomUUID(), manifestSha256: digest('source') },
    baselineSnapshot: { runId: randomUUID(), manifestSha256: digest('baseline') },
    protectedAssertionsDigest: digest('assertions'), dependencyDigest: digest('dependencies'), paramsDigest: digest('params'),
    environmentDigest: digest('environment'), resetDigest: digest('reset'), baselineBuild: digest('build'), platform: 'ios' as const,
    appId: 'com.example.app', target, targetDeviceBinding: digest('device'), requiredChecks,
    budget: { maxAttempts: 2, baselineRuns: 1 as const, candidateRuns: 2 as const, maxRegressionCases: 20, executionMs: 600000,
      approvalMs: 1800000, lifetimeMs: 86400000, evidenceBytes: 67108864 }, createdAt: new Date().toISOString() }
  const plan = repairPlanSchema.parse({ ...body, digest: digest(JSON.stringify(body)) })
  const checks: RepairCheckReceipt[] = plan.requiredChecks.map((check, index) => ({ checkId: check.id, inputDigest: check.inputDigest,
    planDigest: plan.digest, patchDigest, status: index === 0 ? 'fail' : 'pass', origin: target, evidenceRefs: [`evidence-${index}`],
    evidenceVerified: true, cleanupPassed: true, recovered: false, runId: randomUUID(), namespaceDigest: digest(`namespace-${index}`),
    targetDeviceBinding: plan.targetDeviceBinding, ...(index === 0 ? { failureFingerprint: digest('same-failure') } : {}),
    checkedAt: new Date().toISOString() }))
  return { plan, checks, attemptId, patchDigest }
}

describe('frozen locator verification', () => {
  it('separates Mock software and attested physical grades from default CLI success', () => {
    const mock = fixture(), software = evaluateLocatorVerification(mock.plan, mock.attemptId, mock.patchDigest, digest('same-failure'), mock.checks)
    expect(software.outcome).toBe('software-verified')
    expect(repairExitCode(software.outcome)).toBe(1)
    expect(repairExitCode(software.outcome, 'software')).toBe(0)
    const physical = fixture('physical'), device = evaluateLocatorVerification(physical.plan, physical.attemptId, physical.patchDigest, digest('same-failure'), physical.checks)
    expect(device.outcome).toBe('device-verified')
    expect(repairExitCode(device.outcome)).toBe(0)
  })
  it.each(['missing', 'recovered', 'cleanup', 'namespace', 'evidence', 'origin', 'fingerprint', 'failed', 'skipped'] as const)(
    '%s cannot be verified', defect => {
      const { plan, checks, attemptId, patchDigest } = fixture()
      if (defect === 'missing') checks.pop()
      if (defect === 'recovered') checks[1]!.recovered = true
      if (defect === 'cleanup') checks[1]!.cleanupPassed = false
      if (defect === 'namespace') checks[1]!.namespaceDigest = checks[2]!.namespaceDigest
      if (defect === 'evidence') checks[1]!.evidenceVerified = false
      if (defect === 'origin') checks[1]!.origin = 'physical'
      if (defect === 'fingerprint') checks[0]!.failureFingerprint = digest('different')
      if (defect === 'failed') checks[1]!.status = 'fail'
      if (defect === 'skipped') checks[1]!.status = 'not-performed'
      const result = evaluateLocatorVerification(plan, attemptId, patchDigest, digest('same-failure'), checks)
      expect(['software-verified', 'device-verified']).not.toContain(result.outcome)
      expect(repairExitCode(result.outcome, 'software')).toBe(1)
    })
  it('rejects extra, duplicate and changed required checks', () => {
    const { plan, checks, attemptId, patchDigest } = fixture()
    expect(() => evaluateLocatorVerification(plan, attemptId, patchDigest, digest('same-failure'), [...checks, checks[0]!])).toThrow('repair-invalid-contract')
    expect(() => evaluateLocatorVerification(plan, attemptId, patchDigest, digest('same-failure'), [{ ...checks[0]!, inputDigest: digest('changed') }, ...checks.slice(1)])).toThrow('repair-invalid-contract')
  })
})
