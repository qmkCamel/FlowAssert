import type { ReferencePublications } from './workbench-evidence-contracts.js'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { validRunId } from './workbench-store.js'

export type TrashState = 'moving' | 'move-interrupted' | 'trashed' | 'restore-intent' | 'restored' | 'purge-intent' | 'purge-interrupted' | 'purged' | 'recovery-required'
export interface PurgeFile { relative: string; sha256: string; bytes: number }
export interface TrashJournal { referencePublications?: ReferencePublications; id: string; createdAt: string; state: TrashState; manifestSha256: string; bytes: number; expiresAt: string; parentRunId?: string; purgeRemaining?: PurgeFile[]; purgeAuthorizedAt?: string; purgeInventorySha256?: string }

export function safePurgeRelative(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..' && !part.includes('\\') && !part.includes('\0'))
}

/** Atomic, bounded local lifecycle journal. It never performs the destructive action itself. */
export class WorkbenchCleanupJournal {
  constructor(readonly root: string) {}
  async read(id: string): Promise<TrashJournal> {
    validRunId(id)
    const handle = await open(join(this.root, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (info.size > 4 * 1024 * 1024) throw new Error('Trash journal exceeds budget')
      const value = JSON.parse(await handle.readFile('utf8')) as TrashJournal
      if (value.id !== id || !['moving', 'move-interrupted', 'trashed', 'restore-intent', 'restored', 'purge-intent', 'purge-interrupted', 'purged', 'recovery-required'].includes(value.state)
        || (value.parentRunId && !/^[0-9a-f-]{36}$/.test(value.parentRunId))
        || (value.purgeRemaining && (!Array.isArray(value.purgeRemaining) || value.purgeRemaining.length > 10_000 || !value.purgeRemaining.every(item => safePurgeRelative(item.relative) && /^[a-f0-9]{64}$/.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes >= 0)))
        || (value.purgeInventorySha256 && !/^[a-f0-9]{64}$/.test(value.purgeInventorySha256))
        || (value.purgeAuthorizedAt && !Number.isFinite(Date.parse(value.purgeAuthorizedAt)))) throw new Error('Invalid trash journal')
      return value
    } finally { await handle.close() }
  }
  async write(journal: TrashJournal): Promise<void> {
    validRunId(journal.id)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const directory = await lstat(this.root)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe retention journal directory')
    const temporary = join(this.root, `.journal-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(journal)); await handle.sync() } finally { await handle.close() }
    await rename(temporary, join(this.root, `${journal.id}.json`))
    const dir = await open(this.root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await dir.sync() } finally { await dir.close() }
  }
}
