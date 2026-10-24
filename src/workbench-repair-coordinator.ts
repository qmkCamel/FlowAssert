import { randomUUID } from 'node:crypto'
import { RepairError, repairCaseSchema, repairId, repairApprovalSchema, repairAttemptSchema, type RepairCase } from './workbench-repair-contracts.js'
import { admitLocatorProposal } from './workbench-repair-admission.js'
import { assertFrozenPlan, freezeCodePlan, freezeLocatorPlan } from './workbench-repair-freeze.js'
import { assertRepairPermission, repairRegistration } from './workbench-repair-project.js'
import { assertHostSubmission, createHostRepairRequest } from './workbench-repair-host-contracts.js'
import { inspectSourcePatch, resolveRepairSource } from './workbench-repair-source.js'
import { checkRepairPatch, createGenerationWorkspace, createRepairWorkspaces, hashRepairTree,
  preflightRepairPatch, releaseGenerationWorkspace,
  type SourceCheckResult } from './workbench-repair-workspaces.js'
import { hashRepairToolchain } from './workbench-repair-command-runner.js'
import { buildRepairArtifact, verifyRepairArtifact } from './workbench-repair-build.js'
import { stepDigest } from './workbench-tap-facts.js'
import { compilePrivateLocatorCandidate } from './workbench-repair-private-candidate.js'
import { WorkbenchRepairStore } from './workbench-repair-store.js'
import { loadTestProject, type ProjectSnapshot } from './workbench-project.js'
import type { WorkbenchService } from './workbench-service.js'
import type { WorkbenchSuites } from './workbench-suites.js'
import { acceptanceInputSchema } from './workbench-change-contracts.js'

export interface CreateRepairInput { requestId: string; sourceRunId: string; baselineRunId: string; flowId: string }
export interface CreateCodeRepairInput { requestId: string; sourceRunId: string; flowId: string; repositoryId: string }
type Challenge = { nonce: string; caseId: string; owner: string; revision: number; level: 'scope' | 'execution' | 'installation';
  channel: 'local-viewer' | 'interactive-cli'; planDigest: string; patchDigest: string; artifactDigest?: string;
  projectRevision: string; expiresAt: number }
export interface RepairDetail {
  case: RepairCase
  plan: Awaited<ReturnType<WorkbenchRepairStore['plan']>>
  candidate: Awaited<ReturnType<WorkbenchRepairStore['candidate']>>
  hostRequest: Awaited<ReturnType<WorkbenchRepairStore['hostRequest']>>
  patchSubmission: Awaited<ReturnType<WorkbenchRepairStore['patchSubmission']>>
  sourceChecks: Awaited<ReturnType<WorkbenchRepairStore['sourceChecks']>>
  buildArtifact: Awaited<ReturnType<WorkbenchRepairStore['buildArtifact']>>
  installIntent: Awaited<ReturnType<WorkbenchRepairStore['installIntent']>>
  approvals: Awaited<ReturnType<WorkbenchRepairStore['approvals']>>
  attempts: Awaited<ReturnType<WorkbenchRepairStore['attempts']>>
  resets: Awaited<ReturnType<WorkbenchRepairStore['resets']>>
  verifications: Awaited<ReturnType<WorkbenchRepairStore['verifications']>>
}

/** The store and device services stay the owners. This coordinator admits only registered inputs. */
export class WorkbenchRepairCoordinator {
  readonly records: WorkbenchRepairStore
  #accepting = true
  #creation = Promise.resolve()
  #recovery: Promise<string[]> | undefined
  #challenges = new Map<string, Challenge>()
  #activeVerification: { id: string; owner: string; abort: AbortController; done: Promise<RepairCase> } | undefined
  constructor(readonly workbench: WorkbenchService, readonly suites: WorkbenchSuites,
    private readonly projectLoader: () => Promise<ProjectSnapshot> = async () =>
      workbench.baselines.applyApproved(await loadTestProject(workbench.projectPath)),
    private readonly cutpoint: (point: string) => Promise<void> = async () => {}) {
    this.records = new WorkbenchRepairStore(workbench.store)
  }

