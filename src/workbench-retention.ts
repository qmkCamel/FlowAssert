import { syncBuiltinReferences } from './workbench-builtin-references.js'
import { referencePublicationsSchema, type ReferencePublications } from './workbench-evidence-contracts.js'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkbenchReferenceSnapshot } from './workbench-reference-snapshot.js'
import { sha256, validRunId, type WorkbenchStore } from './workbench-store.js'
import { WorkbenchCleanupJournal, safePurgeRelative, type TrashJournal, type PurgeFile } from './workbench-cleanup-journal.js'

export interface RetentionEntry { id: string; startedAt: string; bytes: number; protectedBy: string[]; manifestSha256: string }
export interface RetentionSnapshot { generation: string; runs: RetentionEntry[]; liveBytes: number; trashBytes: number;
  categories: { runs: number; trash: number; exports: number; baselines: number; indexes: number }; scan: { version: 1; complete: true; entries: number; metadataBytes: number };
  trash: { id: string; bytes: number; state: 'moving' | 'trashed' | 'interrupted' }[] }
export interface RetentionPlan { id: string; createdAt: string; expiresAt: string; generation: string; ownerGeneration: string; olderThanDays: number; candidates: { id: string; bytes: number; manifestSha256: string }[]; protected: { id: string; reasons: string[] }[]; movableBytes: number; physicallyFreedBytes: 0; digest: string }

/** Conservative local lifecycle manager: any unreadable reference index fails closed. */
export class WorkbenchRetention {
  readonly root: string
  readonly journals: WorkbenchCleanupJournal
  #plans = new Map<string, string>()
  #recovery: Promise<void> | null = null
  constructor(private readonly store: WorkbenchStore, private readonly activeRunId: () => string | null = () => null, private readonly cutpoint: (name: string) => Promise<void> = async () => {}) { this.root = join(store.root, 'retention'); this.journals = new WorkbenchCleanupJournal(join(this.root, 'journals')) }

