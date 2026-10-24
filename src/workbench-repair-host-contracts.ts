import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { RepairError, repairDigest, repairId, repairName } from './workbench-repair-contracts.js'

const timestamp = z.string().datetime({ offset: true })
const commit = z.string().regex(/^[a-f0-9]{40}$/)
const host = z.object({ kind: z.enum(['codex-mcp', 'deepseek-harness-cordis']),
  version: z.string().min(1).max(64), pluginVersion: z.string().min(1).max(64) }).strict()

export const hostRepairCapabilitiesSchema = z.object({ protocolVersion: z.literal(1), locator: z.boolean(),
  codePatch: z.boolean(), buildInstall: z.boolean() }).strict()

/** Immutable handoff identity. The host cannot select a repository path or command. */
export const hostRepairRequestSchema = z.object({ protocolVersion: z.literal(1), id: repairId,
  caseId: repairId, attemptId: repairId, generation: z.number().int().positive(),
  repositoryId: repairName, baseCommit: commit, projectRevision: repairDigest,
  planDigest: repairDigest, sourceTreeDigest: repairDigest, oracleDigest: repairDigest,
  toolchainDigest: repairDigest, generationWorkspace: z.string().min(1).max(1024).refine(isAbsolute),
  issuedAt: timestamp,
  expiresAt: timestamp, requestDigest: repairDigest,
  permittedPaths: z.array(z.string().min(1).max(256)).min(1).max(50),
  evidence: z.array(z.object({ name: z.string().min(1).max(128), digest: repairDigest }).strict()).max(20),
}).strict().superRefine((value, ctx) => {
  const { requestDigest, ...body } = value
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
    || requestDigest !== createHash('sha256').update(JSON.stringify(body)).digest('hex'))
    ctx.addIssue({ code: 'custom', message: 'Invalid or expired handoff identity' })
})

export const patchSubmissionSchema = z.object({ protocolVersion: z.literal(1),
  requestId: repairId, caseId: repairId, attemptId: repairId, generation: z.number().int().positive(),
  repositoryId: repairName, baseCommit: commit, requestDigest: repairDigest,
  patchDigest: repairDigest, patch: z.string().min(1), host,
}).strict().superRefine((value, ctx) => {
  if (Buffer.byteLength(value.patch, 'utf8') > 512 * 1024
    || value.patchDigest !== createHash('sha256').update(value.patch).digest('hex'))
    ctx.addIssue({ code: 'custom', message: 'Patch budget or digest invalid' })
})
export type HostRepairRequest = z.infer<typeof hostRepairRequestSchema>
export type PatchSubmission = z.infer<typeof patchSubmissionSchema>

export function hostCapabilities(codePatch: boolean, buildInstall: boolean) {
  return hostRepairCapabilitiesSchema.parse({ protocolVersion: 1, locator: true, codePatch, buildInstall })
}

export function createHostRepairRequest(body: Omit<HostRepairRequest, 'requestDigest'>): HostRepairRequest {
  return hostRepairRequestSchema.parse({ ...body,
    requestDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex') })
}

export function assertHostSubmission(request: HostRepairRequest, value: unknown): PatchSubmission {
  let submission: PatchSubmission
  try { submission = patchSubmissionSchema.parse(value) }
  catch { throw new RepairError('repair-invalid-patch') }
  if (Date.parse(request.expiresAt) <= Date.now() || submission.requestId !== request.id
    || submission.caseId !== request.caseId || submission.attemptId !== request.attemptId
    || submission.generation !== request.generation || submission.repositoryId !== request.repositoryId
    || submission.baseCommit !== request.baseCommit || submission.requestDigest !== request.requestDigest)
    throw new RepairError('repair-stale-approval')
  return submission
}
