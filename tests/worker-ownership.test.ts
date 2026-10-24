import { EventEmitter } from 'node:events'
import type { Worker } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { ownWorkerExit, runOwnedWorker } from '../src/workbench-worker-lifecycle.js'
import { compareVisual, type VisualProfile } from '../src/workbench-visual.js'
import { transformShareImage } from '../src/workbench-share.js'
import { TriageAnalyzerRunner } from '../src/workbench-triage-analyzer.js'
import type { TestRun } from '../src/workbench-domain.js'

function fake(reject: boolean) {
  const worker = Object.assign(new EventEmitter(), { terminate: vi.fn(async () => { if (reject) throw new Error('terminate refused'); return 0 }) })
  return { worker, factory: () => worker as unknown as Worker }
}
const profile = { revision: 1, rulesVersion: 1, referenceSha256: 'a'.repeat(64) } as VisualProfile

it.each(['visual', 'share', 'analyzer'] as const)('%s cancellation retains ownership through rejected terminate and late messages', async kind => {
  const { worker, factory } = fake(true), abort = new AbortController()
  const pending = kind === 'visual' ? compareVisual(profile, Buffer.from('image'), 'build', 'unknown', abort.signal, 10_000, factory)
    : kind === 'share' ? transformShareImage(Buffer.from('image'), [], abort.signal, factory)
    : new TriageAnalyzerRunner({ id: 'fixture', version: '1', moduleUrl: new URL('file:///fixture.mjs') }, factory)
      .analyze({ run: { evidence: [], steps: [] } as unknown as TestRun, locatorEvidence: [], manifestSha256: 'a'.repeat(64) }, abort.signal, 10_000)
  let settled = false
  const outcome = pending.then(value => { settled = true; return { value } }, error => { settled = true; return { error } })
  abort.abort(new Error('cancelled'))
  await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce())
  worker.emit('message', { bytes: new Uint8Array([1]), ok: true, analysis: {}, status: 'pass', message: 'late', revision: 1, rulesVersion: 1, referenceSha256: profile.referenceSha256, comparedPixels: 1, differentPixels: 0 })
  worker.emit('error', new Error('late error'))
  await Promise.resolve(); expect(settled).toBe(false)
  worker.emit('exit', 1)
  const result = await outcome
  if (kind === 'visual') expect(result).toMatchObject({ value: { status: 'inconclusive', message: 'Visual comparison cancelled' } })
  else expect(result).toHaveProperty('error')
  expect(worker.eventNames()).toEqual([])
})

it.each(['success', 'decode-error', 'error', 'timeout', 'exit'] as const)('single outcome %s drains actual exit and listeners', async mode => {
  const { worker, factory } = fake(false), decode = vi.fn((value: unknown) => { if (mode === 'decode-error') throw new Error('bad'); return value })
  const pending = runOwnedWorker(new URL('file:///fixture.mjs'), {}, decode, undefined, mode === 'timeout' ? 1 : 10_000, 'Fixture', factory)
  let settled = false
  const observed = pending.then(value => { settled = true; return value }, error => { settled = true; return error })
  if (mode === 'error') worker.emit('error', new Error('failure'))
  else if (mode === 'exit') worker.emit('exit', 1)
  else if (mode !== 'timeout') worker.emit('message', 'result')
  if (mode !== 'exit') {
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce())
    expect(settled).toBe(false); worker.emit('message', 'late'); worker.emit('exit', 0)
  }
  const value = await observed
  if (mode === 'success') expect(value).toBe('result'); else expect(value).toBeInstanceOf(Error)
  expect(worker.eventNames()).toEqual([])
  expect(decode.mock.calls.length).toBe(mode === 'success' || mode === 'decode-error' ? 1 : 0)
})

it('exit ownership close is idempotent even when terminate rejects', async () => {
  const { worker } = fake(true), owner = ownWorkerExit(worker as unknown as Worker)
  const pending = owner.close(), assertion = expect(pending).rejects.toThrow('termination failed')
  expect(owner.close()).toBe(pending)
  worker.emit('error', new Error('late')); worker.emit('exit', 1)
  await assertion; expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.eventNames()).toEqual([])
})
