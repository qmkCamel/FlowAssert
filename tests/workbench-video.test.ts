import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig as Config } from '../src/mcp-config.js'
import { WorkbenchVideoArchive, VIDEO_MAX_BYTES } from '../src/workbench-video.js'
import type { TestRun } from '../src/workbench-store.js'
const demo = await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8')
const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('container-fixture-not-decoded')])
let viewer: ViewerServer, root: string
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'mirror-video-'))
  viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await viewer.service.start({ provider: 'mock' })
  const video = { captureId: randomUUID(), sessionId: viewer.service.state().sessionId, startedAt: new Date().toISOString() }
  const response = await fetch(`${viewer.url}/api/runs`, { method: 'POST', headers: { origin: viewer.url, 'content-type': 'application/json' }, body: JSON.stringify({ yaml: demo, localEvidence: true, video }) })
  expect(response.status).toBe(202)
  return await response.json() as TestRun
}
async function upload(run: TestRun, options: { headers?: Record<string, string>; body?: Buffer } = {}) {
  return fetch(`${viewer.url}/api/runs/${run.id}/video`, { method: 'POST', headers: { origin: viewer.url, 'content-type': 'video/webm', 'x-capture-id': run.video!.captureId, 'x-video-duration-ms': '500', 'x-video-reason': 'videoSaved', ...options.headers }, body: new Uint8Array(options.body ?? bytes) })
}
afterEach(async () => { vi.restoreAllMocks(); await viewer?.close(); if (root) await rm(root, { recursive: true, force: true }) })

it('archives independently of running manifest writes, retries idempotently, serves verified ranges and restores on restart', async () => {
  const run = await setup()
  expect((await upload(run)).status).toBe(200)
  await viewer.workbench.wait()
  const detail = await viewer.workbench.get(run.id)
  expect(detail).toMatchObject({ verdict: 'pass', video: { status: 'partial', durationMs: 500, file: { bytes: bytes.length } } })
  expect((await upload(run)).status).toBe(200)
  expect((await upload(run, { body: Buffer.concat([bytes, Buffer.from('changed')]) })).status).toBe(400)
  const url = `${viewer.url}/api/runs/${run.id}/artifacts/recording.webm`
  const range = await fetch(url, { headers: { range: 'bytes=2-7' } })
  expect(range.status).toBe(206); expect(range.headers.get('content-range')).toBe(`bytes 2-7/${bytes.length}`)
  expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(2, 8))
  expect((await fetch(url, { headers: { range: 'bytes=999-' } })).status).toBe(416)
  expect(Buffer.from(await (await fetch(url, { headers: { range: 'bytes=-4' } })).arrayBuffer())).toEqual(bytes.subarray(-4))
  await viewer.close()
  viewer = new ViewerServer(Config({ viewerPort: 0 }), { workbenchRoot: root }); await viewer.listen()
  expect(await viewer.workbench.get(run.id)).toMatchObject({ verdict: 'pass', video: { status: 'partial' } })
  expect((await fetch(`${viewer.url}/api/runs/${run.id}/artifacts/recording.webm`)).status).toBe(200)
}, 15000)

it('rejects cross origin, wrong binding, format, metadata and empty payload', async () => {
  const run = await setup()
  for (const headers of [{ origin: 'https://untrusted.invalid' }, { 'x-capture-id': randomUUID() }, { 'content-type': 'text/plain' }, { 'x-video-duration-ms': '-1' }, { 'x-video-reason': 'arbitrary' }, { 'x-video-reason': 'run-finished', 'x-video-duration-ms': '1' }]) expect((await upload(run, { headers })).ok).toBe(false)
  expect((await upload(run, { body: Buffer.alloc(0) })).ok).toBe(false)
  expect((await upload(run, { body: Buffer.from('not a video') })).ok).toBe(false)
  const response = await fetch(`${viewer.url}/api/runs`, { method: 'POST', headers: { origin: viewer.url, 'content-type': 'application/json' }, body: JSON.stringify({ yaml: demo, localEvidence: true, video: { ...run.video, sessionId: 'different' } }) })
  expect(response.ok).toBe(false)
}, 15000)