  async snapshot(skipRecovery = false): Promise<RetentionSnapshot> {
    await this.store.init()
    if (!skipRecovery) await this.recover()
    const refs = await this.#references()
    const runs: RetentionEntry[] = []
    const budget: ScanBudget = { entries: 0, metadataBytes: 0, startedAt: Date.now() }
    for (const run of await this.store.list()) {
      const id = run.id
      const directory = join(this.store.root, id)
      const { bytes, unsafe } = await directoryBytes(directory, budget)
      let manifestSha256 = ''
      try { manifestSha256 = (await this.store.readOnlySnapshot(id)).manifestSha256 } catch { /* fail closed below */ }
      const protectedBy = [...(refs.get(id) ?? [])]
      if (run.phase !== 'finished') protectedBy.push('unfinished-run')
      if (run.recovery?.reason === 'Manifest unavailable' || !manifestSha256) protectedBy.push('unreadable-manifest')
      if (unsafe) protectedBy.push('unsafe-directory-entry')
      if (this.activeRunId() === id) protectedBy.push('active-run')
      if (this.store.hasReadLease(id)) protectedBy.push('read-lease')
      runs.push({ id, startedAt: run.startedAt, bytes, protectedBy: [...new Set(protectedBy)].sort(), manifestSha256 })
    }
    const trash: RetentionSnapshot['trash'] = []
    const trashRoot = join(this.root, 'trash')
    for (const entry of await safeEntries(trashRoot)) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) throw new Error('Unsafe trash entry')
      const { bytes, unsafe } = await directoryBytes(join(trashRoot, entry.name), budget)
      if (unsafe) throw new Error('Unsafe trash directory')
      const journal = await this.#journal(entry.name).catch(() => null)
      trash.push({ id: entry.name, bytes, state: journal?.state === 'trashed' ? 'trashed' : 'interrupted' })
    }
    const categories = { runs: runs.reduce((sum, entry) => sum + entry.bytes, 0), trash: trash.reduce((sum, entry) => sum + entry.bytes, 0),
      exports: await optionalDirectoryBytes(join(this.store.root, 'share-jobs'), budget),
      baselines: await optionalDirectoryBytes(join(this.store.root, 'baselines'), budget),
      indexes: await optionalDirectoryBytes(join(this.store.root, 'trends'), budget) }
    const generation = sha256(JSON.stringify({ ownerGeneration: this.store.ownerGeneration, runs: runs.map(({ id, bytes, protectedBy, manifestSha256 }) => ({ id, bytes, protectedBy, manifestSha256 })), trash, refs: [...refs].map(([id, reasons]) => [id, [...reasons].sort()]).sort() }))
    return { generation, runs, liveBytes: categories.runs, trashBytes: categories.trash, categories,
      scan: { version: 1, complete: true, entries: budget.entries, metadataBytes: budget.metadataBytes }, trash }
  }

  async plan(olderThanDays = 30, maxRuns = 20): Promise<RetentionPlan> {
    if (!Number.isSafeInteger(olderThanDays) || olderThanDays < 0 || olderThanDays > 3650 || !Number.isSafeInteger(maxRuns) || maxRuns < 1 || maxRuns > 100) throw new Error('Invalid retention bounds')
    const snapshot = await this.snapshot()
    const cutoff = Date.now() - olderThanDays * 86_400_000
    const candidates = snapshot.runs.filter(entry => !entry.protectedBy.length && Number.isFinite(Date.parse(entry.startedAt)) && Date.parse(entry.startedAt) < cutoff)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(0, maxRuns).map(({ id, bytes, manifestSha256 }) => ({ id, bytes, manifestSha256 }))
    const body = { id: randomUUID(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), generation: snapshot.generation, ownerGeneration: this.store.ownerGeneration, olderThanDays,
      candidates, protected: snapshot.runs.filter(entry => entry.protectedBy.length).map(entry => ({ id: entry.id, reasons: entry.protectedBy })),
      movableBytes: candidates.reduce((sum, entry) => sum + entry.bytes, 0), physicallyFreedBytes: 0 as const }
    const plan = { ...body, digest: sha256(JSON.stringify(body)) }
    if (this.#plans.size >= 100) this.#plans.clear()
    this.#plans.set(plan.id, plan.digest)
    return plan
  }

  async confirm(plan: RetentionPlan): Promise<{ moved: string[]; failed: { id: string; reason: string }[]; pending: string[]; trashBytes: number; physicallyFreedBytes: 0 }> {
    if (!plan || !/^[0-9a-f-]{36}$/.test(plan.id) || !/^[a-f0-9]{64}$/.test(plan.digest) || Date.parse(plan.expiresAt) < Date.now() || this.#plans.get(plan.id) !== plan.digest || plan.ownerGeneration !== this.store.ownerGeneration) throw new Error('Retention plan expired or was not previewed in this session')
    const { digest: _digest, ...body } = plan
    if (sha256(JSON.stringify(body)) !== plan.digest) throw new Error('Retention plan was modified')
    return this.store.withMutationGate(async () => {
      const current = await this.snapshot(true)
      if (current.generation !== plan.generation) throw new Error('Retention plan is stale; review again')
      const eligible = new Map(current.runs.filter(entry => !entry.protectedBy.length).map(entry => [entry.id, entry]))
      for (const item of plan.candidates) {
        const entry = eligible.get(item.id)
        if (!entry || entry.bytes !== item.bytes || entry.manifestSha256 !== item.manifestSha256 || this.store.hasReadLease(item.id)) throw new Error('Retention candidate acquired a reference or lease')
      }
      const trashRoot = join(this.root, 'trash')
      await safeDirectory(this.root); await safeDirectory(trashRoot)
      const moved: string[] = []
      const failed: { id: string; reason: string }[] = [], pending: string[] = []
      for (const [index, item] of plan.candidates.entries()) {
        try {
        const source = join(this.store.root, item.id), target = join(trashRoot, item.id)
        if ((await lstat(source)).isSymbolicLink()) throw new Error('Run directory became unsafe')
        try { await lstat(target); throw new Error('Trash identity already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        const child = (await this.store.readOnlySnapshot(item.id)).run, parentRunId = child.parentRunId
        const journal: TrashJournal = { id: item.id, createdAt: new Date().toISOString(), state: 'moving', manifestSha256: item.manifestSha256, bytes: item.bytes, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), ...(parentRunId ? { parentRunId } : {}), ...(child.referencePublications ? { referencePublications: child.referencePublications } : {}) }
        await this.cutpoint('move:before-intent')
        await this.#writeJournal(journal)
        await this.cutpoint('move:after-intent')
        await this.cutpoint('move:before-rename')
        await rename(source, target)
        await this.cutpoint('move:after-rename')
        await this.cutpoint('move:before-fsync')
        await syncDirectory(this.store.root); await syncDirectory(trashRoot)
        await this.cutpoint('move:after-fsync')
        await this.cutpoint('move:before-commit')
        journal.state = 'trashed'; await this.#writeJournal(journal)
        await this.cutpoint('move:after-commit')
        moved.push(item.id)
        } catch (error) {
          failed.push({ id: item.id, reason: (error as NodeJS.ErrnoException).code === 'EXDEV' ? 'cross-device-rename-refused' : 'move-failed-recovery-required' })
          pending.push(...plan.candidates.slice(index + 1).map(candidate => candidate.id))
          break
        }
      }
      this.#plans.delete(plan.id)
      return { moved, failed, pending, trashBytes: moved.reduce((sum, id) => sum + plan.candidates.find(item => item.id === id)!.bytes, 0), physicallyFreedBytes: 0 }
    })
  }

  async restore(id: string): Promise<void> {
    validRunId(id)
    await this.recover()
    await this.store.withMutationGate(async () => {
      const journal = await this.#journal(id)
      if (!['moving', 'trashed'].includes(journal.state)) throw new Error('Run is not in recoverable trash')
      const source = join(this.root, 'trash', id), target = join(this.store.root, id)
      const info = await lstat(source)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Trash run is unsafe')
      try { await lstat(target); throw new Error('Run identity already exists; restore cannot overwrite') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await this.cutpoint('restore:before-intent')
      journal.state = 'restore-intent'; await this.#writeJournal(journal)
      await this.cutpoint('restore:after-intent')
      await this.cutpoint('restore:before-rename')
      await rename(source, target)
      await this.cutpoint('restore:after-rename')
      await this.cutpoint('restore:before-fsync')
      await syncDirectory(this.store.root); await syncDirectory(join(this.root, 'trash'))
      await this.cutpoint('restore:after-fsync')
      await this.cutpoint('restore:before-commit')
      journal.state = 'restored'; await this.#writeJournal(journal)
      await this.cutpoint('restore:after-commit')
    })
  }

  async purge(id: string, confirmPhrase: string): Promise<number> {
    validRunId(id)
    if (confirmPhrase !== `PURGE ${id}`) throw new Error('Independent irreversible purge confirmation is required')
    await this.recover()
    return this.store.withMutationGate(async () => {
      const journal = await this.#journal(id)
      if (journal.state === 'purged') { await this.#retireChild(journal); return 0 }
      if (!['moving', 'trashed', 'purge-interrupted'].includes(journal.state)) throw new Error('Run is not in trash')
      const path = join(this.root, 'trash', id), info = await lstat(path)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe trash identity')
      const refs = await this.#references()
      if (refs.has(id) || this.store.hasReadLease(id)) throw new Error('Trash run is referenced or leased')
      const { bytes, unsafe } = await directoryBytes(path, { entries: 0, metadataBytes: 0, startedAt: Date.now() })
      if (unsafe) throw new Error('Unsafe trash contents')
      const current = await purgeInventory(path)
      if (journal.purgeRemaining) {
        const original = new Map(journal.purgeRemaining.map(item => [item.relative, item]))
        for (const item of current.files) {
          const expected = original.get(item.relative)
          if (!expected || expected.sha256 !== item.sha256 || expected.bytes !== item.bytes) throw new Error('Remaining purge contents changed; recovery required')
        }
      } else {
        if (!(await sameManifest(path, journal.manifestSha256))) throw new Error('Trash manifest changed; recovery required')
        journal.purgeRemaining = current.files
        journal.purgeInventorySha256 = sha256(JSON.stringify(current.files))
      }
      journal.purgeAuthorizedAt = new Date().toISOString()
      await this.cutpoint('purge:before-intent')
      journal.state = 'purge-intent'; await this.#writeJournal(journal)
      await this.cutpoint('purge:after-intent')
      for (const file of current.files) {
        const target = join(path, file.relative)
        const info = await lstat(target)
        if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes || await fileSha256(target) !== file.sha256) throw new Error('Purge file changed; recovery required')
        await this.cutpoint('purge:before-unlink')
        await unlink(target)
        await this.cutpoint('purge:after-unlink')
        journal.purgeRemaining = journal.purgeRemaining!.filter(item => item.relative !== file.relative)
        await this.cutpoint('purge:before-file-commit')
        await this.#writeJournal(journal)
        await this.cutpoint('purge:after-file-commit')
      }
      for (const directory of current.directories) await rmdir(join(path, directory))
      await this.cutpoint('purge:before-root-remove')
      await rmdir(path)
      await this.cutpoint('purge:after-root-remove')
      await syncDirectory(join(this.root, 'trash'))
      await this.cutpoint('purge:after-fsync')
      await this.cutpoint('purge:before-commit')
      journal.state = 'purged'; journal.purgeRemaining = []; await this.#writeJournal(journal)
      await this.#retireChild(journal)
      await this.cutpoint('purge:after-commit')
      return bytes
    })
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    validRunId(id)
    await this.store.withMutationGate(async () => {
      if (pinned) await this.store.readOnlySnapshot(id)
      const pins = await this.#pins()
      pinned ? pins.add(id) : pins.delete(id)
      await safeDirectory(this.root)
      await syncBuiltinReferences(this.store, 'workbench:pin', 'pins', await this.#pinReferences(), [...pins], async publications => {
        for (const [name, value] of [['pins.json', [...pins].sort()], ['pin-references.json', publications]] as const) {
          const temporary = join(this.root, `.pins-${randomUUID()}.tmp`)
          const handle = await open(temporary, 'wx', 0o600)
          try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
          await rename(temporary, join(this.root, name)); await syncDirectory(this.root)
        }
      }, this.cutpoint)
    })
  }

  async #pins(): Promise<Set<string>> {
    let bytes: Buffer
    try { const handle = await open(join(this.root, 'pins.json'), constants.O_RDONLY | constants.O_NOFOLLOW); try { bytes = await handle.readFile() } finally { await handle.close() } }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set(); throw error }
    if (bytes.length > 64 * 1024) throw new Error('Pin index exceeds budget')
    const ids = JSON.parse(bytes.toString('utf8'))
    if (!Array.isArray(ids) || ids.length > 1000 || !ids.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))) throw new Error('Invalid pin index')
    return new Set(ids)
  }

  async #references(): Promise<Map<string, Set<string>>> {
    return new WorkbenchReferenceSnapshot(this.store, { root: this.root,
      readJournal: id => this.#journal(id), pins: () => this.#pins(), pinReferences: () => this.#pinReferences() }).snapshot()
  }

  async #pinReferences(): Promise<ReferencePublications | undefined> {
    let handle
    try { handle = await open(join(this.root, 'pin-references.json'), constants.O_RDONLY | constants.O_NOFOLLOW) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    try {
      if ((await handle.stat()).size > 4 * 1024 * 1024) throw new Error('Pin references exceed budget')
      return referencePublicationsSchema.parse(JSON.parse(await handle.readFile('utf8')))
    } finally { await handle.close() }
  }

  async #retireChild(journal: TrashJournal): Promise<void> {
    if (journal.referencePublications === undefined) return
    await syncBuiltinReferences(this.store, 'workbench:child', journal.id, journal.referencePublications, [], async publications => {
      await this.#writeJournal({ ...journal, referencePublications: publications }); journal.referencePublications = publications
    }, this.cutpoint)
  }

  async #journal(id: string): Promise<TrashJournal> {
    return this.journals.read(id)
  }
  async #writeJournal(journal: TrashJournal): Promise<void> {
    await this.journals.write(journal)
  }

  async recover(): Promise<void> {
    if (this.#recovery) return this.#recovery
    const recovery = this.store.withMutationGate(async () => {
      for (const entry of await safeEntries(join(this.root, 'journals'))) {
        if (entry.isFile() && /^\.journal-[0-9a-f-]{36}\.tmp$/.test(entry.name)) continue
        if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) throw new Error('Unsafe retention journal index')
        const journal = await this.#journal(entry.name.slice(0, -5))
        const live = await pathExists(join(this.store.root, journal.id))
        const trash = await pathExists(join(this.root, 'trash', journal.id))
        if (journal.state === 'moving') {
          if (live && !trash) journal.state = 'move-interrupted'
          else if (!live && trash && await sameManifest(join(this.root, 'trash', journal.id), journal.manifestSha256)) journal.state = 'trashed'
          else journal.state = 'recovery-required'
          await this.#writeJournal(journal)
        } else if (journal.state === 'restore-intent') {
          if (live && !trash && await sameManifest(join(this.store.root, journal.id), journal.manifestSha256)) journal.state = 'restored'
          else if (!live && trash && await sameManifest(join(this.root, 'trash', journal.id), journal.manifestSha256)) journal.state = 'trashed'
          else journal.state = 'recovery-required'
          await this.#writeJournal(journal)
        } else if (journal.state === 'purge-intent') {
          journal.state = trash && !live ? 'purge-interrupted' : !trash && !live ? 'purged' : 'recovery-required'
          await this.#writeJournal(journal)
        }
        if (journal.state === 'purged') await this.#retireChild(journal)
      }
    })
    this.#recovery = recovery
    try { await recovery } finally { if (this.#recovery === recovery) this.#recovery = null }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe lifecycle directory'); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
async function sameManifest(directory: string, expected: string): Promise<boolean> {
  try {
    const handle = await open(join(directory, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
    try { return sha256(await handle.readFile()) === expected } finally { await handle.close() }
  } catch { return false }
}

async function fileSha256(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Unsafe purge file')
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    return hash.digest('hex')
  } finally { await handle.close() }
}
async function purgeInventory(root: string): Promise<{ files: PurgeFile[]; directories: string[] }> {
  const files: PurgeFile[] = [], directories: string[] = []
  const walk = async (relative: string, depth: number): Promise<void> => {
    if (depth > 8 || files.length + directories.length > 10_000) throw new Error('Purge inventory exceeds budget')
    for (const entry of await safeEntries(join(root, relative))) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (!safePurgeRelative(child) || entry.isSymbolicLink()) throw new Error('Unsafe purge entry')
      const path = join(root, child)
      if (entry.isDirectory()) { await walk(child, depth + 1); directories.push(child) }
      else if (entry.isFile()) { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe purge entry'); files.push({ relative: child, bytes: info.size, sha256: await fileSha256(path) }) }
      else throw new Error('Unsafe purge entry')
    }
  }
  await walk('', 0)
  files.sort((a, b) => a.relative.localeCompare(b.relative))
  return { files, directories }
}

async function safeEntries(directory: string) {
  try { const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe retention directory'); return await readdir(directory, { withFileTypes: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
async function safeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe retention directory')
}
interface ScanBudget { entries: number; metadataBytes: number; startedAt: number }
async function directoryBytes(directory: string, budget: ScanBudget, depth = 0): Promise<{ bytes: number; unsafe: boolean }> {
  if (depth > 8 || Date.now() - budget.startedAt > 30_000) throw new Error('Retention scan coverage incomplete')
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) return { bytes: 0, unsafe: true }
  let bytes = 0, unsafe = false
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    budget.entries++
    budget.metadataBytes += 256 + Buffer.byteLength(entry.name)
    if (budget.entries > 100_000 || budget.metadataBytes > 128 * 1024 * 1024 || Date.now() - budget.startedAt > 30_000)
      throw new Error('Retention scan coverage incomplete')
    if (entry.isSymbolicLink()) { unsafe = true; continue }
    const path = join(directory, entry.name), stat = await lstat(path)
    if (entry.isFile()) bytes += stat.size
    else if (entry.isDirectory()) { const child = await directoryBytes(path, budget, depth + 1); bytes += child.bytes; unsafe ||= child.unsafe }
    else unsafe = true
  }
  return { bytes, unsafe }
}
async function optionalDirectoryBytes(directory: string, budget: ScanBudget): Promise<number> {
  try { const result = await directoryBytes(directory, budget); if (result.unsafe) throw new Error('Retention scan coverage incomplete'); return result.bytes }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
}
async function syncDirectory(directory: string) { const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW); try { await handle.sync() } finally { await handle.close() } }
