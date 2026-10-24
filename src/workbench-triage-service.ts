import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultTriageAnalyzer, TriageAnalyzerRunner, type TriageAnalyzer } from './workbench-triage-analyzer.js'
import { z } from 'zod'
import { stableJson, type ComparisonReport, type WorkbenchComparisonService } from './workbench-comparison.js'
import { productContractReadState } from './workbench-contracts.js'
import { WorkbenchReferences } from './workbench-references.js'
import { sha256, validRunId, type WorkbenchStore } from './workbench-store.js'
import type { EvidenceFile, TestRun } from './workbench-domain.js'
import { triageJobSchema, triageReportSchema, triageReviewSchema, type TriageJob, type TriageReport, type TriageReview } from './workbench-triage-contracts.js'
import type { TriageAnalysis, TriageComparisonContext } from './workbench-triage-rules.js'
import { WorkbenchRepair } from './workbench-repair.js'

const startSchema = z.object({ requestId: z.string().uuid(), targetRunId: z.string().uuid(), comparisonId: z.string().uuid().optional() }).strict()
const reviewInputSchema = triageReviewSchema.omit({ schemaVersion: true, reviewId: true, createdAt: true, revision: true, supersedes: true }).extend({ expectedRevision: z.number().int().nonnegative() }).strict()
const terminal = new Set<TriageJob['state']>(['succeeded', 'cancelled', 'failed', 'interrupted'])
const MANIFEST_MAX = 4 * 1024 * 1024
const COMPARISON_MAX = 8 * 1024 * 1024

export class TriageError extends Error {
  constructor(readonly code: string) { super(code) }
}

/** Local, explicit triage generation. This service never asks a provider or model to act. */
export class WorkbenchTriageService {
  readonly root: string
  readonly #references: WorkbenchReferences
  readonly #repair: WorkbenchRepair
  readonly #analyzer: TriageAnalyzerRunner | null
  #closed = false
  #closePromise: Promise<void> | undefined
  #draining: Promise<void> | undefined
  #drainError: unknown
  #activeJob: string | undefined
  #pending: string[] = []
  #running = false
  #cancelled = new Set<string>()
  #workerStops = new Map<string, () => void>()
  #ready: Promise<void> | null = null
  #acceptTail: Promise<void> = Promise.resolve()
  #jobWrites = new Map<string, Promise<void>>()
  constructor(readonly store: WorkbenchStore, readonly comparisons: WorkbenchComparisonService, options: { analyzer?: TriageAnalyzer | null } = {}) {
    this.#analyzer = options.analyzer === null ? null : new TriageAnalyzerRunner(options.analyzer ?? defaultTriageAnalyzer())
    this.root = join(store.root, 'triage')
    this.#references = new WorkbenchReferences(store)
    this.#repair = new WorkbenchRepair(store)
  }

