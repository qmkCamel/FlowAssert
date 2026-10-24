import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { emptyProject, ocrProjectDigest } from '../src/workbench-project.js'
import { compilePlan } from '../src/workbench-plan.js'
import { approveOcrRegistration } from '../src/workbench-ocr-approval.js'
import { ocrHash } from '../src/workbench-ocr-contracts.js'
import { ocrFixtureEvaluation, fixtureRecognizer, ocrFixtureProfile } from './fixtures/ocr-fixture.js'
import { persistOcrEvidence } from '../src/workbench-ocr-evidence.js'
import { cropOcrImage } from '../src/workbench-ocr.js'

const yaml = 'name: OCR fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- assertTextInRegion: {profile: title}\n- done\n'
it('compiles only explicitly approved scoped profiles and keeps a structured UI assertion mandatory', async () => {
  const project = emptyProject()
  await expect(compilePlan(yaml, project)).rejects.toThrow('unregistered')
  project.ocrProfiles = { title: { profile: ocrFixtureProfile, evaluation: ocrFixtureEvaluation(), page: { text: 'Hello, harness.' } } }
  await expect(compilePlan(yaml, project)).rejects.toThrow('missing-or-stale')
  project.ocrProfiles.title = approveOcrRegistration(project.ocrProfiles.title, ocrProjectDigest(project), 'unit-test-only', true)
  expect((await compilePlan(yaml, project)).nodes.some(n => n.kind === 'ocr')).toBe(true)
  await expect(compilePlan(yaml.replace('- assertVisible: {text: "Hello, harness."}\n', ''), project)).rejects.toThrow('structured assertion')
  project.flows.changed = yaml
  await expect(compilePlan(yaml, project)).rejects.toThrow('stale')
})

it('uses same lease and exact checkpoint, preserves separate verdicts, rejects stale evidence and versions before actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ocr-execution-')), provider = new MockProvider(0)
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
  await mirror.start({ provider: 'mock' })
  const png = Buffer.from((await provider.snapshot()).bytes), size = await sharp(png).metadata()
  const report = ocrFixtureEvaluation()
  report.dataset.profiles.forEach(p => { p.width = size.width!; p.height = size.height! }); report.datasetDigest = ocrHash(report.dataset)
  const profile = report.dataset.profiles[0]!, project = emptyProject()
  project.ocrProfiles = { title: approveOcrRegistration({ profile, evaluation: report, page: { text: 'Hello, harness.' } }, ocrProjectDigest(project), 'UNIT TEST ONLY', true) }
  let output = 'Hello', drift = false
  const workbench = new WorkbenchService(mirror, { root, ocr: {
    preview: (image, p, signal) => fixtureRecognizer(output).preview(image, p, signal),
    identity: async () => drift ? { ...profile.identity, binarySha256: 'c'.repeat(64) } : profile.identity,
    close: async () => {},
  } })
  try {
    const sessionId = mirror.state().sessionId
    const first = await workbench.start(yaml, undefined, undefined, { project }); await workbench.wait()
    const pass = await workbench.get(first.id)
    expect(pass).toMatchObject({ verdict: 'pass', visualVerification: 'pass', businessVerification: 'not-performed', productContract: { verification: { ui: { status: 'pass' }, visual: { required: true, status: 'pass' } } } })
    const step = pass.steps.find(s => s.kind === 'assertTextInRegion')!
    expect(step.evidence.map(e => e.name)).toEqual(['step-2.png', 'step-2.xml', 'ocr-2-crop.png', 'ocr-2.json'])
    const metadata = JSON.parse((await workbench.store.readEvidence(pass.id, step.evidence.at(-1)!)).toString())
    expect(metadata.original.sha256).toBe(step.ocr?.sourceSha256)
    expect(metadata).toMatchObject({ profileDigest: ocrHash(profile), decision: { status: 'pass' } })
    expect(mirror.state().sessionId).toBe(sessionId)
    const preview = await fixtureRecognizer().preview(png, profile)
    await expect(persistOcrEvidence(workbench.store, pass, { ...step }, profile, preview)).rejects.toThrow('checkpoint')
    await expect(persistOcrEvidence(workbench.store, pass, step, profile, { ...preview, imageSha256: 'c'.repeat(64) })).rejects.toThrow('checkpoint')
    await expect(persistOcrEvidence(workbench.store, pass, step, profile, { ...preview, crop: Buffer.from('changed') })).rejects.toThrow('crop-source')
    await expect(cropOcrImage(png, { ...profile, width: profile.width + 1 }, AbortSignal.timeout(1000))).rejects.toThrow()
    output = 'Wrong'; const failed = await workbench.start(yaml, undefined, undefined, { project }); await workbench.wait()
    expect(await workbench.get(failed.id)).toMatchObject({ verdict: 'fail', visualVerification: 'fail', productContract: { verification: { ui: { status: 'pass' } } } })
    output = ''; const uncertain = await workbench.start(yaml, undefined, undefined, { project }); await workbench.wait()
    expect(await workbench.get(uncertain.id)).toMatchObject({ verdict: 'inconclusive', visualVerification: 'inconclusive' })
    drift = true
    await expect(workbench.start(yaml, undefined, undefined, { project })).rejects.toThrow('stale')
    expect(mirror.runOwner).toBeNull()
  } finally { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)
