import { Worker } from 'node:worker_threads'
import { externalParsedSchema, externalKey, externalLabel, type ExternalParsed } from './workbench-external-contracts.js'
export function validateExternalAttachmentWorker(bytes: Uint8Array, type: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('external-cancelled'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../scripts/workbench-external-worker.mjs', import.meta.url), { workerData: { bytes, adapter: type, attachment: true, moduleUrl: new URL(import.meta.url.endsWith('.ts') ? './workbench-external-files.ts' : './external-files.js', import.meta.url).href }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128 } })
    let done = false
    const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); void worker.terminate().then(() => error ? reject(error) : resolve(), () => reject(new Error('external-worker-interrupted'))) }
    const abort = () => finish(new Error('external-cancelled')), timer = setTimeout(() => finish(new Error('external-parser-timeout')), 10_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.once('message', result => finish(result?.ok ? undefined : new Error(/^external-[a-z-]+$/.test(result?.code) ? result.code : 'external-attachment-invalid')))
    worker.once('error', () => finish(new Error('external-attachment-invalid'))); worker.once('exit', () => { if (!done) finish(new Error('external-worker-interrupted')) })
    if (signal.aborted) abort()
  })
}
export interface ExternalResultAdapter {
  readonly id: string; readonly version: string
  parse(bytes: Uint8Array, context: Readonly<{ engine: string; engineVersion: string }>, signal: AbortSignal): Promise<ExternalParsed>
}
export function builtinExternalAdapter(id: 'junit' | 'external-results-v1', options: { timeoutMs?: number; moduleUrl?: URL } = {}): ExternalResultAdapter {
  const moduleUrl = options.moduleUrl ?? new URL(import.meta.url.endsWith('.ts') ? './workbench-external-parser.ts' : './external-parser.js', import.meta.url)
  if (moduleUrl.protocol !== 'file:') throw new Error('external-invalid-adapter')
  return Object.freeze({ id, version: '1', async parse(bytes: Uint8Array, _context: unknown, signal: AbortSignal): Promise<ExternalParsed> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../scripts/workbench-external-worker.mjs', import.meta.url), { workerData: { bytes, adapter: id, moduleUrl: moduleUrl.href }, resourceLimits: { maxOldGenerationSizeMb: 128 }, execArgv: [] })
      let settled = false
      const finish = (error?: Error, result?: unknown) => {
        if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort)
        void worker.terminate().then(() => { if (error) reject(error); else { try { resolve(externalParsedSchema.parse(result)) } catch { reject(new Error('external-invalid-result')) } } }, () => reject(new Error('external-worker-interrupted')))
      }
      const abort = () => finish(new Error('external-cancelled'))
      const timer = setTimeout(() => finish(new Error('external-parser-timeout')), Math.max(1, Math.min(10_000, options.timeoutMs ?? 10_000)))
      signal.addEventListener('abort', abort, { once: true })
      worker.once('message', reply => reply?.ok === true ? finish(undefined, reply.result) : finish(new Error(/^external-[a-z-]+$/.test(reply?.code) ? reply.code : 'external-invalid-report')))
      worker.once('error', () => finish(new Error('external-worker-failed')))
      worker.once('exit', () => { if (!settled) finish(new Error('external-worker-interrupted')) })
      if (signal.aborted) abort()
    })
  } })
}
/** Trusted startup registry only. Adapters receive bytes, never runtime/store capabilities. */
export function externalAdapters(extra: readonly ExternalResultAdapter[] = []) {
  const registry = new Map<string, ExternalResultAdapter>()
  for (const adapter of [builtinExternalAdapter('junit'), builtinExternalAdapter('external-results-v1'), ...extra]) {
    externalKey.parse(adapter.id); externalLabel.parse(adapter.version)
    if (registry.has(adapter.id)) throw new Error('external-duplicate-adapter')
    registry.set(adapter.id, adapter)
  }
  return registry
}
