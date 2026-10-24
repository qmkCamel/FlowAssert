import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { TestRunControlError, TestRunCoordinator } from '../src/test-run-control.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import type { AgentTestControlConfig } from '../src/config.js'
import { randomUUID } from 'node:crypto'
import { acceptanceFixture } from './fixtures/acceptance-fixture.js'
import { externalFixture } from './fixtures/external-fixture.js'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function setup(enabled = true, journalWriteHook?: NonNullable<ConstructorParameters<typeof TestRunCoordinator>[2]>['journalWriteHook'], closeFails = false) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-agent-runs-'))
  const projectPath = join(root, 'project.json')
  const yaml = 'name: Agent fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n'
  await writeFile(join(root, 'fixture.yaml'), yaml)
  await writeFile(projectPath, JSON.stringify({
    flows: { fixture: 'fixture.yaml' },
    suites: { smoke: { name: 'Agent smoke', cases: [{ id: 'fixture', flow: 'fixture' }] } },
  }))
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => new MockProvider(0) })
  await mirror.start({ provider: 'mock' })
  const policy: AgentTestControlConfig = {
    enabled, projectPath, allowedFlows: ['fixture'], allowedSuites: ['smoke'], allowedPlatforms: ['ios'],
    allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: ['flow', 'image'],
  }
  const coordinator = new TestRunCoordinator(mirror, policy, { root: join(root, 'runs'), ...(journalWriteHook ? { journalWriteHook } : {}) })
  cleanups.push(async () => { if (closeFails) await expect(coordinator.close()).rejects.toThrow(); else await coordinator.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
  return { coordinator, projectPath, root, mirror, policy }
}

async function finish(coordinator: TestRunCoordinator, executionId: string) {
  await expect.poll(async () => (await coordinator.status({ executionId }) as { phase: string }).phase, { timeout: 10_000 }).toBe('finished')
  return coordinator.status({ executionId }) as Promise<Record<string, unknown>>
}

describe('Agent test run control', () => {
  it('does not dispatch a runnable gate when reference-bearing journal publication fails', async () => {
    let injected = false
    const { coordinator } = await setup(true, (point, journal) => {
      if (!injected && point === 'temporary-synced' && journal.referencePublications && journal.phase === 'running') { injected = true; throw new Error('ENOSPC dispatch marker') }
    })
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    const accepted = await coordinator.start({ requestId: 'publication-failed', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }) as { executionId: string; runId: string }
    expect(await finish(coordinator, accepted.executionId)).toMatchObject({ verdict: 'cancelled', error: 'ENOSPC dispatch marker' })
    expect(injected).toBe(true)
    expect((await coordinator.workbench.get(accepted.runId)).steps).toEqual([])
    expect((await new WorkbenchReferences(coordinator.workbench.store).list()).some(ref => ref.consumerId === accepted.executionId)).toBe(true)
  })

  it('surfaces terminal publication failure through close without unhandled rejection', async () => {
    const { coordinator } = await setup(true, (point, journal) => {
      if (point === 'temporary-synced' && journal.phase === 'finished') throw new Error('ENOSPC terminal marker')
    }, true)
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    const accepted = await coordinator.start({ requestId: 'terminal-failed', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }) as { executionId: string; runId: string }
    expect(await finish(coordinator, accepted.executionId)).toMatchObject({ verdict: 'inconclusive', evidenceVerification: 'failed' })
    expect((await new WorkbenchReferences(coordinator.workbench.store).list()).filter(ref => ref.consumerId === accepted.executionId)).toHaveLength(1)
    await expect(coordinator.close()).rejects.toThrow()
  })

  it('external asset grants bind current project version and cannot be bypassed via acceptance records', async () => {
    const { coordinator, root } = await setup(), service = coordinator.application.externalAssets
    const job = await service.preview(externalFixture())
    await expect.poll(async () => (await service.getJob(job.id)).phase).toBe('preview')
    const preview = await service.getJob(job.id)
    await service.confirm(job.id, { previewDigest: preview.previewDigest, reviewed: true })
    await expect(coordinator.externalResult(job.assetId)).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    const project = await coordinator.externalProject()
    await service.grant(job.assetId, project, true)
    const result = await coordinator.externalResult(job.assetId)
    expect(result.reportedStatus).toBe('reported-pass'); expect(JSON.stringify(result)).not.toMatch(/private-test|private-secret/)
    expect(await service.authorized(job.assetId, { ...project, identity: 'e'.repeat(64) })).toBe(false)
    const input = acceptanceFixture().input, asset = await service.get(job.assetId)
    input.cells[0]!.appId = 'com.example.mobilemirror.mock'; delete input.cells[0]!.runId
    input.cells[0]!.externalResults = [{ assetId: job.assetId, testId: asset.asset.parsed.tests[0]!.id }]
    const acceptance = coordinator.application.acceptanceRecords, recordPreview = await acceptance.preview(input), id = randomUUID()
    const publication = await acceptance.publish({ id, expectedRevision: 0, previewId: recordPreview.previewId, previewDigest: recordPreview.previewDigest, requestKey: randomUUID(), reviewed: true })
    await expect.poll(async () => (await acceptance.getJob(publication.jobId)).phase).toBe('finished')
    expect(await coordinator.acceptanceRecord(id)).toMatchObject({ current: { status: 'incomplete' } })
    await expect(service.retire(job.assetId)).rejects.toThrow('referenced')
    await service.grant(job.assetId, project, false)
    await expect(coordinator.acceptanceRecord(id)).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    await expect(coordinator.externalResult(job.assetId)).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    await service.grant(job.assetId, project, true)
    await writeFile(join(root, 'fixture.yaml'), 'name: Changed\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- done\n')
    await expect(coordinator.externalResult(job.assetId)).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    await acceptance.retire(id); expect((await service.retire(job.assetId)).retired).toBe(true)
  }, 15_000)
  it('acceptance lookup is metadata-only, ownership-scoped and follows current project permissions', async () => {
    const { coordinator, projectPath } = await setup()
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    const accepted = await coordinator.start({ requestId: 'acceptance-query', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }) as { executionId: string; runId: string }
    await finish(coordinator, accepted.executionId)
    const publish = async (foreign = false) => {
      const input = acceptanceFixture().input
      input.cells[0]!.runId = accepted.runId
      input.cells[0]!.appId = foreign ? 'foreign.app' : 'com.example.mobilemirror.mock'
      const service = coordinator.application.acceptanceRecords, preview = await service.preview(input), id = randomUUID()
      const job = await service.publish({ id, expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true })
      await expect.poll(async () => (await service.getJob(job.jobId)).phase).toBe('finished')
      return id
    }
    const id = await publish()
    const result = await coordinator.acceptanceRecord(id)
    expect(result).toMatchObject({ id, current: { status: 'incomplete', cells: [{ dimensions: { business: 'withheld', cleanup: 'withheld' } }] } })
    expect(result).not.toHaveProperty('input')
    expect(JSON.stringify(result)).not.toMatch(/base64|Agent fixture|fixture.yaml/)
    await expect(coordinator.acceptanceRecord(await publish(true))).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    await expect(coordinator.acceptanceRecord(randomUUID())).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    await writeFile(projectPath, JSON.stringify({ flows: {} }))
    await expect(coordinator.acceptanceRecord(id)).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
  })
  it('discovers, durably accepts, deduplicates and exposes verified evidence', async () => {
    const { coordinator } = await setup()
    const catalog = await coordinator.catalog() as { catalogRevision: string; items: Array<{ id: string }> }
    expect(catalog.items.map((entry) => entry.id)).toEqual(['fixture', 'smoke'])
    const request = { requestId: 'same-request', target: { kind: 'flow' as const, id: 'fixture' }, catalogRevision: catalog.catalogRevision }
    const accepted = await coordinator.start(request) as { executionId: string; runId: string; phase: string }
    expect(accepted).toMatchObject({ phase: 'accepted' })
    const duplicate = await coordinator.start(request) as { executionId: string }
    expect(duplicate.executionId).toBe(accepted.executionId)
    await expect(coordinator.start({ ...request, target: { kind: 'suite', id: 'smoke' } })).rejects.toMatchObject({ code: 'mobile_mirror_request_conflict' })
    const status = await finish(coordinator, accepted.executionId)
    expect(status).toMatchObject({ verdict: 'pass', evidenceVerification: 'verified', runId: accepted.runId,
      resultProjection: { reportedVerdict: 'pass', verdict: 'pass', verification: { visual: { status: 'not-performed' } } },
      task: { contractVersion: 1, kind: 'test-run', phase: 'finished', result: { exitCode: 0 } } })
    const list = await coordinator.evidence({ executionId: accepted.executionId }) as { items: Array<{ artifactId: string; kind: string }> }
    const flow = list.items.find((entry) => entry.kind === 'flow')!
    const text = await coordinator.evidence({ executionId: accepted.executionId, artifactId: flow.artifactId, format: 'text' })
    expect(text).toMatchObject({ truncated: false })
    expect(JSON.stringify(text)).toContain('Agent fixture')
  }, 15_000)

  it('reports evidence corruption without rewriting the original execution verdict', async () => {
    const { coordinator, root } = await setup()
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    const accepted = await coordinator.start({ requestId: 'corrupt-proof', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }) as { executionId: string; runId: string }
    await finish(coordinator, accepted.executionId)
    const list = await coordinator.evidence({ executionId: accepted.executionId }) as { items: Array<{ artifactId: string; kind: string }> }
    const flow = list.items.find((entry) => entry.kind === 'flow')!
    await writeFile(join(root, 'runs', accepted.runId, 'flow.yaml'), 'tampered')
    await expect(coordinator.evidence({ executionId: accepted.executionId, artifactId: flow.artifactId, format: 'text' })).rejects.toMatchObject({ code: 'mobile_mirror_artifact_corrupt' })
    await expect(coordinator.status({ executionId: accepted.executionId })).resolves.toMatchObject({ verdict: 'inconclusive', evidenceVerification: 'failed',
      resultProjection: { reportedVerdict: 'pass', verdict: 'inconclusive', evidenceAvailability: 'unavailable' } })
    expect((await coordinator.workbench.store.get(accepted.runId)).verdict).toBe('pass')
  }, 15_000)

  it('keeps a durable Agent request tombstone after media purge and never replays the device action', async () => {
    const { coordinator, root, mirror, policy } = await setup()
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    const request = { requestId: 'purged-evidence', target: { kind: 'flow' as const, id: 'fixture' }, catalogRevision: catalog.catalogRevision }
    const accepted = await coordinator.start(request) as { executionId: string; runId: string }
    expect(await finish(coordinator, accepted.executionId)).toMatchObject({ verdict: 'pass' })
    const journal = JSON.parse(await readFile(join(root, 'runs', 'agent-executions', `${accepted.executionId}.json`), 'utf8'))
    expect(journal.referencePublications[accepted.runId].retiredAt).toBeTruthy()
    expect((await new WorkbenchReferences(coordinator.workbench.store).list()).filter(ref => ref.consumerId === accepted.executionId)).toEqual([])
    const retention = new WorkbenchRetention(coordinator.workbench.store)
    const plan = await retention.plan(0)
    expect(plan.candidates.map(item => item.id)).toContain(accepted.runId)
    expect((await retention.confirm(plan)).moved).toContain(accepted.runId)
    const unavailable = await coordinator.status({ requestId: request.requestId }) as Record<string, unknown>
    expect(unavailable).toMatchObject({ verdict: 'inconclusive', exitCode: 2, evidenceVerification: 'failed',
      resultProjection: { reportedVerdict: 'pass', verdict: 'inconclusive', evidenceAvailability: 'unavailable', clean: false } })
    await expect(coordinator.evidence({ requestId: request.requestId })).rejects.toMatchObject({ code: 'mobile_mirror_artifact_unavailable' })
    await retention.purge(accepted.runId, `PURGE ${accepted.runId}`)
    expect(await coordinator.start(request)).toMatchObject({ executionId: accepted.executionId, phase: 'finished' })
    expect((await coordinator.workbench.list()).some(run => run.id === accepted.runId)).toBe(false)
    await coordinator.close()
    const restarted = new TestRunCoordinator(mirror, policy, { root: join(root, 'runs') })
    cleanups.push(() => restarted.close())
    expect(await restarted.start(request)).toMatchObject({ executionId: accepted.executionId, phase: 'finished' })
    expect(await restarted.status({ requestId: request.requestId })).toMatchObject({ verdict: 'inconclusive', exitCode: 2,
      resultProjection: { reportedVerdict: 'pass', evidenceAvailability: 'unavailable' } })
  }, 20_000)

  it('fails closed for disabled, changed and unregistered projects without running', async () => {
    const disabled = await setup(false)
    await expect(disabled.coordinator.catalog()).rejects.toMatchObject({ code: 'mobile_mirror_not_enabled' })
    const { coordinator, projectPath } = await setup()
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    await writeFile(projectPath, JSON.stringify({ flows: {}, suites: {} }))
    await expect(coordinator.start({ requestId: 'changed', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision })).rejects.toMatchObject({ code: 'mobile_mirror_project_changed' })
    const refreshed = await coordinator.catalog() as { catalogRevision: string }
    await expect(coordinator.start({ requestId: 'missing', target: { kind: 'flow', id: 'fixture' }, catalogRevision: refreshed.catalogRevision })).rejects.toMatchObject({ code: 'mobile_mirror_not_registered' })
  })

  it('runs a registered suite and rejects cross-execution evidence', async () => {
    const { coordinator } = await setup()
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    const first = await coordinator.start({ requestId: 'suite-1', target: { kind: 'suite', id: 'smoke' }, catalogRevision: catalog.catalogRevision }) as { executionId: string; suiteId: string }
    const done = await finish(coordinator, first.executionId)
    expect(done).toMatchObject({ verdict: 'pass', exitCode: 0, totalCases: 1 })
    const firstEvidence = await coordinator.evidence({ executionId: first.executionId }) as { items: Array<{ artifactId: string }> }
    const second = await coordinator.start({ requestId: 'flow-2', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }) as { executionId: string }
    await finish(coordinator, second.executionId)
    await expect(coordinator.evidence({ executionId: second.executionId, artifactId: firstEvidence.items[0]!.artifactId, format: 'text' })).rejects.toBeInstanceOf(TestRunControlError)
    const suite = await coordinator.suites.get(first.suiteId), attempt = suite.cases[0]!.attempts[0]!
    const ledger = new WorkbenchReferences(coordinator.workbench.store), retention = new WorkbenchRetention(coordinator.workbench.store)
    expect(suite.referencePublications?.[attempt]?.retiredAt).toBeUndefined()
    expect((await ledger.list()).filter(ref => ref.consumerKind === 'workbench:suite' && ref.consumerId === first.suiteId)).toHaveLength(1)
    expect((await retention.snapshot()).runs.find(item => item.id === attempt)?.protectedBy).toContain('suite')
    await coordinator.suites.freezeForRetention(first.suiteId)
    expect((await coordinator.suites.get(first.suiteId)).referencePublications?.[attempt]?.retiredAt).toBeTruthy()
    expect((await ledger.list()).filter(ref => ref.consumerId === first.suiteId)).toEqual([])
    await retention.confirm(await retention.plan(0))
    // Retrying freeze after media removal uses the durable frozen facts, not the deleted manifest.
    await expect(coordinator.suites.freezeForRetention(first.suiteId)).resolves.toBeDefined()
  }, 20_000)

  it('cancels after durable acceptance without opening the execute gate', async () => {
    const { coordinator, root } = await setup()
    await writeFile(join(root, 'fixture.yaml'), 'name: Cancel before dispatch\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- wait: 30\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    const catalog = await coordinator.catalog() as { catalogRevision: string }
    const accepted = await coordinator.start({ requestId: 'cancel-at-accept', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }) as { executionId: string; runId: string }
    await coordinator.cancel(accepted.executionId)
    const status = await finish(coordinator, accepted.executionId)
    expect(status).toMatchObject({ verdict: 'cancelled' })
    const run = await coordinator.workbench.get(accepted.runId)
    expect(run.steps.some((step) => step.status === 'passed')).toBe(false)
  }, 15_000)

  it.each(['temporary-synced', 'renamed', 'directory-synced'] as const)('recovers a crash at the %s acceptance boundary without replay', async (crashPoint) => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-agent-crash-'))
    const projectPath = join(root, 'project.json'), runsRoot = join(root, 'runs')
    await writeFile(join(root, 'fixture.yaml'), 'name: Crash fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    await writeFile(projectPath, JSON.stringify({ flows: { fixture: 'fixture.yaml' } }))
    const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => new MockProvider(0) })
    await mirror.start({ provider: 'mock' })
    const policy = {
      enabled: true, projectPath, allowedFlows: ['fixture'], allowedSuites: [], allowedPlatforms: ['ios' as const],
      allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: ['flow' as const],
    }
    let injected = false
    const crashed = new TestRunCoordinator(mirror, policy, { root: runsRoot, journalWriteHook(point) {
      if (!injected && point === crashPoint) { injected = true; throw new Error(`simulated crash at ${point}`) }
    } })
    cleanups.push(async () => { await crashed.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
    const catalog = await crashed.catalog() as { catalogRevision: string }
    const request = { requestId: `crash-${crashPoint}`, target: { kind: 'flow' as const, id: 'fixture' }, catalogRevision: catalog.catalogRevision }
    await expect(crashed.start(request)).rejects.toThrow(`simulated crash at ${crashPoint}`)
    await crashed.close()

    const restarted = new TestRunCoordinator(mirror, policy, { root: runsRoot })
    cleanups.push(() => restarted.close())
    if (crashPoint === 'temporary-synced') {
      await expect(restarted.status({ requestId: request.requestId })).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
      const accepted = await restarted.start(request) as { executionId: string }
      await expect(finish(restarted, accepted.executionId)).resolves.toMatchObject({ verdict: 'pass' })
    } else {
      const recovered = await restarted.status({ requestId: request.requestId }) as Record<string, unknown>
      expect(recovered).toMatchObject({ phase: 'finished', verdict: 'inconclusive', error: 'Interrupted; execution was not replayed' })
      const duplicate = await restarted.start(request) as { executionId: string }
      expect(duplicate.executionId).toBe(recovered.executionId)
      expect(restarted.workbench.activeId).toBeNull()
    }
  }, 20_000)
})
