import { z } from 'zod'

const id = z.string().uuid()
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = z.string().datetime({ offset: true })

export const evidenceReferenceSchema = z.object({
  contractVersion: z.literal(1),
  refId: id,
  consumerKind: z.enum(['baseline', 'comparison', 'suite', 'child', 'share-map', 'pin', 'agent']),
  consumerId: z.string().min(1).max(160),
  revision: z.number().int().positive().optional(),
  targetRunId: id,
  evidenceRefs: z.array(z.string().regex(/^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/)).max(64),
  sourceHash: digest,
  createdAt: timestamp,
}).strict()
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>

/** New consumers use v2; v1 stays byte-for-byte compatible for older readers. */
export const evidenceReferenceV2Schema = evidenceReferenceSchema.omit({ contractVersion: true, consumerKind: true }).extend({
  contractVersion: z.literal(2),
  consumerKind: z.enum(['triage', 'triage-review']),
}).strict()
/** Extension references remain readable/protective without the extension being installed. */
export const evidenceReferenceV3Schema = evidenceReferenceSchema.omit({ contractVersion: true, consumerKind: true }).extend({
  contractVersion: z.literal(3),
  consumerKind: z.string().regex(/^[a-z][a-z0-9.-]{0,63}:[a-z][a-z0-9.-]{0,63}$/),
}).strict()
export const evidenceReferenceReadSchema = z.discriminatedUnion('contractVersion', [evidenceReferenceSchema, evidenceReferenceV2Schema, evidenceReferenceV3Schema])
export type ReadableEvidenceReference = z.infer<typeof evidenceReferenceReadSchema>

export const referencePublicationSchema = z.object({
  version: z.literal(1), references: z.array(evidenceReferenceV3Schema).min(1).max(2),
  retiredAt: timestamp.optional(),
}).strict()
export type ReferencePublication = z.infer<typeof referencePublicationSchema>
export const referencePublicationsSchema = z.record(id, referencePublicationSchema).refine(value => Object.keys(value).length <= 10_000, 'Too many reference publications')
export type ReferencePublications = z.infer<typeof referencePublicationsSchema>

export const evidenceReadLeaseSchema = z.object({
  contractVersion: z.literal(1),
  leaseId: id,
  ownerGeneration: id,
  runIds: z.array(id).min(1).max(10_000),
  operationId: z.string().min(1).max(160),
  acquiredAt: timestamp,
}).strict()
export type EvidenceReadLease = z.infer<typeof evidenceReadLeaseSchema>

export const operationRecordSchema = z.object({
  contractVersion: z.literal(1),
  jobId: id,
  kind: z.enum(['share-preview', 'share-export', 'trend-rebuild', 'retention']),
  requestDigest: digest,
  requestKey: digest.optional(),
  ownerGeneration: id,
  phase: z.enum(['queued', 'preparing', 'transforming', 'awaiting-review', 'committing', 'succeeded', 'cancelling', 'cancelled', 'failed', 'interrupted']),
  progress: z.string().max(160),
  createdAt: timestamp,
  startedAt: timestamp.optional(),
  finishedAt: timestamp.optional(),
  stableError: z.string().max(160).optional(),
  resultRef: z.string().max(160).optional(),
}).strict()
export type OperationRecord = z.infer<typeof operationRecordSchema>

export const triageOperationRecordSchema = operationRecordSchema.omit({ contractVersion: true, kind: true }).extend({
  contractVersion: z.literal(2),
  kind: z.literal('triage'),
}).strict()
export const operationRecordReadSchema = z.discriminatedUnion('contractVersion', [operationRecordSchema, triageOperationRecordSchema])
export type ReadableOperationRecord = z.infer<typeof operationRecordReadSchema>

export const cleanupJournalSchema = z.object({
  contractVersion: z.literal(1),
  operationId: id,
  runId: id,
  action: z.enum(['move', 'restore', 'purge']),
  manifestHash: digest,
  inventoryHash: digest,
  ownerGeneration: id,
  state: z.enum(['intent', 'committed', 'interrupted', 'recovery-required']),
  authorizedAt: timestamp,
  purgeAfter: timestamp.optional(),
  result: z.string().max(160).optional(),
}).strict()
export type CleanupJournal = z.infer<typeof cleanupJournalSchema>