it('refuses corrupted media without changing the declared UI verdict', async () => {
  const run = await setup(); await upload(run); await viewer.workbench.wait()
  await writeFile(join(root, run.id, 'recording.webm'), Buffer.concat([bytes, Buffer.from('corrupt')]))
  expect((await fetch(`${viewer.url}/api/runs/${run.id}/artifacts/recording.webm`)).ok).toBe(false)
  expect((await viewer.workbench.get(run.id)).verdict).toBe('pass')
  await writeFile(join(root, run.id, 'video.json'), '{}')
  expect((await viewer.workbench.get(run.id)).video?.status).toBe('unavailable')
}, 15000)

it('reports missing recording after restart and preserves old runs without video', async () => {
  const run = await setup(); await viewer.workbench.wait(); await viewer.close()
  viewer = new ViewerServer(Config({ viewerPort: 0 }), { workbenchRoot: root }); await viewer.listen()
  expect(await viewer.workbench.get(run.id)).toMatchObject({ verdict: 'pass', video: { status: 'unavailable' } })
  const stored = await viewer.workbench.store.get(run.id); delete stored.video; await viewer.workbench.store.save(stored)
  expect((await viewer.workbench.get(run.id)).video).toBeUndefined()
}, 15000)

it('retries index write failure without replacing bytes or breaking executor evidence', async () => {
  const run = await setup()
  vi.spyOn(viewer.workbench.store, 'saveVideoIndex').mockRejectedValueOnce(new Error('disk fixture'))
  expect((await upload(run)).ok).toBe(false)
  expect((await upload(run)).ok).toBe(true)
  await viewer.workbench.wait()
  expect(await viewer.workbench.get(run.id)).toMatchObject({ verdict: 'pass', video: { status: 'partial' } })
}, 15000)

it('bounds and serializes uploads before allocating the video body', async () => {
  const run = await setup()
  const archive = new WorkbenchVideoArchive(viewer.workbench.store)
  const request = (await import('node:stream')).Readable.from([bytes]) as unknown as import('node:http').IncomingMessage
  request.headers = { 'content-type': 'video/webm', 'x-capture-id': run.video!.captureId, 'x-video-duration-ms': '500', 'x-video-reason': 'videoSaved', 'content-length': String(VIDEO_MAX_BYTES + 1) }
  await expect(archive.upload(run, request)).rejects.toThrow('limit')
  delete request.headers['content-length']
  let release!: () => void
  const save = viewer.workbench.store.saveVideoIndex.bind(viewer.workbench.store)
  vi.spyOn(viewer.workbench.store, 'saveVideoIndex').mockImplementation(async (...args) => { await new Promise<void>((resolve) => { release = resolve }); await save(...args) })
  const pending = archive.upload(run, request)
  await expect.poll(() => Boolean(release)).toBe(true)
  await expect(archive.upload(run, request)).rejects.toThrow('in progress')
  release(); await pending
}, 15000)

it('aborts an unfinished upload before releasing the archive owner', async () => {
  const run = await setup()
  const archive = new WorkbenchVideoArchive(viewer.workbench.store)
  const request = new (await import('node:stream')).PassThrough() as unknown as import('node:http').IncomingMessage
  request.headers = { 'content-type': 'video/webm', 'x-capture-id': run.video!.captureId, 'x-video-duration-ms': '500', 'x-video-reason': 'videoSaved' }
  const pending = archive.upload(run, request).catch((error: Error) => error.message)
  await archive.close()
  expect(await pending).toContain('shutting down')
  await expect(archive.upload(run, request)).rejects.toThrow('closed')
  expect(await viewer.workbench.store.readVideoIndex(run.id)).toBeUndefined()
}, 15000)
