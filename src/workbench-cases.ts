import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { sha256 } from './content-hash.js'
import { stableJson } from './workbench-comparison.js'
import { webCaseSchema } from './workbench-web-contracts.js'
import type { WorkbenchStore } from './workbench-store.js'

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.string().datetime()
export const caseContentSchema = z.object({ name: z.string().trim().min(1).max(160), tags: z.array(z.string().trim().min(1).max(32)).max(10),
  platform: z.enum(['ios', 'android']), appId: z.string().min(1).max(255), yaml: z.string().min(1).refine(value => Buffer.byteLength(value) <= 64 * 1024), publicParams: z.record(z.unknown()) }).strict()
export const caseOriginSchema = z.object({ caseId: id, revisionId: id, inputDigest: hash }).strict()
const revisionMeta = { schemaVersion: z.literal(1), caseId: id, revisionId: id, projectDigest: hash, contentDigest: hash, createdAt: date, requestHash: hash }
const revisionSchema = z.union([caseContentSchema.extend(revisionMeta).strict(), webCaseSchema.extend(revisionMeta).strict()])
const mobileRecordSchema = z.object({ schemaVersion: z.literal(1), caseId: id, name: z.string().max(160), tags: z.array(z.string().max(32)).max(10),
  platform: z.enum(['ios', 'android']), appId: z.string().max(255), headRevision: id, archivedAt: date.nullable(), createdAt: date, updatedAt: date,
  revisions: z.array(z.object({ revisionId: id, contentDigest: hash, createdAt: date }).strict()).max(100) }).strict()
const recordSchema = z.union([mobileRecordSchema, mobileRecordSchema.omit({ appId: true }).extend({ platform: z.literal('web'), executionKind: z.literal('web') }).strict()])
const catalogSchema = z.object({ schemaVersion: z.literal(1), generation: id,
  cases: z.record(recordSchema), requests: z.record(z.object({ digest: hash, caseId: id, revisionId: id, archivedAt: date.nullable() }).strict()) }).strict()
const saveSchema = z.object({ requestId: id, expectedRevision: id.nullable(), content: z.union([caseContentSchema, webCaseSchema]), publicData: z.literal(true) }).strict()
type Catalog = z.infer<typeof catalogSchema>
export type CaseRevision = z.infer<typeof revisionSchema>
export class CaseLibraryError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'CaseLibraryError' }
}
const catalogBudget = 32 * 1024 * 1024, revisionBudget = 128 * 1024
export type CaseWritePoint = 'revision-synced' | 'revision-renamed' | 'revision-directory-synced' | 'head-synced' | 'head-renamed' | 'head-directory-synced'

