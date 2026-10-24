import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { expect, it } from 'vitest'
import { matrixRegistrySchema } from '../src/device-matrix-contracts.js'
import { preflightMatrixResources } from '../src/device-matrix-preflight.js'
import { DeviceOwnerClaim } from '../src/device-owner-claim.js'
import { matrixFixture } from './fixtures/matrix-fixture.js'
it('rejects repeated devices, ports, unsafe fixtures and occupied ports without killing their owner', async () => {
  const f = await matrixFixture()
  try {
    const bad = structuredClone(f.registry); bad.slots[1]!.udid = bad.slots[0]!.udid.toUpperCase()
    expect(() => matrixRegistrySchema.parse(bad)).toThrow('resource-conflict')
    const unsafe = structuredClone(f.registry); unsafe.plans.smoke!.cells[0]!.fixture.parallelSafe = false
    expect(() => matrixRegistrySchema.parse(unsafe)).toThrow('unsafe')
    const s = createServer(); await new Promise<void>(resolve => s.listen(f.registry.slots[0]!.ports.driver, '127.0.0.1', resolve))
    try { await expect(preflightMatrixResources(f.registry)).rejects.toThrow('preflight'); expect(s.listening).toBe(true) } finally { await new Promise<void>(resolve => s.close(() => resolve())) }
  } finally { await f.close() }
})
it('runs real dual Mock child processes in isolated stores, preserves references and detects missing bytes offline', async () => {
  const f = await matrixFixture()
  try {
    const started = await f.matrix.start('smoke', 'START smoke'); await f.matrix.wait()
    const result = await f.matrix.get(started.id)
    expect(result, JSON.stringify(result)).toMatchObject({ phase: 'finished', exitCode: 0 })
    expect(new Set(result.slots.map(s => s.pid)).size).toBe(2)
    expect(new Set(result.slots.map(s => s.storeId)).size).toBe(2)
    expect(result.cells.every(c => c.attempts[0]!.status === 'pass')).toBe(true)
    const first = result.cells[0]!.attempts[0]!
    const run = await f.matrix.readAttempt(started.id, first)
    expect(run.run.id).toBe(first.id)
    const reference = await readFile(join(f.matrix.root, started.id, 'stores', first.storeId, 'references', `${first.referenceId}.json`), 'utf8')
    expect(JSON.parse(reference).consumerKind).toBe('matrix:attempt')
    await f.matrix.retry(started.id, result.cells[0]!.id, `RETRY ${started.id} ${result.cells[0]!.id}`); await f.matrix.wait()
    const retried = await f.matrix.get(started.id)
    expect(retried.exitCode, JSON.stringify(retried)).toBe(0); expect(retried.cells[0]!.attempts).toHaveLength(2)
    expect(retried.cells[0]!.attempts[0]).toEqual(first)
    const file = run.run.steps[0]!.evidence[0]!
    await writeFile(join(f.matrix.root, started.id, 'stores', first.storeId, first.runId!, file.name), 'damaged')
    expect((await f.matrix.get(started.id)).exitCode).toBe(2)
    expect(JSON.parse(await readFile(join(f.matrix.root, started.id, 'result-1.json'), 'utf8')).value.exitCode).toBe(0)
  } finally { await f.close() }
}, 60000)
it('honors existing device claims before creating any business runs', async () => {
  const f = await matrixFixture(), slot = f.registry.slots[1]!, lease = await new DeviceOwnerClaim().acquire(slot.platform, slot.udid)
  try {
    const started = await f.matrix.start('smoke', 'START smoke'); await f.matrix.wait()
    const result = await f.matrix.get(started.id)
    expect(result.exitCode).toBe(2); expect(result.cells.every(c => c.attempts.every(a => !a.runId))).toBe(true)
  } finally { await lease.release(); await f.close() }
}, 60000)
it('cancels one slot while the other completes without crossed attempts', async () => {
  const f = await matrixFixture(1)
  try {
    const started = await f.matrix.start('smoke', 'START smoke')
    await expect.poll(async () => (await f.matrix.status(started.id)).cells[0]?.attempts[0]?.phase, { timeout: 20000 }).toBe('running')
    await f.matrix.cancel(started.id, 'one'); await f.matrix.wait()
    const result = await f.matrix.get(started.id)
    expect(result.cells.filter(c => c.slotId === 'two').every(c => c.attempts[0]!.status === 'pass'), JSON.stringify(result)).toBe(true)
    expect(result.exitCode).not.toBe(0)
    expect(result.cells.find(c => c.id === 'one-2')!.attempts[0]!.status).toBe('cancelled')
  } finally { await f.close() }
}, 60000)
