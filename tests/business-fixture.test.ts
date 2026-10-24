import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startFixtureServer } from '../fixtures/business/server.js'
import { createFixtureProject } from '../fixtures/business/project.js'
import { loadTestProject } from '../src/workbench-project.js'
import { executeExtension } from '../src/workbench-extensions.js'
import { compilePlan } from '../src/workbench-plan.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-business-')); roots.push(root)
  const database = join(root, 'orders.sqlite')
  const server = await startFixtureServer({ database, port: 0 })
  return { root, database, server, base: `http://127.0.0.1:${server.port}` }
}
const json = (method: string) => ({ method, headers: { 'content-type': 'application/json' }, body: '{}' })
describe('real business fixture backend', () => {
  it('delays only submissions without blocking health and never creates missing fixtures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-business-delay-')); roots.push(root)
    const service = await startFixtureServer({ database: join(root, 'orders.sqlite'), port: 0, submissionDelayMs: 500 })
    const base = `http://127.0.0.1:${service.port}`
    try {
      let finished = false
      const pending = fetch(`${base}/app/orders/${randomUUID()}`, json('POST')).then(response => { finished = true; return response })
      expect((await fetch(`${base}/health`)).status).toBe(200)
      expect(finished).toBe(false)
      expect((await pending).status).toBe(404)
    } finally { await service.close() }
  })
  it('only app submission creates a persisted order; restart reads it and cleanup cascades', async () => {
    const { database, server, base } = await fixture(); const id = randomUUID(); let closed = false
    try {
      expect((await fetch(`${base}/app/orders/${id}`, json('POST'))).status).toBe(404)
      expect((await fetch(`${base}/test/fixtures/${id}`, json('PUT'))).status).toBe(200)
      expect((await fetch(`${base}/test/orders/${id}`)).status).toBe(404)
      for (let i = 0; i < 2; i++) expect((await fetch(`${base}/app/orders/${id}`, json('POST'))).status).toBe(200)
      await server.close(); closed = true
      const restarted = await startFixtureServer({ database, port: 0 }); const url = `http://127.0.0.1:${restarted.port}`
      try {
        expect(await (await fetch(`${url}/test/orders/${id}`)).json()).toEqual({ fixtureId: id, id: `order-${id}`, sku: 'fixture-item', quantity: 1, amountCents: 1200, status: 'submitted' })
        for (let i = 0; i < 2; i++) expect((await fetch(`${url}/test/fixtures/${id}`, { method: 'DELETE' })).status).toBe(200)
        for (const route of ['orders', 'fixtures']) expect((await fetch(`${url}/test/${route}/${id}`)).status).toBe(404)
      } finally { await restarted.close() }
    } finally { if (!closed) await server.close() }
  })
  it('isolates runs and rejects browser origins, invalid payloads and unknown IDs', async () => {
    const { server, base } = await fixture(); const a = randomUUID(), b = randomUUID()
    try {
      for (const id of [a,b]) await fetch(`${base}/test/fixtures/${id}`, json('PUT'))
      await fetch(`${base}/test/fixtures/${a}`, { method: 'DELETE' })
      expect((await fetch(`${base}/test/fixtures/${b}`)).status).toBe(200)
      expect((await fetch(`${base}/test/fixtures/${b}`, { ...json('PUT'), body: '{' })).status).toBe(400)
      expect((await fetch(`${base}/test/fixtures/${b}`, { ...json('PUT'), body: '{"amount":1}' })).status).toBe(400)
      expect((await fetch(`${base}/test/fixtures/${b}`, { headers: { origin: 'https://untrusted.example' } })).status).toBe(403)
      expect((await fetch(`${base}/test/fixtures/not-an-id`)).status).toBe(404)
    } finally { await server.close() }
  })
  it('generates registered projects for both platforms', async () => {
    const { root, server, base } = await fixture()
    try { for (const platform of ['android', 'ios'] as const) {
      const path = await createFixtureProject(join(root, platform), platform, base, base)
      const project = await loadTestProject(path)
      expect((await compilePlan(project.flows.order!, project)).header.platform).toBe(platform)
      expect((await compilePlan(project.flows.order!, project, { expectedAmount: 999 })).params.expectedAmount).toBe(999)
    } } finally { await server.close() }
  })
  it('runs actual registered prepare/verify/cleanup modules and rejects missing/wrong business truth', async () => {
    const { root, server, base } = await fixture()
    try {
      const project = await loadTestProject(await createFixtureProject(join(root, 'project'), 'android', base, base))
      const tokens: unknown[] = []
      const call = (name: string, args: unknown) => executeExtension(project.extensions[name]!, args, new AbortController().signal, async token => { tokens.push(token) })
      const { id } = await call('seed', { base }) as { id: string }
      expect(tokens).toEqual([{ base, id }])
      expect(await call('verify', { base, id, expectedAmount: 1200 })).toMatchObject({ verdict: 'fail' })
      await fetch(`${base}/app/orders/${id}`, json('POST'))
      expect(await call('verify', { base, id, expectedAmount: 1200 })).toMatchObject({ verdict: 'pass' })
      expect(await call('verify', { base, id, expectedAmount: 999 })).toMatchObject({ verdict: 'fail' })
      expect(await call('cleanup', tokens[0])).toEqual({ deleted: true })
      expect((await fetch(`${base}/test/orders/${id}`)).status).toBe(404)
    } finally { await server.close() }
  })
})
