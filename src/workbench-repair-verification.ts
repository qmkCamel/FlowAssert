import { randomUUID } from 'node:crypto'
import { RepairError, repairVerificationSchema, type RepairCheckReceipt, type RepairPlan, type RepairVerification } from './workbench-repair-contracts.js'

/** A pure, fail-closed projection. Only the coordinator may supply receipts made from verified local runs. */
export function evaluateLocatorVerification(plan: RepairPlan, attemptId: string, patchDigest: string,
  sourceFailureFingerprint: string, checks: RepairCheckReceipt[]): RepairVerification {
  if (plan.route !== 'locator-maintenance' || !/^[a-f0-9]{64}$/.test(patchDigest)
    || !/^[a-f0-9]{64}$/.test(sourceFailureFingerprint)) throw new RepairError('repair-invalid-contract')
  const expected = new Map(plan.requiredChecks.map(check => [check.id, check]))
  const seen = new Set<string>(), usedRuns = new Set<string>(), namespaces = new Set<string>()
  let evidenceGap = false, notReproduced = false, candidateFailed = false, identityGap = false
  for (const receipt of checks) {
    const frozen = expected.get(receipt.checkId)
    if (!frozen || seen.has(receipt.checkId) || receipt.inputDigest !== frozen.inputDigest
      || receipt.planDigest !== plan.digest || receipt.patchDigest !== patchDigest)
      throw new RepairError('repair-invalid-contract')
    seen.add(receipt.checkId)
    if (receipt.runId && usedRuns.has(receipt.runId)) throw new RepairError('repair-invalid-contract')
    if (receipt.runId) usedRuns.add(receipt.runId)
    if (receipt.namespaceDigest && namespaces.has(receipt.namespaceDigest)) evidenceGap = true
    if (receipt.namespaceDigest) namespaces.add(receipt.namespaceDigest)
    if (!receipt.runId || !receipt.namespaceDigest || receipt.evidenceRefs.length === 0
      || !receipt.evidenceVerified || !receipt.cleanupPassed || receipt.recovered
      || receipt.status === 'inconclusive' || receipt.status === 'not-performed') evidenceGap = true
    if (receipt.targetDeviceBinding !== plan.targetDeviceBinding || receipt.origin !== plan.target)
      identityGap = true
    if (frozen.kind === 'baseline') {
      if (receipt.status !== 'fail' || receipt.failureFingerprint !== sourceFailureFingerprint) notReproduced = true
    } else if (receipt.status === 'fail') candidateFailed = true
  }
  if (seen.size !== expected.size) evidenceGap = true
  const gaps: RepairVerification['gaps'] = []
  if (evidenceGap) gaps.push('repair-evidence-unavailable')
  if (identityGap) gaps.push('repair-install-identity-unverified')
  if (notReproduced) gaps.push('repair-not-reproduced')
  const outcome = gaps.length ? 'inconclusive' : candidateFailed ? 'not-fixed'
    : plan.target === 'physical' ? 'device-verified' : 'software-verified'
  const body = { contractVersion: 1 as const, id: randomUUID(), caseId: plan.caseId, attemptId,
    planDigest: plan.digest, patchDigest, checks, gaps,
    grade: outcome === 'device-verified' ? 'device' as const : outcome === 'software-verified' ? 'software' as const : 'proposal' as const,
    outcome, checkedAt: new Date().toISOString() }
  return repairVerificationSchema.parse(body)
}
