import { Worker, type WorkerOptions } from 'node:worker_threads'
import { NativeWorkerProtocol, type NativeExecutionResult } from './workbench-worker-protocol.js'
import { WORKBENCH_WORKER_URL, type WorkbenchFlow } from './workbench-flow.js'
import type { WorkbenchDevice } from './workbench-device.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { TestRun } from './workbench-domain.js'
import { timed, type TimingObserver } from './workbench-timing.js'
import type { StepEvent } from './workbench-step-evidence.js'
import { appiumPublicErrorCode } from './providers/appium-provider.js'
import { ownWorkerExit } from './workbench-worker-lifecycle.js'
import type { SourceStepIdentity } from './workbench-tap-facts.js'

export class FlowAssertionFailure extends Error {}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** One native block on the existing device lease. Worker and RPC never become a second device owner. */
export async function executeNativeBlock(input: {
  store: WorkbenchStore; run: TestRun; flow: WorkbenchFlow; block: WorkbenchFlow; path: string; sourceLines: number[]
  sourceSteps?: SourceStepIdentity[] | undefined; pathOffset?: number
  device: WorkbenchDevice; timing: TimingObserver; signal: AbortSignal
  createWorker: (url: URL, options: WorkerOptions) => Worker
  setWorker: (worker: Worker | null) => void
  setTimingStep: (step: number | undefined) => void
  recordStep: (event: StepEvent) => Promise<void>
}): Promise<NativeExecutionResult> {
  const { store, run, flow, block, path, sourceLines, device, timing, signal } = input
  const offset = run.steps.length
  flow.parsed.steps.push(...block.parsed.steps)
  flow.blockers = block.blockers
  for (const [index, mode] of Object.entries(block.inputModes)) flow.inputModes[offset + Number(index)] = mode
  const initial = await device.geometry()
  signal.throwIfAborted()
  const stepGate = new Int32Array(new SharedArrayBuffer(4))
  const worker = input.createWorker(WORKBENCH_WORKER_URL, {
    workerData: { sessionId: device.sessionId, platform: device.platform,
      size: `${initial.viewport.width}x${initial.viewport.height}`, meta: flow.parsed.meta, steps: block.parsed.steps, stepGate: stepGate.buffer },
    env: { DOTENV_CONFIG_PATH: '/dev/null', AGENT_MODE: 'dom', VISION_LOCATE_PROVIDER: 'none', NO_COLOR: '1' },
    stdout: true, stderr: true,
  })
  const owner = ownWorkerExit(worker)
  input.setWorker(worker)
  const protocol = new NativeWorkerProtocol(block.parsed.steps.map(step => step.kind))
  let log = '', result: NativeExecutionResult | null = null
  const collect = (data: Buffer) => { if (log.length < 64_000) log += data.toString().slice(0, 64_000 - log.length) }
  worker.stdout.on('data', collect); worker.stderr.on('data', collect)
  let queue = Promise.resolve(), onAbort: (() => void) | undefined
  const finished = new Promise<void>((resolve, reject) => {
    let done = false
    const finish = (error?: unknown) => { if (done) return; done = true; error ? reject(error) : resolve() }
    worker.on('message', (raw: unknown) => {
      if (signal.aborted || done) return
      queue = queue.then(async () => {
        if (done) return
        signal.throwIfAborted()
        const event = protocol.accept(raw)
        if (event.type === 'tool') {
          try {
            const step = flow.parsed.steps[(run.steps.at(-1)?.index ?? 0) - 1]
            let args = event.args
            if (event.name === 'appium_set_value') {
              if (step?.kind !== 'type' || step.text !== args.text || !step.selector) throw new Error('Unexpected input dispatch')
              args = { text: step.text, selector: step.selector, mode: flow.inputModes[run.steps.at(-1)!.index] }
            }
            const response = await device.callTool(event.name, args, flow.parsed.meta.appId!)
            if (!signal.aborted) worker.postMessage({ protocolVersion: 1, id: event.id, result: response })
          } catch (error) {
            const current = run.steps.at(-1)
            run.diagnostics!.push({ domain: 'device-driver', code: appiumPublicErrorCode(error) ?? 'tool-call-failed', phase: 'execute',
              ...(current?.comparison?.stepKey ? { stepKey: current.comparison.stepKey } : {}), retryable: true,
              evidenceRefs: current?.evidence.map(file => file.name) ?? [], observedAt: new Date().toISOString(), message: message(error) })
            if (current?.kind === 'type' && current.status === 'running') {
              await input.recordStep({ type: 'step', step: current.index, total: flow.parsed.steps.length,
                kind: 'type', status: 'failed', error: message(error) })
            }
            // An error RPC would let AppClaw fall back to an unowned standalone input provider.
            throw error
          }
        } else if (event.type === 'step') {
          event.step += offset
          input.setTimingStep(event.step)
          device.path = `${path}/${event.step - offset + (input.pathOffset ?? 0)}`
          await input.recordStep({ type: 'step', step: event.step, total: event.total, kind: event.kind, status: event.status,
            ...(event.target !== undefined ? { target: event.target } : {}), ...(event.error !== undefined ? { error: event.error } : {}),
            ...(event.message !== undefined ? { message: event.message } : {}), ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}) })
          if (event.status === 'running') {
            const step = run.steps.at(-1)!
            step.path = device.path
            step.sourceLine = sourceLines[event.step - offset - 1] ?? 0
            const source = input.sourceSteps?.[event.step - offset - 1]
            if (source) step.sourceStep = source
          }
          Atomics.store(stepGate, 0, 1); Atomics.notify(stepGate, 0)
        } else if (event.type === 'result') { result = event.result; finish() }
        else finish(new Error(event.error))
      }).catch((error: unknown) => finish(error))
    })
    worker.once('error', finish)
    worker.once('exit', code => { if (!done) finish(new Error(`Executor exited before completion (${code})`)) })
    onAbort = () => finish(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  let executionError: unknown
  try { await finished } catch (error) { executionError = error }
  finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
    try { await owner.close() } catch (error) { executionError = executionError === undefined ? error : new AggregateError([executionError, error], 'Execution and termination failed') }
    finally {
      await queue
      worker.removeAllListeners('message'); worker.removeAllListeners('error'); worker.removeAllListeners('exit')
      worker.stdout.off('data', collect); worker.stderr.off('data', collect)
      input.setWorker(null); input.setTimingStep(undefined)
    }
    if (log) run.evidence.push(await timed(timing, 'persist', () => store.put(run.id, `executor-${offset}.txt`, log, 'text/plain; charset=utf-8')))
  }
  if (executionError !== undefined) throw executionError
  signal.throwIfAborted()
  const completed = result as NativeExecutionResult | null
  if (!completed?.success) throw new FlowAssertionFailure(completed?.reason ?? 'UI assertion failed')
  return completed
}
