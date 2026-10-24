import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { matrixFixture } from './fixtures/matrix-fixture.js'
import { LocalDeviceMatrix } from '../src/device-matrix.js'
import { WorkbenchStore } from '../src/workbench-store.js'
import { MatrixProcess } from '../src/device-matrix-process.js'
import { MatrixAcceptanceSources } from '../src/device-matrix-sources.js'
import { writeAcceptance } from '../src/workbench-change-storage.js'
import { matrixExitCode } from '../src/device-matrix-contracts.js'
import { loadTestProject } from '../src/workbench-project.js'
import sharp from 'sharp'

it('validates the exact snapshot after a concurrent edit, before any device claim or action', async () => {
  const f = await matrixFixture(), validate = f.matrix.validate.bind(f.matrix)
  try {
    vi.spyOn(f.matrix, 'validate').mockImplementation(async id => {
      const result = await validate(id)
      await writeFile(join(f.root, 'flow.yaml'), 'name: Unsafe edit\nplatform: ios\nappId: com.example.mobilemirror.mock\nprepare: [{ref: undeclared}]\n---\n- assertVisible: {text: Ready}\n- done\n')
      return result
    })
    await expect(f.matrix.start('smoke', 'START smoke')).rejects.toThrow('namespace-unbound')
    expect(await f.matrix.list()).toEqual([])
  } finally { await f.close() }
})

it('requires cleanup for side-effect fixtures even when their namespace is bound', async () => {
  const f = await matrixFixture()
  try {
    await writeFile(join(f.root, 'prepare.mjs'), 'export default async () => ({})')
    await writeFile(f.projectPath, JSON.stringify({ flows: { example: 'flow.yaml' }, extensions: { prepare: { module: 'prepare.mjs', role: 'prepare', input: { type: 'object' }, output: { type: 'object' } } } }))
    await writeFile(join(f.root, 'flow.yaml'), 'name: Unsafe fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\nparams: {matrixNamespace: {type: string}}\nprepare: [{ref: prepare, args: {namespace: "${params.matrixNamespace}"}}]\n---\n- assertVisible: {text: Ready}\n- done\n')
    await expect(f.matrix.start('smoke', 'START smoke')).rejects.toThrow('cleanup-required')
    expect(await f.matrix.list()).toEqual([])
  } finally { await f.close() }
})

it.each(['low', 'unknown'])('rejects %s capacity before spawning any child', async mode => {
  const f = await matrixFixture(), store = new WorkbenchStore(join(f.root, 'capacity'), async () => { if (mode === 'unknown') throw Error('unknown'); return 256 * 1024 * 1024 })
  const matrix = new LocalDeviceMatrix(store, f.projectPath, f.registryPath)
  try { await expect(matrix.start('smoke', 'START smoke')).rejects.toThrow('storage-'); expect(await matrix.list()).toEqual([]) }
  finally { await matrix.close(); await store.close(); await f.close() }
})

it('serializes shared fixture keys across children and preserves FIFO within each slot', async () => {
  const f = await matrixFixture(0.3)
  try {
    for (const c of f.registry.plans.smoke!.cells) c.fixture.resourceKeys = ['exclusive-account']
    await writeFile(f.registryPath, JSON.stringify(f.registry))
    const start = await f.matrix.start('smoke', 'START smoke'); await f.matrix.wait()
    const result = await f.matrix.get(start.id); expect(result.exitCode, JSON.stringify(result)).toBe(0)
    const attempts = result.cells.flatMap(c => c.attempts).sort((a, b) => a.startedAt!.localeCompare(b.startedAt!))
    for (let i = 1; i < attempts.length; i++) expect(Date.parse(attempts[i]!.startedAt!)).toBeGreaterThanOrEqual(Date.parse(attempts[i - 1]!.endedAt!))
    for (const slot of ['one', 'two']) expect(attempts.filter(a => result.cells.find(c => c.attempts.includes(a))!.slotId === slot).map(a => result.cells.find(c => c.attempts.includes(a))!.id)).toEqual([`${slot}-1`, `${slot}-2`])
  } finally { await f.close() }
}, 60000)

