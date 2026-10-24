import { expect, test, vi } from 'vitest'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { abortableDelay } from '../src/abort.js'

test('historical query is read-only; Viewer capture preserves Agent identity and four entries', async () => {
  let now = Date.now()
  const provider = new MockProvider(0), source = vi.spyOn(provider, 'screenSource'), snapshot = vi.spyOn(provider, 'snapshot')
  const service = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { now: () => now, providerFactory: () => provider })
  try {
    await service.start({ provider: 'mock' })
    const observations = []
    for (let i = 0; i < 4; i++) observations.push(await service.observe({ image: false, structure: true }))
    const last = observations.at(-1)!, before = service.state()
    const local = await service.captureViewerInspection()
    expect(service.state()).toEqual(before); expect(local).not.toHaveProperty('observationId')
    const count = source.mock.calls.length, imageCount = snapshot.mock.calls.length
    for (const o of observations) service.queryScreen({ observationId: o.observationId, op: 'find' })
    expect(source).toHaveBeenCalledTimes(count); expect(snapshot).toHaveBeenCalledTimes(imageCount)
    expect(service.queryScreen({ observationId: observations[0]!.observationId, op: 'find' }).actionBinding.status).toBe('superseded')
    expect(() => service.queryScreen({ observationId: local.inspectionId, op: 'find' })).toThrow('screen_observation_stale')
    await service.action({ kind: 'tap', x: 1, y: 1, observationId: last.observationId })
    expect(service.queryScreen({ observationId: last.observationId, op: 'find' }).actionBinding.status).toBe('screen-changed')
    const fresh = await service.observe({ image: false, structure: true }); now += 16000
    expect(service.queryScreen({ observationId: fresh.observationId, op: 'find' }).actionBinding.status).toBe('action-expired')
    await expect(service.action({ kind: 'tap', x: 1, y: 1, observationId: fresh.observationId })).rejects.toThrow('screen_observation_expired')
    now += 44001; expect(() => service.queryScreen({ observationId: fresh.observationId, op: 'find' })).toThrow('screen_observation_expired')
  } finally { await service.dispose() }
})
test('slow capture fails fast across entrypoints while query and stop remain available', async () => {
  let slow = false
  class Slow extends MockProvider { override async screenSource(signal?: AbortSignal) { if (slow) await abortableDelay(800, signal!); return super.screenSource() } }
  const service = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => new Slow(0) })
  try {
    await service.start({ provider: 'mock' }); const o = await service.observe({ image: false, structure: true }); slow = true
    const capturing = service.captureViewerInspection(); const rejected = expect(capturing).rejects.toThrow()
    await expect(service.observe({ image: false, structure: true })).rejects.toThrow('screen_observation_in_progress')
    expect(service.queryScreen({ observationId: o.observationId, op: 'find' }).nodes.length).toBeGreaterThan(0)
    await service.stop(); await rejected
  } finally { await service.dispose() }
})
test('local inspection remains separate from agent sharing policy', async () => {
  const provider = new MockProvider(0)
  Object.defineProperty(provider, 'kind', { value: 'appium' })
  const service = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0, viewerMediaMode: 'polling', agentScreenContentPolicy: 'mock-only' }), 'http://127.0.0.1', { providerFactory: () => provider })
  try {
    await service.start({ provider: 'appium' })
    const inspection = await service.captureViewerInspection()
    expect(inspection.structure.nodes.length).toBeGreaterThan(0)
    expect(() => service.queryScreen({ observationId: inspection.inspectionId, op: 'find' })).toThrow('screen_observation_disabled')
    await expect(service.observe({ image: false, structure: true })).rejects.toThrow('screen_observation_disabled')
  } finally { await service.dispose() }
})
test('full/summary and image selection remain orthogonal across physical sharing policies', async () => {
  const { MobileMirrorCommands } = await import('../src/mobile-mirror-commands.js')
  const { summarizeObservation, projectObservation } = await import('../src/observation-store.js')
  for (const policy of ['mock-only', 'structure', 'image-and-structure'] as const) {
    const provider = new MockProvider(0); Object.defineProperty(provider, 'kind', { value: 'appium' })
    const config = resolveMirrorConfig({ agentScreenContentPolicy: policy, viewerMediaMode: 'polling', mockStartupDelayMs: 0 })
    const service = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => provider })
    const commands = new MobileMirrorCommands(config, { service, iosWdaPreflight: { run: async () => { throw new Error('unused') } } })
    try {
      await service.start({ provider: 'appium' })
      for (const structureMode of ['full', 'summary'] as const) for (const includeImage of [false, true]) {
        const request = commands.execute('mobile_mirror_inspect_screen', { structureMode, includeImage })
        if (policy === 'mock-only' || includeImage && policy === 'structure') { await expect(request).rejects.toThrow(/screen_observation_disabled|screen_image_sharing_disabled/); continue }
        const result = await request
        if (result.kind !== 'observation') throw new Error('Expected observation')
        const projected = projectObservation(summarizeObservation(result.value), result.structureMode)
        expect('structureSummary' in projected).toBe(structureMode === 'summary'); expect('structure' in projected).toBe(structureMode === 'full')
        expect(!!projected.image).toBe(includeImage)
        expect(service.queryScreen({ observationId: result.value.observationId, op: 'find' }).nodes.length).toBeGreaterThan(0)
      }
    } finally { await service.dispose() }
  }
})
