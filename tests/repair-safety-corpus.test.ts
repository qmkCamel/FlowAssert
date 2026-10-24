import { createHash, randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { assertLocatorOnlyDiff } from '../src/workbench-repair-diff.js'
import { evaluateLocatorVerification } from '../src/workbench-repair-verification.js'
import { repairPlanSchema, type RepairCheckReceipt } from '../src/workbench-repair-contracts.js'

/** Frozen synthetic contract corpus v1. These are not real-device effectiveness samples. */
const drift = [
  'account-entry', 'cart-entry', 'checkout-entry', 'search-entry', 'filter-entry',
  'details-entry', 'help-entry', 'history-entry', 'settings-entry', 'profile-entry',
  'inbox-entry', 'notification-entry', 'address-entry', 'coupon-entry', 'catalog-entry',
  'category-entry', 'wishlist-entry', 'tracking-entry', 'payment-entry', 'confirmation-entry',
] as const
const productDefects = [
  'wrong-total', 'missing-order', 'stale-cart', 'duplicate-payment', 'auth-rejected',
  'missing-search-result', 'wrong-address', 'invalid-discount', 'delayed-confirmation', 'lost-upload',
  'empty-profile', 'missing-message', 'incorrect-filter', 'wrong-currency', 'failed-refund',
  'unavailable-inventory', 'wrong-language', 'broken-deep-link', 'missing-permission', 'stale-session',
] as const
const counterexamples = [
  'missing-check', 'recovered-step', 'failed-cleanup', 'reused-namespace', 'unverified-evidence',
  'wrong-origin', 'different-failure', 'skipped-candidate', 'missing-run-id', 'missing-evidence-ref',
  'wrong-device-binding', 'missing-namespace', 'inconclusive-candidate', 'skipped-regression', 'baseline-passes',
  'duplicate-check', 'changed-check-input', 'changed-plan', 'changed-patch', 'unknown-check',
] as const
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function fixture(name: string) {
  const caseId = randomUUID(), attemptId = randomUUID(), patchDigest = digest(`patch:${name}`)
  const requiredChecks = ['baseline', 'candidate1', 'candidate2', 'regression'].map((id, index) => ({ id,
    kind: (index === 0 ? 'baseline' : index === 3 ? 'regression' : 'candidate') as 'baseline' | 'candidate' | 'regression',
    inputDigest: digest(`${name}:${id}`) }))
  const body = { contractVersion: 1 as const, id: randomUUID(), caseId, projectId: 'synthetic', projectRevision: digest(name),
    route: 'locator-maintenance' as const, sourceSnapshot: { runId: randomUUID(), manifestSha256: digest('source') },
    baselineSnapshot: { runId: randomUUID(), manifestSha256: digest('anchor') }, protectedAssertionsDigest: digest('oracle'),
    dependencyDigest: digest('dependencies'), paramsDigest: digest('params'), environmentDigest: digest('environment'),
    resetDigest: digest('reset'), baselineBuild: digest('build'), platform: 'ios' as const, appId: 'com.example.fixture',
    target: 'mock' as const, targetDeviceBinding: digest('mock-device'), requiredChecks,
    budget: { maxAttempts: 2, baselineRuns: 1 as const, candidateRuns: 2 as const, maxRegressionCases: 20,
      executionMs: 600000, approvalMs: 1800000, lifetimeMs: 86400000, evidenceBytes: 67108864 },
    createdAt: '2026-10-04T00:00:00.000Z' }
  const plan = repairPlanSchema.parse({ ...body, digest: digest(JSON.stringify(body)) })
  const checks: RepairCheckReceipt[] = plan.requiredChecks.map((check, index) => ({ checkId: check.id,
    inputDigest: check.inputDigest, planDigest: plan.digest, patchDigest, status: index === 0 ? 'fail' : 'pass',
    origin: 'mock', evidenceRefs: [`evidence-${name}-${index}`], evidenceVerified: true, cleanupPassed: true,
    recovered: false, runId: randomUUID(), namespaceDigest: digest(`${name}:namespace:${index}`),
    targetDeviceBinding: plan.targetDeviceBinding, ...(index === 0 ? { failureFingerprint: digest(`${name}:missing`) } : {}),
    checkedAt: '2026-10-04T00:00:01.000Z' }))
  return { plan, checks, attemptId, patchDigest, failureFingerprint: digest(`${name}:missing`) }
}

it('freezes 20 drift / 20 product defect / 20 safety counterexamples without false verification', () => {
  expect(new Set([...drift, ...productDefects, ...counterexamples]).size).toBe(60)
  const report = { driftSuccess: 0, driftAbstain: 0, defectNotFixed: 0, defectFalseRepair: 0,
    counterAbstain: 0, counterFalseRepair: 0 }
  for (const [index, name] of drift.entries()) {
    const oldId = `old-${index}-${name}`, nextId = `next-${index}-${name}`
    const before = `name: ${name}\nplatform: ios\nappId: com.example.fixture\n---\n- tap: {accessibilityId: ${oldId}}\n- assertVisible: {text: Ready}\n`
    const after = before.replace(oldId, nextId)
    expect(() => assertLocatorOnlyDiff(before, after, 0), name).not.toThrow()
    const { plan, checks, attemptId, patchDigest, failureFingerprint } = fixture(name)
    const outcome = evaluateLocatorVerification(plan, attemptId, patchDigest, failureFingerprint, checks).outcome
    if (outcome === 'software-verified') report.driftSuccess++; else report.driftAbstain++
    expect(outcome, name).toBe('software-verified')
  }
  for (const name of productDefects) {
    const { plan, checks, attemptId, patchDigest, failureFingerprint } = fixture(name)
    checks[1]!.status = 'fail'
    const outcome = evaluateLocatorVerification(plan, attemptId, patchDigest, failureFingerprint, checks).outcome
    if (outcome === 'not-fixed') report.defectNotFixed++; else if (outcome.endsWith('verified')) report.defectFalseRepair++
    expect(outcome, name).toBe('not-fixed')
  }
  for (const name of counterexamples) {
    const { plan, checks, attemptId, patchDigest, failureFingerprint } = fixture(name)
    switch (name) {
      case 'missing-check': checks.pop(); break
      case 'recovered-step': checks[1]!.recovered = true; break
      case 'failed-cleanup': checks[1]!.cleanupPassed = false; break
      case 'reused-namespace': checks[1]!.namespaceDigest = checks[2]!.namespaceDigest; break
      case 'unverified-evidence': checks[1]!.evidenceVerified = false; break
      case 'wrong-origin': checks[1]!.origin = 'physical'; break
      case 'different-failure': checks[0]!.failureFingerprint = digest('not-the-source'); break
      case 'skipped-candidate': checks[1]!.status = 'not-performed'; break
      case 'missing-run-id': delete checks[1]!.runId; break
      case 'missing-evidence-ref': checks[1]!.evidenceRefs = []; break
      case 'wrong-device-binding': checks[1]!.targetDeviceBinding = digest('other-device'); break
      case 'missing-namespace': delete checks[1]!.namespaceDigest; break
      case 'inconclusive-candidate': checks[1]!.status = 'inconclusive'; break
      case 'skipped-regression': checks[3]!.status = 'not-performed'; break
      case 'baseline-passes': checks[0]!.status = 'pass'; break
      case 'duplicate-check': checks.push({ ...checks[0]! }); break
      case 'changed-check-input': checks[1]!.inputDigest = digest('tampered-input'); break
      case 'changed-plan': checks[1]!.planDigest = digest('tampered-plan'); break
      case 'changed-patch': checks[1]!.patchDigest = digest('tampered-patch'); break
      case 'unknown-check': checks[1]!.checkId = 'unknown-check'; break
    }
    let outcome: string
    try { outcome = evaluateLocatorVerification(plan, attemptId, patchDigest, failureFingerprint, checks).outcome }
    catch { outcome = 'rejected' }
    if (outcome === 'rejected' || outcome === 'inconclusive') report.counterAbstain++
    else if (outcome.endsWith('verified')) report.counterFalseRepair++
    expect(['rejected', 'inconclusive'], name).toContain(outcome)
  }
  expect(report).toEqual({ driftSuccess: 20, driftAbstain: 0, defectNotFixed: 20, defectFalseRepair: 0,
    counterAbstain: 20, counterFalseRepair: 0 })
})
