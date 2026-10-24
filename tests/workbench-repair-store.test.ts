import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchRepairStore } from '../src/workbench-repair-store.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { repairPlanSchema, repairCaseSchema, repairBudgetSchema, repairCandidateSchema,
  repairApprovalSchema, repairAttemptSchema } from '../src/workbench-repair-contracts.js'

const digest = 'a'.repeat(64), now = '2026-10-03T12:00:00.000Z'
const roots: string[] = [], stores: WorkbenchStore[] = []
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture(options: { capacity?: () => Promise<number>; cutpoint?: (point: string) => Promise<void> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'repair-store-')); roots.push(root)
  const store = new WorkbenchStore(root, options.capacity); stores.push(store); await store.init()
  const sourceId = randomUUID(), baselineId = randomUUID()
  for (const id of [sourceId, baselineId]) await store.save({ schemaVersion: 1, id, phase: 'finished', verdict: id === sourceId ? 'fail' : 'pass', name: 'original', yaml: 'original',
    engine: 'fixture', startedAt: now, endedAt: now, sessionId: 'session', deviceName: 'mock', platform: 'android', provider: 'mock',
    verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed', cleanup: 'session-retained', evidence: [], steps: [] })
  const sourceSnapshot = { runId: sourceId, manifestSha256: (await store.readOnlySnapshot(sourceId)).manifestSha256 }
  const planBody = { contractVersion: 1, id: randomUUID(), caseId: randomUUID(), projectId: 'fixture', projectRevision: digest,
    route: 'locator-maintenance', sourceSnapshot, baselineSnapshot: { runId: baselineId, manifestSha256: (await store.readOnlySnapshot(baselineId)).manifestSha256 },
    protectedAssertionsDigest: digest, dependencyDigest: digest, paramsDigest: digest, environmentDigest: digest, resetDigest: digest, baselineBuild: digest,
    platform: 'android', appId: 'com.example.fixture', target: 'mock', targetDeviceBinding: digest,
    requiredChecks: [{ id: 'original', kind: 'baseline', inputDigest: digest }, { id: 'candidate1', kind: 'candidate', inputDigest: digest },
      { id: 'candidate2', kind: 'candidate', inputDigest: digest }, { id: 'regression', kind: 'regression', inputDigest: digest }], budget: repairBudgetSchema.parse({}), createdAt: now }
  const plan = repairPlanSchema.parse({ ...planBody, digest: createHash('sha256').update(JSON.stringify(planBody)).digest('hex') })
  const createdAt = new Date()
  const record = repairCaseSchema.parse({ contractVersion: 1, id: plan.caseId, requestId: randomUUID(), requestDigest: digest, owner: 'local',
    projectId: plan.projectId, projectRevision: digest, sourceSnapshot, route: plan.route, planId: plan.id, planDigest: plan.digest,
    phase: 'planning', revision: 1, generation: 0, attempts: [], approvals: [], verificationIds: [], budget: plan.budget, spentExecutionMs: 0,
    createdAt: createdAt.toISOString(), updatedAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + plan.budget.lifetimeMs).toISOString() })
  return { root, store, plan, record, repair: new WorkbenchRepairStore(store, options.cutpoint) }
}

