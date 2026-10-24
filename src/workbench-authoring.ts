import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { WorkbenchAcceptance, type AcceptanceChannel, type AcceptanceWritePoint } from './workbench-acceptance.js'
import { sha256 } from './content-hash.js'
import { stableJson } from './workbench-comparison.js'
import { compilePlan, type ExecutionPlan } from './workbench-plan.js'
import { loadTestProject } from './workbench-project.js'
import { lintWorkbenchFlow, lintWorkbenchSyntax, validationErrorLine } from './workbench-lint.js'
import { referencePublicationsSchema } from './workbench-evidence-contracts.js'
import { syncBuiltinReferences, hasAgentTombstone } from './workbench-builtin-references.js'
import { parseVideoRequest, type VideoRequest } from './workbench-video.js'
import type { WorkbenchService } from './workbench-service.js'
import { PACKAGE_VERSION } from './version.js'
import { caseOriginSchema, type WorkbenchCaseLibrary } from './workbench-cases.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const targetSchema = z.object({ platform: z.enum(['ios', 'android']), appId: z.string().min(1).max(255), sessionId: z.string().max(256).nullable() }).strict()
export const authoringInputSchema = z.object({ yaml: z.string().min(1).refine(text => Buffer.byteLength(text) <= 64 * 1024),
  params: z.record(z.unknown()).default({}), target: targetSchema }).strict()
export const authoringRunSchema = z.object({ receipt: z.string().uuid(), inputDigest: hash, requestId: z.string().regex(/^[\p{L}\p{N}._:-]{1,128}$/u),
  localEvidence: z.literal(true), caseRevision: caseOriginSchema.optional(), video: z.object({ captureId: z.string().uuid(), sessionId: z.string(), startedAt: z.string() }).strict().optional() }).strict()
export const validationReceiptSchema = z.object({ token: z.string().uuid(), revisionDigest: hash, paramsDigest: hash, projectDigest: hash,
  compilerVersion: z.string(), targetBinding: targetSchema.extend({ generationToken: z.string().nullable() }), inputDigest: hash,
  expiresAt: z.string().datetime() }).strict()
const summarySchema = z.object({ verdict: z.string().optional(), exitCode: z.number().int().optional(), error: z.string().max(512).optional(),
  resultProjection: z.object({ contractVersion: z.literal(1), runId: z.string().uuid(), clean: z.boolean(), verdict: z.string().optional(),
    evidenceAvailability: z.enum(['verified', 'unavailable', 'not-checked', 'not-revalidated']),
    verification: z.object({ evidence: z.object({ status: z.string() }).strict() }).strict() }).strict().optional() }).strict()
export const authoringJournalSchema = z.object({ schemaVersion: z.literal(1), source: z.literal('viewer-authoring'),
  executionId: z.string().uuid(), requestId: z.string().max(128), requestKey: hash, requestHash: hash, runId: z.string().uuid(),
  phase: z.enum(['accepted', 'running', 'cancelling', 'finished']), acceptedAt: z.string().datetime(), endedAt: z.string().datetime().optional(),
  summary: summarySchema, referencePublications: referencePublicationsSchema.optional() }).strict()
type Journal = z.infer<typeof authoringJournalSchema>
type Receipt = z.infer<typeof validationReceiptSchema>
type Input = z.infer<typeof authoringInputSchema>

export class AuthoringError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'AuthoringError' }
}

