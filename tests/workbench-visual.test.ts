import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveMirrorConfig as Config } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { compareVisual, registerVisualProfile } from '../src/workbench-visual.js'
import { sha256 } from '../src/workbench-store.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const profile = (referenceSha256: string, reference = 'reference.png') => ({ rulesVersion: 1 as const, revision: 1, platform: 'ios' as const, appId: 'com.example.mobilemirror.mock', build: 'mock-1', theme: 'any' as const,
  approvedBy: 'fixture-reviewer', approvedAt: new Date().toISOString(), reference, referenceSha256, channelDelta: 0, maxDifferentRatio: 0, masks: [] })

describe('explicit deterministic visual assertion', () => {
  it('compares bounded pixels and returns inconclusive for incompatible dimensions', async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
    const approved = await registerVisualProfile(profile(sha256(image)), image)
    expect((await compareVisual(approved, image, 'mock-1')).status).toBe('pass')
    const changed = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#00ff00' } }).png().toBuffer()
    expect((await compareVisual(approved, changed, 'mock-1')).status).toBe('fail')
    expect((await compareVisual(approved, changed, 'unknown')).status).toBe('inconclusive')
    const wrongSize = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
    expect((await compareVisual(approved, wrongSize, 'mock-1')).status).toBe('inconclusive')
    const masked = await registerVisualProfile({ ...profile(sha256(image)), masks: [{ x: 0, y: 0, width: 2, height: 2 }] }, image)
    expect((await compareVisual(masked, changed, 'mock-1')).status).toBe('inconclusive')
    const timed = await compareVisual(approved, image, 'mock-1', 'unknown', undefined, 1)
    expect(timed).toMatchObject({ status: 'inconclusive', message: 'Visual comparison exceeded time budget' })
    const cancelled = new AbortController(); cancelled.abort()
    expect(await compareVisual(approved, image, 'mock-1', 'unknown', cancelled.signal)).toMatchObject({ status: 'inconclusive', message: 'Visual comparison cancelled' })
  })

  it('uses the existing mock session and checkpoint for visual pass/fail without changing UI assertions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-visual-'))
    const provider = new MockProvider(0)
    const mirror = new MirrorService(Config({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
    await mirror.start({ provider: 'mock' })
    const original = Buffer.from((await provider.snapshot()).bytes)
    const changed = await sharp(original).composite([{ input: { create: { width: 1, height: 1, channels: 4, background: '#ffffff' } }, top: 0, left: 0 }]).png().toBuffer()
    await writeFile(join(root, 'reference.png'), original)
    await writeFile(join(root, 'different.png'), changed)
    const projectPath = join(root, 'project.json')
    await writeFile(projectPath, JSON.stringify({ visualProfiles: { exact: profile(sha256(original)), wrong: profile(sha256(changed), 'different.png') } }))
    const workbench = new WorkbenchService(mirror, { root: join(root, 'runs'), projectPath })
    cleanups.push(async () => { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
    const flow = (name: string) => `name: Visual fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- assertVisual: {profile: ${name}}\n- done\n`
    const first = await workbench.start(flow('exact')); await workbench.wait()
    const pass = await workbench.get(first.id)
    expect(pass).toMatchObject({ verdict: 'pass', visualVerification: 'pass', productContract: { verification: { ui: { status: 'pass' }, visual: { required: true, status: 'pass' } } } })
    expect(pass.steps.find(step => step.kind === 'assertVisual')?.visual?.status).toBe('pass')
    const sessionId = mirror.state().sessionId
    const second = await workbench.start(flow('wrong')); await workbench.wait()
    const fail = await workbench.get(second.id)
    expect(fail).toMatchObject({ verdict: 'fail', visualVerification: 'fail', productContract: { verification: { ui: { status: 'pass' }, visual: { required: true, status: 'fail' } } } })
    expect(mirror.state().sessionId).toBe(sessionId)
    await expect(workbench.start(flow('missing'))).rejects.toThrow(/Unregistered visual profile/)
    expect(mirror.runOwner).toBeNull()
  }, 30000)
})
