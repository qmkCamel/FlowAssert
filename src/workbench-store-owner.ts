import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, rmdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { processIdentity } from './device-owner-claim.js'

export interface StoreOwner {
  schemaVersion: 1
  pid: number
  processIdentity: string
  nonce: string
  generation: string
  acquiredAt: string
}

/** The short claim mutex serializes stale-owner replacement across processes. */
async function withClaimMutex<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const path = join(root, '.lock-claim')
  const claimPath = join(path, 'claim.json')
  const nonce = randomUUID()
  const deadline = Date.now() + 2_000
  while (true) {
    try { await mkdir(path, { mode: 0o700 }); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = await lstat(path).catch(() => null)
      if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe workbench owner claim')
      let claimant: { pid: number; nonce: string } | null = null
      try {
        const handle = await open(claimPath, constants.O_RDONLY | constants.O_NOFOLLOW)
        try { claimant = JSON.parse(await handle.readFile('utf8')) as { pid: number; nonce: string } }
        finally { await handle.close() }
      } catch (readError) { if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError }
      // Never race another process to remove a stale claim. If the holder died
      // inside this short critical section, require exact operator recovery.
      if (claimant && Number.isSafeInteger(claimant.pid) && claimant.pid > 0 && typeof claimant.nonce === 'string' && !alive(claimant.pid))
        throw new Error('Dead workbench owner claim requires manual recovery')
      if (claimant && (!Number.isSafeInteger(claimant.pid) || claimant.pid <= 0 || typeof claimant.nonce !== 'string'))
        throw new Error('Invalid workbench owner claim')
      if (Date.now() >= deadline) throw new Error('Workbench owner claim is busy')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    await writeFile(claimPath, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 })
    return await operation()
  } finally {
    let ownClaim = false
    try {
      const handle = await open(claimPath, constants.O_RDONLY | constants.O_NOFOLLOW)
      try { ownClaim = (JSON.parse(await handle.readFile('utf8')) as { nonce?: string }).nonce === nonce }
      finally { await handle.close() }
    } catch { /* a changed claim must not be removed */ }
    if (ownClaim) { await rm(claimPath); await rmdir(path) }
  }
}

async function readOwner(root: string): Promise<StoreOwner | number | null> {
  let handle
  try { handle = await open(join(root, '.lock'), constants.O_RDONLY | constants.O_NOFOLLOW) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  try {
    if ((await handle.stat()).size > 4_096) throw new Error('Invalid workbench store lock')
    const value = (await handle.readFile('utf8')).trim()
    if (/^[1-9]\d*$/.test(value)) return Number(value)
    const owner = JSON.parse(value) as StoreOwner
    if (owner?.schemaVersion !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || typeof owner.processIdentity !== 'string' || !owner.processIdentity
      || typeof owner.nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(owner.nonce)
      || typeof owner.generation !== 'string' || !/^[0-9a-f-]{36}$/.test(owner.generation)
      || !Number.isFinite(Date.parse(owner.acquiredAt))) throw new Error('Invalid workbench store lock')
    return owner
  } finally { await handle.close() }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

export async function acquireStoreOwner(root: string): Promise<StoreOwner> {
  return withClaimMutex(root, async () => {
    const current = await readOwner(root)
    if (current !== null) {
      // A live PID with a changed start identity may have been reused. Keep the
      // directory protected until an operator can inspect the old claim.
      if (alive(typeof current === 'number' ? current : current.pid)) throw new Error('Another workbench owns this evidence directory')
      await rm(join(root, '.lock'))
    }
    const identity = await processIdentity(process.pid)
    if (!identity) throw new Error('Current workbench process identity is unavailable')
    const owner: StoreOwner = { schemaVersion: 1, pid: process.pid, processIdentity: identity,
      nonce: randomUUID(), generation: randomUUID(), acquiredAt: new Date().toISOString() }
    await writeFile(join(root, '.lock'), JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
    return owner
  })
}

export async function assertStoreOwner(root: string, owner: StoreOwner): Promise<void> {
  const current = await readOwner(root)
  if (!current || typeof current === 'number' || current.nonce !== owner.nonce || current.generation !== owner.generation
    || current.pid !== owner.pid || current.processIdentity !== owner.processIdentity)
    throw new Error('Workbench store owner changed')
}

export async function releaseStoreOwner(root: string, owner: StoreOwner): Promise<void> {
  await withClaimMutex(root, async () => {
    const current = await readOwner(root)
    if (current && typeof current !== 'number' && current.nonce === owner.nonce && current.generation === owner.generation)
      await rm(join(root, '.lock'))
  })
}
