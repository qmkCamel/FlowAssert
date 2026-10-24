import { randomUUID } from 'node:crypto'
import { evidenceReferenceV3Schema, referencePublicationSchema, type ReferencePublication, type ReadableEvidenceReference } from './workbench-evidence-contracts.js'
import { WorkbenchReferences } from './workbench-references.js'
import type { WorkbenchStore } from './workbench-store.js'

export { referencePublicationSchema, type ReferencePublication } from './workbench-evidence-contracts.js'
export type ReferenceTarget = { runId: string; sourceHash: string; evidenceRefs: string[] }
export type ReferenceCutpoint = (name: string) => Promise<void>

/** The record callback and its references share one gate. Failure keeps protective orphans. */
export async function publishConsumer(store: WorkbenchStore, kind: string, id: string, targets: ReferenceTarget[],
  commit: (publication: ReferencePublication) => Promise<void>, cutpoint: ReferenceCutpoint = async () => {}) {
  const publication = referencePublicationSchema.parse({ version: 1, references: targets.map(target => ({
    contractVersion: 3, refId: randomUUID(), consumerKind: kind, consumerId: id,
    targetRunId: target.runId, sourceHash: target.sourceHash, evidenceRefs: target.evidenceRefs, createdAt: new Date().toISOString(),
  })) })
  const ledger = new WorkbenchReferences(store)
  await store.withMutationGate(async () => {
    for (const reference of publication.references) {
      await ledger.publishUnderMutationGate(reference)
      await cutpoint('publication:after-reference')
    }
    await commit(publication)
    await cutpoint('publication:after-commit')
  })
}

/** Validate even retired markers; only live publications require the ledger to still exist. */
export function validatePublication(value: unknown, kind: string, id: string, targets: ReferenceTarget[], ledger: Map<string, ReadableEvidenceReference>): ReferencePublication {
  const publication = referencePublicationSchema.parse(value)
  if (publication.references.length !== targets.length || new Set(publication.references.map(ref => ref.refId)).size !== targets.length) throw new Error('Invalid consumer reference identities')
  for (const [index, reference] of publication.references.entries()) {
    const target = targets[index]!
    if (reference.consumerKind !== kind || reference.consumerId !== id || reference.targetRunId !== target.runId
      || reference.sourceHash !== target.sourceHash || JSON.stringify(reference.evidenceRefs) !== JSON.stringify(target.evidenceRefs)) throw new Error('Consumer reference target mismatch')
    if (!publication.retiredAt) {
      const stored = ledger.get(reference.refId)
      if (!stored || JSON.stringify(evidenceReferenceV3Schema.parse(stored)) !== JSON.stringify(reference)) throw new Error('Consumer reference missing or changed; retention is blocked')
    }
  }
  return publication
}

/** Tombstone first, then owner-checked revocation; restarting the operation is safe. */
export async function retireConsumerUnderMutationGate(store: WorkbenchStore, value: ReferencePublication, kind: string, id: string,
  targets: ReferenceTarget[], commit: (publication: ReferencePublication) => Promise<void>, cutpoint: ReferenceCutpoint = async () => {}) {
  const ledger = new WorkbenchReferences(store)
  const publication = validatePublication(value, kind, id, targets, new Map((await ledger.list()).map(ref => [ref.refId, ref])))
  const retired = { ...publication, retiredAt: publication.retiredAt ?? new Date().toISOString() }
  await commit(retired)
  await cutpoint('retirement:after-tombstone')
  for (const ref of retired.references) {
    await ledger.revokeUnderMutationGate(ref.refId, kind, id)
    await cutpoint('retirement:after-revoke')
  }
}
