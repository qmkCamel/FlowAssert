import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'

const roots: string[] = []
const stores: WorkbenchStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-store-owner-'))
  roots.push(root)
  return root
}

describe('workbench store ownership', () => {
  it('records a generation and blocks a second store before it can register a lease', async () => {
    const root = await fixture()
    const first = new WorkbenchStore(root), second = new WorkbenchStore(root)
    stores.push(first, second)
    await first.init()
    const record = JSON.parse(await readFile(join(root, '.lock'), 'utf8'))
    expect(record).toMatchObject({ schemaVersion: 1, pid: process.pid, generation: first.ownerGeneration })
    await expect(second.lease(['91853cb6-caf3-4f8c-8cf9-5f6ee84aa8d1'])).rejects.toThrow(/Another workbench/)
    await expect(second.put('91853cb6-caf3-4f8c-8cf9-5f6ee84aa8d1', 'flow.yaml', 'unsafe', 'text/yaml')).rejects.toThrow(/no writable owner/)
    await first.close()
    await second.init()
    expect(second.ownerGeneration).not.toBe(record.generation)
  })

  it('does not overwrite a live or reused PID claim and reclaims a dead legacy claim', async () => {
    const root = await fixture()
    const store = new WorkbenchStore(root)
    stores.push(store)
    await writeFile(join(root, '.lock'), JSON.stringify({ schemaVersion: 1, pid: process.pid, processIdentity: 'old-process', nonce: '00000000-0000-4000-8000-000000000000', generation: '00000000-0000-4000-8000-000000000001', acquiredAt: new Date().toISOString() }))
    await expect(store.init()).rejects.toThrow(/Another workbench/)
    expect((await readFile(join(root, '.lock'), 'utf8'))).toContain('old-process')
    await writeFile(join(root, '.lock'), '99999999')
    await store.init()
    expect(store.ownerGeneration).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('fails closed when the previous owner claim cannot be verified', async () => {
    const root = await fixture()
    const store = new WorkbenchStore(root)
    stores.push(store)
    await writeFile(join(root, '.lock'), '{invalid')
    await expect(store.init()).rejects.toThrow()
    expect(await readFile(join(root, '.lock'), 'utf8')).toBe('{invalid')
  })

  it('never races a live, dead, or unknown claim mutex holder', async () => {
    const root = await fixture()
    const claim = join(root, '.lock-claim')
    await mkdir(claim)
    await writeFile(join(claim, 'claim.json'), JSON.stringify({ pid: process.pid, nonce: 'live' }))
    const store = new WorkbenchStore(root); stores.push(store)
    await expect(store.init()).rejects.toThrow(/claim is busy/)
    expect(await readFile(join(claim, 'claim.json'), 'utf8')).toContain('live')
    await writeFile(join(claim, 'claim.json'), JSON.stringify({ pid: 99999999, nonce: 'dead' }))
    await expect(store.init()).rejects.toThrow(/manual recovery/)
    expect(await readFile(join(claim, 'claim.json'), 'utf8')).toContain('dead')
  }, 10000)

  it('refuses a changed owner before a mutation and never removes the replacement at close', async () => {
    const root = await fixture()
    const store = new WorkbenchStore(root)
    stores.push(store)
    await store.init()
    const replacement = { ...JSON.parse(await readFile(join(root, '.lock'), 'utf8')), nonce: '11111111-1111-4111-8111-111111111111' }
    await writeFile(join(root, '.lock'), JSON.stringify(replacement))
    await expect(store.withMutationGate(() => 'should not execute')).rejects.toThrow(/owner changed/)
    await store.close()
    expect(JSON.parse(await readFile(join(root, '.lock'), 'utf8')).nonce).toBe(replacement.nonce)
  })

  it('rejects a separate live process and reclaims its lock after an abrupt exit', async () => {
    const root = await fixture()
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/workbench-store-owner-child.ts', root], {
      cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'],
    })
    try {
      const ready = await new Promise<string>((resolve, reject) => {
        child.stdout.once('data', bytes => resolve(String(bytes)))
        child.once('error', reject)
      })
      expect(ready).toContain('READY')
      const store = new WorkbenchStore(root)
      stores.push(store)
      await expect(store.init()).rejects.toThrow(/Another workbench/)
      child.kill('SIGKILL')
      await new Promise(resolve => child.once('exit', resolve))
      await store.init()
      expect(store.ownerGeneration).toMatch(/^[0-9a-f-]{36}$/)
    } finally { if (child.exitCode === null) child.kill('SIGKILL') }
  }, 10_000)
})
