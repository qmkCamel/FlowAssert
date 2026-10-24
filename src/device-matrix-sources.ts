import type { LocalDeviceMatrix } from './device-matrix.js'
import type { AcceptanceInput } from './workbench-change-contracts.js'
import type { AcceptanceSourceLease, AcceptanceSourceResolver } from './workbench-change-source.js'

/** Registered matrix cells resolve to ordinary per-dimension run facts, never to a green matrix flag. */
export class MatrixAcceptanceSources implements AcceptanceSourceResolver {
  constructor(readonly base: AcceptanceSourceResolver, readonly matrix: LocalDeviceMatrix) {}
  async acquire(input: AcceptanceInput, signal?: AbortSignal): Promise<AcceptanceSourceLease> {
    const lease = await this.base.acquire(input, signal)
    try {
      for (const cell of input.cells) {
        if (!cell.matrixCell) continue
        // A matrix source may never fall back to a same-named native run.
        for (const id of [cell.runId!, ...cell.historyRunIds]) lease.sources.delete(id)
        const ref = cell.matrixCell
        const state = await this.matrix.status(ref.matrixId), source = state.cells.find(c => c.id === ref.cellId)
        const current = source?.attempts.find(a => a.id === ref.attemptId)
        if (!current || current.runId !== cell.runId) continue
        for (const id of [cell.runId!, ...cell.historyRunIds]) {
          signal?.throwIfAborted()
          const attempt = source!.attempts.find(a => a.runId === id)
          if (!attempt) continue
          try {
            const read = () => this.matrix.readAttempt(ref.matrixId, attempt)
            const snapshot = await read()
            lease.sources.set(id, { ...snapshot, availability: 'verified', storage: 'matrix', recheck: async () => {
              const now = await read(); if (now.manifestSha256 !== snapshot.manifestSha256) throw new Error('acceptance-preview-stale')
            } })
          } catch { signal?.throwIfAborted() }
        }
      }
      return lease
    } catch (error) { lease.release(); throw error }
  }
}
