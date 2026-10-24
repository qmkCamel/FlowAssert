import { readFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'

const code = await readFile(new URL('../viewer/screenshot-playback.js', import.meta.url), 'utf8')
const { createScreenshotPlayback } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
afterEach(() => vi.useRealTimers())
async function fixture(failures: number[] = [], load = vi.fn(async () => true), ids = [1, 4, 9]) {
  vi.useFakeTimers()
  const change = vi.fn(), player = createScreenshotPlayback({ load, change })
  await player.configure({ steps: ids.map(index => ({ index })), index: ids[0], failures, enabled: true })
  return { player, load, change }
}
it('starts paused, dwells after readiness, changes speed and ends without looping', async () => {
  const { player, load } = await fixture()
  await vi.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(1)
  player.play(); await vi.advanceTimersByTimeAsync(1499); expect(player.state().step.index).toBe(1)
  await vi.advanceTimersByTimeAsync(1); expect(player.state().step.index).toBe(4)
  player.speed(2); await vi.advanceTimersByTimeAsync(750); expect(player.state().step.index).toBe(9)
  await vi.advanceTimersByTimeAsync(750); expect(player.state().reason).toBe('ended')
  await vi.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(3)
  player.play(); await vi.advanceTimersByTimeAsync(0); expect(player.state().step.index).toBe(1)
})
it('pauses at each failed step and explicitly continues without infinite failure stops', async () => {
  const { player } = await fixture([4, 9])
  player.play(); await vi.advanceTimersByTimeAsync(1500); expect(player.state().reason).toBe('failure')
  player.play(); await vi.advanceTimersByTimeAsync(1500); expect(player.state().step.index).toBe(9); expect(player.state().reason).toBe('failure')
  player.play(); await vi.advanceTimersByTimeAsync(1500); expect(player.state().reason).toBe('ended')
})
it('pauses at an initially selected failure and supports half-speed timing', async () => {
  const { player } = await fixture([1]); player.play(); expect(player.state().reason).toBe('failure')
  player.speed(.5); player.play(); await vi.advanceTimersByTimeAsync(2999); expect(player.state().step.index).toBe(1)
  await vi.advanceTimersByTimeAsync(1); expect(player.state().step.index).toBe(4)
})
it('missing evidence requires retry or manual navigation; successful retry stays paused', async () => {
  const load = vi.fn(async () => true).mockResolvedValueOnce(false), { player } = await fixture([], load)
  expect(player.state().reason).toBe('unavailable'); player.play(); expect(player.state().active).toBe(false)
  await player.retry(); expect(player.state().ready).toBe(true); expect(player.state().active).toBe(false)
  player.play(); await player.select(4); expect(player.state().active).toBe(false)
})
it('ignores delayed readiness after cancellation and does not consume dwell while loading', async () => {
  let release!: (available: boolean) => void
  const load = vi.fn(async () => true).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  vi.useFakeTimers(); const player = createScreenshotPlayback({ load, change: vi.fn() })
  const pending = player.configure({ steps: [{ index: 1 }, { index: 2 }], index: 1, failures: [], enabled: true })
  await vi.advanceTimersByTimeAsync(5000); expect(player.state().position).toBe(0)
  const signal = (load.mock.calls as unknown as [unknown, { signal: AbortSignal }][])[0]![1]
  player.pause(); expect(signal.signal.aborted).toBe(true)
  await player.select(2); release(true); await pending
  expect(player.state().step.index).toBe(2); expect(player.state().active).toBe(false)
  await vi.advanceTimersByTimeAsync(5000); expect(load).toHaveBeenCalledTimes(2)
})
it('bounds empty and single-step runs, disabled runs and rejected loads', async () => {
  const { player } = await fixture([], vi.fn(async () => true), [1]); player.play(); expect(player.state().active).toBe(false)
  await player.configure({ steps: [], failures: [], enabled: true }); player.play(); expect(player.state().position).toBe(-1)
  const failed = createScreenshotPlayback({ load: async () => { throw new Error('decode') }, change: vi.fn() })
  await failed.configure({ steps: [{ index: 1 }, { index: 2 }], index: 1, failures: [], enabled: true }); expect(failed.state().reason).toBe('unavailable')
})
it('starts dwell only after a slow image resolves and cancels pending timers on reconfiguration', async () => {
  let release!: (available: boolean) => void
  const load = vi.fn(async () => true).mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  const { player } = await fixture([], load)
  player.play(); await vi.advanceTimersByTimeAsync(1500); expect(player.state().loading).toBe(true)
  await vi.advanceTimersByTimeAsync(10000); expect(load).toHaveBeenCalledTimes(2)
  release(true); await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(1499); expect(player.state().step.index).toBe(4)
  await player.configure({ steps: [{ index: 1 }, { index: 2 }], index: 1, failures: [], enabled: false })
  player.play(); await vi.advanceTimersByTimeAsync(5000); expect(player.state().active).toBe(false); expect(player.state().step.index).toBe(1)
})