  stopAccepting(): void { this.#accepting = false }

  /** Run before opening any transport after a process restart. No execution is resumed. */
  async recoverInterrupted(): Promise<string[]> {
    return this.#recovery ??= this.records.recoverInterrupted().catch(error => { this.#recovery = undefined; throw error })
  }

  async close(): Promise<void> {
    this.stopAccepting(); this.#challenges.clear(); await this.#creation
    const active = this.#activeVerification
    if (active) {
      const current = await this.records.get(active.id)
      if (!current.cancelRequestedAt && this.#activeVerification === active
        && !['blocked', 'finished'].includes(current.phase))
        await this.cancel(active.id, active.owner, current.revision).catch(error => {
          if (!(error instanceof RepairError) || error.code !== 'repair-busy') throw error
        })
      await active.done
      const after = await this.records.get(active.id)
      if (after.phase === 'installing' && (await this.records.installIntent(active.id))?.status === 'prepared')
        await this.records.markInstallUnknown(active.id, after.revision)
    }
  }

  /** Read remains available after opt-in is disabled, but only to the case owner. */
  async get(id: string, owner: string): Promise<RepairDetail> {
    await this.recoverInterrupted()
    repairId.parse(id)
    const record = await this.records.get(id)
    if (record.owner !== owner) throw new RepairError('repair-not-found')
    const [plan, candidate, hostRequest, patchSubmission, sourceChecks, buildArtifact, installIntent,
      approvals, attempts, resets, verifications] = await Promise.all([
      this.records.plan(id), this.records.candidate(id), this.records.hostRequest(id), this.records.patchSubmission(id),
      this.records.sourceChecks(id), this.records.buildArtifact(id), this.records.installIntent(id),
      this.records.approvals(id), this.records.attempts(id),
      this.records.resets(id), this.records.verifications(id),
    ])
    return { case: record, plan, candidate, hostRequest, patchSubmission, sourceChecks, buildArtifact,
      installIntent, approvals, attempts, resets, verifications }
  }

  /** Redacted Agent projection; guessed IDs from another project are indistinguishable from absent cases. */
  async getForAgent(id: string, operation: 'plan' | 'verify' | 'cancel' = 'plan') {
    const detail = await this.get(id, 'local')
    await this.#assertOperationPermission(detail, operation)
    const scopeGranted = detail.approvals.some(approval => approval.level === 'scope'
      && approval.planDigest === detail.plan.digest && approval.projectRevision === detail.case.projectRevision
      && approval.principal === detail.case.owner
      && approval.targetDeviceBinding === detail.plan.targetDeviceBinding
      && ['share-evidence', 'generate-patch'].every(operation => approval.allowedOperations.includes(operation as typeof approval.allowedOperations[number]))
      && Date.parse(approval.expiresAt) > Date.now())
    const project = await this.projectLoader()
    return { contractVersion: 1, capabilities: { locator: true,
      codePatch: project.repair?.source?.isolation === 'trusted-local', buildInstall: false },
      caseId: detail.case.id, route: detail.case.route, projectId: detail.case.projectId,
      sourceRunId: detail.case.sourceSnapshot.runId,
      phase: detail.case.phase, outcome: detail.case.outcome ?? null, reason: detail.case.reason ?? null,
      revision: detail.case.revision, updatedAt: detail.case.updatedAt, planDigest: detail.plan.digest,
      candidateDigest: detail.candidate?.digest ?? detail.patchSubmission?.patchDigest ?? null,
      artifactDigest: scopeGranted ? detail.buildArtifact?.artifactDigest ?? null : null,
      semanticDiff: scopeGranted ? detail.candidate?.semanticDiff ?? null : null,
      hostRequest: scopeGranted ? detail.hostRequest ?? null : null,
      requiredChecks: detail.plan.requiredChecks.map(check => ({ id: check.id, kind: check.kind })),
      approvals: detail.approvals.map(approval => ({ level: approval.level, expiresAt: approval.expiresAt })),
      attempts: detail.attempts.map(attempt => ({ generation: attempt.generation,
        childRunIds: scopeGranted ? attempt.childRunIds : [],
        outcome: attempt.outcome ?? null })),
      verification: detail.verifications.at(-1) ? { grade: detail.verifications.at(-1)!.grade,
        outcome: detail.verifications.at(-1)!.outcome, gaps: detail.verifications.at(-1)!.gaps } : null }
  }

  /** Only a pre-dispatch case can be cancelled synchronously. Active execution needs its owner to drain first. */
  async cancel(id: string, owner: string, expectedRevision: number): Promise<RepairCase> {
    const detail = await this.get(id, owner), current = detail.case
    const active = this.#activeVerification?.id === id ? this.#activeVerification : undefined
    if (!active && (!['planning', 'awaiting-approval', 'queued', 'installing'].includes(current.phase)
      || (current.phase === 'installing' && detail.installIntent))) throw new RepairError('repair-busy')
    const cancelled = await this.records.update(id, expectedRevision, value => {
      if (!active && !['planning', 'awaiting-approval', 'queued', 'installing'].includes(value.phase)) throw new RepairError('repair-busy')
      const now = new Date().toISOString()
      return { ...value, phase: active ? 'cancelling' : 'finished', ...(active ? {} : { outcome: 'cancelled' as const }),
        cancelRequestedAt: now, updatedAt: now, revision: expectedRevision + 1 }
    })
    if (active) {
      active.abort.abort(new Error('Repair cancelled'))
      if (this.workbench.activeId) await this.workbench.cancel(this.workbench.activeId)
    }
    return cancelled
  }

  async retire(id: string, owner: string, expectedRevision: number): Promise<void> {
    const detail = await this.get(id, owner)
    await this.records.retire(id, expectedRevision)
    if (detail.hostRequest) {
      const project = await this.projectLoader(), policy = project.repair?.source
      if (policy?.repositoryId === detail.hostRequest.repositoryId)
        await releaseGenerationWorkspace(policy, detail.hostRequest.generationWorkspace)
    }
  }

  /** Explicit local handoff to the existing acceptance preview; never publishes a revision. */
  async acceptanceCandidate(id: string, owner: string, expectedRevision: number, proposed: unknown) {
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
    const verification = detail.verifications.at(-1), attempt = detail.attempts.at(-1)
    if (detail.case.phase !== 'finished' || !verification || !attempt
      || !['software-verified', 'device-verified'].includes(verification.outcome)
      || detail.case.outcome !== verification.outcome) throw new RepairError('repair-ineligible')
    const base = acceptanceInputSchema.parse(proposed)
    if (base.cells.length !== 1 || base.cells[0]!.runId || base.cells[0]!.matrixCell
      || base.cells[0]!.historyRunIds.length || base.cells[0]!.externalResults?.length
      || base.cells[0]!.platform !== detail.plan.platform || base.cells[0]!.appId !== detail.plan.appId)
      throw new RepairError('repair-invalid-contract')
    const candidate = detail.plan.requiredChecks.filter(check => check.kind === 'candidate').at(-1)
    const receipt = verification.checks.find(check => check.checkId === candidate?.id)
    if (!receipt?.runId || receipt.status !== 'pass' || !receipt.evidenceVerified || !receipt.cleanupPassed)
      throw new RepairError('repair-evidence-unavailable')
    const source = await this.workbench.store.readOnlySnapshot(detail.case.sourceSnapshot.runId)
    const latest = await this.workbench.store.readOnlySnapshot(receipt.runId)
    if (source.manifestSha256 !== detail.case.sourceSnapshot.manifestSha256
      || source.run.verdict !== 'fail' || latest.run.verdict !== 'pass'
      || receipt.origin !== detail.plan.target || receipt.runId === source.run.id)
      throw new RepairError('repair-evidence-unavailable')
    const draft = acceptanceInputSchema.parse({ ...base, declarationsReviewed: false,
      cells: [{ ...base.cells[0], runId: receipt.runId, historyRunIds: [source.run.id] }] })
    return { caseId: id, caseRevision: expectedRevision, grade: verification.grade, checkedAt: verification.checkedAt,
      limitation: verification.grade === 'software' ? 'software-only-not-device-verified' : 'declared-not-supply-chain-verified',
      input: draft, published: false }
  }

  /** The transport must present this only after a local human gesture. It is not an Agent tool. */
  async approvalChallenge(id: string, owner: string, expectedRevision: number, level: 'scope' | 'execution' | 'installation',
    channel: Challenge['channel'] = 'local-viewer') {
    if (!this.#accepting) throw new RepairError('repair-interrupted')
    for (const [nonce, challenge] of this.#challenges) if (challenge.expiresAt <= Date.now()) this.#challenges.delete(nonce)
    if (this.#challenges.size >= 100) throw new RepairError('repair-busy')
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
    const patchDigest = detail.candidate?.digest ?? detail.patchSubmission?.patchDigest
    if (detail.case.phase !== 'awaiting-approval'
      || (detail.case.route === 'locator-maintenance' && !detail.candidate)
      || (level === 'execution' && !patchDigest)
      || (level === 'installation' && (detail.case.resumePhase !== 'installing' || !detail.buildArtifact))
      || (detail.case.resumePhase === 'installing' && level !== 'installation')
      || Date.parse(detail.case.expiresAt) <= Date.now())
      throw new RepairError('repair-ineligible')
    await this.#assertCurrentPermission(detail, level)
    if (level === 'installation') {
      const policy = (await this.projectLoader()).repair?.source
      if (!policy) throw new RepairError('repair-capability-unavailable')
      await verifyRepairArtifact(detail.buildArtifact!, policy, this.workbench.store.root)
    }
    if (level === 'execution' && !detail.approvals.some(item => item.level === 'scope' && item.principal === owner
      && item.planDigest === detail.plan.digest && item.projectRevision === detail.case.projectRevision
      && item.targetDeviceBinding === detail.plan.targetDeviceBinding
      && Date.parse(item.expiresAt) > Date.now())) throw new RepairError('repair-approval-required')
    const nonce = randomUUID(), expiresAt = Math.min(Date.now() + 300_000, Date.parse(detail.case.expiresAt))
    this.#challenges.set(nonce, { nonce, caseId: id, owner, revision: expectedRevision, level, channel,
      planDigest: detail.plan.digest, patchDigest: patchDigest ?? '0'.repeat(64),
      ...(level === 'installation' ? { artifactDigest: detail.buildArtifact!.artifactDigest } : {}),
      projectRevision: detail.case.projectRevision, expiresAt })
    return { nonce, caseId: id, revision: expectedRevision, level, planDigest: detail.plan.digest,
      ...(level === 'execution' ? { patchDigest } : {}),
      ...(level === 'installation' ? { artifactDigest: detail.buildArtifact!.artifactDigest,
        appId: detail.buildArtifact!.appId, platform: detail.buildArtifact!.platform,
        targetDeviceBinding: detail.plan.targetDeviceBinding } : {}),
      expiresAt: new Date(expiresAt).toISOString() }
  }

  /** Consume before any write; failures need a new explicit gesture, never a replay. */
  async approve(id: string, owner: string, expectedRevision: number, nonce: string,
    channel: Challenge['channel'] = 'local-viewer'): Promise<RepairCase> {
    if (!this.#accepting) throw new RepairError('repair-interrupted')
    const challenge = this.#challenges.get(nonce)
    this.#challenges.delete(nonce)
    if (!challenge || challenge.caseId !== id || challenge.owner !== owner || challenge.revision !== expectedRevision
      || challenge.channel !== channel
      || challenge.expiresAt <= Date.now()) throw new RepairError('repair-stale-approval')
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision || detail.plan.digest !== challenge.planDigest
      || detail.case.projectRevision !== challenge.projectRevision
      || (detail.candidate?.digest ?? detail.patchSubmission?.patchDigest ?? '0'.repeat(64)) !== challenge.patchDigest
      || (challenge.level === 'installation' && detail.buildArtifact?.artifactDigest !== challenge.artifactDigest))
      throw new RepairError('repair-stale-approval')
    await this.#assertCurrentPermission(detail, challenge.level)
    if (challenge.level === 'installation') {
      const policy = (await this.projectLoader()).repair?.source
      if (!policy) throw new RepairError('repair-capability-unavailable')
      await verifyRepairArtifact(detail.buildArtifact!, policy, this.workbench.store.root)
    }
    const now = new Date(), expiresAt = new Date(Math.min(now.getTime() + detail.case.budget.approvalMs, Date.parse(detail.case.expiresAt)))
    const approval = repairApprovalSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: id, principal: owner,
      channel, level: challenge.level, planDigest: detail.plan.digest,
      projectRevision: detail.case.projectRevision, targetDeviceBinding: detail.plan.targetDeviceBinding,
      ...(challenge.level !== 'scope' ? { patchDigest: challenge.patchDigest } : {}),
      ...(challenge.level === 'installation' ? { artifactDigest: challenge.artifactDigest } : {}),
      allowedOperations: challenge.level === 'scope' ? ['share-evidence', 'generate-patch']
        : challenge.level === 'installation' ? ['install']
          : detail.case.route === 'product-code' ? ['software-check'] : ['baseline', 'revalidate', 'regress'],
      issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString() })
    const accepted = await this.records.appendApproval(id, expectedRevision, approval)
    if (detail.case.route === 'product-code' && challenge.level === 'scope')
      return this.issueHostRequest(id, owner, accepted.revision)
    return accepted
  }

