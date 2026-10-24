import { expect, it } from 'vitest'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { matrixFixture } from './fixtures/matrix-fixture.js'
import { DeviceOwnerClaim, processIdentity } from '../src/device-owner-claim.js'
import type { MatrixState } from '../src/device-matrix-contracts.js'

it.each([false, true])('SIGKILL child quarantines its slot and poisons unresolved shared resources=%s without replay', async shared => {
  const f = await matrixFixture(1)
  let killedPid: number | undefined
  try {
    if (shared) for (const cell of f.registry.plans.smoke!.cells) if (['one-1', 'two-2'].includes(cell.id)) cell.fixture.resourceKeys = ['shared-resource']
    await writeFile(f.registryPath, JSON.stringify(f.registry))
    const start = await f.matrix.start('smoke', 'START smoke')
    await expect.poll(async () => (await f.matrix.status(start.id)).cells[0]!.attempts[0]!.phase, { timeout: 20000 }).toBe('running')
    killedPid = (await f.matrix.status(start.id)).slots[0]!.pid!
    process.kill(killedPid, 'SIGKILL'); await f.matrix.wait()
    const result = await f.matrix.get(start.id)
    expect(result.slots[0]).toMatchObject({ phase: 'quarantined', cleanupConfirmed: false })
    expect(result.cells.find(c => c.id === 'one-2')!.attempts[0]!.status).toBe('blocked')
    expect(result.cells.find(c => c.id === 'two-1')!.attempts[0]!.status).toBe('pass')
    expect(result.cells.find(c => c.id === 'two-2')!.attempts[0]!.status).toBe(shared ? 'blocked' : 'pass')
    await expect(f.matrix.retry(start.id, 'one-1', `RETRY ${start.id} one-1`)).rejects.toThrow('cleanup-unconfirmed')
    await expect(new DeviceOwnerClaim().acquire('ios', f.registry.slots[0]!.udid)).rejects.toThrow('safely reclaimed')
  } finally {
    await f.close()
    // Only the exact synthetic test device, matching the process killed above.
    const udid = f.registry.slots[0]!.udid, key = createHash('sha256').update(`ios\0${udid}`).digest('hex')
    const path = join(homedir(), '.local/share/mobile-mirror/device-claims', `${key}.json`)
    const record = await readFile(path, 'utf8').then(JSON.parse, () => null)
    if (record?.pid === killedPid && udid.startsWith('mock-') && await processIdentity(killedPid!) === null) await rm(path)
  }
}, 60000)

it('SIGKILL parent closes its children through IPC loss; restart records interruption without dispatching again', async () => {
  const f = await matrixFixture(3)
  const parent = fork(new URL('./fixtures/matrix-parent.ts', import.meta.url), [f.store.root, f.projectPath, f.registryPath], { execArgv: ['--import', import.meta.resolve('tsx')], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  try {
    const [state] = await once(parent, 'message') as [MatrixState]
    const exited = once(parent, 'exit'); parent.kill('SIGKILL'); await exited
    for (const slot of state.slots) await expect.poll(() => processIdentity(slot.pid!), { timeout: 20000 }).toBeNull()
    const recovered = await f.matrix.get(state.id)
    expect(recovered).toMatchObject({ phase: 'finished', exitCode: 2, error: 'matrix-interrupted-no-automatic-replay' })
    expect(recovered.cells.every(c => c.attempts.length === 1)).toBe(true)
    for (const slot of f.registry.slots) { const claim = await new DeviceOwnerClaim().acquire(slot.platform, slot.udid); await claim.release() }
  } finally { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGTERM'); await f.close() }
}, 60000)
