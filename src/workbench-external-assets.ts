import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { open, realpath, rename, rm } from 'node:fs/promises'
import { z } from 'zod'
import { acceptanceHash, acceptanceDigest, acceptanceId } from './workbench-change-contracts.js'
import { acceptanceDirectory as directory, acceptanceEntries as entries, acceptanceMissing as missing, readAcceptance as read, writeAcceptance as write } from './workbench-change-storage.js'
import { sha256, type WorkbenchStore } from './workbench-store.js'
import { externalAssetSchema, externalInputSchema, externalJobSchema, externalLimits, externalParsedSchema, externalProjectSchema, externalSafeSummary, type ExternalAsset, type ExternalInput, type ExternalJob, type ExternalProject } from './workbench-external-contracts.js'
import { externalAdapters, validateExternalAttachmentWorker, type ExternalResultAdapter } from './workbench-external-adapters.js'
import { readExternalFile } from './workbench-external-files.js'

const terminal = new Set(['finished', 'cancelled', 'failed', 'interrupted'])
const referenceSchema = z.object({ contractVersion: z.literal(1), id: acceptanceId, assetId: acceptanceId, digest: acceptanceDigest, consumer: z.string().regex(/^[a-f0-9-]{36}:\d{1,3}$/), createdAt: z.string().datetime() }).strict()
const grantSchema = z.object({ contractVersion: z.literal(1), assetId: acceptanceId, digest: acceptanceDigest, project: externalProjectSchema, granted: z.boolean(), at: z.string().datetime() }).strict()
const retiredSchema = z.object({ contractVersion: z.literal(1), assetId: acceptanceId, at: z.string().datetime() }).strict()
export class WorkbenchExternalAssets {
  root: string
  readonly #adapters: Map<string, ExternalResultAdapter>
  readonly #cutpoint: (phase: string) => Promise<void>
  #ready: Promise<void> | undefined; #closed = false; #queue: Promise<unknown> = Promise.resolve(); #admitting = 0
  #active = new Map<string, { controller: AbortController; promise: Promise<void>; release(): void; timer?: ReturnType<typeof setTimeout> }>()
  #leases = new Map<string, number>(); #operations = new Set<Promise<unknown>>()
  constructor(readonly store: WorkbenchStore, options: { adapters?: readonly ExternalResultAdapter[]; cutpoint?: (phase: string) => Promise<void> } = {}) {
    this.root = join(store.root, 'external-assets'); this.#adapters = externalAdapters(options.adapters); this.#cutpoint = options.cutpoint ?? (async () => {})
  }
  #gate<T>(fn: () => Promise<T>): Promise<T> { const next = this.#queue.then(fn); this.#queue = next.catch(() => {}); return next }
  #track<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('external-closed'))
    const promise = fn(); this.#operations.add(promise); void promise.finally(() => this.#operations.delete(promise)).catch(() => {}); return promise
  }
  async #init() {
    if (this.#closed) throw new Error('external-closed')
    return this.#ready ??= this.#initialize().catch(error => { this.#ready = undefined; throw error })
  }
  async #initialize() {
    await this.store.init()
    this.root = join(await realpath(this.store.root), 'external-assets')
    for (const name of ['', 'jobs', 'staging', 'assets', 'references', 'grants', 'retired', 'trash']) await directory(join(this.root, name))
    for (const name of await entries(join(this.root, 'jobs'))) {
      if (name.startsWith('.acceptance-')) continue
      const job = await read(join(this.root, 'jobs', name), externalJobSchema)
      if (name !== `${job.id}.json`) throw new Error('external-job-identity')
      if (terminal.has(job.phase)) continue
      const release = await this.store.reserveEvidence(`external-recovery:${job.id}`, 8 * 1024 * 1024)
      try {
        try { const asset = await this.#asset(job.assetId); if (asset.jobId !== job.id || asset.inputDigest !== job.inputDigest) throw new Error('external-job-conflict'); job.phase = 'finished' }
        catch (error) { if (!missing(error)) throw error; job.phase = 'interrupted'; job.error = 'external-interrupted' }
        job.endedAt = new Date().toISOString(); await this.#save(job)
        await this.#discardStage(job.id)
      } finally { release() }
    }
  }
  #save(job: ExternalJob) { return write(join(this.root, 'jobs', `${job.id}.json`), job, true) }
  async #asset(id: string) {
    acceptanceId.parse(id)
    const asset = await read(join(this.root, 'assets', id, 'manifest.json'), externalAssetSchema)
    if (asset.id !== id) throw new Error('external-asset-identity')
    return asset
  }
  async #retired(id: string) {
    try { const value = await read(join(this.root, 'retired', `${id}.json`), retiredSchema); if (value.assetId !== id) throw new Error('external-retired-identity'); return true }
    catch (error) { if (missing(error)) return false; throw error }
  }
  async #discardStage(id: string) {
    acceptanceId.parse(id); const root = join(this.root, 'staging', id)
    try { await entries(root, 35) } catch (error) { if (missing(error)) return; throw error }
    await rm(root, { recursive: true })
  }
  preview(value: unknown): Promise<ExternalJob> {
    return this.#track(async () => {
      const input = externalInputSchema.parse(value), adapter = this.#adapters.get(input.adapter)
      if (!adapter) throw new Error('external-unknown-adapter')
      if (input.attachments.reduce((n, a) => n + Buffer.byteLength(a.bytes, 'base64'), 0) > externalLimits.total) throw new Error('external-attachment-budget')
      await this.#init()
      const inputDigest = acceptanceHash({ ...input, adapterVersion: adapter.version }), jobId = input.requestKey
      const prior = await this.#jobIfExists(jobId)
      if (prior) { if (prior.inputDigest !== inputDigest) throw new Error('external-request-conflict'); return prior }
      if (this.#active.size + this.#admitting >= 2) throw new Error('external-busy')
      this.#admitting++
      let release: (() => void) | undefined
      try {
        release = await this.store.reserveEvidence(`external:${randomUUID()}`, externalLimits.total + externalLimits.report + 8 * 1024 * 1024)
        return await this.#gate(async () => {
          if (this.#closed) throw new Error('external-closed')
          const prior = await this.#jobIfExists(jobId)
          if (prior) { if (prior.inputDigest !== inputDigest) throw new Error('external-request-conflict'); release!(); return prior }
          if ((await entries(join(this.root, 'jobs'))).length >= 1000) throw new Error('external-job-budget')
          const job: ExternalJob = { contractVersion: 1, id: jobId, assetId: randomUUID(), requestKey: input.requestKey, inputDigest, phase: 'accepted', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString() }
          await this.#save(job)
          const controller = new AbortController(), reservation = release!
          const active = { controller, promise: Promise.resolve(), release: reservation, timer: setTimeout(() => { void this.cancel(job.id).catch(() => {}) }, 600_000) }
          active.timer.unref(); this.#active.set(job.id, active)
          active.promise = this.#parse(job, input, adapter, controller.signal)
          void active.promise.catch(() => {})
          return structuredClone(job)
        })
      } catch (error) { release?.(); throw error } finally { this.#admitting-- }
    })
  }
  async #writeBytes(path: string, bytes: Buffer) { const file = await open(path, 'wx', 0o600); try { await file.writeFile(bytes); await file.sync() } finally { await file.close() } }
  async #parse(job: ExternalJob, input: ExternalInput, adapter: ExternalResultAdapter, signal: AbortSignal) {
    try {
      job.phase = 'parsing'; await this.#save(job); signal.throwIfAborted()
      const root = join(this.root, 'staging', job.id); await directory(root)
      const report = Buffer.from(input.report, 'base64'); await this.#writeBytes(join(root, 'report.bin'), report)
      const parsed = externalParsedSchema.parse(await adapter.parse(report, Object.freeze({ engine: input.engine, engineVersion: input.engineVersion }), signal))
      signal.throwIfAborted()
      const ids = new Set(parsed.tests.map(t => t.id))
      if (ids.size !== parsed.tests.length || new Set(input.bindings.map(b => b.testId)).size !== input.bindings.length || input.bindings.some(b => !ids.has(b.testId))) throw new Error('external-invalid-binding')
      for (const binding of input.bindings) { const test = parsed.tests.find(t => t.id === binding.testId)!; test.logicalTestKey = binding.logicalTestKey; test.inputDigest = binding.inputDigest }
      const attachments: ExternalAsset['attachments'] = []
      for (const inputFile of input.attachments) {
        signal.throwIfAborted()
        if (/\.(?:html?|svg|[cm]?js|sh|exe|mp4|webm)$/i.test(inputFile.label)) throw new Error('external-attachment-type')
        if (inputFile.testId && !ids.has(inputFile.testId)) throw new Error('external-invalid-binding')
        const bytes = Buffer.from(inputFile.bytes, 'base64'); await validateExternalAttachmentWorker(bytes, inputFile.contentType, signal); signal.throwIfAborted()
        const id = randomUUID(); await this.#writeBytes(join(root, `${id}.bin`), bytes)
        attachments.push({ id, label: inputFile.label, contentType: inputFile.contentType, sha256: sha256(bytes), bytes: bytes.length, ...(inputFile.testId ? { testId: inputFile.testId } : {}) })
      }
      const asset = externalAssetSchema.parse({ contractVersion: 1, id: job.assetId, jobId: job.id, requestKey: job.requestKey, inputDigest: job.inputDigest, importedAt: new Date().toISOString(), adapter: { id: adapter.id, version: adapter.version }, engine: input.engine, engineVersion: input.engineVersion, declaration: input.declaration, sourceDigest: sha256(report), reportBytes: report.length, parsed, attachments })
      await write(join(root, 'manifest.json'), asset); await this.#cutpoint('after-staging'); signal.throwIfAborted()
      job.previewDigest = acceptanceHash(asset); job.phase = 'preview'; await this.#save(job)
    } catch (error) {
      job.phase = signal.aborted ? 'cancelled' : 'failed'; job.error = error instanceof Error && /^external-[a-z-]+$/.test(error.message) ? error.message : 'external-import-failed'; job.endedAt = new Date().toISOString()
      try { await this.#save(job); await this.#discardStage(job.id) } finally { this.#release(job.id) }
    }
  }
  #release(id: string) { const active = this.#active.get(id); if (active) { clearTimeout(active.timer); active.release(); this.#active.delete(id) } }
  async #jobIfExists(id: string) { try { return await read(join(this.root, 'jobs', `${id}.json`), externalJobSchema) } catch (error) { if (missing(error)) return undefined; throw error } }
  getJob(id: string) {
    return this.#track(async () => {
      acceptanceId.parse(id); await this.#init(); const job = await this.#jobIfExists(id); if (!job || job.id !== id) throw new Error('external-job-not-found')
      if (job.phase === 'preview') return { ...job, preview: await read(join(this.root, 'staging', id, 'manifest.json'), externalAssetSchema) }
      return job
    })
  }
  confirm(id: string, value: unknown) {
    return this.#track(async () => {
      acceptanceId.parse(id)
      const request = z.object({ previewDigest: acceptanceDigest, reviewed: z.literal(true) }).strict().parse(value)
      await this.#init()
      return this.#gate(async () => {
        const job = await this.#jobIfExists(id)
        if (!job || job.previewDigest !== request.previewDigest) throw new Error('external-preview-conflict')
        if (job.phase === 'finished') return job
        if (job.phase !== 'preview' || !this.#active.has(id) || Date.parse(job.expiresAt) <= Date.now()) throw new Error('external-preview-expired')
        const active = this.#active.get(id)!; active.controller.signal.throwIfAborted()
        let published = false
        try {
        const root = join(this.root, 'staging', id), asset = await read(join(root, 'manifest.json'), externalAssetSchema)
        if (acceptanceHash(asset) !== request.previewDigest) throw new Error('external-preview-conflict')
        await this.#verify(asset, root); active.controller.signal.throwIfAborted()
        const existing = await entries(join(this.root, 'assets'))
        if (existing.includes(job.assetId) || existing.length >= 1000) throw new Error('external-asset-conflict')
        job.phase = 'committing'; await this.#save(job); await this.#cutpoint('before-publish')
        active.controller.signal.throwIfAborted()
        await rename(root, join(this.root, 'assets', job.assetId))
        published = true
        const dir = await open(join(this.root, 'assets'), constants.O_RDONLY | constants.O_NOFOLLOW); try { await dir.sync() } finally { await dir.close() }
        await this.#cutpoint('after-publish')
        job.phase = 'finished'; job.endedAt = new Date().toISOString(); await this.#save(job); this.#release(id)
        return job
        } catch (error) {
          job.phase = published ? 'finished' : active.controller.signal.aborted ? 'cancelled' : 'failed'
          job.endedAt = new Date().toISOString()
          if (!published) job.error = 'external-publication-failed'
          try { await this.#save(job); if (!published) await this.#discardStage(id) } finally { this.#release(id) }
          if (!published) throw error
          return job
        }
      })
    })
  }
  cancel(id: string) {
    return this.#track(async () => {
      acceptanceId.parse(id); await this.#init(); const active = this.#active.get(id)
      active?.controller.abort(new Error('external-cancelled')); await active?.promise
      return this.#gate(async () => {
        const job = await this.#jobIfExists(id); if (!job) throw new Error('external-job-not-found')
        if (!terminal.has(job.phase)) { job.phase = 'cancelled'; job.endedAt = new Date().toISOString(); await this.#save(job); await this.#discardStage(id) }
        this.#release(id); return job
      })
    })
  }
  async #verify(asset: ExternalAsset, root = join(this.root, 'assets', asset.id)) {
    const report = await readExternalFile(join(root, 'report.bin'), externalLimits.report)
    if (report.length !== asset.reportBytes || sha256(report) !== asset.sourceDigest) throw new Error('external-evidence-corrupt')
    for (const file of asset.attachments) { const bytes = await readExternalFile(join(root, `${file.id}.bin`), externalLimits.attachment); if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('external-evidence-corrupt') }
  }
  async lease(id: string) {
    await this.#init(); acceptanceId.parse(id)
    return this.#gate(async () => {
      if (await this.#retired(id)) throw new Error('external-retired')
      const asset = await this.#asset(id); this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1)
      let released = false
      return { asset, digest: acceptanceHash(asset), release: () => { if (!released) { released = true; const n = (this.#leases.get(id) ?? 1) - 1; if (n) this.#leases.set(id, n); else this.#leases.delete(id) } } }
    })
  }
  get(id: string) {
    return this.#track(async () => {
      const lease = await this.lease(id)
      try { let availability = 'verified'; try { await this.#verify(lease.asset) } catch { availability = 'unavailable' }
        return { asset: lease.asset, digest: lease.digest, availability, checkedAt: new Date().toISOString(), summary: externalSafeSummary(lease.asset) }
      } finally { lease.release() }
    })
  }
  list(offset = 0) {
    return this.#track(async () => { await this.#init(); z.number().int().min(0).max(1000).parse(offset); const names = (await entries(join(this.root, 'assets'))).sort(), items = []
      for (const id of names.slice(offset, offset + 20)) { if (await this.#retired(id)) continue; const asset = await this.#asset(id); items.push({ id, importedAt: asset.importedAt, adapter: asset.adapter, engine: asset.engine, reportedStatus: asset.parsed.reportedStatus }) }
      return { items, nextOffset: offset + 20 < names.length ? offset + 20 : null }
    })
  }
  download(id: string, attachmentId: string) {
    return this.#track(async () => { acceptanceId.parse(attachmentId); const lease = await this.lease(id)
      try { const file = lease.asset.attachments.find(f => f.id === attachmentId); if (!file) throw new Error('external-attachment-not-found')
        const bytes = await readExternalFile(join(this.root, 'assets', id, `${file.id}.bin`), externalLimits.attachment)
        if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('external-evidence-corrupt')
        return { bytes, contentType: file.contentType, name: `${file.id}.${({ 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt', 'application/json': 'json', 'application/xml': 'xml' } as const)[file.contentType]}` }
      } finally { lease.release() }
    })
  }
  grant(id: string, project: ExternalProject, granted: boolean) {
    return this.#track(async () => {
      acceptanceId.parse(id); externalProjectSchema.parse(project); await this.#init()
      const release = await this.store.reserveEvidence(`external-grant:${randomUUID()}`, 1024 * 1024)
      try { return await this.#gate(async () => { if (await this.#retired(id)) throw new Error('external-retired'); const asset = await this.#asset(id)
        const value = grantSchema.parse({ contractVersion: 1, assetId: id, digest: acceptanceHash(asset), project, granted, at: new Date().toISOString() })
        await write(join(this.root, 'grants', `${id}-${project.identity}.json`), value, true); return { id, project, granted, at: value.at }
      }) } finally { release() }
    })
  }
  async authorized(id: string, project: ExternalProject) {
    acceptanceId.parse(id); externalProjectSchema.parse(project); await this.#init()
    try { const asset = await this.#asset(id), grant = await read(join(this.root, 'grants', `${id}-${project.identity}.json`), grantSchema)
      return !await this.#retired(id) && grant.assetId === id && grant.granted && grant.digest === acceptanceHash(asset) && acceptanceHash(grant.project) === acceptanceHash(project)
    } catch { return false }
  }
  async #refs() {
    const result = []
    for (const name of await entries(join(this.root, 'references'), 10_000)) { const ref = await read(join(this.root, 'references', name), referenceSchema); if (name !== `${ref.id}.json`) throw new Error('external-reference-identity'); result.push(ref) }
    return result
  }
  pin(assetId: string, digest: string, consumer: string) {
    return this.#track(async () => { await this.#init(); return this.#gate(async () => {
      const ref = referenceSchema.parse({ contractVersion: 1, id: randomUUID(), assetId, digest, consumer, createdAt: new Date().toISOString() })
      if (await this.#retired(assetId)) throw new Error('external-retired')
      if (acceptanceHash(await this.#asset(assetId)) !== digest) throw new Error('external-source-changed')
      const refs = await this.#refs(), old = refs.find(r => r.assetId === assetId && r.digest === digest && r.consumer === consumer)
      if (old) return old
      if (refs.length >= 10_000) throw new Error('external-reference-budget')
      await write(join(this.root, 'references', `${ref.id}.json`), ref); return ref
    }) })
  }
  revoke(acceptanceIdValue: string) {
    return this.#track(async () => { acceptanceId.parse(acceptanceIdValue); await this.#init(); return this.#gate(async () => {
      for (const ref of await this.#refs()) if (ref.consumer.startsWith(`${acceptanceIdValue}:`)) await rm(join(this.root, 'references', `${ref.id}.json`))
      const dir = await open(join(this.root, 'references'), constants.O_RDONLY | constants.O_NOFOLLOW); try { await dir.sync() } finally { await dir.close() }
    }) })
  }
  retire(id: string) {
    return this.#track(async () => { acceptanceId.parse(id); await this.#init(); const release = await this.store.reserveEvidence(`external-retire:${randomUUID()}`, 1024 * 1024)
      try { return await this.#gate(async () => {
        if (this.#leases.has(id)) throw new Error('external-read-lease')
        if ((await this.#refs()).some(r => r.assetId === id)) throw new Error('external-referenced')
        if (!await this.#retired(id)) { await this.#asset(id); await write(join(this.root, 'retired', `${id}.json`), { contractVersion: 1, assetId: id, at: new Date().toISOString() }) }
        try { await rename(join(this.root, 'assets', id), join(this.root, 'trash', id)) } catch (error) { if (!missing(error)) throw error }
        return { id, retired: true, recovery: 'local-trash-retained' }
      }) } finally { release() }
    })
  }
  async close() {
    this.#closed = true
    for (const active of this.#active.values()) active.controller.abort(new Error('external-closed'))
    await Promise.allSettled([...this.#operations, ...[...this.#active.values()].map(a => a.promise)])
    await this.#gate(async () => { for (const [id] of this.#active) {
      const job = await this.#jobIfExists(id)
      if (job && !terminal.has(job.phase)) { job.phase = 'interrupted'; job.endedAt = new Date().toISOString(); await this.#save(job); await this.#discardStage(id) }
      this.#release(id)
    } })
  }
}
