import { createServer } from 'node:http'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import prepare from '../examples/business-http/prepare.mjs'
import verify from '../examples/business-http/verify.mjs'
import cleanup from '../examples/business-http/cleanup.mjs'
import { loadTestProject } from '../src/workbench-project.js'
import { compilePlan } from '../src/workbench-plan.js'

const servers = [], directories = []
const originalToken = process.env.MOBILE_MIRROR_HTTP_TOKEN
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve))
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  if (originalToken === undefined) delete process.env.MOBILE_MIRROR_HTTP_TOKEN
  else process.env.MOBILE_MIRROR_HTTP_TOKEN = originalToken
})

async function fixture({ unknownWrite = false, cleanupFailure = false, oversizedRead = false } = {}) {
  const state = { writes: [], deletes: [], reads: [], ids: new Set(), polls: new Map() }
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const id = path.split('/').at(-1)
    if (request.headers.authorization !== 'Bearer test-only-token' || request.headers['x-correlation-id'] !== id) { response.writeHead(401).end(); return }
    if (request.method === 'PUT' && path.startsWith('/test/fixtures/')) {
      state.writes.push(id); state.ids.add(id)
      if (unknownWrite) { request.socket.destroy(); return }
      response.writeHead(201).end(); return
    }
    if (request.method === 'GET' && path.startsWith('/test/jobs/')) {
      state.reads.push(id)
      const count = (state.polls.get(id) ?? 0) + 1; state.polls.set(id, count)
      response.writeHead(state.ids.has(id) ? 200 : 404, { 'content-type': 'application/json' })
      response.end(oversizedRead ? JSON.stringify({ status: 'complete', padding: 'x'.repeat(17 * 1024) })
        : JSON.stringify(count === 1 ? { status: 'pending' } : { status: 'complete', amountCents: 1200 }))
      return
    }
    if (request.method === 'DELETE' && path.startsWith('/test/fixtures/')) {
      state.deletes.push(id)
      if (cleanupFailure) { response.writeHead(500).end(); return }
      state.ids.delete(id); response.writeHead(204).end(); return
    }
    if (request.method === 'GET' && path.startsWith('/test/fixtures/')) { response.writeHead(state.ids.has(id) ? 200 : 404).end(); return }
    response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  process.env.MOBILE_MIRROR_HTTP_TOKEN = 'test-only-token'
  return { base: `http://127.0.0.1:${server.address().port}`, state }
}

describe('trusted run-scoped HTTP business template', () => {
  it('loads the public project example and compiles its registered flow without a device', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mirror-business-template-')); directories.push(directory)
    for (const name of ['prepare.mjs', 'verify.mjs', 'cleanup.mjs']) await copyFile(new URL(`../examples/business-http/${name}`, import.meta.url), join(directory, name))
    await copyFile(new URL('../examples/business-http/project.json.example', import.meta.url), join(directory, 'project.json'))
    await copyFile(new URL('../examples/business-http/order.yaml.example', import.meta.url), join(directory, 'order.yaml'))
    const project = await loadTestProject(join(directory, 'project.json'))
    const plan = await compilePlan(project.flows.order, project)
    expect(plan.header.appId).toBe('com.example.testapp')
    expect(plan.header.verify).toHaveLength(1)
  })

  it('polls an asynchronous positive and negative business result, then cleans only its own resource', async () => {
    const { base, state } = await fixture()
    const registered = []
    const prepared = await prepare({ base, namespace: 'trial' }, { registerCleanup: async token => registered.push(token) })
    expect(prepared.correlationId).toBe(prepared.id)
    expect(registered).toEqual([{ base, id: prepared.id }])
    expect(await verify({ base, id: prepared.id, expectedAmount: 1200 })).toMatchObject({ verdict: 'pass', actual: '1200' })
    expect(await verify({ base, id: prepared.id, expectedAmount: 999 })).toMatchObject({ verdict: 'fail', expected: '999', actual: '1200' })
    expect(await cleanup(registered[0])).toEqual({ deleted: true })
    expect(state.writes).toEqual([prepared.id])
    expect(state.deletes).toEqual([prepared.id])
    expect(state.ids.size).toBe(0)
  })

  it('does not replay an uncertain write; the pre-registered cleanup token remains usable', async () => {
    const { base, state } = await fixture({ unknownWrite: true })
    const registered = []
    await expect(prepare({ base, namespace: 'trial' }, { registerCleanup: async token => registered.push(token) })).rejects.toThrow()
    expect(state.writes).toHaveLength(1)
    expect(registered).toHaveLength(1)
    await expect(cleanup(registered[0])).resolves.toEqual({ deleted: true })
    expect(state.ids.size).toBe(0)
  })

  it('keeps cleanup failures explicit and bounds verifier response bytes', async () => {
    const { base, state } = await fixture({ cleanupFailure: true, oversizedRead: true })
    const prepared = await prepare({ base, namespace: 'trial' }, { registerCleanup: async () => {} })
    await expect(verify({ base, id: prepared.id, expectedAmount: 1200 })).rejects.toThrow(/16 KiB/)
    await expect(cleanup({ base, id: prepared.id })).rejects.toThrow(/Scoped cleanup HTTP 500/)
    expect(state.deletes).toEqual([prepared.id])
    expect(state.ids.has(prepared.id)).toBe(true)
  })
})
