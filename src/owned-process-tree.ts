import { basename } from 'node:path'
import { NodeHostCommandRunner, type HostCommandRunner } from './host-command-runner.js'

export const PROCESS_OWNER_ENV = 'MOBILE_MIRROR_PROCESS_OWNER'
export interface ProcessIdentity { pid: number; parent: number; started: string; command: string; zombie: boolean }
export interface ProcessInventory {
  list(): Promise<ProcessIdentity[]>
  hasOwner(pid: number, owner: string): Promise<boolean>
  signal(pid: number, signal: NodeJS.Signals): void
}

/** No command arguments or environment contents escape this local ownership port. */
export class NodeProcessInventory implements ProcessInventory {
  constructor(private readonly runner: HostCommandRunner = new NodeHostCommandRunner()) {}
  async list(): Promise<ProcessIdentity[]> {
    const result = await this.runner.run('/bin/ps', ['-axo', 'pid=,ppid=,stat=,lstart=,comm='], { timeoutMs: 2_000 })
    if (!result.ok) throw new Error('Owned process inventory unavailable')
    return result.stdout.split('\n').flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/)
      if (!match && line.trim()) throw new Error('Owned process inventory invalid')
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), zombie: match[3]!.startsWith('Z'), started: match[4]!, command: match[5]! }] : []
    })
  }
  async hasOwner(pid: number, owner: string): Promise<boolean> {
    const result = await this.runner.run('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], { timeoutMs: 2_000 })
    // A process can exit between inventory and environment reads.
    if (!result.ok) {
      if ((await this.list()).some((row) => row.pid === pid && !row.zombie)) throw new Error('Owned process identity unavailable')
      return false
    }
    return result.stdout.split(/\s+/).includes(`${PROCESS_OWNER_ENV}=${owner}`)
  }
  signal(pid: number, signal: NodeJS.Signals): void {
    try { process.kill(pid, signal) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('Owned process signal failed') }
  }
}

const same = (a: ProcessIdentity, b: ProcessIdentity) => a.pid === b.pid && a.started === b.started && a.command === b.command
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Only instantiated for an explicitly spawned managed Appium, never external servers. */
export class OwnedProcessTree {
  readonly #known = new Map<number, ProcessIdentity>()
  readonly #ancestry = new Map<number, ProcessIdentity>()
  readonly #rejected = new Set<string>()
  #sampling: Promise<void> | null = null
  #timer: ReturnType<typeof setInterval> | null = null
  #root: ProcessIdentity | null = null
  #retired = false
  constructor(readonly rootPid: number, private readonly owner: string, private readonly inventory: ProcessInventory = new NodeProcessInventory()) {}

  start(): void {
    if (this.#timer) return
    void this.sample().catch(() => undefined)
    this.#timer = setInterval(() => { void this.sample().catch(() => undefined) }, 250)
    this.#timer.unref()
  }
  async sample(): Promise<void> {
    if (this.#retired) return
    return this.#sampling ??= this.#sample().finally(() => { this.#sampling = null })
  }
  async #sample(): Promise<void> {
    const rows = await this.inventory.list()
    const root = rows.find((row) => row.pid === this.rootPid && !row.zombie)
    if (!this.#root && root && await this.inventory.hasOwner(root.pid, this.owner)) this.#root = root
    const parents = new Set(rows.filter((row) => {
      const known = this.#known.get(row.pid)
      return !row.zombie && ((known && same(known, row)) || (this.#root && same(this.#root, row)))
    }).map((row) => row.pid))
    let added = true
    while (added) {
      added = false
      for (const row of rows) {
        if (row.zombie || parents.has(row.pid) || !parents.has(row.parent)) continue
        this.#known.set(row.pid, row); this.#ancestry.set(row.pid, row); parents.add(row.pid); added = true
      }
    }
    // XCUITest intentionally detaches xcodebuild. An inherited nonce also covers
    // reparenting before the first sample, without taking ownership by name alone.
    for (const row of rows) {
      if (row.zombie || this.#known.has(row.pid) || basename(row.command) !== 'xcodebuild') continue
      const key = `${row.pid}:${row.started}:${row.command}`
      if (this.#rejected.has(key)) continue
      if (await this.inventory.hasOwner(row.pid, this.owner)) this.#known.set(row.pid, row)
      else this.#rejected.add(key)
    }
  }

  async cleanup(graceMs: number): Promise<void> {
    if (this.#retired) return
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null }
    await this.sample()
    // Even a saved PID is never authority after reuse. Re-read before each signal.
    for (const signal of ['SIGINT', 'SIGKILL'] as const) {
      const current = await this.inventory.list()
      for (const known of this.#known.values()) {
        if (!current.some((row) => !row.zombie && same(row, known))) continue
        // macOS can hide the environment of Apple platform binaries from ps.
        // An observed descendant of our nonce-confirmed root remains owned after
        // reparenting; a nonce-only orphan must still confirm its nonce.
        const ancestor = this.#ancestry.get(known.pid)
        if (basename(known.command) === 'xcodebuild' && !(ancestor && same(ancestor, known)) && !await this.inventory.hasOwner(known.pid, this.owner)) {
          // An unchanged-looking PID is insufficient if WDA no longer carries our nonce.
          if ((await this.inventory.list()).some((row) => !row.zombie && same(row, known))) throw new Error('Owned WDA identity could not be confirmed')
          continue
        }
        this.inventory.signal(known.pid, signal)
      }
      const until = performance.now() + graceMs
      do {
        const remaining = await this.inventory.list()
        if (![...this.#known.values()].some((known) => remaining.some((row) => !row.zombie && same(row, known)))) {
          this.#retired = true; this.#known.clear(); this.#ancestry.clear(); return
        }
        await delay(50)
      } while (performance.now() < until)
    }
    throw new Error('Owned Appium descendants did not stop')
  }
}
