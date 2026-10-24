import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { sha256 } from './content-hash.js'
import type { WorkbenchStore } from './workbench-store.js'
import { WorkbenchReferences } from './workbench-references.js'
import { referencePublicationsSchema } from './workbench-evidence-contracts.js'
import { syncBuiltinReferences, validateBuiltinReferences } from './workbench-builtin-references.js'
import { buildMockRepairVerification } from './workbench-repair-run-receipts.js'
import { assertRepairTransition } from './workbench-repair-workflow.js'
import { assertHostSubmission, hostRepairRequestSchema, patchSubmissionSchema,
  type HostRepairRequest, type PatchSubmission } from './workbench-repair-host-contracts.js'
import { sourceCheckResultSchema, type SourceCheckResult } from './workbench-repair-workspaces.js'
import { repairArtifactManifestSchema, type RepairArtifactManifest } from './workbench-repair-build.js'
import { parseRepair, RepairError, REPAIR_JSON_LIMIT, repairCaseSchema, repairDigest, repairId, repairPlanSchema,
  repairCandidateSchema, repairApprovalSchema, repairAttemptSchema, repairVerificationSchema,
  repairResetSchema, type RepairCase, type RepairPlan, type RepairCandidate, type RepairApproval, type RepairAttempt,
  type RepairVerification, type RepairReset, type RepairErrorCode } from './workbench-repair-contracts.js'

const journalSchema = z.object({ version: z.literal(1), previousDigest: repairDigest.nullable(),
  value: repairCaseSchema, plan: repairPlanSchema, runIds: z.array(repairId).min(1).max(48),
  publications: referencePublicationsSchema, retiredAt: z.string().datetime().optional(),
  candidate: repairCandidateSchema.optional(), approvalRecords: z.array(repairApprovalSchema).max(8).optional(),
  attemptRecords: z.array(repairAttemptSchema).max(2).optional(), verificationRecords: z.array(repairVerificationSchema).max(2).optional(),
  resetRecords: z.array(repairResetSchema).max(24).optional(),
  hostRequest: hostRepairRequestSchema.optional(), patchSubmission: patchSubmissionSchema.optional(),
  sourceChecks: z.array(sourceCheckResultSchema).max(2).optional(),
  buildArtifact: repairArtifactManifestSchema.optional(),
  installIntent: z.object({ artifactDigest: repairDigest, targetDeviceBinding: repairDigest,
    requestedAt: z.string().datetime(), status: z.enum(['prepared', 'completed', 'unknown']),
    receiptDigest: repairDigest.optional(), identityState: z.enum(['verified', 'mismatch', 'unverified']).optional(),
    identityDigest: repairDigest.optional(),
    receipt: z.object({ dispatchedAt: z.string().datetime(), completedAt: z.string().datetime(),
      sessionId: z.string().min(1).max(128), provider: z.enum(['mock', 'appium']) }).strict().optional(),
    identity: z.object({ appId: z.string().min(1).max(160), version: z.string().max(128).optional(),
      buildMarker: z.string().max(256).optional(), artifactDigest: repairDigest.optional(),
      evidence: z.enum(['package-digest', 'app-build-marker', 'version-only']),
      observedAt: z.string().datetime() }).strict().optional(),
  }).strict().optional(),
}).strict()
type Journal = z.infer<typeof journalSchema>
const envelope = z.object({ digest: repairDigest, journal: journalSchema }).strict()
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

/** Owner-local bounded read model; immutable journal entries, not the cache, are authoritative.
 * Constructors do no I/O. All writes share the WorkbenchStore mutation/retention gate.
 */
export class WorkbenchRepairStore {
  readonly root: string
  #ready: Promise<void> | undefined
  #index = new Map<string, Journal>()
  #requests = new Map<string, string>()
  #pendingResets = new Set<string>()
  constructor(readonly store: WorkbenchStore, private readonly cutpoint: (point: string) => Promise<void> = async () => {}) {
    this.root = join(store.root, 'repairs')
  }

