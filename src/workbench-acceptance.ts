import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkbenchStore } from './workbench-store.js'

export interface AcceptanceIdentity {
  executionId: string
  requestKey: string
  requestHash: string
  phase: 'accepted' | 'running' | 'cancelling' | 'finished'
}
export type AcceptanceWritePoint = 'temporary-synced' | 'renamed' | 'directory-synced'
const roots = { agent: 'agent-executions', authoring: 'authoring-executions' } as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const digest = /^[0-9a-f]{64}$/

export class AcceptanceError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'AcceptanceError' }
}

export interface AcceptanceAdapter<J extends AcceptanceIdentity> {
  parse(value: unknown): J
  recover(journal: J): Promise<void>
  drain(): Promise<void>
  writeHook?: (point: AcceptanceWritePoint, journal: Readonly<J>) => void
  maxEntries?: number
  maxBytes?: number
}

/** No device access, authorization, timers or initialization in the constructor. */
export class WorkbenchAcceptance {
  #channels = new Map<string, { stopAccepting(): void; close(): Promise<void> }>()
  #closed = false
  #closePromise: Promise<void> | undefined
  constructor(readonly store: WorkbenchStore) {}

  channel<J extends AcceptanceIdentity>(name: keyof typeof roots, adapter: AcceptanceAdapter<J>): AcceptanceChannel<J> {
    if (this.#closed) throw new AcceptanceError('acceptance-closed')
    if (this.#channels.has(name)) throw new AcceptanceError('acceptance-channel-owned')
    const channel = new AcceptanceChannel(this.store, roots[name], adapter)
    this.#channels.set(name, channel)
    return channel
  }
  stopAccepting(): void { this.#closed = true; for (const channel of this.#channels.values()) channel.stopAccepting() }
  close(): Promise<void> {
    this.stopAccepting()
    return this.#closePromise ??= (async () => {
      const results = await Promise.allSettled([...this.#channels.values()].map(channel => channel.close()))
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (errors.length) throw new AggregateError(errors, 'Acceptance cleanup failed')
    })()
  }
}

/** One fixed namespace. Adapters retain their own authorization and journal schema. */
export class AcceptanceChannel<J extends AcceptanceIdentity> {
  readonly records = new Map<string, J>()
  readonly requests = new Map<string, string>()
  readonly #root: string
  #ready: Promise<void> | undefined
  #tail: Promise<void> = Promise.resolve()
  #closed = false
  #uncertain = new Set<string>()
  #closePromise: Promise<void> | undefined
  constructor(readonly store: WorkbenchStore, directory: string, private readonly adapter: AcceptanceAdapter<J>) {
    if (!Object.values(roots).includes(directory as typeof roots[keyof typeof roots])) throw new AcceptanceError('acceptance-directory')
    this.#root = join(store.root, directory)
  }
  stopAccepting(): void { this.#closed = true }
  get accepting(): boolean { return !this.#closed }
  async serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new AcceptanceError('acceptance-closed')
    const previous = this.#tail
    let release!: () => void
    this.#tail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      if (this.#closed) throw new AcceptanceError('acceptance-closed')
      return await operation()
    } finally { release() }
  }
  assertAccepting(): void { if (this.#closed) throw new AcceptanceError('acceptance-closed') }
  lookup(requestKey: string, requestHash: string): J | undefined {
    if (this.#uncertain.has(requestKey)) throw new AcceptanceError('acceptance-outcome-unknown')
    const id = this.requests.get(requestKey), previous = id ? this.records.get(id) : undefined
    if (previous && previous.requestHash !== requestHash) throw new AcceptanceError('acceptance-request-conflict')
    return previous
  }
  remember(journal: J): void {
    const id = this.requests.get(journal.requestKey)
    if (id && id !== journal.executionId) throw new AcceptanceError('acceptance-duplicate-identity')
    this.records.set(journal.executionId, journal); this.requests.set(journal.requestKey, journal.executionId)
  }
  init(): Promise<void> { return this.#ready ??= this.#initialize() }
  async #initialize(): Promise<void> {
    await this.store.init(); await this.#directory()
    const entries = await readdir(this.#root, { withFileTypes: true })
    const files = entries.filter(entry => entry.name.endsWith('.json'))
    if (files.length > (this.adapter.maxEntries ?? 10_000)) throw new AcceptanceError('acceptance-entry-budget')
    for (const entry of entries) {
      if (entry.isFile() && /^[0-9a-f-]{73}\.tmp$/.test(entry.name)) continue
      if (!entry.isFile() || !entry.name.endsWith('.json') || !uuid.test(entry.name.slice(0, -5))) throw new AcceptanceError('acceptance-unsafe-entry')
      const handle = await open(join(this.#root, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW)
      let value: unknown
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > (this.adapter.maxBytes ?? 256 * 1024)) throw new AcceptanceError('acceptance-journal-budget')
        value = JSON.parse(await handle.readFile('utf8'))
      } finally { await handle.close() }
      const journal = this.adapter.parse(value)
      this.#identity(journal)
      if (journal.executionId !== entry.name.slice(0, -5)) throw new AcceptanceError('acceptance-identity-mismatch')
      this.remember(journal)
    }
    // Validate every identity before publishing any recovery. Never dispatch here.
    for (const journal of this.records.values()) if (journal.phase !== 'finished') await this.adapter.recover(journal)
  }

  /** Capacity reservation is outside the store gate; commit and references share that gate. */
  async persist(journal: J, commit: (write: (value: J) => Promise<void>) => Promise<void> = write => write(journal)): Promise<void> {
    this.#identity(journal)
    const bytes = this.adapter.maxBytes ?? 256 * 1024
    if (Buffer.byteLength(JSON.stringify(journal, null, 2)) > bytes) throw new AcceptanceError('acceptance-journal-budget')
    const isNew = !this.records.has(journal.executionId)
    if (isNew && this.records.size >= (this.adapter.maxEntries ?? 10_000)) throw new AcceptanceError('acceptance-entry-budget')
    const release = await this.store.reserveEvidence(`acceptance:${randomUUID()}`, bytes)
    try {
      await this.store.withMutationGate(async () => {
        await this.#directory()
        await commit(value => this.#write(value))
      })
    } catch (error) {
      // A failed fsync/rename response is not proof that nothing was published.
      // Keep new requests fenced for this runtime; restart inspects durable facts.
      if (isNew) this.#uncertain.add(journal.requestKey)
      throw error
    } finally { release() }
  }
  async #directory(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 })
    const stat = await lstat(this.#root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AcceptanceError('acceptance-unsafe-directory')
    const parent = await open(this.store.root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await parent.sync() } finally { await parent.close() }
  }
  #identity(journal: J): void {
    if (!uuid.test(journal.executionId) || !digest.test(journal.requestKey) || !digest.test(journal.requestHash)
      || !['accepted', 'running', 'cancelling', 'finished'].includes(journal.phase)) throw new AcceptanceError('acceptance-invalid-identity')
  }
  async #write(journal: J): Promise<void> {
    this.#identity(journal)
    const text = JSON.stringify(journal, null, 2)
    if (Buffer.byteLength(text) > (this.adapter.maxBytes ?? 256 * 1024)) throw new AcceptanceError('acceptance-journal-budget')
    const destination = join(this.#root, `${journal.executionId}.json`)
    try { const stat = await lstat(destination); if (!stat.isFile() || stat.isSymbolicLink()) throw new AcceptanceError('acceptance-unsafe-journal') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = join(this.#root, `${journal.executionId}-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(text); await handle.sync() } finally { await handle.close() }
    this.adapter.writeHook?.('temporary-synced', journal)
    await rename(temporary, destination)
    this.adapter.writeHook?.('renamed', journal)
    const directory = await open(this.#root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await directory.sync() } finally { await directory.close() }
    this.adapter.writeHook?.('directory-synced', journal)
  }
  close(): Promise<void> {
    this.stopAccepting()
    return this.#closePromise ??= (async () => {
      await this.#tail
      await this.#ready?.catch(() => undefined)
      await this.adapter.drain()
    })()
  }
}
