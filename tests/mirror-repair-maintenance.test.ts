import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { MOCK_SESSION_APP_ID } from '../src/mock-screen-model.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'

const request = { artifactPath: '/fixture/Fixture.app', artifactDigest: 'a'.repeat(64),
  appId: MOCK_SESSION_APP_ID, buildMarker: 'candidate-1', platform: 'ios' as const }

it('uses the sole repair lease, rebuilds the session, and invalidates prior observations', async () => {
  const provider = new MockProvider(0)
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => provider })
  const owner = randomUUID()
  try {
    await mirror.start({ provider: 'mock' })
    const oldSession = mirror.state().sessionId
    const run = mirror.acquireRun(randomUUID(), new AbortController().signal)
    expect(() => mirror.reserveRepair(owner)).toThrow(/reserved|busy/)
    await run.release()
    const groupOwner = randomUUID(), releaseGroup = mirror.reserveRunGroup(groupOwner)
    expect(() => mirror.reserveRepair(owner)).toThrow(/reserved|busy/)
    await expect(mirror.installRepairArtifact(owner, request)).rejects.toThrow(/lease/)
    const groupChild = mirror.acquireRun(randomUUID(), new AbortController().signal, undefined, groupOwner)
    await groupChild.release(); releaseGroup()
    const release = mirror.reserveRepair(owner)
    expect((await mirror.readRepairInstalledIdentity(owner, request.appId, request)).state).toBe('unverified')
    expect(() => mirror.reserveRepair(randomUUID())).toThrow(/busy/)
    await expect(mirror.installRepairArtifact(randomUUID(), request)).rejects.toThrow(/lease/)
    const receipt = await mirror.installRepairArtifact(owner, request)
    expect(receipt.provider).toBe('mock')
    expect(receipt.sessionId).not.toBe(oldSession)
    expect(mirror.cachedFrame()).toBeNull()
    expect((await mirror.readRepairInstalledIdentity(owner, request.appId, request)).state).toBe('verified')
    expect((await mirror.readRepairInstalledIdentity(owner, request.appId,
      { ...request, artifactDigest: 'b'.repeat(64) })).state).toBe('mismatch')
    await release()
  } finally { await mirror.dispose() }
})

it('never acquires install capability from an externally owned/attached session', async () => {
  class ExternalProvider extends MockProvider {
    override appControlContext() { return { owned: false, platform: 'mock' as const, targetAppId: MOCK_SESSION_APP_ID } }
  }
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => new ExternalProvider(0) })
  try {
    await mirror.start({ provider: 'mock' })
    expect(mirror.repairMaintenanceAvailable(request.appId, request.platform)).toBe(false)
    const owner = randomUUID(), release = mirror.reserveRepair(owner)
    await expect(mirror.installRepairArtifact(owner, request)).rejects.toThrow(/unavailable/)
    await release()
  } finally { await mirror.dispose() }
})

it('accepts a matching app build marker but never treats version alone as identity', async () => {
  class MarkerProvider extends MockProvider {
    override async readRepairInstalledIdentity(appId: string) {
      const original = await super.readRepairInstalledIdentity(appId)
      return { appId: original.appId,
        ...(original.buildMarker === undefined ? {} : { buildMarker: original.buildMarker }),
        ...(original.version === undefined ? {} : { version: original.version }),
        evidence: 'app-build-marker' as const, observedAt: original.observedAt }
    }
  }
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => new MarkerProvider(0) })
  const owner = randomUUID()
  try {
    await mirror.start({ provider: 'mock' })
    const release = mirror.reserveRepair(owner)
    expect((await mirror.readRepairInstalledIdentity(owner, request.appId, request)).state).toBe('unverified')
    await mirror.installRepairArtifact(owner, request)
    expect((await mirror.readRepairInstalledIdentity(owner, request.appId, request)).state).toBe('verified')
    expect((await mirror.readRepairInstalledIdentity(owner, request.appId,
      { ...request, buildMarker: 'old-build' })).state).toBe('mismatch')
    await release()
  } finally { await mirror.dispose() }
})

it('fences uncertain post-dispatch cancellation; only read-only identity remains available', async () => {
  const provider = new MockProvider(0, { postMutationDelayMs: 100 })
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => provider })
  const owner = randomUUID(), abort = new AbortController()
  try {
    await mirror.start({ provider: 'mock' })
    const release = mirror.reserveRepair(owner)
    const pending = mirror.installRepairArtifact(owner, request, abort.signal)
    await new Promise(resolve => setTimeout(resolve, 20))
    abort.abort(new Error('fixture cancellation'))
    await expect(pending).rejects.toThrow()
    expect((await mirror.readRepairInstalledIdentity(owner, request.appId, request)).state).toBe('verified')
    await expect(mirror.installRepairArtifact(owner, request)).rejects.toThrow(/uncertain/)
    await release()
    expect(() => mirror.reserveRepair(randomUUID())).toThrow(/uncertain/)
  } finally { await mirror.dispose() }
})

it('fences a provider disconnect after dispatch without retrying installation', async () => {
  class DisconnectProvider extends MockProvider {
    installs = 0
    override async installRepairArtifact(input: Parameters<MockProvider['installRepairArtifact']>[0], signal?: AbortSignal) {
      this.installs++
      await super.installRepairArtifact(input, signal)
      await this.stop()
      throw new Error('fixture device disconnected after install')
    }
  }
  const provider = new DisconnectProvider(0)
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => provider })
  const owner = randomUUID()
  try {
    await mirror.start({ provider: 'mock' })
    const release = mirror.reserveRepair(owner)
    await expect(mirror.installRepairArtifact(owner, request)).rejects.toThrow(/disconnected/)
    expect(provider.installs).toBe(1)
    await expect(mirror.readRepairInstalledIdentity(owner, request.appId, request)).rejects.toThrow(/not connected/)
    await expect(mirror.installRepairArtifact(owner, request)).rejects.toThrow(/uncertain/)
    expect(provider.installs).toBe(1)
    await release()
  } finally { await mirror.dispose() }
})
