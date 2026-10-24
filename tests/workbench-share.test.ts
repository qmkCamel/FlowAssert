import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchShare } from '../src/workbench-share.js'
import { WorkbenchShareJobs } from '../src/workbench-share-jobs.js'
import { WorkbenchStore, type TestRun } from '../src/workbench-store.js'

const roots: string[] = []
const stores: WorkbenchStore[] = []
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-share-')); roots.push(root)
  const store = new WorkbenchStore(root); stores.push(store); await store.init()
  const id = 'a4cbcab9-e014-43d2-92d2-a2c9f49447ba'
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 245, g: 15, b: 10, alpha: 1 } } }).png().toBuffer()
  const image = await store.put(id, 'step-1.png', png, 'image/png')
  const xml = await store.put(id, 'step-1.xml', '<AppiumAUT><XCUIElementTypeButton name="secret-token-123" label="secret-token-123" x="0" y="0" width="2" height="2" visible="true"/></AppiumAUT>', 'application/xml; charset=utf-8')
  const log = await store.put(id, 'executor.txt', `password=secret-token-123 ${['', 'Users', 'private', 'path'].join('/')}`, 'text/plain; charset=utf-8')
  const now = new Date().toISOString()
  const run: TestRun = { schemaVersion: 1, id, name: 'Sensitive run', yaml: 'name: secret-token-123', engine: 'fixture', phase: 'finished', verdict: 'pass', startedAt: now, endedAt: now,
    sessionId: 'secret-session', deviceName: 'secret-device', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'pass', cleanup: 'session-retained',
    steps: [{ index: 1, kind: 'assert', status: 'passed', startedAt: now, endedAt: now, evidence: [image, xml] }], evidence: [log] }
  await store.save(run)
  return { store, run, png, root }
}

describe('reviewed safe share', () => {
  it('masks pixels, strips XML attributes and imports v2 without a passing verdict', async () => {
    const { store, run, png, root } = await fixture()
    const share = new WorkbenchShare(store)
    const options = { files: [{ name: 'step-1.png', masks: [{ x: 0, y: 0, width: 1, height: 1 }] }, { name: 'step-1.xml' }] }
    const preview = await share.preview(run.id, options)
    expect(preview.files).toHaveLength(2)
    expect(preview.files[1]!.preview).toContain('role="button"')
    expect(JSON.stringify(preview)).not.toContain('secret-token-123')
    const archive = await share.export(run.id, options, preview.digest, true)
    expect(archive).toMatchObject({ version: 2, run: { verdict: 'inconclusive' }, sharing: { reportedVerdict: 'pass', verification: 'not-revalidated' } })
    const serialized = JSON.stringify(archive)
    for (const secret of ['secret-token-123', 'secret-device', 'secret-session', run.id, ['','Users','private','path'].join('/')]) expect(serialized).not.toContain(secret)
    expect(archive.sharing?.reviewed).toEqual([{ file: 'share-1.png', transformation: 'png-masks-v1' }, { file: 'share-2.xml', transformation: 'structure-allowlist-v1' }])
    expect((await readFile(join(root, 'shares', `${archive.sharing!.shareId}.json`), 'utf8'))).toContain(run.id)
    expect((await readFile(join(root, run.id, 'step-1.png'))).equals(png)).toBe(true)
    const pixels = await sharp(Buffer.from(archive.files[0]!.base64, 'base64')).raw().toBuffer()
    expect([...pixels.subarray(0, 3)]).toEqual([0, 0, 0])
    const imported = await store.importArchive(archive)
    expect(imported).toMatchObject({ verdict: 'inconclusive', source: 'import', share: { reportedVerdict: 'pass', verification: 'not-revalidated' } })
    expect(imported.evidence).toHaveLength(0)
    expect(imported.steps[0]!.evidence).toHaveLength(2)
  })

  it('rejects stale previews, unreviewed export, tampering and unsafe masks', async () => {
    const { store, run } = await fixture()
    const share = new WorkbenchShare(store)
    const options = { files: [{ name: 'step-1.png', masks: [{ x: 0, y: 0, width: 1, height: 1 }] }] }
    const preview = await share.preview(run.id, options)
    await expect(share.export(run.id, options, preview.digest, false)).rejects.toThrow(/review/)
    await expect(share.export(run.id, { files: [{ name: 'step-1.png', masks: [{ x: 0, y: 0, width: 2, height: 1 }] }] }, preview.digest, true)).rejects.toThrow(/stale/)
    await expect(share.preview(run.id, { files: [{ name: 'executor.txt' }] })).rejects.toThrow(/PNG and XML/)
    await expect(share.preview(run.id, { files: [{ name: 'step-1.png', masks: [{ x: 2, y: 0, width: 1, height: 1 }] }] })).rejects.toThrow(/outside/)
    const archive = await share.export(run.id, options, preview.digest, true)
    const injected = structuredClone(archive)
    injected.run.params = { token: 'should-not-enter-v2' }
    await expect(store.importArchive(injected)).rejects.toThrow(/private or unsupported/)
    archive.files[0]!.base64 = Buffer.from('tampered').toString('base64')
    await expect(store.importArchive(archive)).rejects.toThrow(/integrity/)
    expect((await store.get(run.id)).verdict).toBe('pass')
  })

  it('accepts exactly 64 selected files and rejects 65 before conversion', async () => {
    const { store, run } = await fixture()
    const selections: { name: string }[] = []
    for (let index = 0; index < 64; index++) {
      const name = `part-${index}.xml`
      run.evidence.push(await store.put(run.id, name, '<AppiumAUT><XCUIElementTypeButton name="safe"/></AppiumAUT>', 'application/xml; charset=utf-8'))
      selections.push({ name })
    }
    await store.save(run)
    const share = new WorkbenchShare(store)
    expect((await share.preview(run.id, { files: selections })).files).toHaveLength(64)
    await expect(share.preview(run.id, { files: [...selections, { name: 'step-1.xml' }] })).rejects.toThrow(/1–64/)
  })

  it('rejects oversized source bytes and pixel dimensions before sharing', async () => {
    const { store, run } = await fixture()
    run.evidence.push(await store.put(run.id, 'oversized.xml', 'x'.repeat(4 * 1024 * 1024 + 1), 'application/xml; charset=utf-8'))
    const wide = await sharp({ create: { width: 4097, height: 1, channels: 4, background: '#ffffff' } }).png().toBuffer()
    run.evidence.push(await store.put(run.id, 'wide.png', wide, 'image/png'))
    await store.save(run)
    const share = new WorkbenchShare(store)
    await expect(share.preview(run.id, { files: [{ name: 'oversized.xml' }] })).rejects.toThrow(/source exceeds evidence budget/)
    await expect(share.preview(run.id, { files: [{ name: 'wide.png' }] })).rejects.toThrow(/dimensions/)
  })
})

