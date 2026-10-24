import { expect, it, vi } from 'vitest'
import * as filesystem from 'node:fs/promises'
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>() }))
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchExternalAssets } from '../src/workbench-external-assets.js'
import { readExternalFile, validateExternalAttachment } from '../src/workbench-external-files.js'
import { externalFixture } from './fixtures/external-fixture.js'
import { seedAcceptance } from './fixtures/acceptance-fixture.js'
import { CombinedAcceptanceSources, NativeAcceptanceSources, evaluateAcceptanceCell } from '../src/workbench-change-source.js'
import { parseExternalReport } from '../src/workbench-external-parser.js'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
export async function externalPreview(service: WorkbenchExternalAssets, input: unknown = externalFixture()) {
  const accepted = await service.preview(input)
  await expect.poll(async () => (await service.getJob(accepted.id)).phase).toBe('preview')
  return service.getJob(accepted.id)
}
it('imports immutable reports, verifies downloads, defaults private, revokes grants and protects references', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'external-assets-'))), store = new WorkbenchStore(root), service = new WorkbenchExternalAssets(store)
  try {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
    const input = { ...externalFixture(), attachments: [{ label: 'same.png', contentType: 'image/png', bytes: png.toString('base64') }, { label: 'same.png', contentType: 'image/png', bytes: png.toString('base64') }] }
    const job = await externalPreview(service, input), request = { previewDigest: job.previewDigest, reviewed: true }
    expect((await service.confirm(job.id, request)).phase).toBe('finished')
    expect((await service.confirm(job.id, request)).phase).toBe('finished')
    const record = await service.get(job.assetId), original = await readFile(join(service.root, 'assets', job.assetId, 'manifest.json'))
    expect(record.availability).toBe('verified'); expect(record.asset.attachments[0]!.id).not.toBe(record.asset.attachments[1]!.id)
    expect(JSON.stringify(record.summary)).not.toMatch(/private-test|private-secret|same.png/)
    const project = { identity: 'a'.repeat(64), revision: 'b'.repeat(64) }
    expect(await service.authorized(job.assetId, project)).toBe(false)
    await service.grant(job.assetId, project, true); expect(await service.authorized(job.assetId, project)).toBe(true)
    expect(await service.authorized(job.assetId, { ...project, revision: 'c'.repeat(64) })).toBe(false)
    await service.grant(job.assetId, project, false); expect(await service.authorized(job.assetId, project)).toBe(false)
    const file = record.asset.attachments[0]!
    expect((await service.download(job.assetId, file.id)).bytes).toEqual(png)
    const owner = randomUUID(); await service.pin(job.assetId, record.digest, `${owner}:1`)
    await service.pin(job.assetId, record.digest, `${owner}:2`)
    await expect(service.retire(job.assetId)).rejects.toThrow('referenced')
    await writeFile(join(service.root, 'assets', job.assetId, `${file.id}.bin`), 'broken')
    await expect(service.download(job.assetId, file.id)).rejects.toThrow('corrupt')
    expect((await service.get(job.assetId)).availability).toBe('unavailable')
    expect(await readFile(join(service.root, 'assets', job.assetId, 'manifest.json'))).toEqual(original)
    await service.revoke(owner)
    const unknownRef = join(service.root, 'references', `${randomUUID()}.json`)
    await writeFile(unknownRef, '{}')
    await expect(service.retire(job.assetId)).rejects.toThrow()
    await rm(unknownRef)
    const lease = await service.lease(job.assetId)
    await expect(service.retire(job.assetId)).rejects.toThrow('read-lease'); lease.release()
    expect(await service.retire(job.assetId)).toMatchObject({ retired: true, recovery: 'local-trash-retained' })
    expect((await service.list()).items).toHaveLength(0)
    await expect(service.get(job.assetId)).rejects.toThrow('retired')
  } finally { await service.close(); await store.close(); await rm(root, { recursive: true, force: true }) }
})
it('limits jobs, binds previews, fails closed on capacity and interrupts previews without replay', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'external-boundaries-'))); let capacity = 1024 ** 3
  const store = new WorkbenchStore(root, async () => capacity), service = new WorkbenchExternalAssets(store)
  try {
    capacity = Number.NaN; await expect(service.preview(externalFixture())).rejects.toThrow('capacity')
    capacity = 1; await expect(service.preview(externalFixture())).rejects.toThrow('insufficient')
    capacity = 1024 ** 3
    const input = externalFixture(), first = await externalPreview(service, input)
    expect((await service.preview(input)).id).toBe(first.id)
    await expect(service.preview({ ...input, engineVersion: '2' })).rejects.toThrow('conflict')
    await expect(service.confirm(first.id, { previewDigest: 'f'.repeat(64), reviewed: true })).rejects.toThrow('conflict')
    const second = await externalPreview(service)
    await expect(service.preview(externalFixture())).rejects.toThrow('busy')
    await service.cancel(second.id); expect((await service.getJob(second.id)).phase).toBe('cancelled')
    await service.close(); await expect(service.preview(input)).rejects.toThrow('closed')
    const restart = new WorkbenchExternalAssets(store)
    try { expect((await restart.getJob(first.id)).phase).toBe('interrupted'); expect((await restart.list()).items).toHaveLength(0) } finally { await restart.close() }
  } finally { await service.close(); await store.close(); await rm(root, { recursive: true, force: true }) }
})
it('reads only explicit regular files, checks true media formats and rejects active attachments', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'external-files-')))
  try {
    const path = join(root, 'report.xml'); await writeFile(path, '<testsuite/>'); await symlink(path, join(root, 'alias'))
    execFileSync('mkfifo', [join(root, 'fifo')])
    await expect(readExternalFile(join(root, 'fifo'), 1000)).rejects.toThrow()
    await symlink(root, join(root, 'parent-alias'))
    await expect(readExternalFile(join(root, 'parent-alias', 'report.xml'), 1000)).rejects.toThrow()
    await expect(readExternalFile(join(root, 'alias'), 1000)).rejects.toThrow()
    expect((await readExternalFile(path, 1000)).toString()).toBe('<testsuite/>')
    const realLstat = filesystem.lstat; let observed = 0
    const changed = vi.spyOn(filesystem, 'lstat').mockImplementation((async (target: string) => {
      const stat = await realLstat(target)
      if (target === path && ++observed === 2) Object.defineProperty(stat, 'ino', { value: stat.ino + 1 })
      return stat
    }) as typeof filesystem.lstat)
    try { await expect(readExternalFile(path, 1000)).rejects.toThrow('changed') } finally { changed.mockRestore() }
    await expect(readExternalFile(path, 1)).rejects.toThrow('budget')
    for (const text of ['<svg/>', '<html/>', '<script>bad</script>', 'const x = 1', '#!/bin/sh']) await expect(validateExternalAttachment(Buffer.from(text), 'text/plain')).rejects.toThrow()
    await expect(validateExternalAttachment(Buffer.from('<root/>'), 'image/png')).rejects.toThrow()
    const large = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'red' } }).png().toBuffer()
    await expect(validateExternalAttachment(large, 'image/png')).rejects.toThrow()
    await validateExternalAttachment(Buffer.from('plain log'), 'text/plain')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('requires native revalidation and matching provenance; external failure remains separately visible', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'external-source-'))), store = new WorkbenchStore(root), service = new WorkbenchExternalAssets(store)
  try {
    const { input } = await seedAcceptance(store), cell = input.cells[0]!, report = '<testsuite><testcase name="failed"><failure/></testcase></testsuite>'
    const test = parseExternalReport(Buffer.from(report), 'junit').tests[0]!
    const job = await externalPreview(service, { ...externalFixture(), report: Buffer.from(report).toString('base64'), declaration: { commit: input.commit, appId: cell.appId, platform: cell.platform, binarySha256: cell.binarySha256, build: cell.build }, bindings: [{ testId: test.id, logicalTestKey: cell.logicalTestKey, inputDigest: cell.inputDigest }] })
    await service.confirm(job.id, { reviewed: true, previewDigest: job.previewDigest })
    cell.externalResults = [{ assetId: job.assetId, testId: test.id }]
    const lease = await new CombinedAcceptanceSources(new NativeAcceptanceSources(store), service).acquire(input)
    try {
      const result = evaluateAcceptanceCell(input, cell, lease.sources, lease.external)
      expect(result.status).toBe('pass'); expect(result.externalResults?.[0]).toMatchObject({ reportedStatus: 'fail', availability: 'verified' })
      expect(evaluateAcceptanceCell(input, cell, new Map(), lease.external).status).toBe('incomplete')
      expect(evaluateAcceptanceCell(input, { ...cell, build: 'different' }, lease.sources, lease.external).reasons).toContain('external-source-unmatched')
    } finally { lease.release() }
  } finally { await service.close(); await store.close(); await rm(root, { recursive: true, force: true }) }
})
it('aborts an in-flight parser and drains staging on close without device context', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'external-cancel-'))), store = new WorkbenchStore(root)
  let entered = false, aborted = false
  const service = new WorkbenchExternalAssets(store, { adapters: [{ id: 'slow', version: '1', parse: async (_bytes, context, signal) => {
    expect(Object.keys(context).sort()).toEqual(['engine', 'engineVersion']); entered = true
    return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true }) })
  } }] })
  try {
    const job = await service.preview({ ...externalFixture(), adapter: 'slow' })
    await expect.poll(() => entered).toBe(true)
    await service.close(); expect(aborted).toBe(true)
    const reopened = new WorkbenchExternalAssets(store)
    try { expect((await reopened.getJob(job.id)).phase).toBe('cancelled') } finally { await reopened.close() }
    expect(await readdir(join(service.root, 'staging'))).toHaveLength(0)
  } finally { await service.close(); await store.close(); await rm(root, { recursive: true, force: true }) }
})
it.each(['after-staging', 'before-publish', 'after-publish'])('SIGKILL at %s never exposes half-published assets or replays parsers', async phase => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'external-crash-'))), store = new WorkbenchStore(root), service = new WorkbenchExternalAssets(store)
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/external-crash-child.ts', root, phase], { stdio: 'pipe' })
    let errors = ''; child.stderr.on('data', bytes => { errors += String(bytes) })
    const signal = await new Promise<string | null>((resolve, reject) => { child.once('error', reject); child.once('exit', (_code, signal) => resolve(signal)) })
    expect(signal, errors).toBe('SIGKILL')
    const request = JSON.parse(await readFile(join(root, 'test-request.json'), 'utf8'))
    const job = await service.getJob(request.requestKey)
    expect(job.phase).toBe(phase === 'after-publish' ? 'finished' : 'interrupted')
    expect((await service.list()).items).toHaveLength(phase === 'after-publish' ? 1 : 0)
    expect((await service.preview(request)).id).toBe(job.id)
    if (phase === 'after-publish') expect((await service.get(job.assetId)).availability).toBe('verified')
  } finally { await service.close(); await store.close(); await rm(root, { recursive: true, force: true }) }
}, 15_000)
