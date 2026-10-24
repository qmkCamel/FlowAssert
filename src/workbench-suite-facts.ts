import { sha256, type WorkbenchStore } from './workbench-store.js'
import type { TestRun } from './workbench-domain.js'
import type { RunResultProjection } from './workbench-contracts.js'
import type { FrozenSuiteAttempt, SuiteCase } from './workbench-suites.js'

/** The suite manifest is a separate durable fact source after attempt media is removed. */
export function hasFrozenSuiteFacts(item: Pick<SuiteCase, 'attempts' | 'frozenAttempts' | 'frozenDigest'>): boolean {
  return Array.isArray(item.frozenAttempts) && item.frozenDigest === sha256(JSON.stringify(item.frozenAttempts))
    && item.frozenAttempts.length === item.attempts.length
    && item.frozenAttempts.every((fact, index) => fact.runId === item.attempts[index] && fact.trendRun?.id === fact.runId
      && fact.projection?.runId === fact.runId && fact.projection?.evidenceAvailability === 'verified'
      && /^[a-f0-9]{64}$/.test(fact.manifestSha256))
}

export async function freezeSuiteCase(store: WorkbenchStore, getVerified: (id: string) => Promise<TestRun>, item: SuiteCase): Promise<void> {
  const facts: FrozenSuiteAttempt[] = []
  for (const attempt of item.attempts) {
    const { run: source, manifestSha256 } = await store.readOnlySnapshot(attempt)
    const projection = (await getVerified(attempt)).resultProjection
    if (source.phase !== 'finished' || projection?.evidenceAvailability !== 'verified' || projection.readState === 'unsupported')
      throw new Error('Suite attempt is not verified for retention')
    const trendRun: TestRun = {
      schemaVersion: 1, id: source.id, name: source.name, yaml: '', engine: source.engine, phase: 'finished',
      ...(source.verdict ? { verdict: source.verdict } : {}), startedAt: source.startedAt,
      ...(source.endedAt ? { endedAt: source.endedAt } : {}), sessionId: 'retained', deviceName: 'retained',
      platform: source.platform, provider: source.provider, verificationScope: source.verificationScope,
      visualVerification: source.visualVerification, businessVerification: source.businessVerification,
      steps: source.steps.filter(step => step.visual).map(step => ({ index: step.index, kind: step.kind, status: step.status,
        startedAt: step.startedAt, evidence: [], ...(step.visual ? { visual: step.visual } : {}) })),
      evidence: [], cleanup: source.cleanup, ...(source.comparison ? { comparison: source.comparison } : {}),
      ...(source.source ? { source: source.source } : {}), ...(source.share ? { share: source.share } : {}),
      ...(source.productContract?.contractVersion === 2 ? { productContract: structuredClone(source.productContract), measurements: structuredClone(source.measurements ?? []) } : {}),
    }
    facts.push({ runId: attempt, manifestSha256, projection, trendRun })
  }
  item.frozenAttempts = facts
  item.frozenDigest = sha256(JSON.stringify(facts))
}

export function unavailableSuiteProjection(item: SuiteCase, index: number): RunResultProjection {
  if (!hasFrozenSuiteFacts(item)) throw new Error('Suite attempt is unavailable without a verified tombstone')
  const frozen = item.frozenAttempts![index]
  if (!frozen || frozen.runId !== item.attempts[index]) throw new Error('Suite attempt tombstone identity mismatch')
  const projection = structuredClone(frozen.projection)
  projection.evidenceAvailability = 'unavailable'
  projection.verification.evidence.status = 'fail'
  projection.verdict = 'inconclusive'
  projection.clean = false
  projection.exitCode = 2
  projection.reasons.push({ domain: 'evidence', code: 'evidence-unavailable', evidenceRefs: [] })
  return projection
}
