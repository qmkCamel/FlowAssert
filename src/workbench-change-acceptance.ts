import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { WorkbenchStore } from './workbench-store.js'
import { WorkbenchReferences } from './workbench-references.js'
import { acceptanceDigest, acceptanceHash, acceptanceId, acceptanceInputSchema, acceptancePublishSchema, acceptanceRevisionSchema,
  summarizeAcceptance, acceptanceMarkdown, type AcceptanceInput, type AcceptancePublish, type AcceptanceRevision, type AcceptanceSummary } from './workbench-change-contracts.js'
import { CombinedAcceptanceSources, NativeAcceptanceSources, evaluateAcceptanceCell, type AcceptanceSourceResolver } from './workbench-change-source.js'
import type { WorkbenchExternalAssets } from './workbench-external-assets.js'
import { acceptanceDirectory, acceptanceEntries, acceptanceMissing, readAcceptance, writeAcceptance } from './workbench-change-storage.js'

const jobSchema = z.object({
  version: z.literal(1), jobId: acceptanceId, id: acceptanceId, requestKey: acceptanceId, requestDigest: acceptanceDigest,
  phase: z.enum(['accepted', 'running', 'committing', 'finished', 'cancelling', 'cancelled', 'failed', 'interrupted']),
  createdAt: z.string().datetime(), endedAt: z.string().datetime().optional(), revision: z.number().int().positive().optional(),
  error: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
}).strict()
export type AcceptanceJob = z.infer<typeof jobSchema>
const tombstoneSchema = z.object({ version: z.literal(1), id: acceptanceId, retiredAt: z.string().datetime() }).strict()
const indexSchema = z.object({ version: z.literal(1), id: acceptanceId, latest: z.number().int().min(1).max(100), digest: acceptanceDigest }).strict()
interface Preview { previewId: string; previewDigest: string; generatedAt: string; expiresAt: string; input: AcceptanceInput; summary: AcceptanceSummary }
const final = new Set<AcceptanceJob['phase']>(['finished', 'cancelled', 'failed', 'interrupted'])
function frozenScope(input: AcceptanceInput) {
  return { repository: input.repository, pullRequest: input.pullRequest, cells: input.cells.map(({ runId: _runId, historyRunIds: _history, matrixCell: _matrix, externalResults: _external, binarySha256: _binary, build: _build, inputDigest: _params, ...cell }) => cell) }
}

