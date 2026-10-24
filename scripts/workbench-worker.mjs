// A pinned native executor in an isolated worker. No AppClaw session bootstrap.
import { parentPort, workerData } from 'node:worker_threads'
if (!parentPort) throw new Error('Workbench worker requires a parent')
// Strict flows need no network. Fail closed if an upstream change invokes a model.
globalThis.fetch = async () => { throw new Error('Network/model calls are disabled for deterministic flows') }
if (workerData.mode === 'parse') {
  try {
    const { parseFlowYamlString } = await import('@appclaw/core/flow/parse-yaml-flow')
    parentPort.postMessage({ parsed: await parseFlowYamlString(workerData.yaml, { strict: true }) })
  } catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
  parentPort.close()
} else {
const { runYamlFlow } = await import('@appclaw/core/flow/run-yaml-flow')
const { setDevicePlatform, setDeviceScreenSize } = await import('@appclaw/core/vision/window-size')
const { silenceTerminalUI } = await import('@appclaw/core/ui/terminal')
silenceTerminalUI(true)
let nextId = 0
let sequence = 0
const emit = (event) => parentPort.postMessage({ ...event, protocolVersion: 1, sequence: ++sequence })
const pending = new Map()
parentPort.on('message', ({ protocolVersion, id, result, error }) => {
  if (protocolVersion !== 1 || !Number.isSafeInteger(id) || !pending.has(id)) throw new Error('Invalid executor RPC reply')
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  error ? p.reject(new Error(error)) : p.resolve(result)
})
const mcp = {
  sessionId: workerData.sessionId,
  callTool(name, args) {
    return new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      emit({ type: 'tool', id, name, args })
    })
  },
  async listTools() { return [] },
  async close() {},
}
setDevicePlatform(mcp, workerData.platform)
setDeviceScreenSize(mcp, workerData.size)
const stepStarts = new Map()
const stepGate = new Int32Array(workerData.stepGate)
try {
  const result = await runYamlFlow(mcp, workerData.meta, workerData.steps, {
    stepDelayMs: 0,
    tapTargetMaxAttempts: 20,
    tapTargetPollIntervalMs: 250,
    onFlowStep(step, total, kind, target, status, error, message) {
      // runYamlFlow appends a bare done to each block. It is not a source step.
      if (kind === 'done' && step > workerData.steps.length) return
      const durationMs = status === 'running' ? undefined : performance.now() - stepStarts.get(step)
      Atomics.store(stepGate, 0, 0)
      emit({ type: 'step', step, total, kind, target, status, error, message, durationMs })
      // The native callback is synchronous. Block only this isolated worker so
      // the next native step (including sleep) starts after its checkpoint lands.
      if (Atomics.wait(stepGate, 0, 0, 600_000) === 'timed-out') throw new Error('Checkpoint acknowledgement timed out')
      if (status === 'running') stepStarts.set(step, performance.now())
    },
  })
  emit({ type: 'result', result })
} catch (error) {
  emit({ type: 'failure', error: error instanceof Error ? error.message : String(error) })
}

}
