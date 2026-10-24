import { parentPort, workerData } from 'node:worker_threads'

try {
  const { analyzeTriage } = await import(workerData.moduleUrl)
  const analysis = await analyzeTriage(workerData.run, workerData.comparison, workerData.locatorEvidence, workerData.manifestSha256, workerData.config)
  parentPort.postMessage({ ok: true, analysis })
} catch {
  // Do not return archive text, stack traces or local paths across the worker boundary.
  parentPort.postMessage({ ok: false, code: 'analysis-failed' })
}
