import { runOwnedWorker, type WorkerFactory } from './workbench-worker-lifecycle.js'
export { WorkerTerminationError as ComparisonTerminationError } from './workbench-worker-lifecycle.js'
export type ComparisonWorkerFactory = WorkerFactory

export function runComparisonWorker<T>(data: unknown, signal: AbortSignal, createWorker?: WorkerFactory, timeoutMs = 120_000): Promise<T> {
  return runOwnedWorker(new URL('../scripts/workbench-comparison-worker.mjs', import.meta.url), {
    workerData: data, resourceLimits: { maxOldGenerationSizeMb: 256 },
  }, raw => {
    const value = raw as { ok?: boolean; result?: T; error?: string }
    if (!value?.ok || value.result === undefined) throw new Error(value?.error ?? 'Comparison worker failed')
    return value.result
  }, signal, timeoutMs, 'Comparison', createWorker)
}
