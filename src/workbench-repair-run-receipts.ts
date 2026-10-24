import { sha256 } from './content-hash.js'
import { RepairError, type RepairAttempt, type RepairCandidate, type RepairCheckReceipt,
  type RepairPlan, type RepairReset, type RepairVerification } from './workbench-repair-contracts.js'
import { trustedMissingTap } from './workbench-repair-evidence.js'
import { evaluateLocatorVerification } from './workbench-repair-verification.js'
import { runResultProjection } from './workbench-contracts.js'
import { verifyRunEvidence } from './workbench-run-finalization.js'
import { stepDigest } from './workbench-tap-facts.js'
import type { TestRun } from './workbench-domain.js'
import type { WorkbenchStore } from './workbench-store.js'

async function missingFingerprint(store: WorkbenchStore, run: TestRun): Promise<string | undefined> {
  const step = run.steps.find(item => item.kind === 'tap' && item.status === 'failed' && item.tapFact?.outcome === 'target-not-found')
  if (!step || !await trustedMissingTap(store, run, step)) return undefined
  return stepDigest({ sourcePath: step.tapFact!.source.path, sourceStep: step.tapFact!.source.stepSha256,
    selector: step.tapFact!.resolution.selectorSha256, outcome: step.tapFact!.outcome })
}

/** Rebuilds receipts from immutable local runs and durable Mock reset records, never host reports. */
export async function buildMockRepairVerification(store: WorkbenchStore, plan: RepairPlan, candidate: RepairCandidate,
  attempt: RepairAttempt, resets: RepairReset[], expectedYaml: ReadonlyMap<string, string>): Promise<RepairVerification> {
  if (plan.target !== 'mock' || attempt.caseId !== plan.caseId || attempt.planDigest !== plan.digest
    || attempt.patchDigest !== candidate.digest || attempt.childRunIds.length !== plan.requiredChecks.length
    || resets.length !== plan.requiredChecks.length) throw new RepairError('repair-evidence-unavailable')
  const sourceSnapshot = await store.readOnlySnapshot(plan.sourceSnapshot.runId)
  if (sourceSnapshot.manifestSha256 !== plan.sourceSnapshot.manifestSha256) throw new RepairError('repair-evidence-unavailable')
  const sourceFingerprint = await missingFingerprint(store, sourceSnapshot.run)
  if (!sourceFingerprint) throw new RepairError('repair-evidence-unavailable')
  const checks: RepairCheckReceipt[] = [], initialStates = new Set<string>()
  for (const [index, check] of plan.requiredChecks.entries()) {
    const reset = resets.find(item => item.attemptId === attempt.id && item.checkId === check.id)
    const runId = attempt.childRunIds[index]
    if (!reset || reset.status !== 'completed' || !reset.receipt || !runId) throw new RepairError('repair-evidence-unavailable')
    initialStates.add(reset.receipt.initialStateSha256)
    const { run } = await store.readOnlySnapshot(runId)
    if (run.phase !== 'finished' || run.source === 'import' || run.share || run.parentRunId !== plan.sourceSnapshot.runId
      || run.provider !== 'mock' || run.platform !== plan.platform || run.sessionId !== reset.receipt.sessionId
      || run.productContract?.provenance.app.id.value !== plan.appId || run.yaml !== expectedYaml.get(check.id))
      throw new RepairError('repair-evidence-unavailable')
    if (check.kind === 'candidate' && (run.repair?.proposalDigest !== candidate.digest
      || run.repair.sourceRunId !== plan.sourceSnapshot.runId)) throw new RepairError('repair-evidence-unavailable')
    let evidenceVerified = true
    try { await verifyRunEvidence(store, run) } catch { evidenceVerified = false }
    const projection = runResultProjection(run, evidenceVerified ? 'verified' : 'unavailable')
    const fingerprint = check.kind === 'baseline' ? await missingFingerprint(store, run) : undefined
    const status = check.kind === 'baseline' ? fingerprint ? 'fail' : projection.verdict === 'pass' ? 'pass' : 'inconclusive'
      : projection.verdict === 'pass' ? 'pass' : projection.verdict === 'fail' ? 'fail' : 'inconclusive'
    checks.push({ checkId: check.id, inputDigest: check.inputDigest, planDigest: plan.digest,
      patchDigest: candidate.digest, status, origin: 'mock', evidenceRefs: [`/api/runs/${runId}`],
      evidenceVerified: evidenceVerified && projection.verification.evidence.status === 'pass',
      cleanupPassed: run.cleanup === 'session-retained' && run.resourceCleanup !== 'failed'
        && projection.verification.cleanup.status !== 'fail',
      recovered: run.verdict === 'recovered' || run.steps.some(step => Boolean(step.recoveredBy)),
      runId, namespaceDigest: sha256(reset.receipt.namespaceId), targetDeviceBinding: plan.targetDeviceBinding,
      ...(fingerprint ? { failureFingerprint: fingerprint } : {}), checkedAt: run.endedAt ?? new Date().toISOString() })
  }
  if (initialStates.size !== 1) throw new RepairError('repair-evidence-unavailable')
  return evaluateLocatorVerification(plan, attempt.id, candidate.digest, sourceFingerprint, checks)
}
