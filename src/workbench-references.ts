import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { evidenceReferenceReadSchema, type ReadableEvidenceReference } from './workbench-evidence-contracts.js'
import { sha256, type WorkbenchStore } from './workbench-store.js'

/** Durable consumer facts. A damaged or unknown entry blocks retention. */
export class WorkbenchReferences {
  readonly root: string
  constructor(private readonly store: WorkbenchStore) { this.root = join(store.root, 'references') }

  async publish(value: ReadableEvidenceReference): Promise<ReadableEvidenceReference> {
    const reference = evidenceReferenceReadSchema.parse(value)
    return this.store.withMutationGate(() => this.publishUnderMutationGate(reference))
  }

  /** Caller must already hold the store mutation gate. */
  async publishUnderMutationGate(value: ReadableEvidenceReference): Promise<ReadableEvidenceReference> {
    const reference = evidenceReferenceReadSchema.parse(value)
    const snapshot = await this.store.readOnlySnapshot(reference.targetRunId)
    if (snapshot.manifestSha256 !== reference.sourceHash) throw new Error('Reference source changed before publication')
    const known = new Map([...snapshot.run.evidence, ...snapshot.run.steps.flatMap(step => step.evidence)].map(file => [file.name, file]))
    for (const name of reference.evidenceRefs) {
      const file = known.get(name)
      if (!file || file.incomplete || file.recovered || file.lineage?.integrity === 'unverified' || file.lineage?.integrity === 'failed') throw new Error('Reference evidence is unavailable or unverified')
      await this.store.readEvidence(reference.targetRunId, file)
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const directory = await lstat(this.root)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe evidence reference directory')
    const parent = await open(this.store.root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await parent.sync() } finally { await parent.close() }
    const path = join(this.root, `${reference.refId}.json`)
    const bytes = Buffer.from(JSON.stringify(reference))
    try {
      const existing = await readReference(path)
      if (sha256(JSON.stringify(existing)) !== sha256(bytes)) throw new Error('Reference identity already has different content')
      return existing
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = join(this.root, `.reference-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try { await link(temporary, path) } finally { await rm(temporary, { force: true }) }
    const dir = await open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await dir.sync() } finally { await dir.close() }
    return reference
  }

  async list(): Promise<ReadableEvidenceReference[]> {
    let entries
    try {
      const root = await lstat(this.root)
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Unsafe evidence reference directory')
      entries = await readdir(this.root, { withFileTypes: true })
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    if (entries.length > 10_000) throw new Error('Evidence reference index exceeds budget')
    const result: ReadableEvidenceReference[] = []
    let bytes = 0
    for (const entry of entries) {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) throw new Error('Unsafe evidence reference index')
      bytes += (await lstat(join(this.root, entry.name))).size
      if (bytes > 64 * 1024 * 1024) throw new Error('Evidence reference index exceeds budget')
      const record = await readReference(join(this.root, entry.name))
      if (`${record.refId}.json` !== entry.name) throw new Error('Evidence reference identity mismatch')
      result.push(record)
    }
    return result
  }

  /** Revokes only the named consumer; a durable caller tombstone must be written first. */
  async revoke(refId: string, consumerKind: ReadableEvidenceReference['consumerKind'], consumerId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(refId)) throw new Error('Invalid reference id')
    await this.store.withMutationGate(() => this.revokeUnderMutationGate(refId, consumerKind, consumerId))
  }

  /** Caller must already hold the store mutation gate. */
  async revokeUnderMutationGate(refId: string, consumerKind: ReadableEvidenceReference['consumerKind'], consumerId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(refId)) throw new Error('Invalid reference id')
    const path = join(this.root, `${refId}.json`)
    let current: ReadableEvidenceReference
    try { current = await readReference(path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (current.consumerKind !== consumerKind || current.consumerId !== consumerId) throw new Error('Reference ownership mismatch')
    await rm(path)
    const dir = await open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await dir.sync() } finally { await dir.close() }
  }
}

async function readReference(path: string): Promise<ReadableEvidenceReference> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if ((await handle.stat()).size > 64 * 1024) throw new Error('Evidence reference exceeds budget')
    return evidenceReferenceReadSchema.parse(JSON.parse(await handle.readFile('utf8')))
  } finally { await handle.close() }
}