/** Local acceptance composition. The service has no device, shell, network or host-loop capability. */
export class WorkbenchChangeAcceptance {
  readonly root: string
  readonly references: WorkbenchReferences
  readonly resolver: AcceptanceSourceResolver
  #ready: Promise<void> | undefined
  #closed = false
  #previews = new Map<string, Preview>()
  #running = new Map<string, { promise: Promise<void>; controller: AbortController; job: AcceptanceJob }>()
  #operations = new Set<Promise<unknown>>()
  #reads = 0
  constructor(readonly store: WorkbenchStore, options: { resolver?: AcceptanceSourceResolver; external?: WorkbenchExternalAssets; cutpoint?: (phase: string) => Promise<void> } = {}) {
    this.root = join(store.root, 'acceptance')
    this.references = new WorkbenchReferences(store)
    this.external = options.external
    this.resolver = options.resolver ?? (options.external ? new CombinedAcceptanceSources(new NativeAcceptanceSources(store), options.external) : new NativeAcceptanceSources(store))
    this.cutpoint = options.cutpoint ?? (async () => {})
  }
  private readonly cutpoint: (phase: string) => Promise<void>
  private readonly external: WorkbenchExternalAssets | undefined
  async #init() {
    if (this.#closed) throw new Error('acceptance-closed')
    return this.#ready ??= this.#initialize().catch(error => { this.#ready = undefined; throw error })
  }
  async #initialize() {
    await this.store.init()
    await acceptanceDirectory(this.root)
    await acceptanceDirectory(join(this.root, 'jobs'))
    await acceptanceDirectory(join(this.root, 'records'))
    const jobs = await acceptanceEntries(join(this.root, 'jobs'))
    for (const filename of jobs) {
      if (/^\.acceptance-[a-f0-9-]+\.tmp$/.test(filename)) continue
      if (!/^[a-f0-9-]{36}\.json$/.test(filename)) throw new Error('acceptance-job-index-invalid')
      const path = join(this.root, 'jobs', filename), job = await readAcceptance(path, jobSchema)
      if (`${job.jobId}.json` !== filename) throw new Error('acceptance-job-identity')
      if (!final.has(job.phase)) {
        const release = await this.store.reserveEvidence(`acceptance-recovery:${job.jobId}`, 8 * 1024 * 1024)
        try {
        const revision = await this.#findRequest(job.id, job.requestKey)
        if (revision) {
          if (revision.requestDigest !== job.requestDigest) throw new Error('acceptance-request-conflict')
          await this.#repairIndex(revision)
          job.phase = 'finished'; job.revision = revision.revision
        } else { job.phase = 'interrupted'; job.error = 'acceptance-interrupted' }
        job.endedAt = new Date().toISOString()
        await writeAcceptance(path, job, true)
        } finally { release() }
      }
    }
  }
  #track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('acceptance-closed'))
    const promise = operation(); this.#operations.add(promise)
    void promise.finally(() => this.#operations.delete(promise)).catch(() => {})
    return promise
  }
  preview(value: unknown, signal?: AbortSignal): Promise<Preview> {
    return this.#track(async () => {
      const input = acceptanceInputSchema.parse(value)
      await this.#init()
      if (this.#reads >= 2) throw new Error('acceptance-busy')
      this.#reads++
      try {
        const lease = await this.resolver.acquire(input, signal)
        try {
          signal?.throwIfAborted()
          const summary = summarizeAcceptance(input, input.cells.map(cell => evaluateAcceptanceCell(input, cell, lease.sources, lease.external)))
          const now = Date.now()
          for (const [id, preview] of this.#previews) if (Date.parse(preview.expiresAt) <= now) this.#previews.delete(id)
          if (this.#previews.size >= 16) this.#previews.delete(this.#previews.keys().next().value!)
          const preview: Preview = { previewId: randomUUID(), previewDigest: acceptanceHash({ input, summary }), generatedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), input, summary }
          this.#previews.set(preview.previewId, structuredClone(preview))
          return preview
        } finally { lease.release() }
      } finally { this.#reads-- }
    })
  }
  publish(value: unknown): Promise<AcceptanceJob> {
    return this.#track(async () => {
      const request = acceptancePublishSchema.parse(value)
      await this.#init()
      const requestDigest = acceptanceHash({ id: request.id, expectedRevision: request.expectedRevision, previewDigest: request.previewDigest })
      // Lookup durable idempotency before checking ephemeral preview tokens.
      const existing = await this.#findRequest(request.id, request.requestKey)
      if (existing) {
        if (existing.requestDigest !== requestDigest) throw new Error('acceptance-request-conflict')
        return { version: 1, jobId: request.requestKey, id: request.id, requestKey: request.requestKey, requestDigest, phase: 'finished', revision: existing.revision, createdAt: existing.createdAt, endedAt: existing.createdAt }
      }
      const jobPath = join(this.root, 'jobs', `${request.requestKey}.json`)
      try {
        const prior = await readAcceptance(jobPath, jobSchema)
        if (prior.requestDigest !== requestDigest || prior.id !== request.id) throw new Error('acceptance-request-conflict')
        return prior
      } catch (error) { if (!acceptanceMissing(error)) throw error }
      const preview = this.#previews.get(request.previewId)
      if (!preview || Date.parse(preview.expiresAt) <= Date.now() || preview.previewDigest !== request.previewDigest) throw new Error('acceptance-preview-expired')
      if (!preview.input.declarationsReviewed) throw new Error('acceptance-declarations-not-reviewed')
      if (this.#running.size >= 2) throw new Error('acceptance-busy')
      const reservation = await this.store.reserveEvidence(`acceptance:${randomUUID()}`, 12 * 1024 * 1024)
      let job: AcceptanceJob = { version: 1, jobId: request.requestKey, id: request.id, requestKey: request.requestKey, requestDigest, phase: 'accepted', createdAt: new Date().toISOString() }
      try {
        await this.store.withMutationGate(async () => {
          if (this.#closed) throw new Error('acceptance-closed')
          try {
            const prior = await readAcceptance(jobPath, jobSchema)
            if (prior.requestDigest !== requestDigest || prior.id !== request.id) throw new Error('acceptance-request-conflict')
            job = prior; reservation(); return
          } catch (error) { if (!acceptanceMissing(error)) throw error }
          const entries = await acceptanceEntries(join(this.root, 'jobs'))
          if (entries.length >= 1000 || this.#running.size >= 2) throw new Error('acceptance-job-budget')
          await writeAcceptance(jobPath, job)
          const controller = new AbortController()
          // Register before yielding; actual publication must acquire the store gate again.
          const promise = this.#execute(job, request, structuredClone(preview), controller.signal).finally(() => { reservation(); this.#running.delete(job.jobId) })
          this.#running.set(job.jobId, { promise, controller, job })
          void promise.catch(() => {})
        })
      } catch (error) { reservation(); throw error }
      return structuredClone(job)
    })
  }
  async #execute(job: AcceptanceJob, request: AcceptancePublish, preview: Preview, signal: AbortSignal) {
    let committed: AcceptanceRevision | undefined
    const saveJob = () => writeAcceptance(join(this.root, 'jobs', `${job.jobId}.json`), job, true)
    try {
      job.phase = 'running'; await saveJob(); await this.cutpoint('before-source')
      signal.throwIfAborted()
      const lease = await this.resolver.acquire(preview.input, signal)
      try {
        const summary = summarizeAcceptance(preview.input, preview.input.cells.map(cell => evaluateAcceptanceCell(preview.input, cell, lease.sources, lease.external)))
        if (acceptanceHash({ input: preview.input, summary }) !== preview.previewDigest) throw new Error('acceptance-preview-stale')
        await this.store.withMutationGate(async () => {
          signal.throwIfAborted()
          if (await this.#retired(request.id)) throw new Error('acceptance-retired')
          const revisions = await this.#revisions(request.id)
          if (revisions.length !== request.expectedRevision) throw new Error('acceptance-revision-conflict')
          const previous = revisions.at(-1)
          if (previous && acceptanceHash(frozenScope(previous.input)) !== acceptanceHash(frozenScope(preview.input))) throw new Error('acceptance-scope-conflict')
          // Leases exclude retention, but recheck all manifests before committing reference facts.
          for (const [id, source] of lease.sources) {
            if (source.storage === 'matrix') { if (!source.recheck) throw new Error('acceptance-matrix-source-unavailable'); await source.recheck() }
            else if ((await this.store.readOnlySnapshot(id)).manifestSha256 !== source.manifestSha256) throw new Error('acceptance-preview-stale')
          }
          const revision = revisions.length + 1
          // Matrix attempts already carry durable cross-store references; they cannot be retired here.
          const references = [...lease.sources].filter(([, source]) => source.storage !== 'matrix').map(([targetRunId, source]) => ({ contractVersion: 3 as const, refId: randomUUID(), consumerKind: 'acceptance:revision', consumerId: `${request.id}:${revision}`, targetRunId, evidenceRefs: [], sourceHash: source.manifestSha256, createdAt: new Date().toISOString() }))
          const record = acceptanceRevisionSchema.parse({ contractVersion: preview.input.contractVersion, id: request.id, revision, previousSha256: previous ? acceptanceHash(previous) : null,
            requestKey: request.requestKey, requestDigest: job.requestDigest, inputDigest: acceptanceHash(preview.input), createdAt: new Date().toISOString(), input: preview.input, summary, references: references.map(ref => ref.refId) })
          const recordRoot = join(this.root, 'records', request.id)
          const entries = await acceptanceEntries(join(this.root, 'records'))
          if (!entries.includes(request.id) && entries.length >= 1000) throw new Error('acceptance-record-count-budget')
          await acceptanceDirectory(recordRoot)
          await writeAcceptance(join(recordRoot, `intent-${request.requestKey}.json`), record)
          await this.cutpoint('before-references')
          signal.throwIfAborted()
          for (const ref of references) await this.references.publishUnderMutationGate(ref)
          for (const [assetId, source] of lease.external ?? []) await this.external?.pin(assetId, source.digest, `${request.id}:${revision}`)
          await this.cutpoint('after-references')
          signal.throwIfAborted()
          job.phase = 'committing'; await saveJob()
          await writeAcceptance(join(recordRoot, `revision-${revision}.json`), record)
          committed = record
          await this.cutpoint('after-revision')
          await this.#repairIndex(record)
          await this.cutpoint('after-index')
          job.phase = 'finished'; job.revision = revision
        })
      } finally { lease.release() }
    } catch (error) {
      if (committed) { job.phase = 'finished'; job.revision = committed.revision }
      else { job.phase = signal.aborted ? 'cancelled' : 'failed'; job.error = error instanceof Error && /^acceptance-[a-z-]+$/.test(error.message) ? error.message : 'acceptance-operation-failed' }
    }
    job.endedAt = new Date().toISOString()
    await saveJob()
    await this.cutpoint('after-job-save')
  }
  async #repairIndex(record: AcceptanceRevision) {
    const path = join(this.root, 'records', record.id, 'index.json')
    try { const index = await readAcceptance(path, indexSchema); if (index.latest > record.revision) return } catch (error) { if (!acceptanceMissing(error)) throw error }
    await writeAcceptance(path, { version: 1, id: record.id, latest: record.revision, digest: acceptanceHash(record) }, true)
  }
  async #revisions(id: string): Promise<AcceptanceRevision[]> {
    acceptanceId.parse(id)
    const root = join(this.root, 'records', id)
    let entries: string[]
    try { entries = await acceptanceEntries(root, 1200) } catch (error) { if (acceptanceMissing(error)) return []; throw error }
    const revisions: AcceptanceRevision[] = []
    for (const name of entries) {
      if (/^\.acceptance-[a-f0-9-]+\.tmp$/.test(name) || name === 'tombstone.json' || name === 'index.json') continue
      if (/^intent-[a-f0-9-]{36}\.json$/.test(name)) { await readAcceptance(join(root, name), acceptanceRevisionSchema); continue }
      if (!/^revision-\d+\.json$/.test(name)) throw new Error('acceptance-record-index-invalid')
      const record = await readAcceptance(join(root, name), acceptanceRevisionSchema)
      if (record.id !== id || name !== `revision-${record.revision}.json`) throw new Error('acceptance-revision-identity')
      revisions.push(record)
    }
    revisions.sort((a, b) => a.revision - b.revision)
    if (revisions.length > 100) throw new Error('acceptance-revision-budget')
    for (let i = 0; i < revisions.length; i++) if (revisions[i]!.revision !== i + 1 || revisions[i]!.previousSha256 !== (i ? acceptanceHash(revisions[i - 1]) : null)) throw new Error('acceptance-revision-chain-invalid')
    try {
      const index = await readAcceptance(join(root, 'index.json'), indexSchema)
      if (index.id !== id || !revisions[index.latest - 1] || acceptanceHash(revisions[index.latest - 1]) !== index.digest) throw new Error('acceptance-index-invalid')
    } catch (error) { if (!acceptanceMissing(error)) throw error }
    return revisions
  }
  async #findRequest(id: string, key: string) { return (await this.#revisions(id)).find(record => record.requestKey === key) }
  async #retired(id: string) {
    acceptanceId.parse(id)
    try { const record = await readAcceptance(join(this.root, 'records', id, 'tombstone.json'), tombstoneSchema); if (record.id !== id) throw new Error('acceptance-tombstone-identity'); return true }
    catch (error) { if (acceptanceMissing(error)) return false; throw error }
  }
  getJob(id: string): Promise<AcceptanceJob> {
    return this.#track(async () => {
      acceptanceId.parse(id); await this.#init()
      const job = await readAcceptance(join(this.root, 'jobs', `${id}.json`), jobSchema)
      if (job.jobId !== id) throw new Error('acceptance-job-identity')
      // Atomic rename makes the terminal file visible before its fsync/cleanup finishes.
      // A caller observing a terminal job may immediately submit the next publication.
      if (final.has(job.phase)) await this.#running.get(id)?.promise
      return job
    })
  }
  cancel(id: string): Promise<AcceptanceJob> {
    return this.#track(async () => {
      const job = await this.getJob(id), active = this.#running.get(id)
      if (active && !final.has(active.job.phase) && active.job.phase !== 'committing') {
        active.controller.abort(new Error('acceptance-cancelled'))
        return { ...job, phase: 'cancelling' }
      }
      return active ? structuredClone(active.job) : job
    })
  }
  get(id: string, revision?: number, signal?: AbortSignal) {
    return this.#track(async () => {
      acceptanceId.parse(id); if (revision !== undefined) z.number().int().min(1).max(100).parse(revision)
      await this.#init()
      if (this.#reads >= 2) throw new Error('acceptance-busy')
      this.#reads++
      try {
      const revisions = await this.#revisions(id), record = revision === undefined ? revisions.at(-1) : revisions[revision - 1]
      if (!record) throw new Error('acceptance-not-found')
      const retired = await this.#retired(id)
      const lease = await this.resolver.acquire(record.input, signal)
      try {
        const cells = record.input.cells.map(cell => evaluateAcceptanceCell(record.input, cell, lease.sources, lease.external))
        for (const [index, cell] of cells.entries()) if (acceptanceHash(cell) !== acceptanceHash(record.summary.cells[index])) {
          cell.status = 'incomplete'; cell.outcome = 'not-clean'; cell.reasons = [...new Set([...cell.reasons, 'published-source-changed'])]
        }
        if (retired) for (const cell of cells) { cell.status = 'incomplete'; cell.outcome = 'not-clean'; cell.reasons.push('acceptance-retired') }
        return { id, revision: record.revision, latestRevision: revisions.length, createdAt: record.createdAt, revisionSha256: acceptanceHash(record),
          retired, input: record.input, generated: record.summary, current: summarizeAcceptance(record.input, cells), checkedAt: new Date().toISOString() }
      } finally { lease.release() }
      } finally { this.#reads-- }
    })
  }
  async export(id: string, revision: number, format: 'json' | 'markdown', signal?: AbortSignal) {
    const result = await this.get(id, revision, signal)
    const { input: _input, ...publicResult } = result
    return format === 'markdown' ? `${acceptanceMarkdown(result.current, result.createdAt)}\nRecord: ${result.id}; revision=${result.revision}; policyVersion=${result.current.policyVersion}\n生成时结论 / At generation: ${result.generated.status}\n当前核查时间 / Checked: ${result.checkedAt}\n` : JSON.stringify(publicResult, null, 2)
  }
  list(offset = 0) {
    return this.#track(async () => {
      z.number().int().min(0).max(1000).parse(offset); await this.#init()
      const names = (await acceptanceEntries(join(this.root, 'records'))).sort()
      const items = []
      for (const id of names.slice(offset, offset + 20)) {
        acceptanceId.parse(id)
        const revisions = await this.#revisions(id), latest = revisions.at(-1)
        if (latest) items.push({ id, revision: latest.revision, repository: latest.summary.repository, commit: latest.summary.commit, createdAt: latest.createdAt, retired: await this.#retired(id) })
      }
      return { items, nextOffset: offset + 20 < names.length ? offset + 20 : null }
    })
  }
  retire(id: string) {
    return this.#track(async () => {
      acceptanceId.parse(id); await this.#init()
      // Recovery can reserve capacity; initialize the other owner before taking our gate.
      await this.external?.list(0)
      const release = await this.store.reserveEvidence(`acceptance-retire:${id}`, 8 * 1024 * 1024)
      try {
        return await this.store.withMutationGate(async () => {
          const revisions = await this.#revisions(id)
          if (!revisions.length) throw new Error('acceptance-not-found')
          if (!await this.#retired(id)) await writeAcceptance(join(this.root, 'records', id, 'tombstone.json'), { version: 1, id, retiredAt: new Date().toISOString() })
          await this.cutpoint('after-tombstone')
          const refs = await this.references.list()
          for (const ref of refs) if (ref.consumerKind === 'acceptance:revision' && ref.consumerId.startsWith(`${id}:`))
            await this.references.revokeUnderMutationGate(ref.refId, ref.consumerKind, ref.consumerId)
          await this.external?.revoke(id)
          return { id, retired: true as const }
        })
      } finally { release() }
    })
  }
  async close(): Promise<void> {
    this.#closed = true
    for (const active of this.#running.values()) if (active.job.phase !== 'committing') active.controller.abort(new Error('acceptance-closed'))
    await Promise.allSettled([...this.#operations, ...[...this.#running.values()].map(active => active.promise)])
    this.#previews.clear()
  }
}