/** A bounded authoring index, not a run/evidence owner. Revisions never participate in retention. */
export class WorkbenchCaseLibrary {
  readonly root: string
  #closed = false
  #pending = new Set<Promise<unknown>>()
  constructor(readonly store: WorkbenchStore, private readonly projectDigest: () => Promise<string>,
    private readonly cutpoint: (point: CaseWritePoint) => Promise<void> = async () => {}) { this.root = join(store.root, 'cases') }
  stopAccepting() { this.#closed = true }
  async close() { this.stopAccepting(); await Promise.allSettled(this.#pending) }
  async #directory() { await safeDirectory(this.root, true); await syncDirectory(this.store.root) }
  async #catalog(): Promise<Catalog> {
    await this.#directory()
    try {
      const catalog = catalogSchema.parse(await readJson(join(this.root, 'catalog.json'), catalogBudget))
      if (Object.keys(catalog.cases).length > 1000 || Object.keys(catalog.requests).length > 10000) throw new CaseLibraryError('case-library-budget', 413)
      for (const [key, record] of Object.entries(catalog.cases)) if (key !== record.caseId || !record.revisions.some(revision => revision.revisionId === record.headRevision)
        || new Set(record.revisions.map(revision => revision.revisionId)).size !== record.revisions.length) throw new CaseLibraryError('case-library-corrupt')
      for (const [key, request] of Object.entries(catalog.requests)) if (!id.safeParse(key).success || !catalog.cases[request.caseId]?.revisions.some(revision => revision.revisionId === request.revisionId)) throw new CaseLibraryError('case-library-corrupt')
      return catalog
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // Missing index alongside published files is not an empty library.
      const entries = await readdir(this.root)
      if (entries.some(name => !name.endsWith('.tmp'))) throw new CaseLibraryError('case-library-index-missing')
      return { schemaVersion: 1, generation: randomUUID(), cases: {}, requests: {} }
    }
  }
  async #operation<T>(write: boolean, action: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new CaseLibraryError('case-library-closed')
    const operation = (async () => {
      const release = write ? await this.store.reserveEvidence(`case:${randomUUID()}`, catalogBudget + revisionBudget) : () => {}
      try { return await this.store.withMutationGate(async () => { if (this.#closed) throw new CaseLibraryError('case-library-closed'); return action() }) }
      finally { release() }
    })()
    this.#pending.add(operation)
    try { return await operation } finally { this.#pending.delete(operation) }
  }
  async list(value: unknown = {}) {
    const input = z.object({ query: z.string().max(160).default(''), tag: z.string().max(32).default(''), archived: z.boolean().default(false), cursor: z.string().max(256).optional() }).strict().parse(value)
    return this.#operation(false, async () => {
      const catalog = await this.#catalog(), filter = sha256(stableJson({ query: input.query, tag: input.tag, archived: input.archived }))
      let offset = 0
      if (input.cursor) {
        const cursor = z.object({ generation: id, offset: z.number().int().min(0).max(1000), filter: hash }).strict().parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString()))
        if (cursor.generation !== catalog.generation || cursor.filter !== filter) throw new CaseLibraryError('case-library-refresh-required')
        offset = cursor.offset
      }
      const all = Object.values(catalog.cases).filter(record => Boolean(record.archivedAt) === input.archived && record.name.toLowerCase().includes(input.query.toLowerCase()) && (!input.tag || record.tags.includes(input.tag))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.caseId.localeCompare(b.caseId))
      return { generation: catalog.generation, total: all.length, cases: all.slice(offset, offset + 50).map(({ revisions: _, ...summary }) => summary),
        cursor: offset + 50 < all.length ? Buffer.from(JSON.stringify({ generation: catalog.generation, offset: offset + 50, filter })).toString('base64url') : null }
    })
  }
  async get(caseId: string) {
    id.parse(caseId)
    return this.#operation(false, async () => { const record = (await this.#catalog()).cases[caseId]; if (!record) throw new CaseLibraryError('case-not-found', 404); return record })
  }
  async revision(caseId: string, revisionId: string) {
    id.parse(caseId); id.parse(revisionId)
    return this.#operation(false, async () => {
      const catalog = await this.#catalog(), record = catalog.cases[caseId], expected = record?.revisions.find(item => item.revisionId === revisionId)
      if (!expected) throw new CaseLibraryError('case-revision-not-found', 404)
      const revision = await this.#readRevision(caseId, revisionId)
      if (revision.contentDigest !== expected.contentDigest) throw new CaseLibraryError('case-revision-corrupt')
      return revision
    })
  }
  async #readRevision(caseId: string, revisionId: string) {
    await safeDirectory(join(this.root, caseId), false)
    const revision = revisionSchema.parse(await readJson(join(this.root, caseId, `${revisionId}.json`), revisionBudget))
    const { schemaVersion: _, caseId: owner, revisionId: revisionKey, contentDigest, createdAt: _created, requestHash: _request, ...content } = revision
    if (owner !== caseId || revisionKey !== revisionId || sha256(stableJson(content)) !== contentDigest) throw new CaseLibraryError('case-revision-corrupt')
    return revision
  }
  async save(caseId: string | null, value: unknown) {
    if (caseId) id.parse(caseId)
    if (Buffer.byteLength(JSON.stringify(value)) > 80 * 1024) throw new CaseLibraryError('case-request-budget', 413)
    const input = saveSchema.parse(value), requestHash = sha256(stableJson({ caseId, ...input }))
    return this.#operation(true, async () => {
      const catalog = await this.#catalog(), prior = catalog.requests[input.requestId]
      if (prior) { if (prior.digest !== requestHash) throw new CaseLibraryError('case-request-conflict'); return prior }
      const key = caseId ?? deterministicId(input.requestId), record = catalog.cases[key]
      if (caseId && !record) throw new CaseLibraryError('case-not-found', 404)
      if ((record?.headRevision ?? null) !== input.expectedRevision) throw new CaseLibraryError('case-revision-conflict')
      if (record?.archivedAt) throw new CaseLibraryError('case-archived')
      if (!record && Object.keys(catalog.cases).length >= 1000 || Object.keys(catalog.requests).length >= 10000) throw new CaseLibraryError('case-library-budget', 413)
      const content = { ...input.content, projectDigest: await this.projectDigest() }, contentDigest = sha256(stableJson(content))
      const identical = record?.revisions.find(item => item.contentDigest === contentDigest)
      if (!identical && (record?.revisions.length ?? 0) >= 100) throw new CaseLibraryError('case-revision-budget', 413)
      // Commit an empty index first. A crash creating the first revision cannot turn a missing index into an empty library.
      if (!Object.keys(catalog.cases).length && !Object.keys(catalog.requests).length) await this.#write('catalog.json', catalog, 'head')
      const revisionId = identical?.revisionId ?? deterministicId(`revision:${input.requestId}`), now = new Date().toISOString()
      const directories = await readdir(this.root, { withFileTypes: true })
      if (directories.some(entry => entry.isSymbolicLink())) throw new CaseLibraryError('case-unsafe-directory')
      if (!record && !directories.some(entry => entry.name === key) && directories.filter(entry => entry.isDirectory()).length >= 1000) throw new CaseLibraryError('case-library-budget', 413)
      await safeDirectory(join(this.root, key), true); await syncDirectory(this.root)
      const files = await readdir(join(this.root, key), { withFileTypes: true })
      if (files.some(entry => !entry.isFile() || !/^[0-9a-f-]{36}\.json(?:\.[0-9a-f-]{36}\.tmp)?$/.test(entry.name))) throw new CaseLibraryError('case-unsafe-revision')
      if (!identical && !files.some(entry => entry.name === `${revisionId}.json`) && files.filter(entry => entry.name.endsWith('.json')).length >= 100) throw new CaseLibraryError('case-revision-budget', 413)
      if (files.length >= 1000) throw new CaseLibraryError('case-orphan-budget', 413)
      if (!identical) {
        const revision: CaseRevision = { schemaVersion: 1, caseId: key, revisionId, ...content, contentDigest, createdAt: now, requestHash }
        try { const orphan = await this.#readRevision(key, revisionId); if (orphan.requestHash !== requestHash || orphan.contentDigest !== contentDigest) throw new CaseLibraryError('case-request-conflict') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.#write(`${key}/${revisionId}.json`, revision, 'revision') }
      }
      if (record && record.platform !== content.platform) throw new CaseLibraryError('case-execution-kind-changed')
      catalog.cases[key] = { schemaVersion: 1, caseId: key, name: content.name, tags: content.tags,
        ...(content.platform === 'web' ? { platform: 'web' as const, executionKind: 'web' as const } : { platform: content.platform, appId: content.appId }),
        headRevision: revisionId, archivedAt: null, createdAt: record?.createdAt ?? now, updatedAt: now,
        revisions: identical ? record!.revisions : [...(record?.revisions ?? []), { revisionId, contentDigest, createdAt: now }] }
      const result = { digest: requestHash, caseId: key, revisionId, archivedAt: null }
      catalog.requests[input.requestId] = result; catalog.generation = randomUUID()
      await this.#write('catalog.json', catalog, 'head')
      return result
    })
  }
  async archive(caseId: string, value: unknown) {
    id.parse(caseId)
    const input = z.object({ requestId: id, expectedRevision: id, archived: z.boolean() }).strict().parse(value)
    return this.#operation(true, async () => {
      const catalog = await this.#catalog(), digest = sha256(stableJson({ caseId, ...input })), prior = catalog.requests[input.requestId]
      if (prior) { if (prior.digest !== digest) throw new CaseLibraryError('case-request-conflict'); return prior }
      const record = catalog.cases[caseId]; if (!record) throw new CaseLibraryError('case-not-found', 404)
      if (record.headRevision !== input.expectedRevision) throw new CaseLibraryError('case-revision-conflict')
      if (Object.keys(catalog.requests).length >= 10000) throw new CaseLibraryError('case-library-budget', 413)
      record.updatedAt = new Date().toISOString(); record.archivedAt = input.archived ? record.updatedAt : null
      const result = { digest, caseId, revisionId: record.headRevision, archivedAt: record.archivedAt }
      catalog.requests[input.requestId] = result; catalog.generation = randomUUID(); await this.#write('catalog.json', catalog, 'head'); return result
    })
  }
  async #write(relative: string, value: unknown, kind: 'head' | 'revision') {
    const text = JSON.stringify(value), limit = kind === 'head' ? catalogBudget : revisionBudget
    if (Buffer.byteLength(text) > limit) throw new CaseLibraryError('case-storage-budget', 413)
    const path = join(this.root, relative), parent = kind === 'head' ? this.root : join(this.root, relative.split('/')[0]!)
    const temporary = `${path}.${randomUUID()}.tmp`, handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(text); await handle.sync() } finally { await handle.close() }
    await this.cutpoint(`${kind}-synced`); await rename(temporary, path); await this.cutpoint(`${kind}-renamed`)
    await syncDirectory(parent); await this.cutpoint(`${kind}-directory-synced`)
  }
}
async function safeDirectory(path: string, create: boolean) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CaseLibraryError('case-unsafe-directory')
}
async function syncDirectory(path: string) { const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { await handle.sync() } finally { await handle.close() } }
async function readJson(path: string, budget: number): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > budget) throw new CaseLibraryError('case-storage-budget', 413); return JSON.parse(await handle.readFile('utf8')) } finally { await handle.close() }
}
function deterministicId(value: string) { const hash = sha256(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}` }
