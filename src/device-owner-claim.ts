import { randomBytes, createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_ROOT = join(homedir(), '.local', 'share', 'mobile-mirror', 'device-claims')

interface ClaimRecord {
  schemaVersion: 1
  key: string
  platform: 'android' | 'ios'
  deviceIdHash: string
  pid: number
  processIdentity: string
  nonce: string
  generation: string
  state: 'starting' | 'active'
  acquiredAt: string
}

export class DeviceOwnerClaimError extends Error {
  readonly code = 'mobile_mirror_owner_conflict'
  constructor(message: string) { super(message); this.name = 'DeviceOwnerClaimError' }
}

export interface DeviceOwnerLease {
  readonly key: string
  readonly nonce: string
  markActive(): Promise<void>
  release(): Promise<boolean>
}

export class DeviceOwnerClaim {
  readonly #root: string
  readonly #pid: number
  readonly #identity: (pid: number) => Promise<string | null>
  constructor(options: { root?: string; pid?: number; identity?: (pid: number) => Promise<string | null> } = {}) {
    this.#root = options.root ?? DEFAULT_ROOT
    this.#pid = options.pid ?? process.pid
    this.#identity = options.identity ?? processIdentity
  }

  async acquire(platform: 'android' | 'ios', deviceId: string): Promise<DeviceOwnerLease> {
    const normalized = deviceId.normalize('NFKC').trim().toLowerCase()
    if (!normalized || normalized.length > 512) throw new DeviceOwnerClaimError('Explicit device identity is invalid')
    const key = createHash('sha256').update(`${platform}\0${normalized}`).digest('hex')
    await mkdir(this.#root, { recursive: true, mode: 0o700 })
    return this.#withLock(key, async () => {
      const path = join(this.#root, `${key}.json`)
      const existing = await readClaim(path)
      if (existing) {
        const identity = await this.#identity(existing.pid)
        if (identity === existing.processIdentity) throw new DeviceOwnerClaimError('Device is owned by another mobile-mirror runtime')
        if (identity !== null || existing.state !== 'starting') {
          throw new DeviceOwnerClaimError('Stale device owner cannot be safely reclaimed; end the original session and remove the diagnosed claim')
        }
        await rm(path)
      }
      const processIdentity = await this.#identity(this.#pid)
      if (!processIdentity) throw new DeviceOwnerClaimError('Current process identity cannot be verified')
      const nonce = randomBytes(24).toString('base64url')
      const record: ClaimRecord = {
        schemaVersion: 1, key, platform, deviceIdHash: createHash('sha256').update(normalized).digest('hex'),
        pid: this.#pid, processIdentity, nonce, generation: randomBytes(16).toString('base64url'), state: 'starting', acquiredAt: new Date().toISOString(),
      }
      await committedJson(path, record)
      return { key, nonce, markActive: () => this.#update(key, nonce, 'active'), release: () => this.#release(key, nonce) }
    })
  }

  async #update(key: string, nonce: string, state: ClaimRecord['state']): Promise<void> {
    await this.#withLock(key, async () => {
      const path = join(this.#root, `${key}.json`), record = await readClaim(path)
      if (!record || record.nonce !== nonce) throw new DeviceOwnerClaimError('Device owner changed before claim update')
      record.state = state; await replaceJson(path, record)
    })
  }

  async #release(key: string, nonce: string): Promise<boolean> {
    return this.#withLock(key, async () => {
      const path = join(this.#root, `${key}.json`), record = await readClaim(path)
      if (!record || record.nonce !== nonce) return false
      await rm(path); return true
    })
  }

  async #withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lock = join(this.#root, `${key}.lock`), deadline = Date.now() + 2_000
    while (true) {
      try { await mkdir(lock, { mode: 0o700 }); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const info = await stat(lock).catch(() => null)
        if (info && Date.now() - info.mtimeMs > 10_000) await rm(lock, { recursive: true, force: true }).catch(() => undefined)
        if (Date.now() >= deadline) throw new DeviceOwnerClaimError('Device owner claim is busy')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    try { return await operation() } finally { await rm(lock, { recursive: true, force: true }) }
  }
}

async function readClaim(path: string): Promise<ClaimRecord | null> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  const value = JSON.parse(text) as ClaimRecord
  if (value.schemaVersion !== 1 || typeof value.nonce !== 'string' || typeof value.processIdentity !== 'string' || !['starting', 'active'].includes(value.state)) throw new DeviceOwnerClaimError('Device owner claim is invalid')
  return value
}

async function committedJson(path: string, value: ClaimRecord): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
}
async function replaceJson(path: string, value: ClaimRecord): Promise<void> {
  const temporary = `${path}-${randomBytes(8).toString('hex')}.tmp`
  await committedJson(temporary, value); await rename(temporary, path)
}

export async function processIdentity(pid: number): Promise<string | null> {
  try {
    const statText = await readFile(`/proc/${pid}/stat`, 'utf8')
    const fields = statText.slice(statText.lastIndexOf(')') + 2).split(' ')
    return `proc:${fields[19]}`
  } catch { /* macOS and other hosts */ }
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 1_000 })
    const value = stdout.trim(); return value ? `ps:${value}` : null
  } catch { return null }
}