describe('persistent safe share jobs', () => {
  it('requires reviewed preview, publishes a verified export and recovers it after restart', async () => {
    const { store, run, root } = await fixture()
    const jobs = new WorkbenchShareJobs(store)
    const options = { files: [{ name: 'step-1.png', masks: [{ x: 0, y: 0, width: 1, height: 1 }] }] }
    const requestId = 'preview-1'
    const submitted = await jobs.submit('share-preview', requestId, { runId: run.id, options })
    const preview = await jobs.waitResult(submitted.jobId)
    expect(preview).toHaveProperty('reviewToken')
    expect(await jobs.submit('share-preview', requestId, { runId: run.id, options })).toHaveProperty('jobId', submitted.jobId)
    await expect(jobs.submit('share-preview', requestId, { runId: run.id, options: { files: [{ name: 'step-1.xml' }] } })).rejects.toThrow(/reused/)
    const token = (preview as { reviewToken: string }).reviewToken
    await expect(jobs.submit('share-export', 'wrong-options', { runId: run.id, options: { files: [{ name: 'step-1.xml' }] }, reviewToken: token, reviewed: true })).rejects.toThrow(/changed/)
    const exportJob = await jobs.submit('share-export', 'export-1', { runId: run.id, options, reviewToken: token, reviewed: true })
    const archive = await jobs.waitResult(exportJob.jobId)
    expect(archive).toMatchObject({ version: 2, sharing: { verification: 'not-revalidated' } })
    expect((await jobs.get(exportJob.jobId)).phase).toBe('succeeded')
    expect(JSON.stringify(await jobs.get(exportJob.jobId))).not.toContain(run.id)
    await jobs.close()
    const restarted = new WorkbenchShareJobs(store)
    expect((await restarted.get(exportJob.jobId)).phase).toBe('succeeded')
    expect(await restarted.result(exportJob.jobId)).toEqual(archive)
    const shareId = (archive as { sharing: { shareId: string } }).sharing.shareId
    expect((await readFile(join(root, 'shares', `${shareId}.json`), 'utf8'))).toContain(run.id)
    await restarted.close()
  })

  it('fails closed when committed artifact integrity changes', async () => {
    const { store, run, root } = await fixture()
    const jobs = new WorkbenchShareJobs(store)
    const options = { files: [{ name: 'step-1.png' }] }
    const previewJob = await jobs.submit('share-preview', 'p', { runId: run.id, options })
    const preview = await jobs.waitResult(previewJob.jobId) as { reviewToken: string }
    const exportJob = await jobs.submit('share-export', 'e', { runId: run.id, options, reviewToken: preview.reviewToken, reviewed: true })
    await jobs.waitResult(exportJob.jobId)
    await jobs.close()
    const path = join(root, 'share-jobs', 'results', exportJob.jobId, 'archive.json')
    const original = await readFile(path, 'utf8')
    await import('node:fs/promises').then(fs => fs.writeFile(path, `${original} `))
    const restarted = new WorkbenchShareJobs(store)
    expect((await restarted.get(exportJob.jobId)).phase).toBe('failed')
    await expect(restarted.result(exportJob.jobId)).rejects.toThrow(/failed/)
    await restarted.close()
  })

  it('keeps source secrets out of failed task status and leaves the original readable', async () => {
    const { store, run } = await fixture()
    const jobs = new WorkbenchShareJobs(store)
    const failed = await jobs.submit('share-preview', 'secret-failure', { runId: run.id, options: { files: [{ name: 'executor.txt' }] } })
    await expect(jobs.waitResult(failed.jobId)).rejects.toThrow(/failed/)
    const record = await jobs.get(failed.jobId)
    expect(record.phase).toBe('failed')
    for (const secret of ['secret-token-123', run.id, 'executor.txt']) expect(JSON.stringify(record)).not.toContain(secret)
    expect((await store.get(run.id)).verdict).toBe('pass')
    await jobs.close()
  })

  it('bounds one active plus two queued conversions and cancels without publishing', async () => {
    const { store, run } = await fixture()
    const jobs = new WorkbenchShareJobs(store)
    vi.spyOn(jobs.share, 'preview').mockImplementation(async (_id, _options, signal) => { signal?.throwIfAborted(); return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }) })
    const input = { runId: run.id, options: { files: [{ name: 'step-1.png' }] } }
    const first = await jobs.submit('share-preview', 'first', input)
    const second = await jobs.submit('share-preview', 'second', input)
    const third = await jobs.submit('share-preview', 'third', input)
    await expect(jobs.submit('share-preview', 'fourth', input)).rejects.toThrow(/queue is full/)
    expect((await jobs.cancel(third.jobId)).phase).toBe('cancelled')
    await jobs.cancel(first.jobId)
    await expect(jobs.waitResult(first.jobId)).rejects.toThrow(/cancelled/)
    await jobs.cancel(second.jobId)
    await jobs.close()
    expect((await jobs.get(second.jobId)).phase).toBe('cancelled')
  })

  it('deduplicates concurrent request IDs without publishing duplicate conversions', async () => {
    const { store, run } = await fixture()
    const jobs = new WorkbenchShareJobs(store)
    const input = { runId: run.id, options: { files: [{ name: 'step-1.png' }] } }
    const accepted = await Promise.all(Array.from({ length: 10 }, () => jobs.submit('share-preview', 'same-request', input)))
    expect(new Set(accepted.map(item => item.jobId)).size).toBe(1)
    expect(await jobs.waitResult(accepted[0]!.jobId)).toHaveProperty('reviewToken')
    await jobs.close()
  })

  it('rebuilds request idempotency from a durable record after a crash before request index publication', async () => {
    const { store, run, root } = await fixture()
    const input = { runId: run.id, options: { files: [{ name: 'step-1.png' }] } }
    const crashed = new WorkbenchShareJobs(store, async point => {
      if (point === 'submit:after-record') throw new Error('simulated process stop')
    })
    await expect(crashed.submit('share-preview', 'crash-window', input)).rejects.toThrow(/simulated process stop/)
    const records = (await readdir(join(root, 'share-jobs'))).filter(name => /^[0-9a-f-]{36}\.json$/.test(name))
    expect(records).toHaveLength(1)
    const restarted = new WorkbenchShareJobs(store)
    const retry = await restarted.submit('share-preview', 'crash-window', input)
    expect(retry).toMatchObject({ jobId: records[0]!.slice(0, -5), phase: 'interrupted' })
    await expect(restarted.submit('share-preview', 'crash-window', { ...input, options: { files: [{ name: 'step-1.xml' }] } })).rejects.toThrow(/reused/)
    expect((await readdir(join(root, 'share-jobs'))).filter(name => /^[0-9a-f-]{36}\.json$/.test(name))).toHaveLength(1)
    await restarted.close()
  })

  it('expires a review token without creating an export job', async () => {
    const { store, run } = await fixture()
    const jobs = new WorkbenchShareJobs(store)
    const options = { files: [{ name: 'step-1.png' }] }
    const previewJob = await jobs.submit('share-preview', 'preview-expiry', { runId: run.id, options })
    const preview = await jobs.waitResult(previewJob.jobId) as { reviewToken: string }
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000 + 1)
    try { await expect(jobs.submit('share-export', 'expired-export', { runId: run.id, options, reviewToken: preview.reviewToken, reviewed: true })).rejects.toThrow(/expired/) }
    finally { clock.mockRestore(); await jobs.close() }
  })

  it('reports committing instead of cancelled when cancellation arrives after publication starts', async () => {
    const { store, run } = await fixture()
    let reached!: () => void, resume!: () => void
    const atCommit = new Promise<void>(resolve => { reached = resolve })
    const release = new Promise<void>(resolve => { resume = resolve })
    const jobs = new WorkbenchShareJobs(store, async point => { if (point === 'export:after-artifact-fsync') { reached(); await release } })
    const options = { files: [{ name: 'step-1.png' }] }
    const previewJob = await jobs.submit('share-preview', 'commit-preview', { runId: run.id, options })
    const preview = await jobs.waitResult(previewJob.jobId) as { reviewToken: string }
    const exportJob = await jobs.submit('share-export', 'commit-export', { runId: run.id, options, reviewToken: preview.reviewToken, reviewed: true })
    await atCommit
    expect((await jobs.cancel(exportJob.jobId)).phase).toBe('committing')
    resume()
    expect(await jobs.waitResult(exportJob.jobId)).toMatchObject({ version: 2 })
    expect((await jobs.get(exportJob.jobId)).phase).toBe('succeeded')
    await jobs.close()
  })

  it.each(['preview:after-transform', 'export:after-transform', 'export:after-artifact-fsync', 'export:after-artifact-rename', 'export:after-manifest'])('recovers a SIGKILL at %s without redoing conversion', async cutpoint => {
    const { store, run, root } = await fixture()
    await store.close(); stores.splice(stores.indexOf(store), 1)
    await killShareAt(root, run.id, cutpoint)
    const restartedStore = new WorkbenchStore(root); stores.push(restartedStore); await restartedStore.init()
    const restarted = new WorkbenchShareJobs(restartedStore)
    const records = await import('node:fs/promises').then(fs => fs.readdir(join(root, 'share-jobs')))
    const jobIds = records.filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).map(name => name.slice(0, -5))
    const jobs = await Promise.all(jobIds.map(id => restarted.get(id)))
    const interrupted = jobs.find(job => job.kind === (cutpoint.startsWith('preview:') ? 'share-preview' : 'share-export'))!
    expect(interrupted.phase).toBe(cutpoint === 'export:after-manifest' ? 'succeeded' : 'interrupted')
    if (interrupted.phase === 'succeeded') expect(await restarted.result(interrupted.jobId)).toMatchObject({ version: 2 })
    else await expect(restarted.result(interrupted.jobId)).rejects.toThrow(/interrupted/)
    await restarted.close()
  })

  it('keeps an older committed export readable after a later conversion is killed', async () => {
    const { store, run, root } = await fixture()
    const jobs = new WorkbenchShareJobs(store)
    const options = { files: [{ name: 'step-1.png' }] }
    const previewJob = await jobs.submit('share-preview', 'old-preview', { runId: run.id, options })
    const preview = await jobs.waitResult(previewJob.jobId) as { reviewToken: string }
    const oldJob = await jobs.submit('share-export', 'old-export', { runId: run.id, options, reviewToken: preview.reviewToken, reviewed: true })
    const oldArchive = await jobs.waitResult(oldJob.jobId)
    await jobs.close(); await store.close(); stores.splice(stores.indexOf(store), 1)
    await killShareAt(root, run.id, 'export:after-artifact-rename')
    const restartedStore = new WorkbenchStore(root); stores.push(restartedStore); await restartedStore.init()
    const restarted = new WorkbenchShareJobs(restartedStore)
    expect(await restarted.result(oldJob.jobId)).toEqual(oldArchive)
    await restarted.close()
  })
})