/** Authoring owns drafts/receipts, never devices. Runs use the existing execution owner. */
export class WorkbenchAuthoring {
  readonly #channel: AcceptanceChannel<Journal>
  readonly #receipts = new Map<string, { receipt: Receipt; input: Input; plan: ExecutionPlan }>()
  readonly #jobs = new Map<string, Promise<void>>()
  readonly #failures: unknown[] = []
  #validating = 0
  readonly #now: () => number
  readonly #cases: WorkbenchCaseLibrary | undefined
  constructor(readonly workbench: WorkbenchService, acceptance: WorkbenchAcceptance, options: {
    now?: () => number; writeHook?: (point: AcceptanceWritePoint, journal: Readonly<Journal>) => void; cases?: WorkbenchCaseLibrary
  } = {}) {
    this.#now = options.now ?? Date.now
    this.#cases = options.cases
    this.#channel = acceptance.channel('authoring', {
      parse: value => authoringJournalSchema.parse(value),
      recover: async journal => {
        journal.phase = 'finished'; journal.endedAt = new Date(this.#now()).toISOString()
        journal.summary = { verdict: 'inconclusive', exitCode: 2, error: 'Interrupted; execution was not replayed' }
        await this.#save(journal)
      },
      drain: async () => {
        this.#receipts.clear()
        for (const entry of this.#channel.records.values()) if (entry.phase !== 'finished') await this.cancel(entry.executionId).catch(() => undefined)
        await Promise.allSettled(this.#jobs.values())
        if (this.#failures.length) throw new AggregateError(this.#failures, 'Authoring journal persistence failed')
      },
      ...(options.writeHook ? { writeHook: options.writeHook } : {}),
    })
  }
  async #project() { return this.workbench.baselines.applyApproved(await loadTestProject(this.workbench.projectPath)) }
  #binding(target: Input['target']) {
    return { ...target, generationToken: this.workbench.mirror.viewerInspectionContext()?.generationToken ?? null }
  }
  #checkTarget(receipt: Receipt): void {
    const state = this.workbench.mirror.state(), binding = receipt.targetBinding
    if (state.lifecycle !== 'streaming' || !binding.sessionId || state.sessionId !== binding.sessionId
      || this.workbench.mirror.testPlatform !== binding.platform
      || (this.workbench.mirror.viewerInspectionContext()?.generationToken ?? null) !== binding.generationToken)
      throw new AuthoringError('authoring-target-changed')
  }
  async validate(value: unknown) {
    this.#channel.assertAccepting()
    if (this.#validating >= 2) throw new AuthoringError('authoring-validation-busy', 429)
    if (Buffer.byteLength(JSON.stringify(value)) > 80 * 1024) throw new AuthoringError('authoring-input-budget', 413)
    const input = authoringInputSchema.parse(value), binding = this.#binding(input.target)
    this.#validating++
    try {
      const syntax = lintWorkbenchSyntax(input.yaml), advice = lintWorkbenchFlow(input.yaml)
      if (syntax.length) return { valid: false as const, blockers: syntax, advice }
      const project = await this.#project()
      let plan: ExecutionPlan
      try { plan = await compilePlan(input.yaml, project, input.params) }
      catch (error) {
        return { valid: false as const, blockers: [{ severity: 'error', message: message(error), line: validationErrorLine(input.yaml, error) }], advice,
          actionOnly: message(error).includes('At least one structured assertion') }
      }
      if (plan.header.appId !== input.target.appId || plan.header.platform !== input.target.platform) throw new AuthoringError('authoring-target-mismatch')
      const compilerVersion = `${PACKAGE_VERSION}:workbench-plan-v1`
      const identity = { revisionDigest: sha256(input.yaml), paramsDigest: sha256(stableJson(input.params)), projectDigest: project.sha256, compilerVersion, targetBinding: binding }
      const receipt = validationReceiptSchema.parse({ ...identity, token: randomUUID(), inputDigest: sha256(stableJson(identity)), expiresAt: new Date(this.#now() + 600_000).toISOString() })
      for (const [token, item] of this.#receipts) if (Date.parse(item.receipt.expiresAt) <= this.#now()) this.#receipts.delete(token)
      if (this.#receipts.size >= 100) throw new AuthoringError('authoring-receipt-budget', 429)
      this.#channel.assertAccepting()
      this.#receipts.set(receipt.token, { receipt, input: structuredClone(input), plan })
      let canRun = true
      try { this.#checkTarget(receipt) } catch { canRun = false }
      return { valid: true as const, receipt, canRun, name: plan.header.name, steps: plan.worstSteps, blockers: [], advice,
        scope: { ui: 'declared-assertions', business: plan.header.verify.length ? 'configured-not-executed' : 'not-performed' } }
    } finally { this.#validating-- }
  }
  async run(value: unknown, signal?: AbortSignal) {
    if (Buffer.byteLength(JSON.stringify(value)) > 80 * 1024) throw new AuthoringError('authoring-input-budget', 413)
    const input = authoringRunSchema.parse(value)
    return this.#channel.serialized(async () => {
      await this.#channel.init()
      const requestKey = sha256(`viewer-authoring\0${input.requestId}`), requestHash = sha256(stableJson(input))
      const previous = this.#channel.lookup(requestKey, requestHash)
      if (previous) return accepted(previous)
      signal?.throwIfAborted()
      const frozen = this.#receipts.get(input.receipt)
      if (!frozen || Date.parse(frozen.receipt.expiresAt) <= this.#now()) throw new AuthoringError('authoring-validation-expired')
      if (frozen.receipt.inputDigest !== input.inputDigest) throw new AuthoringError('authoring-input-changed')
      if ((await this.#project()).sha256 !== frozen.receipt.projectDigest) throw new AuthoringError('authoring-project-changed')
      if (input.caseRevision) {
        if (!this.#cases) throw new AuthoringError('authoring-case-unavailable')
        const revision = await this.#cases.revision(input.caseRevision.caseId, input.caseRevision.revisionId)
        if (revision.platform === 'web') throw new AuthoringError('web-case-requires-web-execution')
        if (revision.platform !== frozen.input.target.platform || revision.appId !== frozen.input.target.appId || revision.yaml !== frozen.input.yaml || stableJson(revision.publicParams) !== stableJson(frozen.input.params)
          || revision.projectDigest !== frozen.receipt.projectDigest || revision.contentDigest !== input.caseRevision.inputDigest) throw new AuthoringError('authoring-case-changed')
      }
      this.#checkTarget(frozen.receipt)
      if (this.workbench.activeId || this.workbench.suiteOwner || [...this.#channel.records.values()].some(entry => entry.phase !== 'finished')) throw new AuthoringError('authoring-device-busy')
      const video = input.video ? parseVideoRequest(input.video, frozen.receipt.targetBinding.sessionId) : undefined
      this.#channel.assertAccepting()
      const journal: Journal = { schemaVersion: 1, source: 'viewer-authoring', executionId: randomUUID(), requestId: input.requestId, requestKey, requestHash,
        runId: randomUUID(), phase: 'accepted', acceptedAt: new Date(this.#now()).toISOString(), summary: {} }
      await this.#save(journal); this.#channel.remember(journal)
      const response = accepted(journal)
      if (signal?.aborted || !this.#channel.accepting) {
        journal.phase = 'finished'; journal.endedAt = new Date(this.#now()).toISOString()
        journal.summary = { verdict: 'cancelled', exitCode: 130, error: 'Accepted but not dispatched' }; await this.#save(journal)
      } else {
        const job = this.#dispatch(journal, frozen, video, input.caseRevision).catch(error => {
          this.#failures.push(error); journal.phase = 'finished'; journal.summary = { verdict: 'inconclusive', exitCode: 2, error: 'Acceptance persistence failed; outcome unknown' }
        }).finally(() => this.#jobs.delete(journal.executionId))
        this.#jobs.set(journal.executionId, job)
      }
      return response
    })
  }
  async status(requestId: string) {
    z.string().regex(/^[\p{L}\p{N}._:-]{1,128}$/u).parse(requestId)
    await this.#channel.init()
    const id = this.#channel.requests.get(sha256(`viewer-authoring\0${requestId}`)), journal = id ? this.#channel.records.get(id) : undefined
    if (!journal) throw new AuthoringError('authoring-request-not-found', 404)
    if (journal.phase === 'finished') await this.#jobs.get(journal.executionId)
    return accepted(journal)
  }
  async cancel(executionId: string) {
    z.string().uuid().parse(executionId); await this.#channel.init()
    const journal = this.#channel.records.get(executionId)
    if (!journal) throw new AuthoringError('authoring-request-not-found', 404)
    if (journal.phase !== 'finished') {
      journal.phase = 'cancelling'; await this.#save(journal)
      if (this.workbench.activeId === journal.runId) await this.workbench.cancel(journal.runId)
    }
    return accepted(journal)
  }
  async #dispatch(journal: Journal, frozen: { receipt: Receipt; input: Input; plan: ExecutionPlan }, video?: VideoRequest, authoringOrigin?: z.infer<typeof caseOriginSchema>) {
    let openGate!: () => void
    const executeGate = new Promise<void>(resolve => { openGate = resolve })
    try {
      if (journal.phase === 'cancelling') throw new AuthoringError('authoring-cancelled-before-dispatch')
      journal.phase = 'running'; await this.#save(journal)
      this.#checkTarget(frozen.receipt)
      await this.workbench.start(frozen.input.yaml, undefined, video, { id: journal.runId, source: 'viewer', executeGate,
        plan: frozen.plan, project: frozen.plan.project, params: frozen.plan.params, ...(authoringOrigin ? { authoringOrigin } : {}),
        expectedTarget: { sessionId: frozen.receipt.targetBinding.sessionId!, generationToken: frozen.receipt.targetBinding.generationToken! } })
      await this.#save(journal)
      if (String(journal.phase) === 'cancelling' || !this.#channel.accepting) await this.workbench.cancel(journal.runId)
      openGate(); await this.workbench.wait()
      const run = await this.workbench.get(journal.runId)
      const projection = run.resultProjection
      journal.summary = projection ? { verdict: projection.verdict ?? 'inconclusive', exitCode: projection.exitCode,
        resultProjection: { contractVersion: 1, runId: run.id, clean: projection.clean, ...(projection.verdict ? { verdict: projection.verdict } : {}),
          evidenceAvailability: projection.evidenceAvailability, verification: { evidence: { status: projection.verification.evidence.status } } } } : { verdict: 'inconclusive', exitCode: 2 }
    } catch (error) {
      if (this.workbench.activeId === journal.runId) await this.workbench.cancel(journal.runId)
      openGate(); if (this.workbench.activeId === journal.runId) await this.workbench.wait()
      journal.summary = { verdict: 'inconclusive', exitCode: 2, error: message(error) }
    } finally {
      openGate(); journal.phase = 'finished'; journal.endedAt = new Date(this.#now()).toISOString(); await this.#save(journal)
    }
  }
  async #save(journal: Journal) {
    await this.#channel.persist(journal, async write => {
      if (journal.referencePublications === undefined) {
        try { await this.workbench.store.readOnlySnapshot(journal.runId) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await write(journal); return }; throw error }
      }
      await syncBuiltinReferences(this.workbench.store, 'workbench:authoring', journal.executionId, journal.referencePublications,
        hasAgentTombstone(journal) ? [] : [journal.runId], async publications => {
          await write({ ...journal, referencePublications: publications }); journal.referencePublications = publications
        })
    })
  }
}
function accepted(journal: Journal) { return { executionId: journal.executionId, runId: journal.runId, phase: journal.phase, acceptedAt: journal.acceptedAt,
  ...(journal.endedAt ? { endedAt: journal.endedAt } : {}), outcome: { verdict: journal.summary.verdict, exitCode: journal.summary.exitCode, error: journal.summary.error } } }
function message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 512) }
