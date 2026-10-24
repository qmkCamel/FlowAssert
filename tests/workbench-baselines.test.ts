import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchBaselines } from '../src/workbench-baselines.js'
import { loadTestProject } from '../src/workbench-project.js'
import { WorkbenchStore, sha256 } from '../src/workbench-store.js'
import { compareVisual } from '../src/workbench-visual.js'
import { resolveMirrorConfig as Config } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(availableBytes?: (root: string) => Promise<number>) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-baselines-'))
  const store = new WorkbenchStore(join(root, 'runs'), availableBytes)
  const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer()
  const green = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#00ff00' } }).png().toBuffer()
  await writeFile(join(root, 'reference.png'), red)
  const projectPath = join(root, 'project.json')
  const profile = { rulesVersion: 1, revision: 1, platform: 'ios', appId: 'com.example.mobilemirror.mock', build: 'mock-1', theme: 'any',
    approvedBy: 'fixture', approvedAt: new Date().toISOString(), reference: 'reference.png', referenceSha256: sha256(red), masks: [], channelDelta: 0, maxDifferentRatio: 0 }
  await writeFile(projectPath, JSON.stringify({ visualProfiles: { exact: profile } }))
  const baselines = new WorkbenchBaselines(store, projectPath)
  cleanups.push(async () => { baselines.close(); await store.close(); await rm(root, { recursive: true, force: true }) })
  return { root, store, red, green, projectPath, baselines, profile }
}