async function killShareAt(root: string, runId: string, cutpoint: string, format = 'json'): Promise<void> {
  const child = spawn(process.execPath, ['--import', 'tsx', join(process.cwd(), 'tests/fixtures/workbench-share-kill-child.ts'), root, runId, cutpoint, format], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  const reached = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Timed out at ${cutpoint}: ${output}`)) }, 15_000)
    child.stdout.on('data', (bytes: Buffer) => { output += bytes.toString(); if (output.includes(`CUTPOINT ${cutpoint}`)) { clearTimeout(timer); resolve() } })
    child.stderr.on('data', (bytes: Buffer) => { output += bytes.toString() })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Child exited at ${cutpoint} (${code}): ${output}`)) })
  })
  await reached
  child.kill('SIGKILL')
  await new Promise<void>(resolve => child.once('close', () => resolve()))
}

describe('frozen offline report jobs', () => {
  it('exports identical reviewed HTML bytes, keeps legacy JSON and verifies HTML after restart', async () => {
    const { store, run, root, png } = await fixture()
    const jobs = new WorkbenchShareJobs(store), options = { files: [{ name: 'step-1.png', masks: [{ x: 0, y: 0, width: 1, height: 1 }] }, { name: 'step-1.xml' }] }
    const job = await jobs.submit('share-preview', 'html-preview', { runId: run.id, options, format: 'html' })
    const preview = await jobs.waitResult(job.jobId) as { reviewToken: string; report: import('../src/workbench-report-html.js').HtmlReportResult }
    expect(preview.report.html).toContain('Source reported verdict:')
    for (const secret of ['secret-token-123', 'secret-device', 'secret-session', run.id, 'Sensitive run', 'private-yaml']) expect(preview.report.html).not.toContain(secret)
    await expect(jobs.submit('share-export', 'format-change', { runId: run.id, options, reviewToken: preview.reviewToken, reviewed: true })).rejects.toThrow(/changed/)
    const exported = await jobs.submit('share-export', 'html-export', { runId: run.id, options, format: 'html', reviewToken: preview.reviewToken, reviewed: true })
    const report = await jobs.waitResult(exported.jobId)
    expect(report).toMatchObject({ html: preview.report.html, sha256: preview.report.sha256, shareId: preview.report.shareId })
    expect(await readFile(join(root, run.id, 'step-1.png'))).toEqual(png)
    await jobs.close()
    const restarted = new WorkbenchShareJobs(store)
    expect(await restarted.result(exported.jobId)).toMatchObject({ html: preview.report.html, sha256: preview.report.sha256 })
    await restarted.close()
  })
  it.each(['export:after-html-fsync', 'export:after-html-rename', 'export:after-manifest'])('recovers HTML SIGKILL at %s and rejects partial publication', async cutpoint => {
    const { store, run, root } = await fixture()
    await store.close(); stores.splice(stores.indexOf(store), 1)
    await killShareAt(root, run.id, cutpoint, 'html')
    const recoveredStore = new WorkbenchStore(root); stores.push(recoveredStore); await recoveredStore.init()
    const jobs = new WorkbenchShareJobs(recoveredStore)
    const records = await import('node:fs/promises').then(fs => fs.readdir(join(root, 'share-jobs')))
    const statuses = await Promise.all(records.filter(name => /^[0-9a-f-]{36}\.json$/.test(name)).map(name => jobs.get(name.slice(0, -5))))
    const exported = statuses.find(job => job.kind === 'share-export')!
    expect(exported.phase).toBe(cutpoint === 'export:after-manifest' ? 'succeeded' : 'interrupted')
    if (exported.phase === 'succeeded') expect(await jobs.result(exported.jobId)).toMatchObject({format:'mobile-mirror-html', version:1})
    else await expect(jobs.result(exported.jobId)).rejects.toThrow(/interrupted/)
    await jobs.close()
  })
  it('releases the HTML source read lease after cancellation during evidence preparation', async () => {
    const {store, run, png} = await fixture(); const share = new WorkbenchShare(store), controller = new AbortController()
    let reached!: () => void, resume!: () => void
    const atRead = new Promise<void>(resolve => {reached = resolve}), gate = new Promise<void>(resolve => {resume = resolve})
    vi.spyOn(store,'readEvidence').mockImplementation(async () => {reached(); await gate; return png})
    const prepared = share.prepareReport(run.id,{files:[{name:'step-1.png'}]},controller.signal)
    await atRead; expect(store.hasReadLease(run.id)).toBe(true)
    controller.abort(new Error('cancelled')); resume()
    await expect(prepared).rejects.toThrow(/cancelled/); expect(store.hasReadLease(run.id)).toBe(false)
    expect((await store.get(run.id)).verdict).toBe('pass')
  })
  it('fails timed-out HTML preparation without publishing a review or changing the source', async () => {
    const {store,run} = await fixture(), original = globalThis.setTimeout
    const jobs = new WorkbenchShareJobs(store, async point => {if(point === 'preview:after-transform') await new Promise(resolve => original(resolve,80))})
    const timer = vi.spyOn(globalThis,'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => original(callback,ms === 30_000 ? 30 : ms,...args)) as typeof setTimeout)
    try {
      const job = await jobs.submit('share-preview','html-timeout',{runId:run.id,format:'html',options:{files:[]}})
      await expect(jobs.waitResult(job.jobId)).rejects.toThrow(/failed/)
      expect(await jobs.get(job.jobId)).toMatchObject({phase:'failed',progress:'Share conversion timed out'})
      expect(store.hasReadLease(run.id)).toBe(false); expect((await store.get(run.id)).verdict).toBe('pass')
    } finally {timer.mockRestore(); await jobs.close()}
  })
  it('invalidates HTML reviews when source changes or token expires and never publishes incomplete HTML', async () => {
    const { store, run } = await fixture(), options = { files: [{ name: 'step-1.png' }] }
    const jobs = new WorkbenchShareJobs(store)
    const first = await jobs.submit('share-preview', 'html-stale', { runId: run.id, options, format: 'html' })
    const preview = await jobs.waitResult(first.jobId) as { reviewToken: string }
    run.name = 'changed'; await store.save(run)
    const exported = await jobs.submit('share-export', 'changed-source', { runId: run.id, options, format: 'html', reviewToken: preview.reviewToken, reviewed: true })
    await expect(jobs.waitResult(exported.jobId)).rejects.toThrow(/failed/)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    await expect(jobs.submit('share-export', 'expired-html', { runId: run.id, options, format: 'html', reviewToken: preview.reviewToken, reviewed: true })).rejects.toThrow(/expired/)
    clock.mockRestore(); await jobs.close()
    const interrupted = new WorkbenchShareJobs(store, async point => { if (point === 'export:after-html-rename') throw new Error('ENOSPC') })
    const second = await interrupted.submit('share-preview', 'html-cutpoint', { runId: run.id, options, format: 'html' })
    const candidate = await interrupted.waitResult(second.jobId) as { reviewToken: string }
    const incomplete = await interrupted.submit('share-export', 'html-incomplete', { runId: run.id, options, format: 'html', reviewToken: candidate.reviewToken, reviewed: true })
    await expect(interrupted.waitResult(incomplete.jobId)).rejects.toThrow(/failed/)
    await interrupted.close()
    const recovered = new WorkbenchShareJobs(store); await expect(recovered.result(incomplete.jobId)).rejects.toThrow(/failed/); await recovered.close()
  })
})

it('allows attachment-free HTML while preserving the nonempty legacy JSON contract', async () => {
  const { store, run } = await fixture(); const jobs = new WorkbenchShareJobs(store), options = { files: [] }
  await expect(jobs.submit('share-preview', 'empty-json', { runId: run.id, options })).rejects.toThrow(/1–64/)
  const job = await jobs.submit('share-preview', 'empty-html', { runId: run.id, options, format: 'html' })
  const preview = await jobs.waitResult(job.jobId) as { reviewToken: string; report: { html: string } }; expect(preview.report.html).toContain('Evidence for this step not included')
  const exported = await jobs.submit('share-export', 'empty-html-export', { runId: run.id, options, format: 'html', reviewToken: preview.reviewToken, reviewed: true })
  expect(await jobs.waitResult(exported.jobId)).toMatchObject({ html: preview.report.html }); await jobs.close()
})
