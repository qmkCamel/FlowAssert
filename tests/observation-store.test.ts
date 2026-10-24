import { describe, expect, it } from 'vitest'
import { ObservationStore, summarizeObservation } from '../src/observation-store.js'
import type { ScreenObservation } from '../src/types.js'

describe('ObservationStore', () => {
  it('publishes 128-bit opaque ids and exposes a byte-free summary', () => {
    let now = 1_000
    const store = new ObservationStore({ now: () => now })
    const observation = store.publish(draft(1, now, new Uint8Array([1, 2, 3])))
    expect(observation.observationId).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(Object.isFrozen(observation)).toBe(true)
    expect(Object.isFrozen(observation.viewport)).toBe(true)
    expect(Object.isFrozen(observation.image)).toBe(true)
    const serialized = JSON.stringify(summarizeObservation(observation))
    expect(serialized).not.toContain('bytes')
    expect(serialized).not.toContain('path')
    expect(serialized).not.toContain('url')
    expect(serialized).not.toContain('base64')
    expect(summarizeObservation(observation).image).toMatchObject({ byteLength: 3, delivery: 'core-memory' })
    now += 1
  })

  it('expires and zeroes image bytes with a fake clock', () => {
    let now = 5_000
    const bytes = new Uint8Array([4, 5, 6])
    const store = new ObservationStore({ now: () => now, ttlMs: 100 })
    const observation = store.publish(draft(1, now, bytes))
    now += 101
    expect(() => store.getForAction(observation.observationId, 1)).toThrow(expect.objectContaining({ code: 'screen_observation_expired' }))
    expect([...bytes]).toEqual([0, 0, 0])
  })

  it('evicts oldest entries by session count and image byte capacity', () => {
    let now = 10_000
    const store = new ObservationStore({ now: () => now, maxPerSession: 2, maxImageBytes: 5 })
    const first = store.publish(draft(1, now++, new Uint8Array([1, 1])))
    const second = store.publish(draft(1, now++, new Uint8Array([2, 2])))
    const third = store.publish(draft(1, now++, new Uint8Array([3, 3])))
    expect(() => store.getForAction(first.observationId, 1)).toThrow(expect.objectContaining({ code: 'screen_observation_stale' }))
    expect(store.getForAction(second.observationId, 1)).toBe(second)
    expect(store.getForAction(third.observationId, 1)).toBe(third)

    const fourth = store.publish(draft(2, now++, new Uint8Array([4, 4, 4])))
    expect(() => store.getForAction(second.observationId, 1)).toThrow(expect.objectContaining({ code: 'screen_observation_stale' }))
    expect(store.getForAction(fourth.observationId, 2)).toBe(fourth)
  })

  it('isolates generations and rejects an individual oversized image', () => {
    const store = new ObservationStore({ maxImageBytes: 2 })
    const observation = store.publish(draft(7, Date.now(), new Uint8Array([1, 2])))
    expect(() => store.getForAction(observation.observationId, 8)).toThrow(expect.objectContaining({ code: 'screen_observation_session_mismatch' }))
    store.clearGeneration(7)
    expect(() => store.getForAction(observation.observationId, 8)).toThrow(expect.objectContaining({ code: 'screen_observation_session_mismatch' }))
    expect(() => store.publish(draft(8, Date.now(), new Uint8Array([1, 2, 3])))).toThrow(expect.objectContaining({ code: 'screen_observation_too_large' }))
  })

  it('freezes and summarizes sensitive metadata without retaining its value', () => {
    const store = new ObservationStore()
    const now = Date.now()
    const observation = store.publish({
      ...draft(1, now, new Uint8Array([1])),
      structure: {
        truncated: false,
        nodes: [{ nodeId: 'n0', role: 'input', sensitive: true, focused: true }],
      },
    })
    expect(Object.isFrozen(observation.structure?.nodes[0])).toBe(true)
    expect(summarizeObservation(observation).structure?.nodes[0]).toEqual({
      nodeId: 'n0', role: 'input', sensitive: true, focused: true,
    })
  })
})

function draft(generation: number, now: number, bytes: Uint8Array): Omit<ScreenObservation, 'observationId' | 'expiresAt'> {
  return {
    sessionGeneration: generation,
    frameRevision: now,
    screenEpoch: 1,
    capturedAt: new Date(now).toISOString(),
    captureEndedAt: new Date(now).toISOString(),
    viewport: { x: 0, y: 0, width: 10, height: 20 },
    orientation: 'portrait',
    orientationSource: 'provider',
    image: { bytes, contentType: 'image/png', width: 10, height: 20 },
  }
}
