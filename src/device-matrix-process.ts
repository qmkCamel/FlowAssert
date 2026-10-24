import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { processIdentity } from './device-owner-claim.js'
import { matrixMessageSchema, type MatrixMessage } from './device-matrix-contracts.js'

/** One privately spawned runtime. Nothing in HTTP input selects an executable or IPC channel. */
export class MatrixProcess {
  readonly child: ChildProcess
  #sequence = 0
  #pending = new Map<string, { message: MatrixMessage; resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>()
  #identity: string | null = null
  #exit: Promise<void>
  constructor(readonly matrixId: string, readonly slotId: string, readonly generation: string) {
    const source = import.meta.url.endsWith('.ts')
    this.child = fork(new URL(source ? './device-matrix-child.ts' : './device-matrix-child.js', import.meta.url), [], {
      execArgv: source ? ['--import', import.meta.resolve('tsx')] : [], serialization: 'json', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    this.#exit = new Promise(resolve => this.child.once('exit', () => { this.#rejectAll(); resolve() }))
    this.child.on('error', () => this.#rejectAll()); this.child.on('disconnect', () => this.#rejectAll())
    this.child.on('message', value => {
      if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) { this.#rejectAll(); return }
      const parsed = matrixMessageSchema.safeParse(value); if (!parsed.success) return
      const message = parsed.data, pending = this.#pending.get(message.requestId)
      if (!pending || message.matrixId !== this.matrixId || message.slotId !== this.slotId || message.generation !== this.generation
        || message.attemptId !== pending.message.attemptId || message.sequence !== pending.message.sequence || message.operation !== pending.message.operation) return
      this.#pending.delete(message.requestId); clearTimeout(pending.timer)
      const payload = message.payload as { ok?: boolean; value?: unknown } | null
      if (payload?.ok === true) pending.resolve(payload.value); else pending.reject(new Error('matrix-child-operation-failed'))
    })
  }
  async identity() {
    if (!this.child.pid) await once(this.child, 'spawn')
    this.#identity = await processIdentity(this.child.pid!)
    if (!this.#identity) throw new Error('matrix-process-identity-unavailable')
    return { pid: this.child.pid!, processIdentity: this.#identity }
  }
  request(operation: MatrixMessage['operation'], attemptId: string, payload: unknown, budgetMs = 30_000): Promise<any> {
    if (!this.child.connected) return Promise.reject(new Error('matrix-child-disconnected'))
    const message = matrixMessageSchema.parse({ version: 1, matrixId: this.matrixId, slotId: this.slotId, generation: this.generation, attemptId, operation, payload, requestId: randomUUID(), sequence: ++this.#sequence })
    if (Buffer.byteLength(JSON.stringify(message)) > 4 * 1024 * 1024) return Promise.reject(new Error('matrix-request-budget'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(message.requestId); reject(new Error('matrix-child-timeout')) }, budgetMs)
      this.#pending.set(message.requestId, { message, resolve, reject, timer })
      this.child.send(message, error => { if (error) { clearTimeout(timer); this.#pending.delete(message.requestId); reject(new Error('matrix-child-disconnected')) } })
    })
  }
  async close(attemptId: string): Promise<void> {
    let clean = false
    try { await this.request('close', attemptId, {}, 30_000); clean = true }
    catch { /* A failed cleanup remains quarantined, even if the process can be reaped. */ }
    if (this.child.connected) this.child.disconnect()
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([this.#exit, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('matrix-child-exit-timeout')), 10_000) })])
    } catch {
      if (this.child.exitCode === null && this.child.pid && this.#identity && await processIdentity(this.child.pid) === this.#identity) this.child.kill('SIGKILL')
      // Do not release runtime ownership while an owned child is still exiting.
      await Promise.race([this.#exit, new Promise<void>(resolve => { const timer = setTimeout(resolve, 5000); timer.unref() })])
      clean = false
    } finally { if (timeout) clearTimeout(timeout) }
    if (!clean) throw new Error('matrix-child-cleanup-unconfirmed')
  }
  #rejectAll() { for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('matrix-child-unavailable')) }; this.#pending.clear() }
}
