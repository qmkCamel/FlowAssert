import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchChangeAcceptance, type AcceptanceJob } from '../src/workbench-change-acceptance.js'
import { seedAcceptance } from './fixtures/acceptance-fixture.js'
import { acceptanceHash } from '../src/workbench-change-contracts.js'
import { NativeAcceptanceSources } from '../src/workbench-change-source.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'

async function finish(service: WorkbenchChangeAcceptance, job: AcceptanceJob) {
  for (let i = 0; i < 300; i++) {
    if (['finished', 'failed', 'interrupted', 'cancelled'].includes(job.phase)) return job
    await new Promise(resolve => setTimeout(resolve, 10)); job = await service.getJob(job.jobId)
  }
  throw new Error('Test job did not finish')
}
async function setup(available?: () => Promise<number>) {
  const root = await mkdtemp(join(tmpdir(), 'acceptance-record-')), store = new WorkbenchStore(root, available)
  const fixture = await seedAcceptance(store), service = new WorkbenchChangeAcceptance(store)
  return { root, store, service, ...fixture, async close() { await service.close(); await store.close(); await rm(root, { recursive: true, force: true }) } }
}
it('publishes immutable revisions, protects references, preserves damaged evidence facts, and retires idempotently', async () => {
  const f = await setup()
  try {
    const before = await readFile(join(f.root, f.run.id, 'manifest.json')), preview = await f.service.preview(f.input)
    expect(preview.summary.status).toBe('pass')
    const request = { id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }
    expect(await finish(f.service, await f.service.publish(request))).toMatchObject({ phase: 'finished', revision: 1 })
    expect(await f.service.publish({ ...request, previewId: randomUUID() })).toMatchObject({ phase: 'finished', revision: 1 })
    await expect(f.service.publish({ ...request, previewDigest: 'e'.repeat(64) })).rejects.toThrow('conflict')
    const result = await f.service.get(request.id)
    expect(result.current.status).toBe('pass')
    expect(JSON.parse(await f.service.export(request.id, 1, 'json')).current).toEqual(result.current)
    expect(await f.service.export(request.id, 1, 'markdown')).toContain('Result: pass')
    const refs = await f.service.references.list()
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ consumerKind: 'acceptance:revision', targetRunId: f.run.id })
    const revisionPath = join(f.root, 'acceptance', 'records', request.id, 'revision-1.json'), revisionBytes = await readFile(revisionPath)
    await writeFile(join(f.root, f.run.id, 'step-1.xml'), 'corrupt')
    const damaged = await f.service.get(request.id)
    expect(damaged.generated.status).toBe('pass'); expect(damaged.current.status).toBe('incomplete')
    expect(await readFile(revisionPath)).toEqual(revisionBytes)
    expect(await readFile(join(f.root, f.run.id, 'manifest.json'))).toEqual(before)
    await f.service.retire(request.id); await f.service.retire(request.id)
    expect(await f.service.references.list()).toHaveLength(0)
    expect((await f.service.get(request.id)).retired).toBe(true)
  } finally { await f.close() }
})
it('concurrent expected-revision publications serialize and cannot overwrite one another or shrink scope', async () => {
  const f = await setup()
  try {
    const preview = await f.service.preview(f.input), id = randomUUID()
    const requests = Array.from({ length: 2 }, () => ({ id, expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }))
    const jobs = await Promise.all(requests.map(request => f.service.publish(request)))
    const done = await Promise.all(jobs.map(job => finish(f.service, job)))
    expect(done.map(job => job.phase).sort()).toEqual(['failed', 'finished'])
    const modified = structuredClone(f.input); modified.cells[0]!.required = ['ui']
    const next = await f.service.preview(modified)
    expect(await finish(f.service, await f.service.publish({ ...requests[0], expectedRevision: 1, previewId: next.previewId, previewDigest: next.previewDigest, requestKey: randomUUID() }))).toMatchObject({ phase: 'failed', error: 'acceptance-scope-conflict' })
    expect((await f.service.get(id)).revision).toBe(1)
  } finally { await f.close() }
})
it('changed sources invalidate a preview; unknown/low capacity cannot publish', async () => {
  let capacity = 1024 * 1024 * 1024
  const f = await setup(async () => capacity)
  try {
    const preview = await f.service.preview(f.input)
    const request = { id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }
    capacity = 1
    await expect(f.service.publish(request)).rejects.toThrow()
    capacity = Number.NaN
    await expect(f.service.publish(request)).rejects.toThrow()
    expect((await f.service.list()).items).toHaveLength(0)
    capacity = 1024 * 1024 * 1024
    f.run.verdict = 'fail'; await f.store.save(f.run)
    expect(await finish(f.service, await f.service.publish(request))).toMatchObject({ phase: 'failed', error: 'acceptance-preview-stale' })
    expect((await f.service.list()).items).toHaveLength(0)
  } finally { await f.close() }
})
it('does not expose a terminal job until the publication slot and durability cleanup are released', async () => {
  const f = await setup(); let resume!: () => void, reached!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve }), entered = new Promise<void>(resolve => { reached = resolve })
  const service = new WorkbenchChangeAcceptance(f.store, { cutpoint: async phase => { if (phase === 'after-job-save') { reached(); await gate } } })
  try {
    const preview = await service.preview(f.input), job = await service.publish({ id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true })
    await entered; let observed = false
    const read = service.getJob(job.jobId).then(result => { observed = true; return result })
    await new Promise(resolve => setTimeout(resolve, 25)); expect(observed).toBe(false)
    resume(); expect((await read).phase).toBe('finished')
  } finally { resume(); await service.close(); await f.close() }
})
it('simultaneous identical requests share one durable job and expired previews are rejected', async () => {
  const f = await setup()
  try {
    const preview = await f.service.preview(f.input)
    const request = { id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }
    const jobs = await Promise.all([f.service.publish(request), f.service.publish(request)])
    expect(jobs[0]!.jobId).toBe(jobs[1]!.jobId)
    expect((await finish(f.service, jobs[0]!)).phase).toBe('finished')
    expect((await f.service.list()).items).toHaveLength(1)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(preview.expiresAt) + 1)
    try { await expect(f.service.publish({ ...request, id: randomUUID(), requestKey: randomUUID() })).rejects.toThrow('expired') }
    finally { clock.mockRestore() }
  } finally { await f.close() }
})
it('retention excludes an in-progress leased read and preserves published references', async () => {
  const f = await setup(), resolver = new NativeAcceptanceSources(f.store), retention = new WorkbenchRetention(f.store)
  try {
    const before = await retention.plan(0)
    const lease = await resolver.acquire(f.input)
    try {
      expect((await retention.plan(0)).candidates.some(c => c.id === f.run.id)).toBe(false)
      await expect(retention.confirm(before)).rejects.toThrow()
    } finally { lease.release() }
    const preview = await f.service.preview(f.input)
    await finish(f.service, await f.service.publish({ id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }))
    expect((await retention.plan(0)).candidates.some(c => c.id === f.run.id)).toBe(false)
    expect(f.store.hasReadLease(f.run.id)).toBe(false)
  } finally { await f.close() }
})
it('cancellation before commit prevents publication; after commit returns completed revision', async () => {
  const f = await setup()
  let resume!: () => void, reached!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve }), entered = new Promise<void>(resolve => { reached = resolve })
  const service = new WorkbenchChangeAcceptance(f.store, { cutpoint: async phase => { if (phase === 'before-source') { reached(); await gate } } })
  try {
    const preview = await service.preview(f.input), request = { id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }
    const job = await service.publish(request); await entered
    expect((await service.cancel(job.jobId)).phase).toBe('cancelling'); resume()
    expect(await finish(service, job)).toMatchObject({ phase: 'cancelled' })
    expect((await service.list()).items).toHaveLength(0)
    const goodPreview = await f.service.preview(f.input)
    const good = await finish(f.service, await f.service.publish({ ...request, previewId: goodPreview.previewId, previewDigest: goodPreview.previewDigest, requestKey: randomUUID() }))
    expect((await f.service.cancel(good.jobId)).phase).toBe('finished')
    await service.close(); await expect(service.preview(f.input)).rejects.toThrow('closed')
  } finally { resume(); await service.close(); await f.close() }
})
it.each(['before-references', 'after-references', 'after-revision', 'after-index'])('SIGKILL at %s recovers conservatively without duplicate publication', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'acceptance-crash-'))
  const store = new WorkbenchStore(root), service = new WorkbenchChangeAcceptance(store)
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/acceptance-crash-child.ts', root, phase], { cwd: process.cwd(), stdio: 'pipe' })
    let stderr = ''; child.stderr.on('data', bytes => { stderr += String(bytes) })
    const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
    expect(exit, stderr).toEqual({ code: null, signal: 'SIGKILL' })
    const request = JSON.parse(await readFile(join(root, 'test-request.json'), 'utf8'))
    const job = await service.getJob(request.requestKey)
    const published = ['after-revision', 'after-index'].includes(phase)
    expect(job.phase).toBe(published ? 'finished' : 'interrupted')
    expect((await service.list()).items).toHaveLength(published ? 1 : 0)
    expect((await service.references.list()).length).toBe(phase === 'before-references' ? 0 : 1)
    expect((await service.publish(request)).phase).toBe(published ? 'finished' : 'interrupted')
  } finally { await service.close(); await store.close(); await rm(root, { recursive: true, force: true }) }
}, 15_000)
it('corrupt index/tombstone fail closed and revocation preserves other consumers', async () => {
  const f = await setup()
  try {
    const preview = await f.service.preview(f.input), id = randomUUID()
    await finish(f.service, await f.service.publish({ id, expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }))
    const ref = (await f.service.references.list())[0]!
    await f.service.references.publish({ ...ref, contractVersion: 3, refId: randomUUID(), consumerKind: 'other:consumer', consumerId: randomUUID() })
    await f.service.retire(id)
    expect((await f.service.references.list()).map(ref => ref.consumerKind)).toEqual(['other:consumer'])
    const root = join(f.root, 'acceptance', 'records', id)
    await writeFile(join(root, 'tombstone.json'), '{}')
    await expect(f.service.get(id)).rejects.toThrow('integrity')
    await writeFile(join(root, 'index.json'), JSON.stringify({ value: { version: 2 }, digest: acceptanceHash({ version: 2 }) }))
    await expect(f.service.get(id)).rejects.toThrow()
    expect((await readdir(root)).filter(name => name.startsWith('revision-'))).toHaveLength(1)
  } finally { await f.close() }
})
it('unknown reference prevents revocation and tombstoned retirement can be retried after interruption', async () => {
  const f = await setup()
  try {
    const preview = await f.service.preview(f.input), id = randomUUID()
    await finish(f.service, await f.service.publish({ id, expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }))
    const ref = (await f.service.references.list())[0]!, path = join(f.service.references.root, `${ref.refId}.json`), original = await readFile(path)
    await writeFile(path, JSON.stringify({ ...ref, contractVersion: 999 }))
    await expect(f.service.retire(id)).rejects.toThrow()
    expect((await f.service.get(id)).retired).toBe(true)
    expect(await readFile(path, 'utf8')).toContain('999')
    await writeFile(path, original)
    await f.service.retire(id)
    expect(await f.service.references.list()).toHaveLength(0)
  } finally { await f.close() }
})
