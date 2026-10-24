import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { operationRecordSchema, type OperationRecord } from './workbench-evidence-contracts.js'
import { createReviewedReportSnapshot, renderReviewedReport, type HtmlReportResult } from './workbench-report-html.js'
import { WorkbenchShare, type ShareOptions, type SharePreview } from './workbench-share.js'
import { sha256, validRunId, type PortableRunArchive, type WorkbenchStore } from './workbench-store.js'

type JobKind = 'share-preview' | 'share-export'
type JobInput = { runId: string; options: ShareOptions; reviewToken?: string; reviewed?: boolean; format?: 'html' }
type LiveJob = { record: OperationRecord; input?: JobInput; controller?: AbortController; finished: Promise<void>; resolve: () => void; cancelRequested: boolean }
type Review = { token: string; runId: string; optionsDigest: string; previewDigest: string; expiresAt: number; report?: HtmlReportResult; generatedAt?: string; reportDigest?: string }
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024
const TERMINAL = new Set<OperationRecord['phase']>(['succeeded', 'failed', 'cancelled', 'interrupted'])

/** Single-owner, bounded local share queue. No inputs or image pixels are stored in job status records. */
export class WorkbenchShareJobs {
  readonly root: string
  readonly share: WorkbenchShare
  #ready: Promise<void> | null = null
  #jobs = new Map<string, LiveJob>()
  #requestIndex = new Map<string, { jobId: string; digest: string }>()
  #reviews = new Map<string, Review>()
  #queue: string[] = []
  #active: string | null = null
  #closed = false
  #closePromise: Promise<void> | undefined
  #submitTail: Promise<void> = Promise.resolve()
  #recordWrites = new Map<string, Promise<void>>()
  constructor(readonly store: WorkbenchStore, private readonly cutpoint: (name: string) => Promise<void> = async () => {}) { this.root = join(store.root, 'share-jobs'); this.share = new WorkbenchShare(store) }

  async submit(kind: JobKind, requestId: string, input: JobInput): Promise<OperationRecord> {
    if (this.#closed) throw new Error('Share jobs are closed')
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) throw new Error('Invalid share request ID')
    validRunId(input.runId)
    if (!Array.isArray(input.options.files) || input.options.files.length < (input.format === 'html' ? 0 : 1) || input.options.files.length > 64) throw new Error('Select 1–64 evidence files')
    await this.#init()
    return this.#serializedSubmit(async () => {
    if (this.#closed) throw new Error('Share jobs are closed')
    const requestKey = sha256(requestId), digest = sha256(JSON.stringify({ kind, input }))
    const existing = this.#requestIndex.get(requestKey)
    if (existing) {
      if (existing.digest !== digest) throw new Error('Share request ID was reused with different content')
      return this.get(existing.jobId)
    }
    if (this.#queue.length >= 2) throw new Error('Share job queue is full (one active, two waiting)')
    if (kind === 'share-export') this.#review(input)
    const jobId = randomUUID(), now = new Date().toISOString()
    const record = operationRecordSchema.parse({ contractVersion: 1, jobId, kind, requestDigest: digest, requestKey,
      ownerGeneration: this.store.ownerGeneration, phase: 'queued', progress: 'Queued for local conversion', createdAt: now })
    await this.#writeRecord(record)
    await this.cutpoint('submit:after-record')
    await this.#writeRequest(requestKey, { jobId, digest })
    let resolve!: () => void
    const finished = new Promise<void>(done => { resolve = done })
    this.#jobs.set(jobId, { record, input, finished, resolve, cancelRequested: false })
    this.#requestIndex.set(requestKey, { jobId, digest })
    this.#queue.push(jobId)
    void this.#drain()
    return structuredClone(record)
    })
  }

  async #serializedSubmit<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#submitTail
    let release!: () => void
    this.#submitTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }

  async get(jobId: string): Promise<OperationRecord> {
    validRunId(jobId); await this.#init()
    const job = this.#jobs.get(jobId)
    if (!job) throw new Error('Unknown share job')
    return structuredClone(job.record)
  }

