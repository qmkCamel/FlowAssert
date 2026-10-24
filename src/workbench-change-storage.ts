import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { acceptanceHash } from './workbench-change-contracts.js'

export const ACCEPTANCE_RECORD_BYTES = 4 * 1024 * 1024
export async function acceptanceDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('acceptance-unsafe-directory')
}
export async function acceptanceEntries(path: string, max = 1000): Promise<string[]> {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('acceptance-unsafe-directory')
  const entries = await readdir(path, { withFileTypes: true })
  if (entries.length > max) throw new Error('acceptance-index-budget')
  for (const entry of entries) if (entry.isSymbolicLink()) throw new Error('acceptance-unsafe-entry')
  return entries.map(entry => entry.name)
}
export async function readAcceptance<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.output<S>> {
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('acceptance-unsafe-directory')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > ACCEPTANCE_RECORD_BYTES) throw new Error('acceptance-record-budget')
    const envelope = JSON.parse(await file.readFile('utf8')) as { digest: string; value: unknown }
    if (!envelope || typeof envelope.digest !== 'string' || envelope.value === undefined || envelope.digest !== acceptanceHash(envelope.value)) throw new Error('acceptance-record-integrity')
    return schema.parse(envelope.value)
  } finally { await file.close() }
}
export async function writeAcceptance(path: string, value: unknown, replace = false): Promise<void> {
  const bytes = JSON.stringify({ digest: acceptanceHash(value), value })
  if (Buffer.byteLength(bytes) > ACCEPTANCE_RECORD_BYTES) throw new Error('acceptance-record-budget')
  await acceptanceDirectory(dirname(path))
  const temporary = join(dirname(path), `.acceptance-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { if (replace) await rename(temporary, path); else await link(temporary, path) }
  finally { await rm(temporary, { force: true }) }
  const dir = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await dir.sync() } finally { await dir.close() }
}
export function acceptanceMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
