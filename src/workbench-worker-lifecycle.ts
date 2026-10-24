import { Worker, type WorkerOptions } from 'node:worker_threads'

export type WorkerFactory = (url: URL, options: WorkerOptions) => Worker
export class WorkerTerminationError extends AggregateError {}
export class WorkerExitError extends Error {}
export class WorkerTimeoutError extends Error {}

/** Install immediately after construction. A rejected terminate is not proof of exit. */
export function ownWorkerExit(worker: Worker) {
  let exited = false, resolveExit!: () => void, closing: Promise<void> | undefined
  const exit = new Promise<void>(resolve => { resolveExit = resolve })
  const onExit = () => { exited = true; resolveExit() }
  const onError = () => {}
  worker.once('exit', onExit); worker.on('error', onError)
  return { close: (): Promise<void> => closing ??= (async () => {
    try {
      if (!exited) {
        let failure: unknown
        try { await worker.terminate() } catch (error) { failure = error }
        await exit
        if (failure !== undefined) throw new WorkerTerminationError([failure], 'Worker termination failed')
      }
    } finally { worker.off('exit', onExit); worker.off('error', onError) }
  })() }
}

/** Bounded single-result computation; native streaming keeps its own protocol. */
export async function runOwnedWorker<T>(url: URL, options: WorkerOptions, decode: (message: unknown) => T,
  signal: AbortSignal | undefined, timeoutMs: number, label: string,
  factory: WorkerFactory = (url, options) => new Worker(url, options)): Promise<T> {
  signal?.throwIfAborted()
  const worker = factory(url, options), owner = ownWorkerExit(worker)
  let timer: ReturnType<typeof setTimeout> | undefined
  let onMessage!: (value: unknown) => void, onError!: (error: Error) => void, onExit!: (code: number) => void, abort!: () => void
  const outcome = await new Promise<{ value: T } | { error: unknown }>(resolve => {
    let settled = false
    const finish = (value: { value: T } | { error: unknown }) => { if (!settled) { settled = true; resolve(value) } }
    onMessage = value => { if (settled) return; try { finish({ value: decode(value) }) } catch (error) { finish({ error }) } }
    onError = error => finish({ error })
    onExit = code => finish({ error: new WorkerExitError(`${label} worker exited before a result (${code})`) })
    abort = () => finish({ error: signal?.reason ?? new Error(`${label} cancelled`) })
    worker.on('message', onMessage); worker.on('error', onError); worker.once('exit', onExit)
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish({ error: new WorkerTimeoutError(`${label} exceeded execution time limit`) }), timeoutMs)
    if (signal?.aborted) abort()
  })
  clearTimeout(timer); signal?.removeEventListener('abort', abort)
  try { await owner.close() }
  catch (error) {
    if ('error' in outcome) throw new WorkerTerminationError([outcome.error, error], `${label} Worker termination failed`)
    throw error
  } finally { worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit) }
  signal?.throwIfAborted()
  if ('error' in outcome) throw outcome.error
  return outcome.value
}