it('quarantines a disconnected fake Appium slot without migration or retry, while the other Mock completes', async () => {
  const f = await matrixFixture(); let sessions = 0, commands = 0, capabilities: any
  const png = (await sharp({ create: { width: 390, height: 844, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64')
  const server = createServer(async (req, res) => {
    let body = ''; for await (const b of req) body += b
    res.setHeader('content-type', 'application/json')
    if (req.url === '/session' && req.method === 'POST') { sessions++; capabilities = JSON.parse(body).capabilities.alwaysMatch; res.end(JSON.stringify({ value: { sessionId: 'fake-android', capabilities: { platformName: 'Android' } } })); return }
    if (req.url === '/status') { res.end(JSON.stringify({ value: { ready: true } })); return }
    if (req.method === 'DELETE') { res.end(JSON.stringify({ value: null })); return }
    if (req.url?.endsWith('/screenshot')) { res.end(JSON.stringify({ value: png })); return }
    if (req.url?.endsWith('/window/rect')) { res.end(JSON.stringify({ value: { x: 0, y: 0, width: 390, height: 844 } })); return }
    if (req.url?.endsWith('/orientation')) { res.end(JSON.stringify({ value: 'PORTRAIT' })); return }
    commands++; res.statusCode = 404; res.end(JSON.stringify({ value: { error: 'invalid session id', message: 'injected disconnect' } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const slot = f.registry.slots[0]!; slot.platform = 'android'; slot.provider = 'appium'; slot.config = { appiumUrl: `http://127.0.0.1:${(server.address() as any).port}`, appiumRuntimeMode: 'external' }
    await writeFile(join(f.root, 'android.yaml'), 'name: Android disconnect\nplatform: android\nappId: example.android\n---\n- assertVisible: {text: Present}\n- done\n')
    await writeFile(f.projectPath, JSON.stringify({ flows: { example: 'flow.yaml', android: 'android.yaml', reset: 'flow.yaml' } }))
    f.registry.plans.smoke!.cells.filter(c => c.slotId === 'one').forEach(c => { c.flow = 'android' })
    await writeFile(f.registryPath, JSON.stringify(f.registry))
    const start = await f.matrix.start('smoke', 'START smoke'); await f.matrix.wait()
    const result = await f.matrix.get(start.id)
    expect(sessions).toBe(1); expect(commands).toBeGreaterThan(0)
    expect(result.cells[0]!.attempts[0]!.runId, JSON.stringify(result)).toBeTruthy()
    expect(capabilities).toMatchObject({ 'appium:udid': slot.udid, 'appium:systemPort': slot.ports.driver, 'appium:mjpegServerPort': slot.ports.mjpeg })
    expect(result.cells.find(c => c.id === 'one-2')!.attempts[0]!.status).toBe('blocked')
    expect(result.cells.filter(c => c.slotId === 'two').every(c => c.attempts[0]!.status === 'pass'), JSON.stringify(result)).toBe(true)
    expect(result.exitCode).not.toBe(0)
  } finally { await f.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
}, 60000)

it('rejects duplicate, wrong-generation and forged replies on private IPC', async () => {
  const f = await matrixFixture(), child = new MatrixProcess(randomUUID(), 'one', randomUUID())
  try {
    await child.identity()
    let sent: any
    const send = child.child.send.bind(child.child)
    vi.spyOn(child.child, 'send').mockImplementation(((message: any, ...args: any[]) => { sent = message; return (send as any)(message, ...args) }) as any)
    const prepare = child.request('prepare', randomUUID(), { invalid: true }, 2000)
    child.child.emit('message', { ...sent, generation: randomUUID(), payload: { ok: true, value: 'forged' } })
    await expect(prepare).rejects.toThrow('operation-failed')
    // Sequence 1 already consumed. An otherwise valid replay cannot acquire a device.
    const project = await loadTestProject(f.projectPath)
    child.child.send({ ...sent, requestId: randomUUID(), payload: { root: join(f.root, 'unused'), slot: f.registry.slots[0], project, projectDigest: 'ignored', cells: [], retry: false } })
    await expect(child.request('connect', randomUUID(), {}, 2000)).rejects.toThrow('operation-failed')
  } finally { await child.close(randomUUID()).catch(() => {}); await f.close() }
}, 20000)

it('never replaces matrix-bound evidence with a native source of the same run id', async () => {
  const id = randomUUID(), sources = new Map([[id, {} as any]])
  const resolver = new MatrixAcceptanceSources({ acquire: async () => ({ sources, release() {} }) }, { status: async () => ({ cells: [] }) } as any)
  const lease = await resolver.acquire({ cells: [{ runId: id, historyRunIds: [], matrixCell: { matrixId: randomUUID(), cellId: 'missing', attemptId: id } }] } as any)
  expect(lease.sources.has(id)).toBe(false); lease.release()
})

it('keeps historical failure higher priority than successful retry, missing evidence, and cancellation', () => {
  expect(matrixExitCode({ cells: [{ attempts: [{ status: 'fail' }, { status: 'pass' }, { status: 'incomplete' }, { status: 'cancelled' }] }], slots: [] } as any)).toBe(1)
})

it('recovers persisted interruption without replay and refuses cleanup-unconfirmed retry', async () => {
  const f = await matrixFixture()
  try {
    const start = await f.matrix.start('smoke', 'START smoke'); await f.matrix.wait()
    const state = await f.matrix.status(start.id); state.phase = 'running'; state.cells[0]!.attempts[0]!.phase = 'running'; state.slots[0]!.phase = 'running'; state.slots[0]!.cleanupConfirmed = false
    await writeAcceptance(join(f.matrix.root, start.id, 'state.json'), state, true)
    await f.matrix.close(); await f.store.close()
    const store = new WorkbenchStore(f.store.root), recovered = new LocalDeviceMatrix(store, f.projectPath, f.registryPath)
    try {
      const result = await recovered.get(start.id)
      expect(result).toMatchObject({ phase: 'finished', error: 'matrix-interrupted-no-automatic-replay', exitCode: 2 })
      expect(result.cells[0]!.attempts).toHaveLength(1)
      await expect(recovered.retry(start.id, 'one-1', `RETRY ${start.id} one-1`)).rejects.toThrow('cleanup-unconfirmed')
      expect((await readdir(join(f.matrix.root, start.id))).filter(n => n.startsWith('result-'))).toEqual(['result-1.json'])
    } finally { await recovered.close(); await store.close() }
  } finally { await f.close() }
}, 60000)

it('reports terminal disk publication failure without advertising success or replacing old results', async () => {
  const f = await matrixFixture(0.5)
  try {
    const start = await f.matrix.start('smoke', 'START smoke')
    await mkdir(join(f.matrix.root, start.id, 'result-1.json')) // deterministic publication fault
    await f.matrix.wait()
    const state = await f.matrix.get(start.id)
    expect(state).toMatchObject({ phase: 'finished', exitCode: 2, error: 'matrix-terminal-persistence-failed' })
    await expect(f.matrix.retry(start.id, 'one-1', `RETRY ${start.id} one-1`)).rejects.toThrow('cleanup-unconfirmed')
  } finally { await f.close() }
}, 60000)