describe('repair durable journal', () => {
  it('durably records reset intent before a fixture action and does not complete it after restart', async () => {
    const { store, plan, record, repair } = await fixture()
    await repair.create(record, plan)
    const candidateBody = { status: 'candidate' as const, sourceRunId: record.sourceSnapshot.runId,
      baselineRunId: plan.baselineSnapshot!.runId, sourcePlanDigest: digest,
      sourceManifestSha256: record.sourceSnapshot.manifestSha256,
      baselineManifestSha256: plan.baselineSnapshot!.manifestSha256,
      failureEvidence: { name: 'failure.xml', sha256: digest }, baselineEvidence: { name: 'baseline.xml', sha256: digest },
      stepIndex: 1, sourceLine: 1, before: { key: 'accessibilityId' as const, value: 'old' },
      after: { key: 'accessibilityId' as const, value: 'new' }, semanticDiff: 'navigation target', yaml: 'fixture-flow' }
    const candidate = repairCandidateSchema.parse({ ...candidateBody, digest: createHash('sha256').update(JSON.stringify(candidateBody)).digest('hex') })
    const proposed = await repair.registerCandidate(record.id, 1, candidate)
    const issuedAt = new Date(), expiresAt = new Date(issuedAt.getTime() + 600_000)
    const approvalBase = { contractVersion: 1 as const, caseId: record.id, principal: 'local', channel: 'local-viewer' as const,
      planDigest: plan.digest, projectRevision: record.projectRevision, targetDeviceBinding: plan.targetDeviceBinding,
      issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() }
    const scope = repairApprovalSchema.parse({ ...approvalBase, id: randomUUID(), level: 'scope',
      allowedOperations: ['share-evidence', 'generate-patch'] })
    const scoped = await repair.appendApproval(record.id, proposed.revision, scope)
    const execution = repairApprovalSchema.parse({ ...approvalBase, id: randomUUID(), level: 'execution',
      patchDigest: candidate.digest, allowedOperations: ['baseline', 'revalidate', 'regress'] })
    const queued = await repair.appendApproval(record.id, scoped.revision, execution)
    const attempt = repairAttemptSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: record.id, generation: 1,
      requestDigest: record.requestDigest, patchDigest: candidate.digest, planDigest: plan.digest,
      createdAt: new Date().toISOString(), childRunIds: [], commandReceipts: [], artifactRefs: [],
      baselineRuns: 0, candidateRuns: 0, regressionRuns: 0, executionMs: 0 })
    const preparing = await repair.beginAttempt(record.id, queued.revision, attempt)
    const intent = await repair.prepareReset(record.id, preparing.revision, attempt.id, 'original')
    expect(intent.status).toBe('prepared')
    const restarted = new WorkbenchRepairStore(store)
    expect((await restarted.resets(record.id))[0]).toEqual(intent)
    await expect(restarted.completeReset(record.id, preparing.revision + 1, intent.id,
      { namespaceId: randomUUID(), initialStateSha256: digest, sessionId: 'mock-session' }))
      .rejects.toThrow('repair-unknown-mutation')
    const receipt = await repair.completeReset(record.id, preparing.revision + 1, intent.id,
      { namespaceId: randomUUID(), initialStateSha256: digest, sessionId: 'mock-session' })
    expect(receipt.status).toBe('completed')
    expect((await restarted.resets(record.id))[0]).toEqual(intent) // A loaded snapshot never silently changes.
    await restarted.rebuildIndex()
    expect((await restarted.resets(record.id))[0]).toEqual(receipt)
    await expect(repair.prepareReset(record.id, preparing.revision + 2, attempt.id, 'original')).rejects.toThrow('repair-ineligible')
  })
  it('deduplicates concurrent requests and preserves the source manifest', async () => {
    const { root, store, plan, record, repair } = await fixture()
    const before = await readFile(join(root, record.sourceSnapshot.runId, 'manifest.json'), 'utf8')
    const [a, b] = await Promise.all([repair.create(record, plan), repair.create(record, plan)])
    expect(a).toEqual(b)
    expect((await new WorkbenchReferences(store).list()).map(item => item.consumerKind)).toEqual(['workbench:repair', 'workbench:repair'])
    expect(await readFile(join(root, record.sourceSnapshot.runId, 'manifest.json'), 'utf8')).toBe(before)
    await expect(repair.create({ ...record, requestDigest: 'b'.repeat(64) }, plan)).rejects.toThrow('repair-request-conflict')
    await expect(repair.create({ ...record, phase: 'queued' }, plan)).rejects.toThrow('repair-invalid-contract')
  })

  it('enforces CAS and immutable identities, budgets and histories', async () => {
    const { plan, record, repair } = await fixture()
    await repair.create(record, plan)
    const next = await repair.update(record.id, 1, value => ({ ...value, revision: 2, phase: 'awaiting-approval' }))
    expect(next.revision).toBe(2)
    await expect(repair.update(record.id, 1, value => ({ ...value, revision: 2 }))).rejects.toThrow('repair-revision-conflict')
    for (const change of [{ attempts: [randomUUID()] }, { approvals: [randomUUID()] }, { verificationIds: [randomUUID()] },
      { generation: -1 }, { requestId: randomUUID() }, { expiresAt: '2026-10-05T12:00:00.000Z' }])
      await expect(repair.update(record.id, 2, value => ({ ...value, revision: 3, ...change }))).rejects.toThrow('repair-invalid-contract')
    await expect(repair.update(record.id, 2, value => ({ ...value, revision: 3, phase: 'finished', outcome: 'device-verified' })))
      .rejects.toThrow('repair-invalid-contract')
    expect(await repair.get(record.id)).toEqual(next)
  })

  it('rebuilds disposable indexes from the journal and pages only the requested owner/project', async () => {
    const { root, store, plan, record, repair } = await fixture()
    await repair.create(record, plan)
    await writeFile(join(root, 'repairs', record.id, 'case.json'), 'corrupt disposable cache')
    const restarted = new WorkbenchRepairStore(store)
    expect(await restarted.get(record.id)).toEqual(record)
    await restarted.rebuildIndex()
    expect((await restarted.list('fixture', 'local', { limit: 1 })).items).toHaveLength(1)
    expect((await restarted.list('other', 'local')).items).toEqual([])
    expect((await restarted.list('fixture', 'other')).items).toEqual([])
    expect((await restarted.list('fixture', 'local', { after: record.id })).items).toEqual([])
    await expect(restarted.list('fixture', 'local', { limit: 101 })).rejects.toThrow('repair-invalid-contract')
  })

  it.each(['journal:before-write', 'publication:after-reference'])('keeps protective references when publication fails at %s', async point => {
    const { store, plan, record, repair } = await fixture({ cutpoint: async phase => { if (phase === point) throw Object.assign(new Error('disk-full'), { code: 'ENOSPC' }) } })
    await expect(repair.create(record, plan)).rejects.toThrow('disk-full')
    expect((await new WorkbenchReferences(store).list()).length).toBeGreaterThan(0)
    await expect(new WorkbenchRepairStore(store).get(record.id)).rejects.toThrow('repair-not-found')
  })

  it('recovers a committed journal after cache publication fails without accepting the request twice', async () => {
    const { store, plan, record, repair } = await fixture({ cutpoint: async phase => { if (phase === 'journal:after-commit') throw new Error('interrupted') } })
    await expect(repair.create(record, plan)).rejects.toThrow('interrupted')
    const restarted = new WorkbenchRepairStore(store)
    expect(await restarted.get(record.id)).toEqual(record)
    expect(await restarted.create(record, plan)).toEqual(record)
    expect((await new WorkbenchReferences(store).list()).length).toBe(2)
  })

  it.each([async () => 256 * 1024 * 1024, async () => NaN, async () => { throw new Error('statfs unavailable') }])('rejects unknown/insufficient capacity before publication', async capacity => {
    const { store, plan, record, repair } = await fixture({ capacity })
    await expect(repair.create(record, plan)).rejects.toThrow('repair-storage-insufficient')
    expect(await new WorkbenchReferences(store).list()).toEqual([])
  })

  it('fails closed on broken journal integrity and missing references', async () => {
    const { root, store, plan, record, repair } = await fixture()
    await repair.create(record, plan)
    const path = join(root, 'repairs', record.id, 'revision-0001.json')
    const contents = await readFile(path, 'utf8')
    await writeFile(path, contents.replace('planning', 'checking'))
    await expect(new WorkbenchRepairStore(store).get(record.id)).rejects.toThrow('repair-invalid-contract')
    await writeFile(path, contents)
    const ref = (await new WorkbenchReferences(store).list())[0]!
    await rm(join(root, 'references', `${ref.refId}.json`))
    await expect(repair.get(record.id)).rejects.toThrow('repair-reference-invalid')
  })

  it('protects child evidence before execution and retires only finished consumers', async () => {
    const { store, plan, record, repair } = await fixture()
    await repair.create(record, plan)
    await expect(repair.retire(record.id, 1)).rejects.toThrow('repair-ineligible')
    const child = { ...await store.get(record.sourceSnapshot.runId), id: randomUUID(), parentRunId: record.sourceSnapshot.runId }
    await store.save(child)
    const next = await repair.protectChild(record.id, 1, child.id)
    expect(next.revision).toBe(2)
    expect((await new WorkbenchReferences(store).list()).some(ref => ref.targetRunId === child.id)).toBe(true)
    await repair.update(record.id, 2, value => ({ ...value, revision: 3, phase: 'finished', outcome: 'cancelled' }))
    await expect(repair.update(record.id, 3, value => ({ ...value, revision: 4, phase: 'queued' }))).rejects.toThrow('repair-ineligible')
    await repair.retire(record.id, 3)
    await repair.retire(record.id, 3)
    expect(await new WorkbenchReferences(store).list()).toEqual([])
    expect((await new WorkbenchRepairStore(store).get(record.id)).outcome).toBe('cancelled')
    expect((await store.get(record.sourceSnapshot.runId)).verdict).toBe('fail')
  })

  it('persists the retirement marker before revocation and resumes after interruption', async () => {
    let interrupt = false
    const { store, plan, record, repair } = await fixture({ cutpoint: async phase => { if (interrupt && phase === 'retirement:after-tombstone') throw new Error('interrupted retirement') } })
    await repair.create(record, plan)
    await repair.update(record.id, 1, value => ({ ...value, revision: 2, phase: 'finished', outcome: 'cancelled' }))
    interrupt = true
    await expect(repair.retire(record.id, 2)).rejects.toThrow('interrupted retirement')
    expect((await new WorkbenchReferences(store).list()).length).toBe(2)
    const restarted = new WorkbenchRepairStore(store)
    await restarted.retire(record.id, 2)
    expect(await new WorkbenchReferences(store).list()).toEqual([])
    expect((await restarted.get(record.id)).revision).toBe(3)
  })
})