describe('reviewed visual baseline approvals', () => {
  it('rejects approval before publishing when storage admission cannot preserve the margin', async () => {
    const { baselines } = await fixture(async () => 256 * 1024 * 1024 + 3 * 1024 * 1024)
    const candidate = await baselines.candidate('exact', { kind: 'project' })
    await expect(baselines.approve(candidate.candidateId, candidate.digest, randomUUID(), 'reviewer', true))
      .rejects.toThrow('storage-insufficient')
    expect(await baselines.list()).toEqual([])
  })

  it('requires explicit review, keeps immutable revisions, and scopes target builds', async () => {
    const { baselines, store, projectPath, red, green } = await fixture()
    const candidate = await baselines.candidate('exact', { kind: 'project' })
    expect(candidate).toMatchObject({ expectedRevision: 0, sourceKind: 'project', sourceBuild: 'mock-1', allowedTargetBuilds: ['mock-1'], sourceImageSha256: sha256(red) })
    const requestId = randomUUID()
    await expect(baselines.approve(candidate.candidateId, candidate.digest, requestId, 'reviewer', false)).rejects.toThrow(/review/)
    const approved = await baselines.approve(candidate.candidateId, candidate.digest, requestId, 'reviewer', true)
    expect(approved).toMatchObject({ revision: 1, sourceKind: 'project', approvedBy: 'reviewer' })
    expect(await baselines.approve(candidate.candidateId, candidate.digest, requestId, 'reviewer', true)).toEqual(approved)
    const reopened = new WorkbenchBaselines(store, projectPath)
    expect(await reopened.approve(candidate.candidateId, candidate.digest, requestId, 'reviewer', true)).toEqual(approved)
    const project = await baselines.applyApproved(await loadTestProject(projectPath))
    expect((await compareVisual(project.visualProfiles.exact!, red, 'mock-1')).status).toBe('pass')
    expect((await compareVisual(project.visualProfiles.exact!, red, 'mock-2')).status).toBe('inconclusive')
    expect((await compareVisual(project.visualProfiles.exact!, green, 'mock-1')).status).toBe('fail')
    const next = await baselines.candidate('exact', { kind: 'project' }, ['mock-1', 'mock-2'])
    const revision2 = await baselines.approve(next.candidateId, next.digest, randomUUID(), 'reviewer', true)
    expect(revision2.revision).toBe(2)
    expect((await baselines.list()).map(row => row.revision)).toEqual([1, 2])
    const updated = await baselines.applyApproved(await loadTestProject(projectPath))
    expect((await compareVisual(updated.visualProfiles.exact!, red, 'mock-2')).status).toBe('pass')
  })

  it('rejects a changed image or rules after preview and preserves prior approval', async () => {
    const { baselines, projectPath, green, profile } = await fixture()
    const first = await baselines.candidate('exact', { kind: 'project' })
    await baselines.approve(first.candidateId, first.digest, randomUUID(), 'reviewer', true)
    const candidate = await baselines.candidate('exact', { kind: 'project' })
    await writeFile(join(dirname(projectPath), 'reference.png'), green)
    await writeFile(projectPath, JSON.stringify({ visualProfiles: { exact: { ...profile, referenceSha256: sha256(green) } } }))
    await expect(baselines.approve(candidate.candidateId, candidate.digest, randomUUID(), 'reviewer', true)).rejects.toThrow(/changed after preview/)
    expect((await baselines.list()).map(row => row.revision)).toEqual([1])
    const fresh = await baselines.candidate('exact', { kind: 'project' })
    await writeFile(projectPath, JSON.stringify({ visualProfiles: { exact: { ...profile, referenceSha256: sha256(green), theme: 'light' } } }))
    await expect(baselines.approve(fresh.candidateId, fresh.digest, randomUUID(), 'reviewer', true)).rejects.toThrow(/rules changed/)
  })

  it.each(['approval:after-temporary', 'approval:after-publish'])(
    'recovers only a fully published revision after interruption at %s', async phase => {
      const { store, projectPath } = await fixture()
      const interrupted = new WorkbenchBaselines(store, projectPath, async point => {
        if (point === phase) throw new Error('simulated-process-stop')
      })
      const candidate = await interrupted.candidate('exact', { kind: 'project' })
      const requestId = randomUUID()
      await expect(interrupted.approve(candidate.candidateId, candidate.digest, requestId, 'reviewer', true))
        .rejects.toThrow('simulated-process-stop')
      interrupted.close()
      const restarted = new WorkbenchBaselines(store, projectPath)
      const committed = await restarted.list()
      expect(committed).toHaveLength(phase === 'approval:after-publish' ? 1 : 0)
      if (committed.length) {
        expect(committed[0]).toMatchObject({ approvalRequestId: requestId, revision: 1 })
        expect(await restarted.approve(candidate.candidateId, candidate.digest, requestId, 'reviewer', true)).toEqual(committed[0])
      } else {
        await expect(restarted.approve(candidate.candidateId, candidate.digest, requestId, 'reviewer', true))
          .rejects.toThrow(/preview again/)
      }
    })

  it.each(['approval:before-temporary', 'approval:after-temporary', 'approval:before-publish', 'approval:after-publish', 'approval:after-directory-sync'])(
    'survives a separate-process SIGKILL at %s', async phase => {
      const { root, store, projectPath, baselines } = await fixture()
      const child = spawn(process.execPath, ['--import', 'tsx', join(process.cwd(), 'tests/fixtures/workbench-baseline-kill-child.ts'),
        store.root, projectPath, phase], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Baseline cutpoint timed out: ${output}`)) }, 15_000)
        child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('CUTPOINT')) { clearTimeout(timer); resolve() } })
        child.stderr.on('data', chunk => { output += String(chunk) })
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Baseline child exited early (${code}): ${output}`)) })
      })
      child.kill('SIGKILL')
      await new Promise(resolve => child.once('exit', resolve))
      await store.init()
      const records = await baselines.list()
      expect(records).toHaveLength(phase.startsWith('approval:after-publish') || phase === 'approval:after-directory-sync' ? 1 : 0)
      if (records.length) {
        const restarted = new WorkbenchBaselines(store, projectPath)
        expect((await restarted.applyApproved(await loadTestProject(projectPath))).visualProfiles.exact?.referenceSha256)
          .toBe(records[0]?.sourceImageSha256)
      }
      expect(root).toContain('mirror-baselines-')
    }, 30_000)

  it('accepts only an original clean passing run image and protects its source from cleanup', async () => {
    const { root, store, red, projectPath } = await fixture()
    const provider = new MockProvider(0)
    const mirror = new MirrorService(Config({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
    await mirror.start({ provider: 'mock' })
    const workbench = new WorkbenchService(mirror, { store, projectPath })
    cleanups.push(async () => { await workbench.close(); await mirror.dispose() })
    const started = await workbench.start('name: Baseline source\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    await workbench.wait()
    const finished = await workbench.get(started.id)
    expect(finished.verdict).toBe('pass')
    const image = [...finished.evidence, ...finished.steps.flatMap(step => step.evidence)].find(file => file.contentType === 'image/png')
    expect(image).toBeDefined()
    for (const changes of [{ source: 'import' as const }, { verdict: 'fail' as const }, { verdict: 'recovered' as const }, { attempt: 2 },
      { share: { shareId: randomUUID(), reportedVerdict: 'pass' as const, verification: 'not-revalidated' as const, withheld: [] } }]) {
      await store.save({ ...finished, ...changes })
      await expect(workbench.baselines.candidate('exact', { kind: 'run', runId: started.id, evidenceName: image!.name })).rejects.toThrow(/original clean completed run/)
    }
    await store.save(finished)
    const originalImage = await store.readEvidence(started.id, image!)
    await writeFile(join(root, 'runs', started.id, image!.name), Buffer.from('damaged PNG'))
    await expect(workbench.baselines.candidate('exact', { kind: 'run', runId: started.id, evidenceName: image!.name })).rejects.toThrow(/integrity/)
    await writeFile(join(root, 'runs', started.id, image!.name), originalImage)
    const candidate = await workbench.baselines.candidate('exact', { kind: 'run', runId: started.id, evidenceName: image!.name })
    expect(candidate).toMatchObject({ sourceKind: 'run', sourceRunId: started.id, sourceImageSha256: image!.sha256 })
    const approved = await workbench.baselines.approve(candidate.candidateId, candidate.digest, randomUUID(), 'reviewer', true)
    expect(approved.sourceManifestSha256).toMatch(/^[a-f0-9]{64}$/)
    const reference = approved.referencePublications?.[started.id]?.references[0]
    expect(reference).toMatchObject({ consumerKind: 'workbench:baseline', consumerId: approved.baselineId, sourceHash: approved.sourceManifestSha256 })
    const retention = new WorkbenchRetention(store)
    const snapshot = await retention.snapshot()
    expect(snapshot.runs.find(run => run.id === started.id)?.protectedBy).toContain('baseline')
    const referencePath = join(store.root, 'references', `${reference!.refId}.json`)
    const originalReference = await readFile(referencePath); await rm(referencePath)
    await expect(retention.snapshot()).rejects.toThrow('missing')
    await writeFile(referencePath, originalReference)
    expect(await store.readEvidence(started.id, image!)).toEqual(Buffer.from(candidate.imageBase64, 'base64'))
    expect(sha256(red)).toMatch(/^[a-f0-9]{64}$/)
  }, 30000)

  it('freezes an accepted run at its baseline revision while later runs use a new approval', async () => {
    const { root, store, projectPath, profile } = await fixture()
    const provider = new MockProvider(0)
    const mirror = new MirrorService(Config({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
    await mirror.start({ provider: 'mock' })
    const actual = Buffer.from((await provider.snapshot()).bytes)
    await writeFile(join(root, 'reference.png'), actual)
    await writeFile(projectPath, JSON.stringify({ visualProfiles: { exact: { ...profile, referenceSha256: sha256(actual) } } }))
    const workbench = new WorkbenchService(mirror, { store, projectPath })
    cleanups.push(async () => { await workbench.close(); await mirror.dispose() })
    const firstCandidate = await workbench.baselines.candidate('exact', { kind: 'project' })
    await workbench.baselines.approve(firstCandidate.candidateId, firstCandidate.digest, randomUUID(), 'reviewer', true)
    let resume!: () => void
    const gate = new Promise<void>(resolve => { resume = resolve })
    const flow = 'name: Frozen visual\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- assertVisual: {profile: exact}\n- done\n'
    const accepted = await workbench.start(flow, undefined, undefined, { executeGate: gate })
    const secondCandidate = await workbench.baselines.candidate('exact', { kind: 'project' }, ['mock-1', 'mock-2'])
    await workbench.baselines.approve(secondCandidate.candidateId, secondCandidate.digest, randomUUID(), 'reviewer', true)
    resume(); await workbench.wait()
    const first = await workbench.get(accepted.id)
    expect(first.steps.find(step => step.kind === 'assertVisual')?.visual).toMatchObject({ status: 'pass', revision: 1 })
    const next = await workbench.start(flow); await workbench.wait()
    const second = await workbench.get(next.id)
    expect(second.steps.find(step => step.kind === 'assertVisual')?.visual).toMatchObject({ status: 'pass', revision: 2 })
  }, 30000)
})