  async init(): Promise<void> {
    await this.store.init()
    return this.#ready ??= this.store.withMutationGate(async () => {
      await directory(this.root)
      await this.#rebuild()
    }).catch(error => { this.#ready = undefined; throw error })
  }

  /** Explicit recovery of the disposable in-memory index; never scans unrelated run manifests. */
  async rebuildIndex(): Promise<void> {
    await this.init()
    await this.store.withMutationGate(() => this.#rebuild())
  }

  /** Startup reconciliation never replays a prepared reset, child run, or device mutation. */
  async recoverInterrupted(): Promise<string[]> {
    await this.init()
    const interrupted: string[] = []
    for (const [id, journal] of this.#index) {
      if (!['preparing', 'patching', 'checking', 'building', 'installing', 'revalidating',
        'regressing', 'finalizing', 'cancelling'].includes(journal.value.phase)) continue
      const now = new Date().toISOString()
      if (journal.value.phase === 'installing' && journal.installIntent?.status === 'prepared')
        await this.markInstallUnknown(id, journal.value.revision)
      else await this.update(id, journal.value.revision, value => ({ ...value, revision: value.revision + 1,
        phase: 'blocked', outcome: 'inconclusive', reason: 'repair-unknown-mutation', updatedAt: now }))
      interrupted.push(id)
    }
    return interrupted
  }

  async #rebuild() {
    const entries = await readdir(this.root, { withFileTypes: true })
    if (entries.length > 1000) throw new RepairError('repair-budget-exhausted')
    const index = new Map<string, Journal>(), requests = new Map<string, string>()
    for (const entry of entries) {
      if (!entry.isDirectory() || !repairId.safeParse(entry.name).success) throw new RepairError('repair-invalid-contract')
      const journal = await this.#load(entry.name)
      if (!journal) continue // A crash before publishing a first revision has no accepted request.
      const key = `${journal.value.projectId}:${journal.value.owner}:${journal.value.requestId}`
      if (requests.has(key)) throw new RepairError('repair-request-conflict')
      index.set(entry.name, journal); requests.set(key, entry.name)
    }
    this.#index = index; this.#requests = requests
  }

  async #load(id: string): Promise<Journal | undefined> {
    const root = join(this.root, id)
    await requireDirectory(root)
    const entries = await readdir(root, { withFileTypes: true })
    if (entries.length > 300) throw new RepairError('repair-budget-exhausted')
    const revisions: string[] = []
    for (const entry of entries) {
      if (!entry.isFile()) throw new RepairError('repair-invalid-contract')
      if (/^revision-[0-9]{4}\.json$/.test(entry.name)) revisions.push(entry.name)
      else if (entry.name !== 'case.json' && !/^\.repair-[0-9a-f-]{36}\.tmp$/.test(entry.name)) throw new RepairError('repair-invalid-contract')
    }
    revisions.sort()
    if (revisions.length > 128) throw new RepairError('repair-budget-exhausted')
    let previousDigest: string | null = null, current: Journal | undefined
    for (const [index, filename] of revisions.entries()) {
      const value = await read(join(root, filename))
      if (value.journal.value.id !== id || value.journal.value.revision !== index + 1 || filename !== revisionName(index + 1)
        || value.journal.previousDigest !== previousDigest) throw new RepairError('repair-invalid-contract')
      if (current && !sameIdentity(current.value, value.journal.value)) throw new RepairError('repair-invalid-contract')
      validateBindings(value.journal)
      previousDigest = value.digest; current = value.journal
    }
    if (current) await this.#validateReferences(current)
    return current
  }

  async #validateReferences(journal: Journal) {
    const ledger = new Map((await new WorkbenchReferences(this.store).list()).map(ref => [ref.refId, ref]))
    try { validateBuiltinReferences(journal.publications, 'workbench:repair', journal.value.id, journal.retiredAt ? [] : journal.runIds, ledger) }
    catch { throw new RepairError('repair-reference-invalid') }
  }

  async create(record: RepairCase, plan: RepairPlan): Promise<RepairCase> {
    const value = parseRepair(repairCaseSchema, record), frozen = parseRepair(repairPlanSchema, plan)
    if (value.revision !== 1 || value.phase !== 'planning' || value.attempts.length || value.approvals.length || value.verificationIds.length
      || value.generation || value.spentExecutionMs || value.outcome || value.cancelRequestedAt) throw new RepairError('repair-invalid-contract')
    await this.init()
    const release = await this.#reserve()
    try {
      return await this.store.withMutationGate(async () => {
        const key = `${value.projectId}:${value.owner}:${value.requestId}`
        const existing = this.#requests.get(key)
        if (existing) {
          const prior = this.#index.get(existing)!.value
          if (prior.requestDigest !== value.requestDigest) throw new RepairError('repair-request-conflict')
          return structuredClone(prior)
        }
        if (this.#index.has(value.id) || this.#index.size >= 1000) throw new RepairError('repair-request-conflict')
        const root = join(this.root, value.id)
        // No adoption of a directory left by a failed, possibly partially published request.
        await mkdir(root, { mode: 0o700 })
        const runIds = [...new Set([value.sourceSnapshot.runId, ...(frozen.baselineSnapshot ? [frozen.baselineSnapshot.runId] : [])])]
        const journal: Journal = { version: 1, previousDigest: null, value, plan: frozen, runIds, publications: {} }
        validateBindings(journal)
        for (const snapshot of [frozen.sourceSnapshot, ...(frozen.baselineSnapshot ? [frozen.baselineSnapshot] : [])])
          if ((await this.store.readOnlySnapshot(snapshot.runId)).manifestSha256 !== snapshot.manifestSha256) throw new RepairError('repair-evidence-unavailable')
        await syncBuiltinReferences(this.store, 'workbench:repair', value.id, undefined, runIds, async publications => {
          await this.#commit({ ...journal, publications })
        }, this.cutpoint)
        return structuredClone(value)
      })
    } finally { release() }
  }

  async get(id: string): Promise<RepairCase> {
    repairId.parse(id); await this.init()
    const journal = this.#index.get(id)
    if (!journal) throw new RepairError('repair-not-found')
    await this.#validateReferences(journal)
    return structuredClone(journal.value)
  }

  async plan(id: string): Promise<RepairPlan> {
    await this.get(id)
    return structuredClone(this.#index.get(id)!.plan)
  }

  async candidate(id: string): Promise<RepairCandidate | undefined> {
    await this.get(id)
    return this.#index.get(id)!.candidate ? structuredClone(this.#index.get(id)!.candidate) : undefined
  }

  async hostRequest(id: string): Promise<HostRepairRequest | undefined> {
    await this.get(id)
    return this.#index.get(id)!.hostRequest ? structuredClone(this.#index.get(id)!.hostRequest) : undefined
  }

  async patchSubmission(id: string): Promise<PatchSubmission | undefined> {
    await this.get(id)
    return this.#index.get(id)!.patchSubmission ? structuredClone(this.#index.get(id)!.patchSubmission) : undefined
  }

  async sourceChecks(id: string): Promise<SourceCheckResult[]> {
    await this.get(id)
    return structuredClone(this.#index.get(id)!.sourceChecks ?? []) as SourceCheckResult[]
  }

  async buildArtifact(id: string): Promise<RepairArtifactManifest | undefined> {
    await this.init(); return structuredClone(this.#index.get(id)?.buildArtifact)
  }

  async installIntent(id: string) {
    await this.init(); return structuredClone(this.#index.get(id)?.installIntent)
  }

  async openCodeScope(id: string, expectedRevision: number): Promise<RepairCase> {
    return this.#mutate(id, expectedRevision, prior => {
      if (prior.plan.route !== 'product-code' || prior.value.phase !== 'planning')
        throw new RepairError('repair-ineligible')
      return { ...prior, value: { ...prior.value, revision: expectedRevision + 1,
        phase: 'awaiting-approval', updatedAt: new Date().toISOString() } }
    })
  }

  async publishHostRequest(id: string, expectedRevision: number, request: HostRepairRequest): Promise<RepairCase> {
    const checked = parseRepair(hostRepairRequestSchema, request)
    return this.#mutate(id, expectedRevision, prior => {
      if (prior.plan.route !== 'product-code' || prior.value.phase !== 'awaiting-approval'
        || prior.hostRequest || checked.caseId !== id || checked.generation !== prior.value.generation + 1
        || checked.planDigest !== prior.plan.digest || checked.projectRevision !== prior.value.projectRevision
        || !(prior.approvalRecords ?? []).some(approval => approval.level === 'scope'
          && approval.planDigest === prior.plan.digest && Date.parse(approval.expiresAt) > Date.now()))
        throw new RepairError('repair-approval-required')
      return { ...prior, hostRequest: checked, value: { ...prior.value,
        revision: expectedRevision + 1, updatedAt: new Date().toISOString() } }
    })
  }

  async registerCodePatch(id: string, expectedRevision: number, raw: unknown): Promise<RepairCase> {
    return this.#mutate(id, expectedRevision, prior => {
      if (prior.plan.route !== 'product-code' || prior.value.phase !== 'awaiting-approval'
        || !prior.hostRequest || prior.patchSubmission || Date.parse(prior.value.expiresAt) <= Date.now())
        throw new RepairError('repair-ineligible')
      const checked = assertHostSubmission(prior.hostRequest, raw)
      return { ...prior, patchSubmission: checked, value: { ...prior.value,
        revision: expectedRevision + 1, updatedAt: new Date().toISOString() } }
    })
  }

  async approvals(id: string): Promise<RepairApproval[]> {
    await this.get(id)
    return structuredClone(this.#index.get(id)!.approvalRecords ?? [])
  }

  async attempts(id: string): Promise<RepairAttempt[]> {
    await this.get(id)
    return structuredClone(this.#index.get(id)!.attemptRecords ?? [])
  }

  async verifications(id: string): Promise<RepairVerification[]> {
    await this.get(id)
    return structuredClone(this.#index.get(id)!.verificationRecords ?? [])
  }

  async resets(id: string): Promise<RepairReset[]> {
    await this.get(id)
    return structuredClone(this.#index.get(id)!.resetRecords ?? [])
  }

  /** Persist intent before a reset side effect. Prepared entries are unknown after a crash. */
  async prepareReset(id: string, expectedRevision: number, attemptId: string, checkId: string): Promise<RepairReset> {
    const intent = repairResetSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: id, attemptId,
      generation: (await this.get(id)).generation, checkId, requestedAt: new Date().toISOString(), status: 'prepared' })
    await this.#mutate(id, expectedRevision, prior => {
      const attempt = prior.attemptRecords?.at(-1)
      if (prior.plan.target !== 'mock' || !['preparing', 'revalidating', 'regressing'].includes(prior.value.phase)
        || !attempt || attempt.id !== attemptId
        || attempt.generation !== intent.generation || !prior.plan.requiredChecks.some(check => check.id === checkId)
        || Date.parse(prior.value.expiresAt) <= Date.now()
        || prior.resetRecords?.some(record => record.attemptId === attemptId && record.checkId === checkId))
        throw new RepairError('repair-ineligible')
      return { ...prior, resetRecords: [...(prior.resetRecords ?? []), intent],
        value: { ...prior.value, revision: expectedRevision + 1, updatedAt: intent.requestedAt } }
    })
    this.#pendingResets.add(intent.id)
    return intent
  }

  /** Only an in-process prepare may complete; a restarted prepared intent stays unknown. */
  async completeReset(id: string, expectedRevision: number, resetId: string,
    receipt: { namespaceId: string; initialStateSha256: string; sessionId: string }): Promise<RepairReset> {
    if (!this.#pendingResets.delete(resetId)) throw new RepairError('repair-unknown-mutation')
    let completed: RepairReset | undefined
    await this.#mutate(id, expectedRevision, prior => {
      const index = prior.resetRecords?.findIndex(record => record.id === resetId) ?? -1
      if (index < 0 || prior.resetRecords![index]!.status !== 'prepared'
        || !['preparing', 'revalidating', 'regressing', 'cancelling'].includes(prior.value.phase)
        || prior.value.generation !== prior.resetRecords![index]!.generation
        || prior.resetRecords!.some(record => record.status === 'completed' && record.receipt?.namespaceId === receipt.namespaceId))
        throw new RepairError('repair-unknown-mutation')
      completed = parseRepair(repairResetSchema, { ...prior.resetRecords![index]!, status: 'completed',
        receipt: { ...receipt, observedAt: new Date().toISOString() } })
      const resets = [...prior.resetRecords!]; resets[index] = completed!
      return { ...prior, resetRecords: resets,
        value: { ...prior.value, revision: expectedRevision + 1, updatedAt: completed!.receipt!.observedAt } }
    }, true)
    return completed!
  }

  async findRequest(projectId: string, owner: string, requestId: string): Promise<RepairCase | undefined> {
    await this.init()
    const id = this.#requests.get(`${projectId}:${owner}:${requestId}`)
    return id ? this.get(id) : undefined
  }

  async registerCandidate(id: string, expectedRevision: number, candidate: RepairCandidate): Promise<RepairCase> {
    const proposal = parseRepair(repairCandidateSchema, candidate)
    return this.#mutate(id, expectedRevision, prior => {
      if (prior.candidate || prior.value.phase !== 'planning' || proposal.sourceRunId !== prior.value.sourceSnapshot.runId
        || proposal.baselineRunId !== prior.plan.baselineSnapshot?.runId
        || proposal.sourceManifestSha256 !== prior.value.sourceSnapshot.manifestSha256
        || proposal.baselineManifestSha256 !== prior.plan.baselineSnapshot?.manifestSha256) throw new RepairError('repair-ineligible')
      return { ...prior, candidate: proposal, value: { ...prior.value, phase: 'awaiting-approval',
        revision: expectedRevision + 1, updatedAt: new Date().toISOString() } }
    })
  }

  async appendApproval(id: string, expectedRevision: number, approval: RepairApproval): Promise<RepairCase> {
    const checked = parseRepair(repairApprovalSchema, approval)
    return this.#mutate(id, expectedRevision, prior => {
      if (prior.value.phase !== 'awaiting-approval'
        || (prior.value.resumePhase === 'installing' && checked.level !== 'installation')
        || (prior.plan.route === 'locator-maintenance' ? !prior.candidate : checked.level !== 'scope' && !prior.patchSubmission)
        || checked.caseId !== id
        || checked.planDigest !== prior.plan.digest || checked.projectRevision !== prior.value.projectRevision
        || checked.targetDeviceBinding !== prior.plan.targetDeviceBinding
        || (checked.level !== 'scope' && checked.patchDigest !== (prior.candidate?.digest ?? prior.patchSubmission?.patchDigest))
        || (checked.level === 'installation' && (prior.value.resumePhase !== 'installing'
          || !prior.buildArtifact || checked.artifactDigest !== prior.buildArtifact.artifactDigest))
        || (checked.level === 'execution' && !(prior.approvalRecords ?? []).some(scope => scope.level === 'scope'
          && scope.principal === checked.principal && scope.planDigest === checked.planDigest
          && Date.parse(scope.expiresAt) > Date.now()))
        || Date.parse(prior.value.expiresAt) <= Date.now()
        || Date.parse(checked.issuedAt) > Date.now() + 1_000
        || Date.parse(checked.expiresAt) <= Date.now() || Date.parse(checked.expiresAt) > Date.parse(prior.value.expiresAt)
        || prior.value.approvals.includes(checked.id))
        throw new RepairError('repair-stale-approval')
      return { ...prior, approvalRecords: [...(prior.approvalRecords ?? []), checked],
        value: { ...prior.value, revision: expectedRevision + 1, updatedAt: new Date().toISOString(),
          approvals: [...prior.value.approvals, checked.id],
          ...(checked.level === 'execution' ? { phase: 'queued' as const }
            : checked.level === 'installation' ? { phase: 'installing' as const, resumePhase: undefined } : {}) } }
    })
  }

  async beginAttempt(id: string, expectedRevision: number, attempt: RepairAttempt): Promise<RepairCase> {
    const checked = parseRepair(repairAttemptSchema, attempt)
    return this.#mutate(id, expectedRevision, prior => {
      const isCode = prior.plan.route === 'product-code'
      if (prior.value.phase !== 'queued' || checked.caseId !== id || checked.planDigest !== prior.plan.digest
        || checked.patchDigest !== (prior.candidate?.digest ?? prior.patchSubmission?.patchDigest)
        || checked.requestDigest !== prior.value.requestDigest
        || (isCode && checked.id !== prior.hostRequest?.attemptId)
        || checked.generation !== prior.value.generation + 1
        || Date.parse(prior.value.expiresAt) <= Date.now() || prior.value.spentExecutionMs >= prior.value.budget.executionMs
        || checked.childRunIds.length || checked.baselineRuns || checked.candidateRuns || checked.regressionRuns
        || checked.outcome || prior.value.attempts.length >= prior.value.budget.maxAttempts
        || !(prior.approvalRecords ?? []).some(approval => approval.level === 'execution' && approval.patchDigest === checked.patchDigest
          && approval.planDigest === prior.plan.digest && Date.parse(approval.expiresAt) > Date.now()
          && (isCode ? approval.allowedOperations.includes('software-check')
            : ['baseline', 'revalidate', 'regress'].every(operation => approval.allowedOperations.includes(operation as typeof approval.allowedOperations[number])))))
        throw new RepairError('repair-approval-required')
      return { ...prior, attemptRecords: [...(prior.attemptRecords ?? []), checked],
        value: { ...prior.value, phase: 'preparing', generation: checked.generation, attempts: [...prior.value.attempts, checked.id],
          revision: expectedRevision + 1, updatedAt: new Date().toISOString() } }
    })
  }

  /** Persist each completed child before advancing; a cancelled child still spends its run budget. */
  async completeChildCheck(id: string, expectedRevision: number, attemptId: string, checkId: string, runId: string): Promise<RepairCase> {
    const snapshot = await this.store.readOnlySnapshot(runId)
    if (snapshot.run.phase !== 'finished' || !snapshot.run.endedAt) throw new RepairError('repair-evidence-unavailable')
    return this.#mutate(id, expectedRevision, prior => {
      const attempt = prior.attemptRecords?.at(-1)
      const count = attempt ? attempt.baselineRuns + attempt.candidateRuns + attempt.regressionRuns : -1
      const frozen = prior.plan.requiredChecks[count]
      if (!attempt || attempt.id !== attemptId || !frozen || frozen.id !== checkId
        || attempt.childRunIds[count] !== runId || attempt.finishedAt || attempt.outcome
        || !['preparing', 'revalidating', 'regressing', 'cancelling'].includes(prior.value.phase))
        throw new RepairError('repair-ineligible')
      const elapsed = Math.max(attempt.executionMs,
        Math.max(0, Date.parse(snapshot.run.endedAt!) - Date.parse(attempt.createdAt)))
      const delta = elapsed - attempt.executionMs
      if (elapsed > prior.value.budget.executionMs || prior.value.spentExecutionMs + delta > prior.value.budget.executionMs)
        throw new RepairError('repair-budget-exhausted')
      const nextAttempt = repairAttemptSchema.parse({ ...attempt,
        baselineRuns: attempt.baselineRuns + Number(frozen.kind === 'baseline'),
        candidateRuns: attempt.candidateRuns + Number(frozen.kind === 'candidate'),
        regressionRuns: attempt.regressionRuns + Number(frozen.kind === 'regression'), executionMs: elapsed })
      const next = prior.plan.requiredChecks[count + 1]
      const phase = prior.value.phase === 'cancelling' ? 'cancelling'
        : !next ? 'finalizing' : next.kind === 'candidate' ? 'revalidating' : next.kind === 'regression' ? 'regressing' : 'preparing'
      return { ...prior, attemptRecords: [...prior.attemptRecords!.slice(0, -1), nextAttempt],
        value: { ...prior.value, revision: expectedRevision + 1, phase,
          spentExecutionMs: prior.value.spentExecutionMs + delta, updatedAt: snapshot.run.endedAt! } }
    }, true)
  }

  /** Terminalize a failed/cancelled attempt only after its in-flight child has drained. */
  async stopAttempt(id: string, expectedRevision: number, outcome: 'cancelled' | 'inconclusive',
    reason: RepairErrorCode): Promise<RepairCase> {
    return this.#mutate(id, expectedRevision, prior => {
      const attempt = prior.attemptRecords?.at(-1)
      if (!attempt || attempt.finishedAt || attempt.outcome || prior.value.phase === 'finished')
        throw new RepairError('repair-ineligible')
      const finishedAt = new Date().toISOString()
      const elapsed = Math.min(prior.value.budget.executionMs - prior.value.spentExecutionMs + attempt.executionMs,
        Math.max(attempt.executionMs, Date.parse(finishedAt) - Date.parse(attempt.createdAt)))
      const delta = elapsed - attempt.executionMs
      const stopped = repairAttemptSchema.parse({ ...attempt, executionMs: elapsed, finishedAt, outcome, reason })
      return { ...prior, attemptRecords: [...prior.attemptRecords!.slice(0, -1), stopped],
        value: { ...prior.value, revision: expectedRevision + 1,
          spentExecutionMs: prior.value.spentExecutionMs + delta, updatedAt: finishedAt } }
    }, true)
  }

  async appendSourceCheck(id: string, expectedRevision: number, result: SourceCheckResult): Promise<RepairCase> {
    const checked = parseRepair(sourceCheckResultSchema, result)
    return this.#mutate(id, expectedRevision, prior => {
      const attempt = prior.attemptRecords?.at(-1)
      if (prior.plan.route !== 'product-code' || prior.value.phase !== 'checking'
        || prior.value.cancelRequestedAt || !attempt || attempt.finishedAt
        || attempt.id !== prior.hostRequest?.attemptId || prior.patchSubmission?.patchDigest !== checked.patchDigest
        || checked.beforeDigest !== prior.hostRequest.sourceTreeDigest
        || (prior.sourceChecks?.length ?? 0) >= 2)
        throw new RepairError('repair-evidence-unavailable')
      const sourceChecks = [...(prior.sourceChecks ?? []), checked]
      return { ...prior, sourceChecks, value: { ...prior.value, revision: expectedRevision + 1,
        updatedAt: new Date().toISOString() } }
    })
  }

  /** Only local runner receipts from two fresh exact-base replay workspaces may earn software grade. */
  async finishCodeAttempt(id: string, expectedRevision: number, results: readonly [SourceCheckResult, SourceCheckResult],
    continueToBuild = false): Promise<RepairCase> {
    const checked = results.map(result => parseRepair(sourceCheckResultSchema, result))
    return this.#mutate(id, expectedRevision, prior => {
      const attempt = prior.attemptRecords?.at(-1), request = prior.hostRequest, submission = prior.patchSubmission
      if (prior.plan.route !== 'product-code' || prior.value.phase !== 'finalizing' || prior.value.cancelRequestedAt
        || !attempt || attempt.finishedAt || !request || !submission
        || prior.sourceChecks?.length !== 2 || JSON.stringify(prior.sourceChecks) !== JSON.stringify(checked)
        || attempt.id !== request.attemptId || attempt.generation !== request.generation
        || checked.some(result => result.patchDigest !== submission.patchDigest
          || result.beforeDigest !== request.sourceTreeDigest || result.oracleDigest !== request.oracleDigest
          || result.finalDigest !== result.afterPatchDigest
          || result.baselineReceipts.every(receipt => receipt.passed)))
        throw new RepairError('repair-evidence-unavailable')
      const success = checked.every(result => result.passed), now = new Date().toISOString()
      const outcome = success ? 'software-verified' as const : 'not-fixed' as const
      const evidence = (value: unknown) => [`command:${sha256(JSON.stringify(value))}`]
      const status = (value: boolean) => value ? 'pass' as const : 'fail' as const
      const makeReceipt = (check: RepairPlan['requiredChecks'][number], passed: boolean,
        refs: string[], fingerprint?: string) => ({ checkId: check.id, inputDigest: check.inputDigest,
        planDigest: prior.plan.digest, patchDigest: submission.patchDigest, status: status(passed),
        origin: 'software' as const, evidenceRefs: refs, evidenceVerified: true,
        cleanupPassed: true, recovered: false, ...(fingerprint ? { failureFingerprint: fingerprint } : {}),
        checkedAt: now })
      const checks = prior.plan.requiredChecks.map(check => {
        if (check.kind === 'software') return makeReceipt(check, success, evidence(checked))
        if (check.kind === 'baseline') return makeReceipt(check, false, evidence(checked[0]!.baselineReceipts),
          sha256(JSON.stringify(checked[0]!.baselineReceipts.filter(receipt => !receipt.passed))))
        if (check.kind === 'candidate') {
          const index = check.id === 'candidate1' ? 0 : 1
          const result = checked[index]!
          return makeReceipt(check, result.receipts.length > 0 && result.receipts.every(receipt => receipt.passed),
            evidence(result.receipts))
        }
        const index = Number(check.id.replace('regression', '')) - 1
        const receipt = checked[1]!.regressionReceipts[index]
        return makeReceipt(check, Boolean(receipt?.passed), evidence(receipt ?? 'missing'))
      })
      const verification = repairVerificationSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: id,
        attemptId: attempt.id, planDigest: prior.plan.digest, patchDigest: submission.patchDigest,
        checks, gaps: [], grade: success ? 'software' : 'proposal', outcome, checkedAt: now })
      const elapsed = Math.max(attempt.executionMs, Date.parse(now) - Date.parse(attempt.createdAt))
      if (elapsed > prior.value.budget.executionMs) throw new RepairError('repair-budget-exhausted')
      const finished = repairAttemptSchema.parse({ ...attempt, finishedAt: now, outcome, executionMs: elapsed,
        baselineRuns: 1, candidateRuns: 2,
        regressionRuns: prior.plan.requiredChecks.filter(check => check.kind === 'regression').length,
        commandReceipts: checked.map(result => sha256(JSON.stringify(result))) })
      return { ...prior, sourceChecks: checked,
        attemptRecords: [...prior.attemptRecords!.slice(0, -1), finished],
        verificationRecords: [...(prior.verificationRecords ?? []), verification],
        value: { ...prior.value, revision: expectedRevision + 1,
          phase: success && continueToBuild ? 'building' : 'finished',
          ...(success && continueToBuild ? {} : { outcome }),
          spentExecutionMs: prior.value.spentExecutionMs + elapsed - attempt.executionMs,
          verificationIds: [...prior.value.verificationIds, verification.id], updatedAt: now } }
    })
  }

  async publishBuildArtifact(id: string, expectedRevision: number, artifact: RepairArtifactManifest): Promise<RepairCase> {
    const checked = parseRepair(repairArtifactManifestSchema, artifact)
    return this.#mutate(id, expectedRevision, prior => {
      const software = prior.verificationRecords?.at(-1)
      if (prior.value.phase !== 'building' || prior.buildArtifact || prior.value.cancelRequestedAt
        || prior.plan.route !== 'product-code' || software?.outcome !== 'software-verified'
        || checked.repositoryId !== prior.hostRequest?.repositoryId
        || checked.baseCommit !== prior.hostRequest.baseCommit
        || checked.patchDigest !== prior.patchSubmission?.patchDigest
        || checked.platform !== prior.plan.platform || checked.appId !== prior.plan.appId
        || checked.oracleDigest !== prior.hostRequest.oracleDigest
        || checked.toolchainDigest !== prior.hostRequest.toolchainDigest)
        throw new RepairError('repair-evidence-unavailable')
      return { ...prior, buildArtifact: checked,
        value: { ...prior.value, revision: expectedRevision + 1, phase: 'awaiting-approval',
          resumePhase: 'installing', updatedAt: new Date().toISOString() } }
    })
  }

  /** Durable intent must precede any provider dispatch. Recovery never replays this operation. */
  async prepareInstall(id: string, expectedRevision: number): Promise<RepairCase> {
    return this.#mutate(id, expectedRevision, prior => {
      const artifact = prior.buildArtifact
      if (!artifact || prior.value.phase !== 'installing' || prior.installIntent
        || prior.value.cancelRequestedAt
        || !(prior.approvalRecords ?? []).some(approval => approval.level === 'installation'
          && approval.artifactDigest === artifact.artifactDigest
          && approval.targetDeviceBinding === prior.plan.targetDeviceBinding
          && approval.allowedOperations.includes('install') && Date.parse(approval.expiresAt) > Date.now()))
        throw new RepairError('repair-approval-required')
      return { ...prior, installIntent: { artifactDigest: artifact.artifactDigest,
        targetDeviceBinding: prior.plan.targetDeviceBinding, requestedAt: new Date().toISOString(), status: 'prepared' },
        value: { ...prior.value, revision: expectedRevision + 1, updatedAt: new Date().toISOString() } }
    })
  }

  async completeInstall(id: string, expectedRevision: number, receipt: unknown,
    identity: unknown, state: 'verified' | 'mismatch' | 'unverified'): Promise<RepairCase> {
    const checkedReceipt = z.object({ dispatchedAt: z.string().datetime(), completedAt: z.string().datetime(),
      sessionId: z.string().min(1).max(128), provider: z.enum(['mock', 'appium']) }).strict().parse(receipt)
    const checkedIdentity = z.object({ identity: z.object({ appId: z.string().min(1).max(160),
      version: z.string().max(128).optional(), buildMarker: z.string().max(256).optional(),
      artifactDigest: repairDigest.optional(), evidence: z.enum(['package-digest', 'app-build-marker', 'version-only']),
      observedAt: z.string().datetime() }).strict(), state: z.enum(['verified', 'mismatch', 'unverified']),
      sessionId: z.string().min(1).max(128), provider: z.enum(['mock', 'appium']) }).strict().parse(identity)
    return this.#mutate(id, expectedRevision, prior => {
      if (prior.value.phase !== 'installing' || prior.installIntent?.status !== 'prepared'
        || prior.value.cancelRequestedAt || !prior.buildArtifact
        || checkedIdentity.state !== state
        || checkedIdentity.sessionId !== checkedReceipt.sessionId
        || checkedIdentity.provider !== checkedReceipt.provider) throw new RepairError('repair-ineligible')
      const now = new Date().toISOString()
      return { ...prior, installIntent: { ...prior.installIntent, status: 'completed',
        receiptDigest: sha256(JSON.stringify(checkedReceipt)), identityState: state,
        identityDigest: sha256(JSON.stringify(checkedIdentity.identity)),
        receipt: checkedReceipt, identity: checkedIdentity.identity },
        value: { ...prior.value, revision: expectedRevision + 1,
          phase: 'blocked', outcome: 'inconclusive',
          reason: state === 'verified' ? 'repair-dependency-unresolved' : 'repair-install-identity-unverified',
          updatedAt: now } }
    })
  }

  async markInstallUnknown(id: string, expectedRevision: number): Promise<RepairCase> {
    return this.#mutate(id, expectedRevision, prior => {
      if (prior.value.phase !== 'installing' || prior.installIntent?.status !== 'prepared')
        throw new RepairError('repair-ineligible')
      const now = new Date().toISOString()
      return { ...prior, installIntent: { ...prior.installIntent, status: 'unknown' },
        value: { ...prior.value, revision: expectedRevision + 1, phase: 'blocked',
          outcome: 'inconclusive', reason: 'repair-unknown-mutation', updatedAt: now } }
    }, true)
  }

  async recordVerification(id: string, expectedRevision: number, verification: RepairVerification): Promise<RepairCase> {
    const checked = parseRepair(repairVerificationSchema, verification)
    // The trusted child-run receipt builder is not wired yet. A submitted envelope
    // cannot certify its own origin or promote a case to a verified grade.
    if (checked.outcome === 'software-verified' || checked.outcome === 'device-verified')
      throw new RepairError('repair-capability-unavailable')
    return this.#mutate(id, expectedRevision, prior => {
      if (!prior.value.attempts.includes(checked.attemptId) || checked.caseId !== id
        || checked.planDigest !== prior.plan.digest || checked.patchDigest !== prior.candidate?.digest
        || prior.value.verificationIds.includes(checked.id)) throw new RepairError('repair-invalid-contract')
      return { ...prior, verificationRecords: [...(prior.verificationRecords ?? []), checked],
        value: { ...prior.value, phase: 'finished', outcome: checked.outcome, revision: expectedRevision + 1,
          verificationIds: [...prior.value.verificationIds, checked.id], updatedAt: checked.checkedAt } }
    })
  }

  /** Build a software result only from protected local child runs and completed Mock reset receipts. */
  async finishMockAttempt(id: string, expectedRevision: number, expectedYaml: ReadonlyMap<string, string>): Promise<RepairCase> {
    await this.get(id)
    const journal = this.#index.get(id)
    if (!journal?.candidate || journal.plan.target !== 'mock' || journal.value.revision !== expectedRevision
      || journal.value.phase !== 'finalizing' || journal.value.cancelRequestedAt) throw new RepairError('repair-ineligible')
    const attempt = journal.attemptRecords?.at(-1)
    if (!attempt) throw new RepairError('repair-ineligible')
    const release = await this.store.lease([journal.value.sourceSnapshot.runId, ...attempt.childRunIds])
    try {
      const verification = await buildMockRepairVerification(this.store, journal.plan, journal.candidate,
        attempt, (journal.resetRecords ?? []).filter(reset => reset.attemptId === attempt.id), expectedYaml)
      return await this.#mutate(id, expectedRevision, prior => {
        if (prior.attemptRecords?.at(-1)?.id !== attempt.id || prior.candidate?.digest !== journal.candidate!.digest
          || JSON.stringify(prior.resetRecords) !== JSON.stringify(journal.resetRecords)
          || JSON.stringify(prior.attemptRecords) !== JSON.stringify(journal.attemptRecords))
          throw new RepairError('repair-revision-conflict')
        const finishedAt = verification.checkedAt
        const checks = prior.plan.requiredChecks
        if (attempt.baselineRuns !== checks.filter(check => check.kind === 'baseline').length
          || attempt.candidateRuns !== checks.filter(check => check.kind === 'candidate').length
          || attempt.regressionRuns !== checks.filter(check => check.kind === 'regression').length)
          throw new RepairError('repair-evidence-unavailable')
        const finishedAttempt = repairAttemptSchema.parse({ ...attempt, finishedAt, outcome: verification.outcome,
        })
        return { ...prior, attemptRecords: [...prior.attemptRecords!.slice(0, -1), finishedAttempt],
          verificationRecords: [...(prior.verificationRecords ?? []), verification],
          value: { ...prior.value, revision: expectedRevision + 1, phase: 'finished', outcome: verification.outcome,
            verificationIds: [...prior.value.verificationIds, verification.id], updatedAt: finishedAt } }
      })
    } finally { release() }
  }

  async #mutate(id: string, expectedRevision: number, apply: (prior: Journal) => Journal,
    allowCancelledCompletion = false): Promise<RepairCase> {
    repairId.parse(id); await this.init()
    const release = await this.#reserve()
    try {
      return await this.store.withMutationGate(async () => {
        const prior = this.#index.get(id)
        if (!prior || prior.retiredAt) throw new RepairError('repair-not-found')
        await this.#validateReferences(prior)
        if (prior.value.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
        if (prior.value.phase === 'finished' || (prior.value.cancelRequestedAt && !allowCancelledCompletion))
          throw new RepairError('repair-ineligible')
        const next = parseRepair(journalSchema, apply(structuredClone(prior)))
        assertRepairTransition(prior.value, next.value)
        if (!sameIdentity(prior.value, next.value) || next.value.revision !== expectedRevision + 1 || next.value.revision > 128)
          throw new RepairError('repair-invalid-contract')
        await this.#commit({ ...next, previousDigest: sha256(JSON.stringify(prior)) })
        return structuredClone(next.value)
      })
    } finally { release() }
  }

  async list(projectId: string, owner: string, options: { after?: string; limit?: number } = {}) {
    return this.#page(owner, options, projectId)
  }

  /** Local Viewer history may include projects whose repair opt-in was later disabled. */
  async listOwned(owner: string, options: { after?: string; limit?: number } = {}) {
    return this.#page(owner, options)
  }

  async #page(owner: string, options: { after?: string; limit?: number }, projectId?: string) {
    await this.init()
    const limit = options.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RepairError('repair-invalid-contract')
    if (options.after) repairId.parse(options.after)
    const values = [...this.#index.values()].filter(entry => (!projectId || entry.value.projectId === projectId) && entry.value.owner === owner)
      .map(entry => entry.value).sort((a, b) => a.id.localeCompare(b.id))
      .filter(value => !options.after || value.id.localeCompare(options.after) > 0)
    const items = values.slice(0, limit).map(value => structuredClone(value))
    return { items, ...(values.length > limit ? { next: items.at(-1)!.id } : {}) }
  }

  /** Internal mutation only. The coordinator supplies transitions, never a transport body. */
  async update(id: string, expectedRevision: number, change: (value: RepairCase) => RepairCase): Promise<RepairCase> {
    repairId.parse(id); await this.init()
    const release = await this.#reserve()
    try {
      return await this.store.withMutationGate(async () => {
        const prior = this.#index.get(id)
        if (!prior || prior.retiredAt) throw new RepairError('repair-not-found')
        if (prior.value.phase === 'finished') throw new RepairError('repair-ineligible')
        await this.#validateReferences(prior)
        if (prior.value.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
        const next = parseRepair(repairCaseSchema, change(structuredClone(prior.value)))
        assertRepairTransition(prior.value, next)
        if (!sameIdentity(prior.value, next) || next.revision !== expectedRevision + 1 || next.revision > 128)
          throw new RepairError('repair-invalid-contract')
        if (next.spentExecutionMs < prior.value.spentExecutionMs || next.generation < prior.value.generation
          || ['software-verified', 'device-verified'].includes(next.outcome ?? '')
          || !isPrefix(prior.value.attempts, next.attempts) || !isPrefix(prior.value.approvals, next.approvals)
          || !isPrefix(prior.value.verificationIds, next.verificationIds) || (prior.value.cancelRequestedAt && next.cancelRequestedAt !== prior.value.cancelRequestedAt))
          throw new RepairError('repair-invalid-contract')
        await this.#commit({ ...prior, previousDigest: sha256(JSON.stringify(prior)), value: next })
        return structuredClone(next)
      })
    } finally { release() }
  }

  /** Must complete before releasing the child run's execution gate. */
  async protectChild(id: string, expectedRevision: number, runId: string): Promise<RepairCase> {
    repairId.parse(id); repairId.parse(runId); await this.init()
    const release = await this.#reserve()
    try {
      return await this.store.withMutationGate(async () => {
        const prior = this.#index.get(id)
        if (!prior || prior.retiredAt) throw new RepairError('repair-not-found')
        if (prior.value.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
        if (prior.value.phase === 'finished' || prior.value.cancelRequestedAt) throw new RepairError('repair-ineligible')
        const runIds = [...new Set([...prior.runIds, runId])]
        const value = { ...prior.value, revision: expectedRevision + 1, updatedAt: new Date().toISOString() }
        const attemptRecords = prior.attemptRecords?.map((attempt, index) => index === prior.attemptRecords!.length - 1
          ? { ...attempt, childRunIds: [...attempt.childRunIds, runId] } : attempt)
        await syncBuiltinReferences(this.store, 'workbench:repair', id, prior.publications, runIds, async publications => {
          await this.#commit({ ...prior, previousDigest: sha256(JSON.stringify(prior)), value, runIds, publications,
            ...(attemptRecords ? { attemptRecords } : {}) })
        }, this.cutpoint)
        return structuredClone(value)
      })
    } finally { release() }
  }

  /** Explicit owner operation, never garbage collection. Repeats finish partial revocation. */
  async retire(id: string, expectedRevision: number): Promise<void> {
    repairId.parse(id); await this.init()
    const release = await this.#reserve()
    try {
      await this.store.withMutationGate(async () => {
        const prior = this.#index.get(id)
        if (!prior) throw new RepairError('repair-not-found')
        if (prior.value.phase !== 'finished') throw new RepairError('repair-ineligible')
        if (!prior.retiredAt && prior.value.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
        const value = { ...prior.value, revision: prior.value.revision + 1 }
        await syncBuiltinReferences(this.store, 'workbench:repair', id, prior.publications, [], async publications => {
          if (prior.retiredAt) return
          await this.#commit({ ...prior, previousDigest: sha256(JSON.stringify(prior)), value, publications, retiredAt: new Date().toISOString() })
        }, this.cutpoint)
      })
    } finally { release() }
  }

  async #reserve() {
    try { return await this.store.reserveEvidence(`repair-record:${randomUUID()}`, 4 * REPAIR_JSON_LIMIT) }
    catch { throw new RepairError('repair-storage-insufficient') }
  }

  async #commit(journal: Journal) {
    validateBindings(journal)
    const checked = parseRepair(journalSchema, journal)
    if (checked.value.revision > 128) throw new RepairError('repair-budget-exhausted')
    const bytes = JSON.stringify({ digest: sha256(JSON.stringify(checked)), journal: checked })
    if (Buffer.byteLength(bytes) > REPAIR_JSON_LIMIT) throw new RepairError('repair-invalid-contract')
    const root = join(this.root, checked.value.id)
    await this.cutpoint('journal:before-write')
    await write(join(root, revisionName(checked.value.revision)), bytes, false)
    const parent = await open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await parent.sync() } finally { await parent.close() }
    // The fsynced immutable journal is the commit point, before the disposable cache.
    this.#index.set(checked.value.id, structuredClone(checked))
    this.#requests.set(`${checked.value.projectId}:${checked.value.owner}:${checked.value.requestId}`, checked.value.id)
    await this.cutpoint('journal:after-commit')
    await write(join(root, 'case.json'), bytes, true)
  }
}

