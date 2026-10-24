import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { NodeLoopbackPortAllocator } from '../src/loopback-port.js'
import { NodeStreamingHostProcessRunner } from '../src/streaming-host-process.js'

describe('streaming host runtime', () => {
  it('allocates a released non-privileged loopback port and honors pre-abort', async () => {
    const allocator = new NodeLoopbackPortAllocator()
    const port = await allocator.allocate()
    expect(port).toBeGreaterThanOrEqual(1024)
    expect(port).toBeLessThanOrEqual(65_535)
    await expect(allocator.isAvailable(port)).resolves.toBe(true)

    const occupied = createServer()
    await new Promise<void>((resolve) => occupied.listen(port, '127.0.0.1', resolve))
    await expect(allocator.isAvailable(port)).resolves.toBe(false)
    await new Promise<void>((resolve) => occupied.close(() => resolve()))

    const controller = new AbortController()
    controller.abort(new Error('fixture abort'))
    await expect(allocator.allocate(controller.signal)).rejects.toThrow('fixture abort')
    await expect(allocator.isAvailable(port, controller.signal)).rejects.toThrow('fixture abort')
  })

  it('spawns without a shell, retains only bounded output tails, and stops idempotently', async () => {
    const runner = new NodeStreamingHostProcessRunner()
    const child = runner.spawn(process.execPath, [
      '-e',
      "process.stdout.write('A'.repeat(128)); process.stderr.write('B'.repeat(128)); setInterval(() => {}, 1000)",
      'literal;touch should-not-run',
    ], { outputLimit: 32 })
    await waitFor(() => child.stdout.length === 32 && child.stderr.length === 32)
    expect(child.stdout).toBe('A'.repeat(32))
    expect(child.stderr).toBe('B'.repeat(32))
    await child.stop()
    await child.stop()
    await expect(child.exited).resolves.not.toBeUndefined()
  })

  it('escalates only the saved child after its stop grace expires', async () => {
    const runner = new NodeStreamingHostProcessRunner()
    const child = runner.spawn(process.execPath, [
      '-e',
      "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)",
    ], { stopGraceMs: 20 })
    await waitFor(() => child.stdout === 'ready')
    await child.stop()
    await expect(child.exited).resolves.toBeNull()
  })
})

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Condition was not reached')
}
