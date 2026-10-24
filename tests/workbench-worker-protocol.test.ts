import { expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { Worker } from 'node:worker_threads'
import { NativeWorkerProtocol } from '../src/workbench-worker-protocol.js'
import { executeNativeBlock } from '../src/workbench-native-execution.js'
const start = { protocolVersion: 1, sequence: 1, type: 'step', step: 1, total: 2, kind: 'tap', status: 'running' }
const tool = { protocolVersion: 1, sequence: 2, type: 'tool', id: 1, name: 'appium_gesture', args: { x: 1, y: 1 } }
const end = { ...start, sequence: 3, status: 'passed' }
const result = { protocolVersion: 1, sequence: 4, type: 'result', result: { success: true, stepsExecuted: 2, stepsTotal: 2 } }

it('accepts pinned-engine step/tool/checkpoint/completion order', () => {
  const protocol = new NativeWorkerProtocol(['tap'])
  for (const event of [start, tool, end, result]) expect(protocol.accept(event).type).toBe(event.type)
  expect(() => protocol.accept({ ...tool, sequence: 5, id: 2 })).toThrow('sequence')
})
it.each([
  null, { ...start, protocolVersion: 2 }, { ...start, sequence: 2 }, { ...start, status: 'passed' },
  { ...start, kind: 'type' }, { ...start, total: 3 }, { ...tool, sequence: 1 }, { ...result, sequence: 1 },
])('rejects malformed, unsupported or premature events: %j', event => {
  expect(() => new NativeWorkerProtocol(['tap']).accept(event)).toThrow()
})
it('rejects duplicate tools and transitions before additional dispatch', () => {
  const protocol = new NativeWorkerProtocol(['tap']); protocol.accept(start); protocol.accept(tool)
  expect(() => protocol.accept({ ...tool, sequence: 3 })).toThrow('tool dispatch')
  expect(() => protocol.accept({ ...start, sequence: 3 })).toThrow('step start')
  protocol.accept(end)
  expect(() => protocol.accept({ ...end, sequence: 4 })).toThrow('terminal step')
})
it('rejects invalid tool envelopes and oversized payloads', () => {
  for (const change of [{ name: 'shell' }, { args: null }, { args: { payload: 'x'.repeat(1024 * 1024) } }, { id: 2 }]) {
    const protocol = new NativeWorkerProtocol(['tap']); protocol.accept(start)
    expect(() => protocol.accept({ ...tool, ...change })).toThrow()
  }
})
it('does not accept success after a failed step or further steps after failure', () => {
  const protocol = new NativeWorkerProtocol(['tap']); protocol.accept(start); protocol.accept({ ...end, sequence: 2, status: 'failed' })
  expect(() => protocol.accept({ ...result, sequence: 3 })).toThrow()
  expect(protocol.accept({ ...result, sequence: 3, result: { ...result.result, success: false, reason: 'not found' } }).type).toBe('result')
})

function executorFixture() {
  const worker = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), terminate: vi.fn(async () => { worker.emit('exit', 0); return 0 }), postMessage: vi.fn() })
  const abort = new AbortController(), callTool = vi.fn(async () => ({ content: [] }))
  const input = {
    store: {}, run: { steps: [], evidence: [], diagnostics: [] }, flow: { parsed: { meta: { appId: 'fixture.app' }, steps: [] }, inputModes: {} },
    block: { parsed: { steps: [{ kind: 'tap', target: 'button' }] }, inputModes: {}, blockers: [] }, path: 'root/1', sourceLines: [1],
    device: { geometry: async () => ({ viewport: { width: 100, height: 100 } }), platform: 'ios', sessionId: 'mock', callTool }, timing: {}, signal: abort.signal,
    createWorker: () => worker as unknown as Worker, setWorker: vi.fn(), setTimingStep: vi.fn(), recordStep: vi.fn(),
  } as unknown as Parameters<typeof executeNativeBlock>[0]
  return { worker, abort, input, callTool }
}
it('rejects a malformed worker before dispatch and awaits termination', async () => {
  const { worker, input, callTool } = executorFixture()
  const pending = executeNativeBlock(input)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(worker.listenerCount('message')).toBe(1))
  worker.emit('message', { ...tool, protocolVersion: 99, sequence: 1 })
  await rejected
  expect(callTool).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce()
})
it('ignores post-cancel messages and releases the worker before returning', async () => {
  const { worker, input, callTool, abort } = executorFixture()
  const pending = executeNativeBlock(input), rejected = expect(pending).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(worker.listenerCount('message')).toBe(1))
  abort.abort(new Error('cancelled'))
  worker.emit('message', start); worker.emit('message', tool)
  await rejected
  expect(callTool).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce()
})

it('retains native ownership until actual exit AND accepted device dispatch drain after terminate rejects', async () => {
  const { worker, input, callTool, abort } = executorFixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  callTool.mockImplementation(async () => { await gate; return { content: [] } })
  input.recordStep = async () => { input.run.steps.push({ index: 1, kind: 'tap', status: 'running', startedAt: new Date().toISOString(), evidence: [] }) }
  worker.terminate.mockImplementation(async () => { throw new Error('terminate rejected') })
  const pending = executeNativeBlock(input)
  let settled = false
  const observed = pending.catch(error => { settled = true; return error })
  await vi.waitFor(() => expect(worker.listenerCount('message')).toBe(1))
  worker.emit('message', start); worker.emit('message', tool)
  await vi.waitFor(() => expect(callTool).toHaveBeenCalledOnce())
  abort.abort(new Error('cancelled'))
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce())
  expect(settled).toBe(false); expect(input.setWorker).not.toHaveBeenCalledWith(null)
  worker.emit('exit', 1); await Promise.resolve()
  expect(settled).toBe(false)
  release(); expect(await observed).toBeInstanceOf(AggregateError)
  expect(input.setWorker).toHaveBeenLastCalledWith(null)
  expect(worker.postMessage).not.toHaveBeenCalled()
  expect(worker.eventNames()).toEqual([])
})