  async cancel(jobId: string): Promise<OperationRecord> {
    validRunId(jobId); await this.#init()
    const job = this.#jobs.get(jobId)
    if (!job) throw new Error('Unknown share job')
    if (TERMINAL.has(job.record.phase) || job.record.phase === 'committing') return structuredClone(job.record)
    job.cancelRequested = true
    if (job.record.phase === 'queued' && this.#active !== jobId) {
      this.#queue = this.#queue.filter(id => id !== jobId)
      await this.#update(job, 'cancelled', 'Cancelled before conversion')
      job.resolve()
    } else {
      await this.#update(job, 'cancelling', 'Cancelling local conversion')
      job.controller?.abort(new Error('Share job cancelled'))
    }
    return structuredClone(job.record)
  }

  async result(jobId: string): Promise<SharePreview & { reviewToken: string; expiresAt: string; report?: HtmlReportResult } | PortableRunArchive | HtmlReportResult> {
    validRunId(jobId); await this.#init()
    const job = this.#jobs.get(jobId)
    if (!job) throw new Error('Unknown share job')
    if (job.record.phase === 'awaiting-review') {
      const review = [...this.#reviews.values()].find(item => item.token === job.record.resultRef)
      if (!review || review.expiresAt <= Date.now()) throw new Error('Share review expired; preview again')
      const preview = this.#previewResults.get(jobId)
      if (!preview) throw new Error('Share preview unavailable after restart; preview again')
      return { ...preview, ...(review.report ? { report: structuredClone(review.report) } : {}), reviewToken: review.token, expiresAt: new Date(review.expiresAt).toISOString() }
    }
    if (job.record.phase !== 'succeeded') throw new Error(`Share job is ${job.record.phase}`)
    return this.#readCommitted(jobId)
  }

  async waitResult(jobId: string): Promise<SharePreview & { reviewToken: string; expiresAt: string; report?: HtmlReportResult } | PortableRunArchive | HtmlReportResult> {
    await this.#init()
    const job = this.#jobs.get(jobId)
    if (!job) throw new Error('Unknown share job')
    await job.finished
    return this.result(jobId)
  }

  reviewTokenForDigest(runId: string, options: ShareOptions, previewDigest: string): string {
    const optionsDigest = sha256(JSON.stringify(options))
    const review = [...this.#reviews.values()].find(item => item.runId === runId && item.optionsDigest === optionsDigest && item.previewDigest === previewDigest && item.expiresAt > Date.now())
    if (!review) throw new Error('Share preview expired or changed; preview again')
    return review.token
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    return this.#closePromise = (async () => {
      await this.#ready?.catch(() => undefined)
      await this.#submitTail
      const errors: unknown[] = []
      for (const id of [...this.#queue, ...(this.#active ? [this.#active] : [])]) {
        try { await this.cancel(id) } catch (error) { errors.push(error) }
      }
      if (this.#active) await this.#jobs.get(this.#active)?.finished
      if (errors.length) throw new AggregateError(errors, 'Share cleanup failed')
    })()
  }

  #previewResults = new Map<string, SharePreview>()
  async #init(): Promise<void> { return this.#ready ??= this.#initialize() }
  async #initialize(): Promise<void> {
    await this.store.init()
    await safeDirectory(this.root)
    await safeDirectory(join(this.root, 'requests'))
    await safeDirectory(join(this.root, 'results'))
    const records = await readdir(this.root, { withFileTypes: true })
    if (records.length > 10_000) throw new Error('Share job index exceeds budget')
    for (const entry of records) {
      if (['requests', 'results'].includes(entry.name)) continue
      if (entry.isFile() && /^\.job-[0-9a-f-]{36}\.tmp$/.test(entry.name)) continue
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) throw new Error('Unsafe share job record')
      const record = operationRecordSchema.parse(JSON.parse((await readBounded(join(this.root, entry.name), 4_096)).toString()))
      if (`${record.jobId}.json` !== entry.name || !['share-preview', 'share-export'].includes(record.kind)) throw new Error('Invalid share job identity')
      let resolve!: () => void
      const finished = new Promise<void>(done => { resolve = done })
      const job: LiveJob = { record, finished, resolve, cancelRequested: false }
      this.#jobs.set(record.jobId, job)
      if (record.requestKey) {
        const prior = this.#requestIndex.get(record.requestKey)
        if (prior && (prior.jobId !== record.jobId || prior.digest !== record.requestDigest)) throw new Error('Duplicate durable share request key')
        this.#requestIndex.set(record.requestKey, { jobId: record.jobId, digest: record.requestDigest })
      }
      if (record.phase === 'succeeded' && !(await this.#validCommitted(record.jobId))) await this.#update(job, 'failed', 'Committed share is unavailable or failed integrity validation', undefined, true)
      if (!TERMINAL.has(record.phase)) {
        if (record.kind === 'share-export' && await this.#validCommitted(record.jobId)) await this.#update(job, 'succeeded', 'Recovered committed export', record.jobId)
        else await this.#update(job, 'interrupted', 'Interrupted before a complete publication')
      }
      resolve()
    }
    const requests = await readdir(join(this.root, 'requests'), { withFileTypes: true })
    if (requests.length > 10_000) throw new Error('Share request index exceeds budget')
    for (const entry of requests) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) throw new Error('Unsafe share request index')
      const value = JSON.parse((await readBounded(join(this.root, 'requests', entry.name), 512)).toString()) as { jobId: string; digest: string }
      validRunId(value.jobId)
      if (!/^[a-f0-9]{64}$/.test(value.digest) || !this.#jobs.has(value.jobId)) throw new Error('Incomplete share request record requires manual recovery')
      const prior = this.#requestIndex.get(entry.name.slice(0, -5))
      if (prior && (prior.jobId !== value.jobId || prior.digest !== value.digest)) throw new Error('Conflicting share request index requires manual recovery')
      this.#requestIndex.set(entry.name.slice(0, -5), value)
    }
  }

  async #drain(): Promise<void> {
    if (this.#active || this.#closed) return
    const jobId = this.#queue.shift()
    if (!jobId) return
    const job = this.#jobs.get(jobId)!
    this.#active = jobId
    try { await this.#execute(job) }
    catch (error) {
      const message = publicShareFailure(error)
      try { await this.#update(job, 'failed', message) }
      catch { job.record = { ...job.record, phase: 'failed', progress: message.slice(0, 160), stableError: message.slice(0, 160), finishedAt: new Date().toISOString() } }
    }
    finally { this.#active = null; job.resolve(); void this.#drain() }
  }

  async #execute(job: LiveJob): Promise<void> {
    const input = job.input!
    if (Date.now() - Date.parse(job.record.createdAt) > 30_000) { await this.#update(job, 'failed', 'Share queue wait exceeded 30 seconds'); return }
    const controller = new AbortController(); job.controller = controller
    let releaseReservation: (() => void) | undefined
    if (job.cancelRequested) controller.abort(new Error('Share job cancelled'))
    const timer = setTimeout(() => controller.abort(new Error('Share conversion exceeded 30 seconds')), 30_000)
    try {
      await this.#update(job, 'preparing', 'Validating source and evidence')
      controller.signal.throwIfAborted()
      if (job.record.kind === 'share-export') releaseReservation = await this.store.reserveEvidence(`share:${job.record.jobId}`, MAX_ARCHIVE_BYTES * (input.format === 'html' ? 2 : 1) + 8 * 1024 * 1024)
      await this.#update(job, 'transforming', 'Converting selected evidence')
      if (job.record.kind === 'share-preview') {
        const prepared = input.format === 'html' ? await this.share.prepareReport(input.runId, input.options, controller.signal) : undefined
        const preview = prepared?.preview ?? await this.share.preview(input.runId, input.options, controller.signal)
        const generatedAt = new Date().toISOString()
        const report = prepared ? renderReviewedReport(createReviewedReportSnapshot(prepared.source, preview, { shareId: randomUUID(), generatedAt })) : undefined
        controller.signal.throwIfAborted()
        await this.cutpoint('preview:after-transform')
        if (job.cancelRequested) throw new Error('Share job cancelled')
        controller.signal.throwIfAborted()
        const token = randomUUID(), expiresAt = Date.now() + 10 * 60_000
        for (const [key, value] of this.#reviews) if (value.expiresAt <= Date.now()) { this.#reviews.delete(key); for (const [id, cached] of this.#previewResults) if (cached.digest === value.previewDigest) this.#previewResults.delete(id) }
        if (this.#reviews.size >= 2) { const oldest = this.#reviews.keys().next().value!; const removed = this.#reviews.get(oldest)!; this.#reviews.delete(oldest); for (const [id, cached] of this.#previewResults) if (cached.digest === removed.previewDigest) this.#previewResults.delete(id) }
        this.#reviews.set(token, { token, runId: input.runId, optionsDigest: optionsDigest(input), previewDigest: preview.digest, expiresAt, ...(report ? { report, generatedAt, reportDigest: report.sha256 } : {}) })
        this.#previewResults.set(job.record.jobId, preview)
        await this.#update(job, 'awaiting-review', 'Preview ready for explicit review', token)
      } else {
        const review = this.#review(input)
        const archive = await this.share.export(input.runId, input.options, review.previewDigest, true, controller.signal, review.report ? { shareId: review.report.shareId, generatedAt: review.generatedAt! } : undefined)
        controller.signal.throwIfAborted()
        this.#review(input)
        await this.cutpoint('export:after-transform')
        if (job.cancelRequested) throw new Error('Share job cancelled')
        controller.signal.throwIfAborted()
        await this.#update(job, 'committing', 'Publishing reviewed archive')
        if (job.cancelRequested) throw new Error('Share job cancelled')
        await this.#commit(job.record.jobId, archive, review.report)
        await this.#update(job, 'succeeded', 'Reviewed archive committed', job.record.jobId)
      }
    } catch (error) {
      const message = publicShareFailure(error)
      await this.#update(job, job.cancelRequested ? 'cancelled' : 'failed', message.slice(0, 160))
    } finally { releaseReservation?.(); clearTimeout(timer); delete job.controller }
  }

  #review(input: JobInput): Review {
    if (!input.reviewed || !input.reviewToken) throw new Error('Explicit reviewed share preview token is required')
    const review = this.#reviews.get(input.reviewToken)
    if (!review || review.expiresAt <= Date.now() || review.runId !== input.runId || review.optionsDigest !== optionsDigest(input)) throw new Error('Share review expired or changed; preview again')
    if (review.report && (review.report.sha256 !== review.reportDigest || sha256(review.report.html) !== review.reportDigest)) throw new Error('Share candidate changed; preview again')
    return review
  }

  async #update(job: LiveJob, phase: OperationRecord['phase'], progress: string, resultRef?: string, integrityInvalidation = false): Promise<void> {
    const id = job.record.jobId
    const previous = this.#recordWrites.get(id) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>(resolve => { release = resolve })
    this.#recordWrites.set(id, tail)
    await previous
    try {
    // Restart verification may downgrade an unavailable committed artifact; late progress may not.
    const invalidate = integrityInvalidation && job.record.phase === 'succeeded' && phase === 'failed'
    if (!invalidate && (TERMINAL.has(job.record.phase) || ['committing', 'cancelling'].includes(job.record.phase) && !TERMINAL.has(phase))) return
    const now = new Date().toISOString()
    job.record = operationRecordSchema.parse({ ...job.record, phase, progress: progress.slice(0, 160),
      ...(phase === 'preparing' ? { startedAt: now } : {}),
      ...(TERMINAL.has(phase) ? { finishedAt: now } : {}),
      ...(['failed', 'interrupted'].includes(phase) ? { stableError: progress.slice(0, 160) } : {}),
      ...(resultRef ? { resultRef } : {}) })
    await this.#writeRecord(job.record)
    } finally {
      release()
      if (this.#recordWrites.get(id) === tail) this.#recordWrites.delete(id)
    }
  }

  async #writeRecord(record: OperationRecord): Promise<void> { await atomicJson(this.root, `${record.jobId}.json`, record) }
  async #writeRequest(key: string, value: { jobId: string; digest: string }): Promise<void> {
    const path = join(this.root, 'requests', `${key}.json`)
    const handle = await open(path, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    await syncDirectory(join(this.root, 'requests'))
  }

  async #commit(jobId: string, archive: PortableRunArchive, report?: HtmlReportResult): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(archive))
    if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Share archive exceeds serialized budget')
    const shareId = archive.sharing?.shareId
    if (!shareId) throw new Error('Derived share identity is missing')
    const mapHash = sha256(await readBounded(join(this.store.root, 'shares', `${shareId}.json`), 64 * 1024))
    const directory = join(this.root, 'results', jobId)
    await safeDirectory(directory)
    const artifact = join(directory, 'archive.json'), temporary = join(directory, `.archive-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await this.cutpoint('export:after-artifact-fsync')
    await rename(temporary, artifact); await syncDirectory(directory)
    await this.cutpoint('export:after-artifact-rename')
    if (report) {
      const htmlBytes = Buffer.from(report.html)
      if (htmlBytes.length > MAX_ARCHIVE_BYTES || sha256(htmlBytes) !== report.sha256 || report.shareId !== shareId) throw new Error('Reviewed report integrity failed')
      const temporaryHtml = join(directory, `.report-${randomUUID()}.tmp`)
      const htmlHandle = await open(temporaryHtml, 'wx', 0o600)
      try { await htmlHandle.writeFile(htmlBytes); await htmlHandle.sync() } finally { await htmlHandle.close() }
      await this.cutpoint('export:after-html-fsync')
      await rename(temporaryHtml, join(directory, 'report.html')); await syncDirectory(directory)
      await this.cutpoint('export:after-html-rename')
    }
    await atomicJson(directory, 'manifest.json', { version: report ? 2 : 1, ...(report ? { htmlSha256: report.sha256 } : {}), jobId, shareId, archiveSha256: sha256(bytes), mapSha256: mapHash, createdAt: new Date().toISOString() })
    await this.cutpoint('export:after-manifest')
  }

  async #validCommitted(jobId: string): Promise<boolean> { try { await this.#readCommitted(jobId); return true } catch { return false } }
  async #readCommitted(jobId: string): Promise<PortableRunArchive | HtmlReportResult> {
    const directory = join(this.root, 'results', jobId)
    const manifest = JSON.parse((await readBounded(join(directory, 'manifest.json'), 2_048)).toString()) as { version: number; jobId: string; shareId: string; archiveSha256: string; mapSha256: string; htmlSha256?: string }
    if (![1, 2].includes(manifest.version) || manifest.jobId !== jobId || !/^[0-9a-f-]{36}$/.test(manifest.shareId)) throw new Error('Invalid committed share manifest')
    const archiveBytes = await readBounded(join(directory, 'archive.json'), MAX_ARCHIVE_BYTES)
    const mapBytes = await readBounded(join(this.store.root, 'shares', `${manifest.shareId}.json`), 64 * 1024)
    if (sha256(archiveBytes) !== manifest.archiveSha256 || sha256(mapBytes) !== manifest.mapSha256) throw new Error('Committed share integrity failed')
    const archive = JSON.parse(archiveBytes.toString()) as PortableRunArchive
    if (archive.format !== 'mobile-mirror-run' || ![2, 4].includes(archive.version) || archive.sharing?.shareId !== manifest.shareId) throw new Error('Committed share identity mismatch')
    if (manifest.version === 2) {
      const htmlBytes = await readBounded(join(directory, 'report.html'), MAX_ARCHIVE_BYTES)
      if (sha256(htmlBytes) !== manifest.htmlSha256) throw new Error('Committed report integrity failed')
      return { format: 'mobile-mirror-html', version: 1, shareId: manifest.shareId, filename: `mobile-mirror-report-${manifest.shareId}.html`, html: htmlBytes.toString(), sha256: manifest.htmlSha256! }
    }
    return archive
  }
}

async function safeDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe share job directory')
}
async function readBounded(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { if ((await handle.stat()).size > maxBytes) throw new Error('Share job file exceeds budget'); return await handle.readFile() }
  finally { await handle.close() }
}
async function atomicJson(directory: string, name: string, value: unknown): Promise<void> {
  const temporary = join(directory, `.job-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
  await rename(temporary, join(directory, name)); await syncDirectory(directory)
}
async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await handle.sync() } finally { await handle.close() }
}
function publicShareFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/cancel/i.test(message)) return 'Share conversion cancelled'
  if (/timeout|exceeded 30 second/i.test(message)) return 'Share conversion timed out'
  if (/budget|too large|exceeds|outside image/i.test(message)) return 'Share evidence exceeds the configured budget'
  if (/stale|expired|changed/i.test(message)) return 'Share review expired or source changed; preview again'
  return 'Share conversion failed; source and prior exports remain unchanged'
}

function optionsDigest(input: JobInput): string { return sha256(JSON.stringify(input.format ? { options: input.options, format: input.format, templateVersion: 1 } : input.options)) }