  async init(): Promise<void> {
    return this.#ready ??= (async () => {
      await this.store.init()
      await safeDirectory(this.root, true)
      for (const sub of ['jobs', 'reports', 'reviews', 'retired']) await safeDirectory(join(this.root, sub), true)
      for (const name of await readdir(join(this.root, 'jobs'))) {
        if (isTemporary(name)) continue
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) throw new TriageError('unsafe-triage-index')
        const job = triageJobSchema.parse(await readJson(join(this.root, 'jobs', name), 8192))
        if (!terminal.has(job.state)) {
          const committed = job.state === 'committing' && await this.#hasCompletePublication(job)
          if (!committed && job.reportId && !await exists(join(this.root, 'reports', `${job.reportId}.json`)))
            await this.#references.revoke(job.reportId, 'triage', job.reportId)
          await this.#saveJob({ ...job, state: committed ? 'succeeded' : 'interrupted', progress: committed ? 'succeeded' : 'interrupted', finishedAt: now() })
        }
      }
    })().catch(error => { this.#ready = null; throw error })
  }

  async start(input: z.input<typeof startSchema>): Promise<TriageJob> {
    if (this.#closed) throw new TriageError('triage-closed')
    if (!this.#analyzer) throw new TriageError('analyzer-disabled')
    const previous = this.#acceptTail
    let release!: () => void
    this.#acceptTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      if (this.#closed) throw new TriageError('triage-closed')
      return await this.#start(input)
    } finally { release() }
  }

  async #start(input: z.input<typeof startSchema>): Promise<TriageJob> {
    const value = startSchema.parse(input)
    await this.init()
    const request = { targetRunId: value.targetRunId, comparisonId: value.comparisonId ?? null, rulesVersion: 1 }
    const digest = sha256(stableJson({ ...request, analyzer: this.#analyzer!.identity }))
    const existing = await this.#findRequest(value.requestId)
    if (existing) {
      const legacy = !existing.analyzer && this.#analyzer!.identity.id === 'builtin.evidence-rules' && this.#analyzer!.identity.version === '1' && this.#analyzer!.identity.configDigest === sha256('{}') && existing.requestDigest === sha256(stableJson(request))
      if (existing.requestDigest !== digest && !legacy) throw new TriageError('request-conflict')
      return existing
    }
    if (this.#pending.length + Number(this.#running) >= 3) throw new TriageError('queue-full')
    const targetPath = join(this.store.root, value.targetRunId, 'manifest.json')
    await boundedStat(targetPath, MANIFEST_MAX)
    const snapshot = await this.store.readOnlySnapshot(value.targetRunId)
    if (snapshot.run.phase !== 'finished' || !snapshot.run.verdict) throw new TriageError('run-not-final')
    if (productContractReadState(snapshot.run) === 'unsupported') throw new TriageError('unsupported-contract')
    if (snapshot.run.steps.length > 2000 || (snapshot.run.diagnostics?.length ?? 0) > 5000) throw new TriageError('budget-exceeded')
    if (value.comparisonId) await this.#comparison(value.comparisonId, value.targetRunId)
    const job: TriageJob = triageJobSchema.parse({ schemaVersion: 1, jobId: randomUUID(), requestId: value.requestId, requestDigest: digest,
      targetRunId: value.targetRunId, ...(value.comparisonId ? { comparisonId: value.comparisonId } : {}), ownerGeneration: this.store.ownerGeneration,
      analyzer: this.#analyzer!.identity, state: 'queued', progress: 'queued', createdAt: now() })
    await this.#saveJob(job)
    this.#pending.push(job.jobId)
    this.#schedule()
    return job
  }

  async getJob(jobId: string): Promise<TriageJob> { await this.init(); validRunId(jobId); return triageJobSchema.parse(await readJson(join(this.root, 'jobs', `${jobId}.json`), 8192)) }

  async cancel(jobId: string): Promise<TriageJob> {
    const job = await this.getJob(jobId)
    if (terminal.has(job.state) || job.state === 'committing') return job
    this.#cancelled.add(jobId)
    this.#workerStops.get(jobId)?.()
    if (job.state === 'queued') {
      this.#pending = this.#pending.filter(id => id !== jobId)
      await this.#saveJob({ ...job, state: 'cancelled', progress: 'cancelled', finishedAt: now() })
    } else await this.#saveJob({ ...job, state: 'cancelling', progress: 'cancelling' })
    return this.getJob(jobId)
  }

  async getReport(reportId: string): Promise<{ report: TriageReport; availability: string; checkedAt: string; retired: boolean }> {
    await this.init(); validRunId(reportId)
    if (!await this.#isPublishedReport(reportId)) throw new TriageError('report-not-found')
    const report = triageReportSchema.parse(await readJson(join(this.root, 'reports', `${reportId}.json`), 128 * 1024))
    const { digest, ...body } = report
    if (sha256(stableJson(body)) !== digest) throw new TriageError('report-integrity-failed')
    let availability = 'verified'
    try {
      const snapshot = await this.store.readOnlySnapshot(report.targetRunId)
      if (snapshot.manifestSha256 !== report.input.targetManifestSha256) availability = 'stale'
      else if (report.comparisonId && (await this.#comparison(report.comparisonId, report.targetRunId)).digest !== report.input.comparisonSha256) availability = 'stale'
      else if (snapshot.run.share || report.input.origin === 'derived') availability = 'not-revalidated'
      else {
        const known = new Map([...snapshot.run.evidence, ...snapshot.run.steps.flatMap(step => step.evidence)].map(file => [file.name, file]))
        for (const item of report.input.evidence) {
          const file = known.get(item.name)
          if (!file) { availability = 'unavailable'; break }
          if (file.sha256 !== item.sha256) { availability = 'stale'; break }
          try { await this.store.readEvidence(report.targetRunId, file) } catch { availability = 'unavailable'; break }
        }
      }
    } catch { availability = 'unavailable' }
    const retired = await exists(join(this.root, 'retired', `${reportId}.json`))
    if (!retired) {
      try {
        if (!(await this.#references.list()).some(ref => ref.contractVersion === 2 && ref.consumerKind === 'triage' && ref.refId === reportId && ref.targetRunId === report.targetRunId))
          availability = 'unavailable'
      } catch { availability = 'unavailable' }
    }
    return { report, availability, checkedAt: now(), retired }
  }

  async evidence(reportId: string, name: string): Promise<{ runId: string; name: string; sha256: string; bytes: number; contentType: string; availability: string }> {
    const current = await this.getReport(reportId)
    if (!current.report.facts.some(fact => fact.evidenceRefs.includes(name))) throw new TriageError('evidence-not-found')
    const snapshot = await this.store.readOnlySnapshot(current.report.targetRunId)
    const file = [...snapshot.run.evidence, ...snapshot.run.steps.flatMap(step => step.evidence)].find(item => item.name === name)
    if (!file) throw new TriageError('evidence-not-found')
    let availability = current.availability === 'verified' && current.report.input.evidence.some(item => item.name === name) ? 'verified' : 'unavailable'
    if (availability === 'verified') try { await this.store.readEvidence(snapshot.run.id, file) } catch { availability = 'unavailable' }
    return { runId: snapshot.run.id, name, sha256: file.sha256, bytes: file.bytes, contentType: file.contentType, availability }
  }

  async reviews(reportId: string): Promise<TriageReview[]> {
    await this.getReport(reportId)
    const dir = join(this.root, 'reviews', reportId)
    if (!await exists(dir)) return []
    await safeDirectory(dir)
    const names = await readdir(dir)
    if (names.length > 1000 || names.some(name => !/^[0-9a-f-]{36}\.json$/.test(name))) throw new TriageError('unsafe-review-index')
    return (await Promise.all(names.map(async name => triageReviewSchema.parse(await readJson(join(dir, name), 8192))))).sort((a, b) => a.revision - b.revision)
  }

  async review(reportId: string, input: z.input<typeof reviewInputSchema>): Promise<TriageReview> {
    const value = reviewInputSchema.parse(input)
    const current = await this.getReport(reportId)
    if (current.retired) throw new TriageError('report-retired')
    if (value.reportId !== reportId || value.reportDigest !== current.report.digest) throw new TriageError('stale-report')
    if (value.evidenceRefs.some(ref => !current.report.input.evidence.some(file => file.name === ref))) throw new TriageError('evidence-not-found')
    return this.store.withMutationGate(async () => {
      if (await exists(join(this.root, 'retired', `${reportId}.json`))) throw new TriageError('report-retired')
      const prior = await this.reviews(reportId)
      if (prior.length !== value.expectedRevision) throw new TriageError('stale-review')
      const review: TriageReview = triageReviewSchema.parse({ schemaVersion: 1, reviewId: randomUUID(), reportId, reportDigest: value.reportDigest,
        revision: prior.length + 1, ...(prior.length ? { supersedes: prior.at(-1)!.reviewId } : {}), reviewer: value.reviewer, note: value.note,
        directions: value.directions, evidenceRefs: value.evidenceRefs, createdAt: now() })
      const dir = join(this.root, 'reviews', reportId)
      await safeDirectory(dir, true)
      await atomicJson(dir, `${review.reviewId}.json`, review)
      return review
    })
  }

  async retire(reportId: string): Promise<{ reportId: string; retired: true }> {
    await this.getReport(reportId)
    await this.store.withMutationGate(async () => {
      if (!await exists(join(this.root, 'retired', `${reportId}.json`)))
        await atomicJson(join(this.root, 'retired'), `${reportId}.json`, { reportId, retiredAt: now() })
      await this.#references.revokeUnderMutationGate(reportId, 'triage', reportId)
    })
    return { reportId, retired: true }
  }

  async #findRequest(requestId: string): Promise<TriageJob | undefined> {
    const names = await readdir(join(this.root, 'jobs'))
    if (names.length > 10_000) throw new TriageError('job-index-budget')
    for (const name of names) {
      if (isTemporary(name)) continue
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) throw new TriageError('unsafe-triage-index')
      const job = triageJobSchema.parse(await readJson(join(this.root, 'jobs', name), 8192))
      if (job.requestId === requestId) return job
    }
    return undefined
  }

  async #isPublishedReport(reportId: string): Promise<boolean> {
    const names = await readdir(join(this.root, 'jobs'))
    if (names.length > 10_000) throw new TriageError('job-index-budget')
    for (const name of names) {
      if (isTemporary(name)) continue
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) throw new TriageError('unsafe-triage-index')
      const job = triageJobSchema.parse(await readJson(join(this.root, 'jobs', name), 8192))
      if (job.reportId === reportId) return job.state === 'succeeded'
    }
    return false
  }

  async #comparison(id: string, targetRunId: string) {
    const path = join(this.comparisons.root, id, 'report.json')
    await boundedStat(path, COMPARISON_MAX)
    const comparison = await this.comparisons.get(id)
    if (!['completed', 'partial'].includes(comparison.state) || comparison.targetRunId !== targetRunId) throw new TriageError('comparison-mismatch')
    return { report: comparison, digest: sha256(stableJson(comparison)) }
  }

  #schedule(): void {
    if (this.#closed || this.#draining) return
    this.#draining = this.#drain().catch(error => { this.#drainError = error }).finally(() => { this.#draining = undefined; if (this.#pending.length) this.#schedule() })
  }

  async #drain(): Promise<void> {
    while (!this.#closed && this.#pending.length) {
      const jobId = this.#pending.shift()!
      this.#activeJob = jobId
      this.#running = true
      try {
        const job = await this.getJob(jobId)
        if (Date.now() - Date.parse(job.createdAt) > 30_000)
          await this.#saveJob({ ...job, state: 'failed', progress: 'failed', errorCode: 'queue-timeout', finishedAt: now() })
        else await this.#execute(jobId)
      } finally { this.#running = false; this.#activeJob = undefined }
    }
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    return this.#closePromise = (async () => {
      await this.#acceptTail
      const errors: unknown[] = []
      for (const id of [...this.#pending, ...(this.#activeJob ? [this.#activeJob] : [])]) {
        try { await this.cancel(id) } catch (error) { errors.push(error) }
      }
      await this.#draining
      if (this.#drainError) errors.push(this.#drainError)
      if (errors.length) throw new AggregateError(errors, 'Triage cleanup failed')
    })()
  }

  async #execute(jobId: string): Promise<void> {
    let job = await this.getJob(jobId)
    let release: (() => void) | undefined
    const deadline = Date.now() + 10_000
    const check = () => { if (this.#closed || this.#cancelled.has(jobId)) { this.#cancelled.add(jobId); throw new TriageError('cancelled') }; if (Date.now() > deadline) throw new TriageError('analysis-timeout') }
    try {
      job = await this.#saveJob({ ...job, state: 'preparing', progress: 'preparing', startedAt: now() })
      release = await this.store.lease([job.targetRunId], `triage:${jobId}`)
      check()
      const snapshot = await this.store.readOnlySnapshot(job.targetRunId)
      await boundedStat(join(this.store.root, job.targetRunId, 'manifest.json'), MANIFEST_MAX)
      if (snapshot.run.phase !== 'finished' || !snapshot.run.verdict) throw new TriageError('run-not-final')
      if (productContractReadState(snapshot.run) === 'unsupported') throw new TriageError('unsupported-contract')
      if (snapshot.run.steps.length > 2000 || (snapshot.run.diagnostics?.length ?? 0) > 5000) throw new TriageError('budget-exceeded')
      const comparison = job.comparisonId ? await this.#comparison(job.comparisonId, job.targetRunId) : undefined
      job = await this.#saveJob({ ...job, state: 'transforming', progress: 'transforming' })
      check()
      const context = comparison ? comparisonContext(comparison.report) : undefined
      let locatorEvidence: string[] = []
      if (comparison && comparison.report.comparability === 'comparable') {
        const candidate = await this.#repair.suggest(job.targetRunId, comparison.report.baselineRunId)
        if (candidate.status === 'candidate') locatorEvidence = [candidate.failureEvidence.name]
      }
      const analysis = await this.#analyzeInWorker(jobId, snapshot.run, context, locatorEvidence, snapshot.manifestSha256, deadline - Date.now())
      check()
      const known = new Map<string, EvidenceFile>([...snapshot.run.evidence, ...snapshot.run.steps.flatMap(step => step.evidence)].map(file => [file.name, file]))
      const selected = [...new Set(analysis.facts.flatMap(fact => fact.evidenceRefs))].sort()
      let total = 0
      const evidence: { name: string; sha256: string }[] = []
      let missing = 0
      for (const name of selected) {
        check()
        const file = known.get(name)
        if (!file || file.incomplete || file.recovered || file.lineage?.integrity === 'unverified' || file.lineage?.integrity === 'failed' || evidence.length >= 64 || file.bytes > (file.contentType.startsWith('image/png') ? 16 : 2) * 1024 * 1024 || total + file.bytes > 64 * 1024 * 1024) { missing++; continue }
        try { await this.store.readEvidence(job.targetRunId, file); evidence.push({ name, sha256: file.sha256 }); total += file.bytes }
        catch { missing++ }
      }
      if (missing) { analysis.limitations = [...new Set([...analysis.limitations, 'evidence-unavailable'])].sort(); analysis.omitted.evidence += missing; analysis.state = 'partial' }
      const origin = snapshot.run.share ? 'derived' : snapshot.run.source === 'import' ? 'imported-original' : snapshot.run.productContract ? 'local-original' : 'legacy-unknown'
      const reportId = randomUUID()
      const body = { schemaVersion: 1 as const, rulesVersion: 1 as const, analyzer: job.analyzer, reportId, targetRunId: job.targetRunId,
        ...(job.comparisonId ? { comparisonId: job.comparisonId } : {}), createdAt: job.createdAt, completedAt: now(),
        input: { targetManifestSha256: snapshot.manifestSha256, ...(comparison ? { comparisonSha256: comparison.digest } : {}), evidence, origin },
        ...analysis }
      const semanticDigest = sha256(stableJson({ rulesVersion: 1, analyzer: job.analyzer, input: body.input, reportedVerdict: analysis.reportedVerdict,
        effectiveVerdict: analysis.effectiveVerdict, verification: analysis.verification, facts: analysis.facts, routes: analysis.routes, disposition: analysis.disposition,
        limitations: analysis.limitations, focus: analysis.focus, omitted: analysis.omitted, state: analysis.state }))
      const withoutDigest = { ...body, semanticDigest }
      const report = triageReportSchema.parse({ ...withoutDigest, digest: sha256(stableJson(withoutDigest)) })
      if (Buffer.byteLength(JSON.stringify(report)) > 128 * 1024) throw new TriageError('report-budget')
      check()
      job = await this.#saveJob({ ...job, state: 'committing', progress: 'committing', reportId })
      if (job.state !== 'committing') throw new TriageError('cancelled')
      await this.store.withMutationGate(async () => {
        if (this.store.ownerGeneration !== job.ownerGeneration) throw new TriageError('stale-owner')
        const latest = await this.store.readOnlySnapshot(job.targetRunId)
        if (latest.manifestSha256 !== snapshot.manifestSha256) throw new TriageError('stale-input')
        if (comparison && (await this.#comparison(job.comparisonId!, job.targetRunId)).digest !== comparison.digest) throw new TriageError('stale-input')
        // The reference is durable before the report becomes visible. A process kill
        // between these writes leaves only protected material; init reconciles it.
        await this.#references.publishUnderMutationGate({ contractVersion: 2, refId: reportId, consumerKind: 'triage', consumerId: reportId,
          targetRunId: job.targetRunId, evidenceRefs: evidence.map(file => file.name), sourceHash: snapshot.manifestSha256, createdAt: now() })
        await atomicJson(join(this.root, 'reports'), `${reportId}.json`, report)
        await this.#saveJob({ ...job, state: 'succeeded', progress: 'succeeded', reportId, finishedAt: now() })
      })
    } catch (error) {
      // Never overwrite a fully published result with a failed status when only
      // the final job-status write failed. Startup will reconcile committing.
      if (job.state !== 'committing' || !job.reportId || !await this.#hasCompletePublication(job)) {
        if (job.reportId && !await exists(join(this.root, 'reports', `${job.reportId}.json`))) {
          try { await this.#references.revoke(job.reportId, 'triage', job.reportId) }
          catch { /* An orphan ref is safer than an unprotected report; startup will retry. */ }
        }
        const state = this.#cancelled.has(jobId) ? 'cancelled' : 'failed'
        await this.#saveJob({ ...job, state, progress: state, errorCode: error instanceof TriageError ? error.code : 'analysis-failed', finishedAt: now() })
      }
    } finally { release?.(); this.#cancelled.delete(jobId) }
  }

  async #saveJob(job: TriageJob): Promise<TriageJob> {
    const valid = triageJobSchema.parse(job)
    const previous = this.#jobWrites.get(valid.jobId) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>(resolve => { release = resolve })
    this.#jobWrites.set(valid.jobId, tail)
    await previous
    try {
      let current: TriageJob | undefined
      try { current = triageJobSchema.parse(await readJson(join(this.root, 'jobs', `${valid.jobId}.json`), 8192)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      // A late cancellation/progress write must not replace a terminal result or roll back a commit.
      if (current && (terminal.has(current.state) || ['committing', 'cancelling'].includes(current.state) && !terminal.has(valid.state))) return current
      await atomicJson(join(this.root, 'jobs'), `${valid.jobId}.json`, valid)
      return valid
    } finally {
      release()
      if (this.#jobWrites.get(valid.jobId) === tail) this.#jobWrites.delete(valid.jobId)
    }
  }

  async #hasCompletePublication(job: TriageJob): Promise<boolean> {
    if (!job.reportId) return false
    try {
      const report = triageReportSchema.parse(await readJson(join(this.root, 'reports', `${job.reportId}.json`), 128 * 1024))
      const { digest, ...body } = report
      const refs = await this.#references.list()
      return sha256(stableJson(body)) === digest && report.targetRunId === job.targetRunId &&
        refs.some(ref => ref.contractVersion === 2 && ref.consumerKind === 'triage' && ref.refId === report.reportId)
    } catch { return false }
  }

  async #analyzeInWorker(jobId: string, run: TestRun, comparison: TriageComparisonContext | undefined, locatorEvidence: string[], manifestSha256: string, remainingMs: number): Promise<TriageAnalysis> {
    if (remainingMs <= 0) throw new TriageError('analysis-timeout')
    const abort = new AbortController()
    this.#workerStops.set(jobId, () => abort.abort())
    if (this.#closed || this.#cancelled.has(jobId)) abort.abort()
    try {
      return await this.#analyzer!.analyze({ run, ...(comparison ? { comparison } : {}), locatorEvidence, manifestSha256 }, abort.signal, remainingMs)
    } catch (error) {
      const code = error instanceof Error && ['analysis-timeout', 'analysis-interrupted', 'invalid-analysis', 'cancelled'].includes(error.message) ? error.message : 'analysis-failed'
      throw new TriageError(code)
    } finally { this.#workerStops.delete(jobId) }
  }
}

const now = () => new Date().toISOString()
function comparisonContext(report: ComparisonReport): TriageComparisonContext {
  const dimensions = report.steps.flatMap(step => Object.values(step.dimensions))
  const first = report.firstConfirmedDifference
  const step = first ? report.steps[first.index] : undefined
  return { comparison: { comparability: report.comparability },
    ...(first && step ? { firstDivergence: { kind: first.qualified ? 'confirmed' as const : 'observed-with-prior-gap' as const,
      step: { index: first.index, path: step.path ?? step.relation } } } : {}),
    evidenceCoverage: { dimensions: { partial: dimensions.filter(value => value.completeness === 'partial').length,
      unavailable: dimensions.filter(value => value.status === 'unavailable').length } } }
}
const isTemporary = (name: string): boolean => /^\.triage-[0-9a-f-]{36}\.tmp$/.test(name)
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error } }
async function safeDirectory(path: string, create = false): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TriageError('unsafe-triage-directory')
}
async function boundedStat(path: string, limit: number): Promise<void> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TriageError('unsafe-triage-input')
  if (stat.size > limit) throw new TriageError('budget-exceeded')
}
async function readJson(path: string, limit: number): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { if ((await handle.stat()).size > limit) throw new TriageError('budget-exceeded'); return JSON.parse(await handle.readFile('utf8')) }
  finally { await handle.close() }
}
async function atomicJson(dir: string, name: string, value: unknown): Promise<void> {
  await safeDirectory(dir, true)
  const path = join(dir, name), temporary = join(dir, `.triage-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }) }
  const directory = await open(dir, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await directory.sync() } finally { await directory.close() }
}
