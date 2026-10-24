import { describe, expect, it, vi } from 'vitest'
import { OwnedProcessTree, type ProcessIdentity, type ProcessInventory } from '../src/owned-process-tree.js'
import { NodeStreamingHostProcessRunner } from '../src/streaming-host-process.js'
import { spawn } from 'node:child_process'

const row = (pid: number, parent: number, command = '/usr/bin/node', started = 'first'): ProcessIdentity => ({ pid, parent, command, started, zombie: false })
function fixture(initial: ProcessIdentity[], owned = [10]) {
  let rows = initial
  const inventory: ProcessInventory = {
    list: vi.fn(async () => rows.map((r) => ({ ...r }))),
    hasOwner: vi.fn(async (pid) => owned.includes(pid)),
    signal: vi.fn((pid) => { rows = rows.filter((r) => r.pid !== pid) }),
  }
  return { inventory, set: (next: ProcessIdentity[]) => { rows = next }, tree: new OwnedProcessTree(10, 'test-nonce', inventory) }
}

describe('owned Appium process tree', () => {
  it('passes a child-only preload environment without losing descendant ownership', async () => {
    const marker = 'MOBILE_MIRROR_TEST_CHILD_ENV', previous = process.env[marker]
    const handle = new NodeStreamingHostProcessRunner().spawn(process.execPath,
      ['-e', `console.log(JSON.stringify({marker:process.env.${marker},owned:Boolean(process.env.MOBILE_MIRROR_PROCESS_OWNER)}))`],
      { ownedDescendants: true, env: { ...process.env, [marker]: 'child-only' } })
    try {
      expect(await handle.exited).toBe(0)
      expect(JSON.parse(handle.stdout)).toMatchObject({ marker: 'child-only', owned: true })
      expect(process.env[marker]).toBe(previous)
    } finally { await handle.stop() }
  })
  it('cleans observed WDA ancestry when macOS hides its environment, but preserves an unproven namesake', async () => {
    const f = fixture([row(10, 1), row(20, 10, '/Xcode/xcodebuild'), row(30, 1, '/Xcode/xcodebuild')], [10])
    await f.tree.sample()
    f.set([row(20, 1, '/Xcode/xcodebuild'), row(30, 1, '/Xcode/xcodebuild')])
    await f.tree.cleanup(5)
    expect(f.inventory.signal).toHaveBeenCalledExactlyOnceWith(20, 'SIGINT')
  })

  it('retains detached descendants after reparenting, without terminating an external namesake', async () => {
    const f = fixture([row(10, 1), row(20, 10, '/Xcode/xcodebuild'), row(30, 1, '/Xcode/xcodebuild')], [10, 20])
    await f.tree.sample()
    f.set([row(20, 1, '/Xcode/xcodebuild'), row(30, 1, '/Xcode/xcodebuild')])
    await f.tree.cleanup(5)
    expect(f.inventory.signal).toHaveBeenCalledExactlyOnceWith(20, 'SIGINT')
  })

  it('uses the inherited nonce for WDA orphaned before the first observation', async () => {
    const f = fixture([row(20, 1, '/Xcode/xcodebuild'), row(30, 1, '/Xcode/xcodebuild')], [20])
    await f.tree.cleanup(5)
    expect(f.inventory.signal).toHaveBeenCalledExactlyOnceWith(20, 'SIGINT')
  })

  it('refuses a nonce-only orphan whose ownership can no longer be confirmed', async () => {
    const f = fixture([row(20, 1, '/Xcode/xcodebuild')], [20])
    await f.tree.sample()
    vi.mocked(f.inventory.hasOwner).mockResolvedValue(false)
    await expect(f.tree.cleanup(5)).rejects.toThrow('identity could not be confirmed')
    expect(f.inventory.signal).not.toHaveBeenCalled()
  })

  it('refuses a reused PID and does not rediscover ownership from its name', async () => {
    const f = fixture([row(10, 1), row(20, 10)])
    await f.tree.sample()
    f.set([row(20, 1, '/usr/bin/node', 'reused')])
    await f.tree.cleanup(5)
    expect(f.inventory.signal).not.toHaveBeenCalled()
  })

  it('does not signal on inventory failure and retries the retained ownership', async () => {
    const f = fixture([row(10, 1), row(20, 10)])
    await f.tree.sample()
    vi.mocked(f.inventory.list).mockRejectedValueOnce(new Error('Unavailable'))
    await expect(f.tree.cleanup(5)).rejects.toThrow('Unavailable')
    expect(f.inventory.signal).not.toHaveBeenCalled()
    await f.tree.cleanup(5)
    expect(f.inventory.signal).toHaveBeenCalledWith(20, 'SIGINT')
  })

  it('reports surviving descendants after bounded escalation, then permits retry', async () => {
    const f = fixture([row(10, 1), row(20, 10)])
    const signal = vi.mocked(f.inventory.signal)
    signal.mockImplementation(() => undefined)
    await expect(f.tree.cleanup(1)).rejects.toThrow('did not stop')
    expect(signal.mock.calls.map((call) => call[1])).toEqual(['SIGINT', 'SIGKILL'])
    f.set([])
    await expect(f.tree.cleanup(1)).resolves.toBeUndefined()
  })

  it('stops an actual detached grandchild while preserving an unrelated process', async () => {
    const external = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const script = `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)`
    const handle = new NodeStreamingHostProcessRunner().spawn(globalThis.process.execPath, ['-e', script], { ownedDescendants: true, stopGraceMs: 300 })
    let descendant = 0
    try {
      await expect.poll(() => Number(handle.stdout.trim())).toBeGreaterThan(0)
      descendant = Number(handle.stdout.trim())
      // Give the ownership sampler time to observe the actual detached ancestry.
      await new Promise((resolve) => setTimeout(resolve, 400))
      await handle.stop()
      expect(() => globalThis.process.kill(external.pid!, 0)).not.toThrow()
      await expect.poll(() => { try { globalThis.process.kill(descendant, 0); return false } catch { return true } }).toBe(true)
    } finally {
      await handle.stop()
      external.kill('SIGKILL')
      if (descendant) try { globalThis.process.kill(descendant, 'SIGKILL') } catch { /* already stopped */ }
    }
  }, 10000)
})
