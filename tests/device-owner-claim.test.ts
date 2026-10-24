import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceOwnerClaim, DeviceOwnerClaimError } from '../src/device-owner-claim.js'
import { spawn } from 'node:child_process'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function root() { const value = await mkdtemp(join(tmpdir(), 'mirror-owner-')); roots.push(value); return value }

describe('explicit device owner claim', () => {
  it('allows one owner across independent runtimes and uses nonce-verified release', async () => {
    const directory = await root()
    const identities = new Map([[101, 'start-a'], [202, 'start-b'], [303, 'start-c']])
    const identity = async (pid: number) => identities.get(pid) ?? null
    const first = new DeviceOwnerClaim({ root: directory, pid: 101, identity })
    const second = new DeviceOwnerClaim({ root: directory, pid: 202, identity })
    const lease = await first.acquire('android', 'DEVICE-1')
    await lease.markActive()
    await expect(second.acquire('android', 'device-1')).rejects.toBeInstanceOf(DeviceOwnerClaimError)
    expect(await lease.release()).toBe(true)
    const replacement = await second.acquire('android', 'device-1')
    expect(await lease.release()).toBe(false)
    const third = new DeviceOwnerClaim({ root: directory, pid: 303, identity })
    await expect(third.acquire('android', 'device-1')).rejects.toMatchObject({ code: 'mobile_mirror_owner_conflict' })
    expect(await replacement.release()).toBe(true)
  })

  it('refuses PID reuse and an active stale session but reclaims a dead pre-session owner', async () => {
    const directory = await root()
    let identity101: string | null = 'old-start'
    const first = new DeviceOwnerClaim({ root: directory, pid: 101, identity: async (pid) => pid === 101 ? identity101 : 'new-owner' })
    const active = await first.acquire('ios', 'UDID')
    await active.markActive()
    identity101 = 'reused-start'
    const replacement = new DeviceOwnerClaim({ root: directory, pid: 202, identity: async (pid) => pid === 101 ? identity101 : 'new-owner' })
    await expect(replacement.acquire('ios', 'UDID')).rejects.toThrow('safely reclaimed')
    expect(await active.release()).toBe(true)

    const starting = await first.acquire('ios', 'UDID')
    identity101 = null
    const reclaimed = await replacement.acquire('ios', 'UDID')
    expect(await starting.release()).toBe(false)
    expect(await reclaimed.release()).toBe(true)
  })

  it('rejects a second process regardless of its separate run history', async () => {
    const directory = await root()
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/device-claim-child.ts', directory, 'hold'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'inherit'] })
    const ready = await new Promise<string>((resolve, reject) => { child.stdout.once('data', (data) => resolve(String(data))); child.once('error', reject) })
    expect(ready).toContain('READY')
    const contender = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/device-claim-child.ts', directory, 'try'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''; contender.stdout.on('data', (data) => { output += String(data) })
    const code = await new Promise<number | null>((resolve) => contender.once('exit', resolve))
    expect(code).toBe(3); expect(output).toContain('CONFLICT')
    child.stdin.write('release\n')
    expect(await new Promise<number | null>((resolve) => child.once('exit', resolve))).toBe(0)
  }, 10_000)
})