function validateBindings(journal: Journal) {
  const { value, plan } = journal
  if (value.id !== plan.caseId || value.planId !== plan.id || value.planDigest !== plan.digest || value.projectId !== plan.projectId
    || value.projectRevision !== plan.projectRevision || value.route !== plan.route || JSON.stringify(value.sourceSnapshot) !== JSON.stringify(plan.sourceSnapshot)
    || JSON.stringify(value.budget) !== JSON.stringify(plan.budget) || !journal.runIds.includes(value.sourceSnapshot.runId))
    throw new RepairError('repair-invalid-contract')
  if (journal.candidate && (journal.candidate.sourceRunId !== value.sourceSnapshot.runId
    || journal.candidate.baselineRunId !== plan.baselineSnapshot?.runId)
    || (journal.hostRequest && (plan.route !== 'product-code' || journal.hostRequest.caseId !== value.id
      || journal.hostRequest.planDigest !== plan.digest || journal.hostRequest.projectRevision !== value.projectRevision))
    || (journal.patchSubmission && (!journal.hostRequest
      || !patchSubmissionSchema.safeParse(journal.patchSubmission).success
      || journal.patchSubmission.requestDigest !== journal.hostRequest.requestDigest
      || journal.patchSubmission.caseId !== value.id))
    || (journal.sourceChecks && (plan.route !== 'product-code' || !journal.patchSubmission
      || journal.sourceChecks.length < 1 || journal.sourceChecks.length > 2
      || journal.sourceChecks.some(result => result.patchDigest !== journal.patchSubmission!.patchDigest)))
    || (journal.buildArtifact && (plan.route !== 'product-code' || !journal.patchSubmission
      || journal.buildArtifact.patchDigest !== journal.patchSubmission.patchDigest
      || journal.buildArtifact.platform !== plan.platform || journal.buildArtifact.appId !== plan.appId))
    || (journal.installIntent && (!journal.buildArtifact
      || journal.installIntent.artifactDigest !== journal.buildArtifact.artifactDigest
      || journal.installIntent.targetDeviceBinding !== plan.targetDeviceBinding
      || (journal.installIntent.status === 'completed' && (!journal.installIntent.receipt
        || !journal.installIntent.identity || !journal.installIntent.identityState
        || journal.installIntent.receiptDigest !== sha256(JSON.stringify(journal.installIntent.receipt))
        || journal.installIntent.identityDigest !== sha256(JSON.stringify(journal.installIntent.identity))))))
    || JSON.stringify(value.approvals) !== JSON.stringify((journal.approvalRecords ?? []).map(item => item.id))
    || JSON.stringify(value.attempts) !== JSON.stringify((journal.attemptRecords ?? []).map(item => item.id))
    || JSON.stringify(value.verificationIds) !== JSON.stringify((journal.verificationRecords ?? []).map(item => item.id))
    || (journal.attemptRecords ?? []).some(attempt => attempt.caseId !== value.id || attempt.planDigest !== plan.digest
      || attempt.childRunIds.some(runId => !journal.runIds.includes(runId)))
    || (journal.approvalRecords ?? []).some(approval => approval.caseId !== value.id || approval.planDigest !== plan.digest)
    || (journal.resetRecords ?? []).some(reset => reset.caseId !== value.id
      || !plan.requiredChecks.some(check => check.id === reset.checkId)
      || !(journal.attemptRecords ?? []).some(attempt => attempt.id === reset.attemptId && attempt.generation === reset.generation))
    || new Set((journal.resetRecords ?? []).map(reset => `${reset.attemptId}:${reset.checkId}`)).size !== (journal.resetRecords ?? []).length
    || new Set((journal.resetRecords ?? []).filter(reset => reset.status === 'completed').map(reset => reset.receipt!.namespaceId)).size
      !== (journal.resetRecords ?? []).filter(reset => reset.status === 'completed').length)
    throw new RepairError('repair-invalid-contract')
}
function sameIdentity(a: RepairCase, b: RepairCase) {
  return ['id', 'requestId', 'requestDigest', 'projectId', 'projectRevision', 'owner', 'route', 'planId', 'planDigest', 'createdAt', 'expiresAt'].every(key =>
    a[key as keyof RepairCase] === b[key as keyof RepairCase]) && JSON.stringify(a.sourceSnapshot) === JSON.stringify(b.sourceSnapshot) && JSON.stringify(a.budget) === JSON.stringify(b.budget)
}
function isPrefix(a: string[], b: string[]) { return a.every((value, index) => b[index] === value) && new Set(b).size === b.length }
function revisionName(revision: number) { return `revision-${String(revision).padStart(4, '0')}.json` }
async function requireDirectory(path: string) {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new RepairError('repair-invalid-contract')
}
async function directory(path: string) { await mkdir(path, { recursive: true, mode: 0o700 }); await requireDirectory(path) }
async function read(path: string) {
  await requireDirectory(dirname(path))
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > REPAIR_JSON_LIMIT) throw new RepairError('repair-invalid-contract')
    const record = parseRepair(envelope, JSON.parse(await handle.readFile('utf8')))
    if (record.digest !== sha256(JSON.stringify(record.journal))) throw new RepairError('repair-invalid-contract')
    return record
  } finally { await handle.close() }
}
async function write(path: string, bytes: string, replace: boolean) {
  await requireDirectory(dirname(path))
  const temporary = join(dirname(path), `.repair-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { if (replace) await rename(temporary, path); else await link(temporary, path) }
  finally { await rm(temporary, { force: true }).catch(error => { if (!missing(error)) throw error }) }
  const dir = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await dir.sync() } finally { await dir.close() }
}
