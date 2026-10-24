import { expect, it } from 'vitest'
import { WorkbenchOcrPreviews } from '../src/workbench-ocr-preview.js'
import { fixtureRecognizer, ocrFixtureProfile } from './fixtures/ocr-fixture.js'
import { handleOcrHttp } from '../src/viewer-workbench-ocr-http.js'
import type { WorkbenchApplication } from '../src/workbench-application.js'

it('bounds concurrent jobs and cancellation waits for actual operation cleanup', async () => {
  let finish!: () => void
  const service = new WorkbenchOcrPreviews({ identity: async () => ocrFixtureProfile.identity, close: async () => {}, preview: async (_image, _profile, signal) => {
    await new Promise<void>(resolve => { finish = resolve }); signal!.throwIfAborted(); throw new Error('fixture')
  } })
  const input = { profile: ocrFixtureProfile, image: Buffer.from('png').toString('base64'), localOnly: true }
  const job = service.start(input); await new Promise(resolve => setImmediate(resolve))
  let cancelled = false; const cancellation = service.cancel(job.id).then(() => { cancelled = true })
  expect(service.get(job.id).phase).toBe('cancelling'); expect(cancelled).toBe(false)
  finish(); await cancellation; expect(service.get(job.id)).toMatchObject({ phase: 'cancelled', completedAt: expect.any(String) })
  await service.close(); expect(() => service.start(input)).toThrow('closed')
})
it('strict preview API rejects arbitrary paths/actions and unknown jobs without invoking device methods', async () => {
  const service = new WorkbenchOcrPreviews({ ...fixtureRecognizer(), identity: async () => ocrFixtureProfile.identity, close: async () => {} })
  const input = { profile: ocrFixtureProfile, image: 'cG5n', localOnly: true }
  for (const extra of [{ path: '/etc/passwd' }, { execute: 'tap' }, { localOnly: false }]) expect(() => service.start({ ...input, ...extra })).toThrow()
  expect(() => service.get('../private')).toThrow()
  const app = { ocrPreviews: service } as WorkbenchApplication
  const result: unknown[] = []
  await handleOcrHttp({ url: new URL('http://localhost/api/workbench/ocr/preview'), method: 'POST', application: app, readJson: async () => input, json: (...values) => { result.push(...values) } })
  expect(result[0]).toBe(202)
  await service.close()
})
