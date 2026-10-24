import { parentPort, workerData } from 'node:worker_threads'
try {
  const module = workerData.moduleUrl.endsWith('.ts') ? await (await import('tsx/esm/api')).tsImport(workerData.moduleUrl, import.meta.url) : await import(workerData.moduleUrl)
  const result = workerData.attachment ? await module.validateExternalAttachment(Buffer.from(workerData.bytes), workerData.adapter) : await module.parseExternalReport(workerData.bytes, workerData.adapter)
  parentPort.postMessage({ ok: true, result })
} catch (error) { parentPort.postMessage({ ok: false, code: /^external-[a-z-]+$/.test(error?.message) ? error.message : 'external-invalid-report' }) }
