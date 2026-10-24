import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'

let root: string | null = null, viewer: ViewerServer | null = null
afterEach(async () => { await viewer?.close(); if (root) await rm(root, { recursive: true, force: true }); viewer = null; root = null })

it('freezes run/share/retention/trend HTTP shapes and central same-origin checks', async () => {
  root = await mkdtemp(join(tmpdir(), 'mirror-http-golden-'))
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await viewer.service.start({ provider: 'mock' })
  const yaml = await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8')
  const post = (path: string, body: unknown, origin = viewer!.url) => fetch(`${viewer!.url}${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const created = await post('/api/runs', { yaml, localEvidence: true })
  expect(created.status).toBe(202)
  const id = (await created.json()).id as string
  let run: any
  for (let attempt = 0; attempt < 100; attempt++) {
    run = await fetch(`${viewer.url}/api/runs/${id}`).then(response => response.json())
    if (run.phase === 'finished') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(run).toMatchObject({ id, phase: 'finished', verdict: 'pass', resultProjection: { reportedVerdict: 'pass', verdict: 'pass', exitCode: 0, evidenceAvailability: 'verified' } })
  const listed = await fetch(`${viewer.url}/api/runs`).then(response => response.json())
  expect(Object.keys(listed).sort()).toEqual(['activeId', 'runs', 'webTests'])
  expect(listed.webTests).toEqual({ enabled: false, target: 'synthetic-viewer', scenarioVersion: 1 })
  expect(listed.runs[0]).toMatchObject({ id, source: 'viewer', verdict: 'pass' })
  const artifact = await fetch(`${viewer.url}/api/runs/${id}/artifacts/step-1.png`)
  expect(artifact.status).toBe(200)
  expect(artifact.headers.get('content-type')).toBe('image/png')
  expect((await artifact.arrayBuffer()).byteLength).toBeGreaterThan(0)
  const retention = await fetch(`${viewer.url}/api/workbench/retention`)
  expect(retention.status).toBe(200)
  expect(Object.keys(await retention.json()).sort()).toEqual(['categories', 'generation', 'liveBytes', 'runs', 'scan', 'trash', 'trashBytes'])
  const repairId = '11111111-1111-4111-8111-111111111111'
  expect((await fetch(`${viewer.url}/api/workbench/repairs/${repairId}`, { headers: { origin: viewer.url } })).status).toBe(404)
  expect((await fetch(`${viewer.url}/api/workbench/repairs/${repairId}`, { headers: { origin: 'https://other.example' } })).status).toBe(400)
  const repairs = await fetch(`${viewer.url}/api/workbench/repairs?limit=10`, { headers: { origin: viewer.url } })
  expect(repairs.status).toBe(200)
  expect(await repairs.json()).toEqual({ items: [] })
  const mutation = { requestId: repairId, sourceRunId: id, baselineRunId: id, flowId: 'demo' }
  expect((await post('/api/workbench/repairs', mutation, 'https://other.example')).status).toBe(400)
  expect((await fetch(`${viewer.url}/api/workbench/repairs`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(mutation) })).status).toBe(400)
  expect((await post('/api/workbench/repairs', { ...mutation, extra: 'x' })).status).toBe(400)
  expect((await post('/api/workbench/repairs', { ...mutation, extra: 'x'.repeat(5000) })).status).toBe(400)
  expect((await post('/api/workbench/repairs', mutation)).status).toBe(404)
  const job = await post('/api/workbench/share/jobs', { kind: 'share-preview', requestId: 'http-golden-preview', runId: id, files: [{ name: 'step-1.png' }] })
  expect(job.status).toBe(202)
  const jobId = (await job.json()).jobId as string
  let status: any
  for (let attempt = 0; attempt < 100; attempt++) {
    status = await fetch(`${viewer.url}/api/workbench/share/jobs/${jobId}`).then(response => response.json())
    if (status.phase === 'awaiting-review') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(status).toMatchObject({ jobId, kind: 'share-preview', phase: 'awaiting-review' })
  const preview = await fetch(`${viewer.url}/api/workbench/share/jobs/${jobId}/result`).then(response => response.json())
  expect(preview).toMatchObject({ reviewToken: expect.any(String), digest: expect.any(String), files: [{ sourceName: 'step-1.png', kind: 'image' }] })
  const legacy = await post('/api/workbench/share/preview', { runId: id, files: [{ name: 'step-1.png' }] })
  expect(legacy.status).toBe(200)
  expect(await legacy.json()).toMatchObject({ digest: preview.digest, files: [{ sourceName: 'step-1.png' }] })
  for (const path of ['/api/runs', '/api/workbench/share/jobs', '/api/workbench/retention', '/api/workbench/trends', '/api/workbench/baselines']) {
    const denied = await fetch(`${viewer.url}${path}`, { headers: { origin: 'https://other.example' } })
    expect(denied.status, path).toBe(400)
  }
  expect((await post('/api/workbench/retention/plan', { olderThanDays: 30, maxRuns: 1 }, 'https://other.example')).status).toBe(400)
}, 30_000)