  async #assertCurrentPermission(detail: RepairDetail, level: 'scope' | 'execution' | 'installation'): Promise<void> {
    return this.#assertOperationPermission(detail, level === 'scope' ? 'plan' : 'verify')
  }

  async #assertOperationPermission(detail: RepairDetail, operation: 'plan' | 'verify' | 'cancel'): Promise<void> {
    const project = await this.projectLoader(), snapshot = await this.workbench.store.readOnlySnapshot(detail.case.sourceSnapshot.runId)
    if (snapshot.manifestSha256 !== detail.case.sourceSnapshot.manifestSha256)
      throw new RepairError('repair-evidence-unavailable')
    const source = snapshot.run
    const flowId = source.flowId ?? Object.keys(project.flows).find(id => project.flows[id] === source.yaml)
    if (!flowId) throw new RepairError('repair-project-changed')
    assertRepairPermission(repairRegistration(project), operation, {
      projectId: detail.case.projectId, flowId, platform: source.platform,
      appId: source.productContract?.provenance.app.id.value ?? '', revision: detail.case.projectRevision,
    })
    assertFrozenPlan(detail.plan, source, project)
  }

  /** Internal preparation only: execution still needs a durable attempt and child reference gate. */
  async prepareApprovedCandidate(id: string, owner: string) {
    const detail = await this.get(id, owner)
    if (detail.case.phase !== 'queued' || !detail.candidate) throw new RepairError('repair-approval-required')
    await this.#assertCurrentPermission(detail, 'execution')
    if (!detail.approvals.some(item => item.level === 'execution' && item.patchDigest === detail.candidate!.digest
      && item.planDigest === detail.plan.digest && Date.parse(item.expiresAt) > Date.now()))
      throw new RepairError('repair-approval-required')
    const project = await this.projectLoader()
    const snapshot = await this.workbench.store.readOnlySnapshot(detail.case.sourceSnapshot.runId)
    if (snapshot.manifestSha256 !== detail.case.sourceSnapshot.manifestSha256)
      throw new RepairError('repair-evidence-unavailable')
    const source = snapshot.run
    return compilePrivateLocatorCandidate(detail.plan, detail.candidate, source, project)
  }

  /** Accept promptly; the durable attempt and device reservation precede the background checks. */
  async acceptMock(id: string, owner: string, expectedRevision: number): Promise<RepairCase> {
    if (!this.#accepting || this.#activeVerification) throw new RepairError('repair-busy')
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
    if (detail.case.phase !== 'queued' || detail.plan.target !== 'mock' || !detail.candidate)
      throw new RepairError('repair-capability-unavailable')
    const privateCandidate = await this.prepareApprovedCandidate(id, owner)
    const project = await this.projectLoader(), source = (await this.workbench.store.readOnlySnapshot(detail.case.sourceSnapshot.runId)).run
    const registration = repairRegistration(project)!
    const state = this.workbench.mirror.state()
    if (state.provider !== 'mock' || state.sessionId !== source.sessionId)
      throw new RepairError('repair-project-changed')
    const expectedYaml = new Map<string, string>()
    for (const [index, check] of detail.plan.requiredChecks.entries()) {
      const yaml = check.kind === 'candidate' ? detail.candidate.yaml : check.kind === 'baseline' ? source.yaml
        : project.flows[registration.policy.regressionFlows[index - 3]!]
      if (!yaml) throw new RepairError('repair-project-changed')
      expectedYaml.set(check.id, yaml)
    }
    let releaseEvidence: (() => void) | undefined, releaseDevice: (() => Promise<void>) | undefined
    try {
      try { releaseEvidence = await this.workbench.store.reserveEvidence(`repair-execution:${id}`, detail.case.budget.evidenceBytes) }
      catch { throw new RepairError('repair-storage-insufficient') }
      releaseDevice = this.workbench.mirror.reserveRepair(id)
      const attempt = repairAttemptSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: id,
        generation: detail.case.generation + 1, requestDigest: detail.case.requestDigest,
        patchDigest: detail.candidate.digest, planDigest: detail.plan.digest, createdAt: new Date().toISOString(),
        childRunIds: [], commandReceipts: [], artifactRefs: [], baselineRuns: 0, candidateRuns: 0, regressionRuns: 0, executionMs: 0 })
      const accepted = await this.records.beginAttempt(id, expectedRevision, attempt)
      const abort = new AbortController()
      const done = this.#runMockChecks(id, owner, attempt.id, privateCandidate, project, source, expectedYaml, abort,
        releaseEvidence, releaseDevice)
      this.#activeVerification = { id, owner, abort, done }
      // The HTTP caller only observes acceptance. Keep terminal failures handled and visible in the journal.
      void done.then(() => { if (this.#activeVerification?.done === done) this.#activeVerification = undefined },
        () => { if (this.#activeVerification?.done === done) this.#activeVerification = undefined })
      return accepted
    } catch (error) {
      if (!this.#activeVerification) {
        await releaseDevice?.()
        releaseEvidence?.()
      }
      throw error
    }
  }

  /** Internal test helper: unlike the transport, wait for the actual child and cleanup. */
  async verifyMock(id: string, owner: string, expectedRevision: number): Promise<RepairCase> {
    await this.acceptMock(id, owner, expectedRevision)
    const active = this.#activeVerification
    if (!active || active.id !== id) return (await this.get(id, owner)).case
    return active.done
  }

  async acceptCode(id: string, owner: string, expectedRevision: number): Promise<RepairCase> {
    if (!this.#accepting || this.#activeVerification) throw new RepairError('repair-busy')
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
    if (detail.case.route !== 'product-code' || detail.case.phase !== 'queued'
      || !detail.hostRequest || !detail.patchSubmission) throw new RepairError('repair-ineligible')
    await this.#assertOperationPermission(detail, 'verify')
    const project = await this.projectLoader(), policy = project.repair?.source
    if (!policy || policy.repositoryId !== detail.hostRequest.repositoryId)
      throw new RepairError('repair-project-changed')
    let releaseEvidence: (() => void) | undefined
    try {
      releaseEvidence = await this.workbench.store.reserveEvidence(`repair-code:${id}`, detail.case.budget.evidenceBytes)
    } catch { throw new RepairError('repair-storage-insufficient') }
    try {
      const attempt = repairAttemptSchema.parse({ contractVersion: 1, id: detail.hostRequest.attemptId,
        caseId: id, generation: detail.hostRequest.generation, requestDigest: detail.case.requestDigest,
        patchDigest: detail.patchSubmission.patchDigest, planDigest: detail.plan.digest,
        createdAt: new Date().toISOString(), childRunIds: [], commandReceipts: [], artifactRefs: [],
        baselineRuns: 0, candidateRuns: 0, regressionRuns: 0, executionMs: 0 })
      const accepted = await this.records.beginAttempt(id, expectedRevision, attempt)
      const abort = new AbortController()
      const done = this.#runCodeChecks(id, owner, detail.hostRequest.sourceTreeDigest,
        detail.hostRequest.oracleDigest, detail.hostRequest.toolchainDigest,
        detail.patchSubmission.patch, policy, abort, releaseEvidence)
      this.#activeVerification = { id, owner, abort, done }
      void done.then(() => { if (this.#activeVerification?.done === done) this.#activeVerification = undefined },
        () => { if (this.#activeVerification?.done === done) this.#activeVerification = undefined })
      return accepted
    } catch (error) { releaseEvidence(); throw error }
  }

  /** Internal test helper: wait for the trusted command runner and terminal journal. */
  async verifyCode(id: string, owner: string, expectedRevision: number): Promise<RepairCase> {
    await this.acceptCode(id, owner, expectedRevision)
    const active = this.#activeVerification
    return active?.id === id ? active.done : (await this.get(id, owner)).case
  }

  /** Installation is local-only and requires a separate exact-artifact approval. */
  async acceptInstall(id: string, owner: string, expectedRevision: number): Promise<RepairCase> {
    if (!this.#accepting || this.#activeVerification) throw new RepairError('repair-busy')
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
    const artifact = detail.buildArtifact
    if (detail.case.phase !== 'installing' || !artifact || detail.installIntent)
      throw new RepairError('repair-ineligible')
    await this.#assertOperationPermission(detail, 'verify')
    if (!detail.approvals.some(approval => approval.level === 'installation'
      && approval.artifactDigest === artifact.artifactDigest
      && approval.patchDigest === artifact.patchDigest
      && approval.targetDeviceBinding === detail.plan.targetDeviceBinding
      && Date.parse(approval.expiresAt) > Date.now())) throw new RepairError('repair-approval-required')
    const project = await this.projectLoader(), policy = project.repair?.source
    if (!policy) throw new RepairError('repair-capability-unavailable')
    await verifyRepairArtifact(artifact, policy, this.workbench.store.root)
    if (!this.workbench.mirror.repairMaintenanceAvailable(artifact.appId, artifact.platform))
      throw new RepairError('repair-capability-unavailable')
    let releaseEvidence: (() => void) | undefined, releaseDevice: (() => Promise<void>) | undefined
    try {
      releaseEvidence = await this.workbench.store.reserveEvidence(`repair-install:${id}`, 8 * 1024 * 1024)
      releaseDevice = this.workbench.mirror.reserveRepair(id)
      const accepted = await this.records.prepareInstall(id, expectedRevision)
      const abort = new AbortController()
      const done = this.#runInstall(id, owner, artifact, policy, abort, releaseEvidence, releaseDevice)
      this.#activeVerification = { id, owner, abort, done }
      void done.then(() => { if (this.#activeVerification?.done === done) this.#activeVerification = undefined },
        () => { if (this.#activeVerification?.done === done) this.#activeVerification = undefined })
      return accepted
    } catch (error) {
      await releaseDevice?.(); releaseEvidence?.()
      throw error instanceof RepairError ? error : new RepairError('repair-busy')
    }
  }

  async #runInstall(id: string, owner: string,
    artifact: NonNullable<RepairDetail['buildArtifact']>,
    policy: NonNullable<ProjectSnapshot['repair']>['source'] & object, abort: AbortController,
    releaseEvidence: () => void, releaseDevice: () => Promise<void>): Promise<RepairCase> {
    try {
      await this.cutpoint('install:after-intent')
      await verifyRepairArtifact(artifact, policy, this.workbench.store.root)
      abort.signal.throwIfAborted()
      await this.#assertOperationPermission(await this.get(id, owner), 'verify')
      await this.cutpoint('install:before-dispatch')
      const receipt = await this.workbench.mirror.installRepairArtifact(id, {
        artifactPath: artifact.artifactPath, artifactDigest: artifact.artifactDigest,
        appId: artifact.appId, buildMarker: artifact.buildMarker, platform: artifact.platform,
      }, abort.signal)
      await this.cutpoint('install:after-dispatch')
      const identity = await this.workbench.mirror.readRepairInstalledIdentity(id, artifact.appId, artifact)
      await this.cutpoint('install:after-identity')
      const current = await this.records.get(id)
      if (abort.signal.aborted || current.cancelRequestedAt) throw new RepairError('repair-cancelled')
      // No provider-specific reset/cleanup contract is available yet. Preserve software evidence,
      // but never promote a Mock or bare installation receipt to device-verified.
      return await this.records.completeInstall(id, current.revision, receipt, identity, identity.state)
    } catch {
      this.workbench.mirror.fenceRepairUnknown(id)
      const current = await this.records.get(id)
      if (current.phase === 'blocked' || current.phase === 'finished') return current
      return await this.records.markInstallUnknown(id, current.revision)
    } finally { await releaseDevice(); releaseEvidence() }
  }

  async inspectInstallAfterInterruption(id: string, owner: string) {
    const detail = await this.get(id, owner)
    if (detail.case.phase !== 'blocked' || detail.installIntent?.status !== 'unknown' || !detail.buildArtifact)
      throw new RepairError('repair-ineligible')
    // The unknown-state journal may be visible before the install worker's finally
    // releases the exclusive device lease. Never race that teardown with inspection.
    if (this.#activeVerification?.id === id) await this.#activeVerification.done
    const release = this.workbench.mirror.reserveRepairInspection(id)
    try {
      const artifact = detail.buildArtifact
      const identity = await this.workbench.mirror.readRepairInstalledIdentity(id, artifact.appId, artifact)
      return { ...identity, limitation: 'read-only-inspection-does-not-resume-or-verify-repair' as const }
    } finally { await release() }
  }

  async #runCodeChecks(id: string, owner: string, baseTreeDigest: string,
    oracleDigest: string, toolchainDigest: string, patch: string,
    policy: NonNullable<ProjectSnapshot['repair']>['source'] & object, abort: AbortController,
    releaseEvidence: () => void): Promise<RepairCase> {
    let evidenceReleased = false
    try {
      const started = await this.records.get(id)
      await this.records.update(id, started.revision, value => ({ ...value, revision: value.revision + 1,
        phase: 'checking', updatedAt: new Date().toISOString() }))
      await this.cutpoint('code:after-intent')
      const results: SourceCheckResult[] = []
      for (let index = 0; index < 2; index++) {
        abort.signal.throwIfAborted()
        const detail = await this.get(id, owner)
        await this.#assertOperationPermission(detail, 'verify')
        const resolved = await resolveRepairSource(policy, policy.repositoryId)
        if (await hashRepairTree(resolved.oracleRoot) !== oracleDigest
          || await hashRepairToolchain(policy) !== toolchainDigest)
          throw new RepairError('repair-project-changed')
        if (detail.case.phase !== 'checking' || detail.case.cancelRequestedAt
          || Date.now() - Date.parse(detail.attempts.at(-1)!.createdAt) >= detail.case.budget.executionMs)
          throw new RepairError('repair-budget-exhausted')
        const workspace = await createRepairWorkspaces(policy)
        try {
          if (workspace.baseTreeDigest !== baseTreeDigest) throw new RepairError('repair-project-changed')
          await this.cutpoint('code:before-command')
          const result = await checkRepairPatch(workspace, policy, patch, abort.signal)
          await this.cutpoint('code:after-command')
          if (result.oracleDigest !== oracleDigest || await hashRepairToolchain(policy) !== toolchainDigest)
            throw new RepairError('repair-project-changed')
          results.push(result)
        } finally { await workspace.close() }
        const current = await this.records.get(id)
        if (abort.signal.aborted || current.cancelRequestedAt) throw new RepairError('repair-cancelled')
        await this.records.appendSourceCheck(id, current.revision, results.at(-1)!)
        await this.cutpoint('code:after-receipt')
      }
      const current = await this.records.get(id)
      await this.#assertOperationPermission(await this.get(id, owner), 'verify')
      if (abort.signal.aborted || current.cancelRequestedAt) throw new RepairError('repair-cancelled')
      const finalizing = await this.records.update(id, current.revision, value => ({ ...value,
        revision: value.revision + 1, phase: 'finalizing', updatedAt: new Date().toISOString() }))
      await this.cutpoint('code:before-finalize')
      const detail = await this.get(id, owner)
      const hasBuild = policy.builds.some(build => build.platform === detail.plan.platform && build.appId === detail.plan.appId)
      const software = await this.records.finishCodeAttempt(id, finalizing.revision,
        results as [SourceCheckResult, SourceCheckResult], hasBuild)
      if (software.phase !== 'building') return software
      releaseEvidence(); evidenceReleased = true
      abort.signal.throwIfAborted()
      await this.#assertOperationPermission(await this.get(id, owner), 'verify')
      const artifact = await buildRepairArtifact(this.workbench.store, policy, {
        platform: detail.plan.platform, appId: detail.plan.appId, patch,
        baseTreeDigest, oracleDigest, toolchainDigest,
        evidenceBytes: detail.case.budget.evidenceBytes }, abort.signal)
      await this.cutpoint('build:after-artifact')
      if (abort.signal.aborted || (await this.records.get(id)).cancelRequestedAt)
        throw new RepairError('repair-cancelled')
      await verifyRepairArtifact(artifact, policy, this.workbench.store.root)
      return await this.records.publishBuildArtifact(id, (await this.records.get(id)).revision, artifact)
    } catch (error) {
      const current = await this.records.get(id)
      if (current.phase === 'finished') return current
      const cancelled = Boolean(current.cancelRequestedAt || abort.signal.aborted)
      const reason = cancelled ? 'repair-cancelled'
        : error instanceof RepairError ? error.code : 'repair-unknown-mutation'
      if (current.phase === 'cancelling' && current.verificationIds.length > 0)
        return await this.records.update(id, current.revision, value => ({ ...value,
          revision: value.revision + 1, phase: 'finished', outcome: 'cancelled', reason,
          updatedAt: new Date().toISOString() }))
      if (current.phase === 'building' || current.phase === 'awaiting-approval')
        return await this.records.update(id, current.revision, value => ({ ...value,
          revision: value.revision + 1, phase: 'blocked', outcome: 'inconclusive', reason,
          updatedAt: new Date().toISOString() }))
      const stopped = await this.records.stopAttempt(id, current.revision,
        cancelled ? 'cancelled' : 'inconclusive', reason)
      return await this.records.update(id, stopped.revision, value => ({ ...value,
        revision: value.revision + 1, phase: 'finished',
        outcome: cancelled ? 'cancelled' : 'inconclusive', reason, updatedAt: new Date().toISOString() }))
    } finally { if (!evidenceReleased) releaseEvidence() }
  }

  async #runMockChecks(id: string, owner: string, attemptId: string,
    privateCandidate: Awaited<ReturnType<WorkbenchRepairCoordinator['prepareApprovedCandidate']>>,
    project: ProjectSnapshot, source: import('./workbench-domain.js').TestRun,
    expectedYaml: Map<string, string>, abort: AbortController,
    releaseEvidence: () => void, releaseDevice: () => Promise<void>): Promise<RepairCase> {
    let resetMayBeUnknown = false
    try {
      const plan = await this.records.plan(id), candidate = await this.records.candidate(id)
      if (!candidate) throw new RepairError('repair-ineligible')
      for (const check of plan.requiredChecks) {
        abort.signal.throwIfAborted()
        const detail = await this.get(id, owner)
        const attempt = detail.attempts.at(-1)
        if (!attempt || Date.now() - Date.parse(attempt.createdAt) >= detail.case.budget.executionMs)
          throw new RepairError('repair-budget-exhausted')
        await this.#assertCurrentPermission(detail, 'execution')
        const expectedPhase = check.kind === 'baseline' ? 'preparing' : check.kind === 'candidate' ? 'revalidating' : 'regressing'
        if (detail.case.cancelRequestedAt || detail.case.phase !== expectedPhase
          || Date.parse(detail.case.expiresAt) <= Date.now()) throw new RepairError('repair-cancelled')
        await this.cutpoint('reset:before-intent')
        const intent = await this.records.prepareReset(id, detail.case.revision, attemptId, check.id)
        resetMayBeUnknown = true
        await this.cutpoint('reset:after-intent')
        const reset = await this.workbench.mirror.resetRepairFixture(id)
        await this.cutpoint('reset:after-dispatch')
        const afterReset = await this.records.get(id)
        await this.records.completeReset(id, afterReset.revision, intent.id, reset)
        resetMayBeUnknown = false
        await this.cutpoint('reset:after-receipt')
        const ready = await this.records.get(id)
        if (abort.signal.aborted || ready.cancelRequestedAt) throw new RepairError('repair-cancelled')
        const yaml = expectedYaml.get(check.id)!
        let openGate!: () => void
        const executeGate = new Promise<void>(resolve => { openGate = resolve })
        const isCandidate = check.kind === 'candidate'
        let runId: string | undefined
        try {
          const started = await this.workbench.start(yaml, source.id, undefined, {
            executeGate, repairOwner: id, source: 'viewer', flowId: isCandidate ? privateCandidate.flowId
              : check.kind === 'baseline' ? source.flowId! : repairRegistration(project)!.policy.regressionFlows[plan.requiredChecks.indexOf(check) - 3]!,
            project: isCandidate ? privateCandidate.project : project,
            ...(isCandidate ? { plan: privateCandidate.execution, repair: candidate } : {}),
            params: check.kind === 'regression' ? {} : source.params ?? {},
          })
          runId = started.id
          await this.cutpoint('child:after-create')
          await this.records.protectChild(id, (await this.records.get(id)).revision, runId)
          await this.cutpoint('child:after-reference')
          openGate()
          await this.workbench.wait()
          await this.cutpoint('child:after-exit')
          await this.records.completeChildCheck(id, (await this.records.get(id)).revision, attemptId, check.id, runId)
        } catch (error) {
          if (runId && this.workbench.activeId === runId) await this.workbench.cancel(runId)
          openGate()
          if (runId) await this.workbench.wait()
          throw error
        }
      }
      const detail = await this.get(id, owner)
      await this.#assertCurrentPermission(detail, 'execution')
      if (abort.signal.aborted || detail.case.cancelRequestedAt) throw new RepairError('repair-cancelled')
      return await this.records.finishMockAttempt(id, detail.case.revision, expectedYaml)
    } catch (error) {
      if (resetMayBeUnknown) this.workbench.mirror.fenceRepairUnknown(id)
      const activeId = this.workbench.activeId
      if (activeId) { await this.workbench.cancel(activeId).catch(() => undefined); await this.workbench.wait() }
      const current = await this.records.get(id)
      if (current.phase === 'finished') return current
      const cancelled = !resetMayBeUnknown && Boolean(current.cancelRequestedAt || abort.signal.aborted)
      const reason = resetMayBeUnknown ? 'repair-unknown-mutation'
        : error instanceof RepairError ? error.code : 'repair-unknown-mutation'
      const stopped = await this.records.stopAttempt(id, current.revision, cancelled ? 'cancelled' : 'inconclusive', reason)
      return await this.records.update(id, stopped.revision, value => ({ ...value, revision: value.revision + 1,
        phase: 'finished', outcome: cancelled ? 'cancelled' : 'inconclusive',
        reason, updatedAt: new Date().toISOString() }))
    } finally {
      await releaseDevice()
      releaseEvidence()
    }
  }

  async create(input: CreateRepairInput, owner: string): Promise<RepairCase> {
    await this.recoverInterrupted()
    if (!this.#accepting) throw new RepairError('repair-interrupted')
    repairId.parse(input.requestId); repairId.parse(input.sourceRunId); repairId.parse(input.baselineRunId)
    // Serialize local create deduplication; the journal remains the cross-restart authority.
    let release!: () => void
    const next = new Promise<void>(resolve => { release = resolve })
    const previous = this.#creation; this.#creation = next
    await previous
    try {
      const project = await this.projectLoader(), registration = repairRegistration(project)
      const source = (await this.workbench.store.readOnlySnapshot(input.sourceRunId)).run
      assertRepairPermission(registration, 'plan', { projectId: registration?.policy.projectId ?? '', flowId: input.flowId,
        platform: source.platform, appId: source.productContract?.provenance.app.id.value ?? '' })
      const requestDigest = stepDigest({ input, projectRevision: registration.revision })
      const existing = await this.records.findRequest(registration.policy.projectId, owner, input.requestId)
      if (existing) {
        if (existing.requestDigest !== requestDigest) throw new RepairError('repair-request-conflict')
        if (existing.phase !== 'planning' || await this.records.candidate(existing.id)) return existing
        const proposal = await admitLocatorProposal(this.workbench.store, project, input.sourceRunId, input.baselineRunId, input.flowId)
        return this.records.registerCandidate(existing.id, existing.revision, proposal)
      }
      const proposal = await admitLocatorProposal(this.workbench.store, project, input.sourceRunId, input.baselineRunId, input.flowId)
      const id = randomUUID(), plan = await freezeLocatorPlan(this.workbench.store, project, proposal, id, input.flowId)
      const createdAt = new Date(), budget = registration.policy.budget
      const record = repairCaseSchema.parse({ contractVersion: 1, id, requestId: input.requestId, requestDigest,
        projectId: registration.policy.projectId, projectRevision: registration.revision, owner,
        sourceSnapshot: plan.sourceSnapshot, route: plan.route, planId: plan.id, planDigest: plan.digest,
        phase: 'planning', revision: 1, generation: 0, attempts: [], approvals: [], verificationIds: [], budget,
        spentExecutionMs: 0, createdAt: createdAt.toISOString(), updatedAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + budget.lifetimeMs).toISOString() })
      await this.records.create(record, plan)
      return this.records.registerCandidate(id, 1, proposal)
    } finally { release() }
  }

  async createCode(input: CreateCodeRepairInput, owner: string): Promise<RepairCase> {
    await this.recoverInterrupted()
    if (!this.#accepting) throw new RepairError('repair-interrupted')
    repairId.parse(input.requestId); repairId.parse(input.sourceRunId)
    let release!: () => void
    const next = new Promise<void>(resolve => { release = resolve })
    const previous = this.#creation; this.#creation = next
    await previous
    try {
      const project = await this.projectLoader(), registration = repairRegistration(project)
      const source = (await this.workbench.store.readOnlySnapshot(input.sourceRunId)).run
      assertRepairPermission(registration, 'plan', { projectId: registration?.policy.projectId ?? '', flowId: input.flowId,
        platform: source.platform, appId: source.productContract?.provenance.app.id.value ?? '' })
      if (registration.policy.source?.repositoryId !== input.repositoryId)
        throw new RepairError('repair-not-found')
      if (registration.policy.source.isolation !== 'trusted-local')
        throw new RepairError('repair-capability-unavailable')
      const requestDigest = stepDigest({ input, projectRevision: registration.revision })
      const existing = await this.records.findRequest(registration.policy.projectId, owner, input.requestId)
      if (existing) {
        if (existing.requestDigest !== requestDigest) throw new RepairError('repair-request-conflict')
        if (existing.phase === 'planning') return this.records.openCodeScope(existing.id, existing.revision)
        const detail = await this.get(existing.id, owner)
        if (existing.phase === 'awaiting-approval' && !detail.hostRequest
          && detail.approvals.some(item => item.level === 'scope'
            && item.planDigest === detail.plan.digest && Date.parse(item.expiresAt) > Date.now()))
          return this.issueHostRequest(existing.id, owner, existing.revision)
        return existing
      }
      const id = randomUUID(), plan = await freezeCodePlan(this.workbench.store, project,
        input.sourceRunId, id, input.flowId, input.repositoryId)
      const now = new Date(), budget = registration.policy.budget
      const record = repairCaseSchema.parse({ contractVersion: 1, id, requestId: input.requestId, requestDigest,
        projectId: registration.policy.projectId, projectRevision: registration.revision, owner,
        sourceSnapshot: plan.sourceSnapshot, route: plan.route, planId: plan.id, planDigest: plan.digest,
        phase: 'planning', revision: 1, generation: 0, attempts: [], approvals: [], verificationIds: [], budget,
        spentExecutionMs: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + budget.lifetimeMs).toISOString() })
      const created = await this.records.create(record, plan)
      return this.records.openCodeScope(created.id, created.revision)
    } finally { release() }
  }

  /** Source access begins only after a durable local scope approval. */
  async issueHostRequest(id: string, owner: string, expectedRevision: number): Promise<RepairCase> {
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
    if (detail.hostRequest) return detail.case
    if (detail.case.route !== 'product-code' || detail.case.phase !== 'awaiting-approval'
      || !detail.approvals.some(item => item.level === 'scope' && item.planDigest === detail.plan.digest
        && item.projectRevision === detail.case.projectRevision && Date.parse(item.expiresAt) > Date.now()))
      throw new RepairError('repair-approval-required')
    await this.#assertOperationPermission(detail, 'plan')
    const project = await this.projectLoader(), policy = project.repair?.source
    if (!policy) throw new RepairError('repair-capability-unavailable')
    if (policy.isolation !== 'trusted-local') throw new RepairError('repair-capability-unavailable')
    const resolved = await resolveRepairSource(policy, policy.repositoryId)
    const generation = await createGenerationWorkspace(policy)
    let retained = false
    try {
      const source = (await this.workbench.store.readOnlySnapshot(detail.case.sourceSnapshot.runId)).run
      const allowed = new Set(policy.evidenceNames)
      const evidence = source.steps.flatMap(step => step.evidence)
        .filter(item => allowed.has(item.name)).slice(0, 20)
        .map(item => ({ name: item.name, digest: item.sha256 }))
      const now = new Date(), request = createHostRepairRequest({ protocolVersion: 1,
        id: randomUUID(), caseId: id, attemptId: randomUUID(), generation: detail.case.generation + 1,
        repositoryId: policy.repositoryId, baseCommit: policy.baseCommit,
        projectRevision: detail.case.projectRevision, planDigest: detail.plan.digest,
        sourceTreeDigest: generation.baseTreeDigest,
        oracleDigest: await hashRepairTree(resolved.oracleRoot),
        toolchainDigest: await hashRepairToolchain(policy),
        generationWorkspace: generation.path,
        issuedAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + 1_800_000,
          Date.parse(detail.case.expiresAt))).toISOString(),
        permittedPaths: policy.writablePaths, evidence })
      const published = await this.records.publishHostRequest(id, expectedRevision, request)
      retained = true
      return published
    } finally { if (!retained) await generation.close() }
  }

  async submitCodePatch(id: string, owner: string, expectedRevision: number, raw: unknown): Promise<RepairCase> {
    const detail = await this.get(id, owner)
    if (detail.case.revision !== expectedRevision) throw new RepairError('repair-revision-conflict')
    if (detail.case.route !== 'product-code' || !detail.hostRequest || detail.patchSubmission)
      throw new RepairError('repair-ineligible')
    await this.#assertOperationPermission(detail, 'plan')
    const project = await this.projectLoader(), registration = repairRegistration(project)
    const source = (await this.workbench.store.readOnlySnapshot(detail.case.sourceSnapshot.runId)).run
    assertRepairPermission(registration, 'submit', { projectId: detail.case.projectId,
      flowId: source.flowId ?? Object.keys(project.flows).find(key => project.flows[key] === source.yaml) ?? '',
      platform: source.platform,
      appId: source.productContract?.provenance.app.id.value ?? '', revision: detail.case.projectRevision })
    const policy = project.repair?.source
    if (!policy) throw new RepairError('repair-capability-unavailable')
    const submission = assertHostSubmission(detail.hostRequest, raw)
    inspectSourcePatch(submission.patch, policy)
    const workspaces = await createRepairWorkspaces(policy)
    try {
      if (workspaces.baseTreeDigest !== detail.hostRequest.sourceTreeDigest)
        throw new RepairError('repair-project-changed')
      const resolved = await resolveRepairSource(policy, policy.repositoryId)
      if (await hashRepairTree(resolved.oracleRoot) !== detail.hostRequest.oracleDigest
        || await hashRepairToolchain(policy) !== detail.hostRequest.toolchainDigest)
        throw new RepairError('repair-project-changed')
      await preflightRepairPatch(workspaces, policy, submission.patch)
      return this.records.registerCodePatch(id, expectedRevision, submission)
    } finally { await workspaces.close() }
  }
}
