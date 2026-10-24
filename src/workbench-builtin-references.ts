import { randomUUID } from 'node:crypto'
import { referencePublicationsSchema, type ReferencePublications, type ReadableEvidenceReference } from './workbench-evidence-contracts.js'
import { validatePublication, type ReferenceCutpoint } from './workbench-consumer-references.js'
import { WorkbenchReferences } from './workbench-references.js'
import type { WorkbenchStore } from './workbench-store.js'

export function validateBuiltinReferences(value: unknown, kind: string, id: string, activeRunIds: string[], ledger: Map<string, ReadableEvidenceReference>): ReferencePublications {
  const publications = referencePublicationsSchema.parse(value)
  const active = new Set(activeRunIds), identities = new Set<string>()
  for (const [runId, publication] of Object.entries(publications)) {
    const ref = publication.references[0]!
    if (publication.references.length !== 1 || ref.evidenceRefs.length || identities.has(ref.refId)) throw new Error('Invalid built-in reference identity')
    identities.add(ref.refId)
    validatePublication(publication, kind, id, [{ runId, sourceHash: ref.sourceHash, evidenceRefs: [] }], ledger)
    if (active.has(runId) === Boolean(publication.retiredAt)) throw new Error('Built-in reference retirement mismatch')
    active.delete(runId)
  }
  if (active.size) throw new Error('Built-in consumer reference missing; retention is blocked')
  return publications
}

/** Gate already held. Commit a fresh marker snapshot; never mutate caller state before durable commit. */
export async function syncBuiltinReferences(store: WorkbenchStore, kind: string, id: string, current: ReferencePublications | undefined,
  activeRunIds: string[], commit: (value: ReferencePublications) => Promise<void>, cutpoint: ReferenceCutpoint = async () => {}) {
  const ledger = new WorkbenchReferences(store), stored = new Map((await ledger.list()).map(ref => [ref.refId, ref]))
  const previous = current === undefined ? {} : validateBuiltinReferences(current, kind, id,
    Object.entries(current).filter(([, publication]) => !publication.retiredAt).map(([runId]) => runId), stored)
  const next = structuredClone(previous), active = new Set(activeRunIds)
  for (const runId of active) {
    if (next[runId] && !next[runId]!.retiredAt) continue
    // Reactivation must first finish any interrupted retirement of the former identity.
    if (next[runId]?.retiredAt) for (const ref of next[runId]!.references) await ledger.revokeUnderMutationGate(ref.refId, kind, id)
    const snapshot = await store.readOnlySnapshot(runId)
    const ref = { contractVersion: 3 as const, refId: randomUUID(), consumerKind: kind, consumerId: id, targetRunId: runId,
      sourceHash: snapshot.manifestSha256, evidenceRefs: [], createdAt: new Date().toISOString() }
    await ledger.publishUnderMutationGate(ref)
    next[runId] = { version: 1, references: [ref] }
    await cutpoint('publication:after-reference')
  }
  for (const [runId, publication] of Object.entries(next)) if (!active.has(runId)) publication.retiredAt ??= new Date().toISOString()
  referencePublicationsSchema.parse(next)
  await commit(next)
  await cutpoint('publication:after-commit')
  for (const publication of Object.values(next)) if (publication.retiredAt) {
    await cutpoint('retirement:after-tombstone')
    for (const ref of publication.references) {
      await ledger.revokeUnderMutationGate(ref.refId, kind, id)
      await cutpoint('retirement:after-revoke')
    }
  }
}

/** Shared with retention; only verified terminal facts permit releasing Agent media. */
export function hasAgentTombstone(journal: { phase: string; runId?: string; requestKey: string; requestHash: string; summary?: { resultProjection?: any } }): boolean {
  const projection = journal.summary?.resultProjection
  return journal.phase === 'finished' && !!projection && [1, 2].includes(projection.contractVersion) && projection.runId === journal.runId
    && projection.evidenceAvailability === 'verified' && projection.verification?.evidence?.status === 'pass'
    && projection.clean === (projection.verdict === 'pass') && /^[a-f0-9]{64}$/.test(journal.requestKey) && /^[a-f0-9]{64}$/.test(journal.requestHash)
}
