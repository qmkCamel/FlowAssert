import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMirrorConfig as Config } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchStore } from '../src/workbench-store.js'
import { compilePlan } from '../src/workbench-plan.js'
import { emptyProject, type ProjectSnapshot } from '../src/workbench-project.js'
import { repairProjectSchema, type RepairProjectPolicy } from '../src/workbench-repair-project.js'
import { factDigest, stepDigest } from '../src/workbench-tap-facts.js'
import { sourceTapIndex, trustedMissingTap } from '../src/workbench-repair-evidence.js'
import { assertLocatorOnlyDiff } from '../src/workbench-repair-diff.js'
import { WorkbenchRepair } from '../src/workbench-repair.js'
import { admitLocatorProposal, classifyRepairFailure } from '../src/workbench-repair-admission.js'
import { assertFrozenPlan, freezeLocatorPlan } from '../src/workbench-repair-freeze.js'
import { WorkbenchRepairCoordinator } from '../src/workbench-repair-coordinator.js'
import { WorkbenchApplication } from '../src/workbench-application.js'
import { WorkbenchRepairStore } from '../src/workbench-repair-store.js'
import { repairAttemptSchema } from '../src/workbench-repair-contracts.js'
import { WorkbenchSuites } from '../src/workbench-suites.js'
import { recordedTapIndices } from '../src/workbench-recorded-tap.js'
import { randomUUID } from 'node:crypto'
import type { ProviderScreenSource } from '../src/types.js'

const demo = await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8')
const trustedPage = { version: 2 as const, anchor: { role: 'text' as const, identifier: 'mock-page', text: 'Hello, harness.' },
  container: { ancestorLevels: 1, platformRole: 'XCUIElementTypeOther', identifier: 'mock-page-container' } }
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function project(yaml = demo, enabled = true, tap = 3, post = 4): ProjectSnapshot & { repair: RepairProjectPolicy } {
  return { ...emptyProject(), flows: { demo: yaml }, repair: repairProjectSchema.parse({ projectId: 'sample', enabled,
    allowedFlows: ['demo'], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'],
    navigation: [{ flow: 'demo', stepPath: `root/${tap}`, postconditionPath: `root/${post}` }] }) }
}
class ControlledProvider extends MockProvider {
  writes = 0
  mode = 'normal'
  stableAnchor = false
  override async screenSource(): Promise<ProviderScreenSource> {
    const source = await super.screenSource()
    if (source.kind !== 'normalized') return source
    const node = source.structure.nodes.find(n => n.identifier === 'action-card')!
    const title = source.structure.nodes.find(n => n.role === 'text')!
    title.identifier = 'mock-page'; title.parentId = node.parentId = 'page-container'
    source.structure.nodes.push({ nodeId: 'page-container', parentId: 'n0', role: 'unknown', platformRole: 'XCUIElementTypeOther',
      identifier: 'mock-page-container', visible: true, enabled: true, bounds: { x: 0, y: 100, width: 390, height: 400 } })
    if (this.stableAnchor) node.name = 'Navigation'
    if (this.mode === 'missing') node.identifier = 'new-action-card'
    if (this.mode === 'ambiguous') source.structure.nodes.push({ ...node, nodeId: 'duplicate' })
    if (this.mode === 'truncated') source.structure.truncated = true
    if (this.mode === 'disabled') node.enabled = false
    if (this.mode === 'hidden') node.visible = false
    if (this.mode === 'zero-bounds') node.bounds = { x: 10, y: 10, width: 0, height: 0 }
    if (this.mode === 'sensitive') node.sensitive = true
    if (this.mode === 'wrong-page') title.text = 'Other screen'
    if (this.mode === 'wrong-semantic') node.name = 'Delete account'
    return source
  }
  override async action(action: Parameters<MockProvider['action']>[0]) {
    this.writes++
    await super.action(action)
    if (this.mode === 'unknown') throw new Error('provider lost reply after mutation')
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-tap-facts-')), provider = new ControlledProvider(0)
  const mirror = new MirrorService(Config({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
  await mirror.start({ provider: 'mock' })
  const store = new WorkbenchStore(root), workbench = new WorkbenchService(mirror, { store })
  cleanups.push(async () => { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
  return { provider, mirror, store, workbench }
}

async function approvedMockCase(useApplication = false) {
  const { provider, mirror, workbench, store } = await setup()
  provider.stableAnchor = true
  const yaml = demo.replace('1 actions received', 'Hello, harness.')
  const registered = project(yaml)
  registered.repair.permissions = ['plan', 'verify']
  registered.repair.navigation[0]!.page = trustedPage
  registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
  registered.repair.regressionFlows = ['regression']
  registered.flows.regression = yaml.replace('- tap:\n    accessibilityId: action-card\n', '')
  registered.provenance = { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1', resetContractVersion: 'reset-v1' }
  const baseline = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
  provider.mode = 'missing'
  const failure = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
  const application = useApplication ? new WorkbenchApplication(mirror, { workbench, repairProjectLoader: async () => registered }) : undefined
  if (application) cleanups.push(() => application.close())
  const suites = application?.suites ?? new WorkbenchSuites(workbench)
  if (!application) cleanups.push(() => suites.close())
  const coordinator = application?.repairCases ?? new WorkbenchRepairCoordinator(workbench, suites, async () => registered)
  const created = await coordinator.create({ requestId: randomUUID(), sourceRunId: failure.id,
    baselineRunId: baseline.id, flowId: 'demo' }, 'owner')
  const scope = await coordinator.approvalChallenge(created.id, 'owner', created.revision, 'scope')
  const scoped = await coordinator.approve(created.id, 'owner', created.revision, scope.nonce)
  const execution = await coordinator.approvalChallenge(created.id, 'owner', scoped.revision, 'execution')
  const queued = await coordinator.approve(created.id, 'owner', scoped.revision, execution.nonce)
  return { provider, mirror, workbench, store, coordinator, queued, failure, application }
}

describe('local ordinary tap facts through the real workbench', () => {
  it.each(['normal', 'wrong-page'])('refuses an old App-root grant on %s even with an existing target', async mode => {
    const { provider, workbench } = await setup(); provider.mode = mode; provider.stableAnchor = true
    const yaml = mode === 'wrong-page' ? demo.replaceAll('Hello, harness.', 'Other screen') : demo
    const registered = project(yaml)
    registered.repair.navigation[0]!.page = { role: 'application', name: 'FlowAssert demo' }
    registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
    const run = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    const finished = await workbench.get(run.id)
    expect(finished.steps.find(s => s.kind === 'tap')?.tapFact).toMatchObject({ outcome: 'blocked', dispatch: 'not-dispatched' })
    expect(provider.writes).toBe(0)
  }, 20000)
  it('retains a blocked not-dispatched fact if the page changes after intent persistence', async () => {
    const { provider, workbench, store } = await setup(); provider.stableAnchor = true
    const yaml = demo.replace('1 actions received', 'Hello, harness.'), registered = project(yaml)
    registered.repair.navigation[0]!.page = trustedPage
    registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
    const save = store.save.bind(store)
    vi.spyOn(store, 'save').mockImplementation(async run => {
      if (run.dispatches?.some(d => d.operation === 'recorded-navigation-tap' && d.state === 'dispatched')) provider.mode = 'wrong-page'
      return save(run)
    })
    const started = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    const run = await workbench.get(started.id), step = run.steps.find(s => s.kind === 'tap')!
    expect(provider.writes).toBe(0)
    expect(run.dispatches?.filter(d => d.operation === 'recorded-navigation-tap').map(d => d.state)).toEqual(['not-dispatched'])
    expect(step.tapFact).toMatchObject({ outcome: 'blocked', dispatch: 'not-dispatched' })
    expect(await trustedMissingTap(store, run, step)).toBeUndefined()
  }, 20000)
  it.each(['normal', 'missing', 'ambiguous', 'truncated', 'disabled', 'hidden', 'zero-bounds', 'sensitive', 'unknown'])('%s never turns uncertainty into missing-target', async mode => {
    const { provider, workbench, store } = await setup(); provider.mode = mode
    const run = await workbench.start(demo, undefined, undefined, { project: project(), flowId: 'demo' })
    await workbench.wait()
    const finished = await workbench.get(run.id), tap = finished.steps.find(s => s.kind === 'tap')!
    expect(tap, JSON.stringify(finished)).toBeDefined()
    expect(tap.sourceStep).toMatchObject({ path: 'root/3', documentSha256: factDigest(demo), topLevel: true, static: true })
    expect(tap.path).toBe('root/1/3')
    expect(sourceTapIndex(finished, tap)).toBe(2)
    expect(provider.writes, JSON.stringify({ error: finished.error, tap })).toBe(['normal', 'unknown'].includes(mode) ? 1 : 0)
    if (mode === 'normal') {
      expect(finished.verdict, JSON.stringify(finished)).toBe('pass')
      expect(tap.tapFact).toMatchObject({ outcome: 'passed', dispatch: 'settled', resolution: { matches: 1 } })
      expect(finished.steps[3]?.sourceStep?.path).toBe('root/4')
    } else if (mode === 'missing') {
      expect(finished.verdict).toBe('fail')
      expect(tap.tapFact).toMatchObject({ outcome: 'target-not-found', dispatch: 'not-dispatched', resolution: { matches: 0 } })
      expect(await trustedMissingTap(store, finished, tap)).toBeDefined()
      const forged = structuredClone(finished); delete forged.steps[2]!.tapFact
      forged.steps[2]!.error = 'target-not-found; not-dispatched'
      expect(await trustedMissingTap(store, forged, forged.steps[2]!)).toBeUndefined()
      const changed = structuredClone(tap); changed.tapFact!.sessionGeneration++
      expect(await trustedMissingTap(store, finished, changed)).toBeUndefined()
    } else {
      expect(finished.verdict).not.toBe('pass')
      expect(tap.tapFact?.outcome).not.toBe('target-not-found')
      expect(await trustedMissingTap(store, finished, tap)).toBeUndefined()
      if (mode === 'unknown') expect(tap.tapFact).toMatchObject({ dispatch: 'unknown', outcome: 'unknown' })
      if (mode === 'ambiguous') expect(tap.tapFact).toMatchObject({ outcome: 'ambiguous-target', dispatch: 'not-dispatched' })
    }
  }, 20000)

  it.each(['source', 'resolution', 'fact'])('write failure at %s does not grant an automatic repair', async kind => {
    const { provider, workbench, store } = await setup()
    // A failed fact write after missing-target must not publish a usable receipt.
    if (kind === 'fact') provider.mode = 'missing'
    const put = store.put.bind(store)
    vi.spyOn(store, 'put').mockImplementation(async (...args) => {
      if (args[1].includes(`tap-${kind}.`)) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })
      return put(...args)
    })
    const run = await workbench.start(demo, undefined, undefined, { project: project() }); await workbench.wait()
    const finished = await workbench.get(run.id), tap = finished.steps.find(s => s.kind === 'tap')!
    expect(provider.writes).toBe(0)
    expect(tap.tapFact).toBeUndefined()
    expect(await trustedMissingTap(store, finished, tap)).toBeUndefined()
  }, 20000)

  it('cancels during durable observation without dispatch, and retains evidence', async () => {
    const { provider, workbench, store } = await setup()
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(r => { release = r }), observed = new Promise<void>(r => { entered = r })
    const put = store.put.bind(store)
    vi.spyOn(store, 'put').mockImplementation(async (...args) => {
      if (args[1].endsWith('tap-resolution.json')) { entered(); await gate }
      return put(...args)
    })
    const run = await workbench.start(demo, undefined, undefined, { project: project() })
    await observed
    const cancelling = workbench.cancel(run.id)
    release(); await cancelling; await workbench.wait()
    const finished = await workbench.get(run.id), tap = finished.steps.find(s => s.kind === 'tap')!
    expect(finished.verdict).toBe('cancelled'); expect(provider.writes).toBe(0)
    expect(tap.tapFact?.outcome).toBe('cancelled')
    expect(await trustedMissingTap(store, finished, tap)).toBeUndefined()
  }, 20000)

  it('keeps disabled registration on the unchanged native path', async () => {
    const { provider, workbench } = await setup()
    const run = await workbench.start(demo, undefined, undefined, { project: project(demo, false) }); await workbench.wait()
    const finished = await workbench.get(run.id)
    expect(finished.verdict).toBe('pass'); expect(provider.writes).toBe(1)
    expect(finished.steps.find(s => s.kind === 'tap')?.tapFact).toBeUndefined()
  }, 20000)

  it.each(['wrong-page', 'wrong-semantic'])('blocks a freshly mismatched %s before dispatch', async mode => {
    const { provider, workbench } = await setup()
    provider.stableAnchor = true
    const registered = project()
    registered.repair.navigation[0]!.page = trustedPage
    registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
    provider.mode = mode
    const yaml = mode === 'wrong-page' ? demo.replaceAll('Hello, harness.', 'Other screen') : demo
    registered.flows.demo = yaml
    const run = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    const finished = await workbench.get(run.id)
    expect(finished.verdict).not.toBe('pass')
    expect(finished.steps.find(step => step.kind === 'tap')?.tapFact?.outcome).toBe('blocked')
    expect(provider.writes).toBe(0)
  }, 20000)

  it('allows the exact registered page and semantic target', async () => {
    const { provider, workbench } = await setup()
    provider.stableAnchor = true
    const yaml = demo.replace('1 actions received', 'Hello, harness.')
    const registered = project(yaml)
    registered.repair.navigation[0]!.page = trustedPage
    registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
    const run = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    const finished = await workbench.get(run.id)
    expect(finished.verdict, JSON.stringify({ error: finished.error, steps: finished.steps.map(step => ({ kind: step.kind, status: step.status, error: step.error, fact: step.tapFact })) })).toBe('pass')
    expect(provider.writes).toBe(1)
  }, 20000)

  it('uses source identity and pre-action evidence for a real baseline/candidate draft', async () => {
    const { provider, workbench, store } = await setup()
    provider.stableAnchor = true
    const yaml = demo.replace('1 actions received', 'Hello, harness.')
    const baseline = await workbench.start(yaml, undefined, undefined, { project: project(yaml) }); await workbench.wait()
    provider.mode = 'missing'
    const failure = await workbench.start(yaml, undefined, undefined, { project: project(yaml) }); await workbench.wait()
    const before = await store.readOnlySnapshot(failure.id)
    const proposal = await new WorkbenchRepair(store).suggest(failure.id, baseline.id)
    expect(proposal, JSON.stringify(proposal)).toMatchObject({ status: 'candidate', before: { value: 'action-card' }, after: { value: 'new-action-card' } })
    expect((await store.readOnlySnapshot(failure.id)).manifestSha256).toBe(before.manifestSha256)
  }, 20000)

  it('admits only a scoped, matching environment and original postcondition', async () => {
    const { provider, workbench, store } = await setup()
    provider.stableAnchor = true
    const yaml = demo.replace('1 actions received', 'Hello, harness.')
    const registered = project(yaml)
    registered.repair.permissions = ['plan']
    registered.repair.navigation[0]!.page = trustedPage
    registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
    registered.provenance = { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1', resetContractVersion: 'reset-v1' }
    const baseline = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    provider.mode = 'missing'
    const failure = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    const source = await workbench.get(failure.id)
    expect(await classifyRepairFailure(store, source)).toMatchObject({ kind: 'locator-drift-candidate', stepIndex: 3 })
    expect(await admitLocatorProposal(store, registered, failure.id, baseline.id, 'demo')).toMatchObject({ status: 'candidate' })
    await expect(admitLocatorProposal(store, { ...registered, flows: { demo: yaml.replace('Hello, harness.', 'changed') } }, failure.id, baseline.id, 'demo'))
      .rejects.toThrow('repair-not-found')
    await expect(admitLocatorProposal(store, { ...registered, provenance: { ...registered.provenance, testDataVersion: 'changed' } }, failure.id, baseline.id, 'demo'))
      .rejects.toThrow('repair-ineligible')
    const postChanged = project(yaml, true, 3, 5)
    postChanged.repair.permissions = ['plan']
    await expect(admitLocatorProposal(store, postChanged, failure.id, baseline.id, 'demo')).rejects.toThrow('repair-ineligible')
    const textOnly = structuredClone(source)
    delete textOnly.steps[2]!.tapFact
    textOnly.steps[2]!.error = 'target-not-found; no dispatch'
    expect(await classifyRepairFailure(store, textOnly)).toMatchObject({ kind: 'evidence-gap' })
  }, 20000)

  it('classifies a verified failed assertion as a product defect candidate', async () => {
    const { workbench, store } = await setup()
    const failed = await workbench.start(demo.replace('1 actions received', 'impossible product expectation'))
    await workbench.wait()
    expect((await classifyRepairFailure(store, await workbench.get(failed.id))).kind).toBe('product-defect-candidate')
  }, 20000)

  it('freezes regression and indirect project data before a candidate run', async () => {
    const { provider, workbench, store } = await setup()
    provider.stableAnchor = true
    const yaml = demo.replace('1 actions received', 'Hello, harness.')
    const registered = project(yaml)
    registered.repair.permissions = ['plan']
    registered.repair.navigation[0]!.page = trustedPage
    registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
    registered.repair.regressionFlows = ['regression']
    registered.flows.regression = yaml.replace('- tap:\n    accessibilityId: action-card\n', '')
    registered.provenance = { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1', resetContractVersion: 'reset-v1' }
    const baseline = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    provider.mode = 'missing'
    const failure = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    const proposal = await admitLocatorProposal(store, registered, failure.id, baseline.id, 'demo')
    const plan = await freezeLocatorPlan(store, registered, proposal, randomUUID(), 'demo')
    expect(plan.requiredChecks.map(check => check.kind)).toEqual(['baseline', 'candidate', 'candidate', 'regression'])
    const source = await workbench.get(failure.id)
    expect(() => assertFrozenPlan(plan, source, registered)).not.toThrow()
    expect(() => assertFrozenPlan(plan, source, { ...registered, datasets: { oracle: [{ id: 'changed', params: {} }] } }))
      .toThrow('repair-project-changed')
    await expect(freezeLocatorPlan(store, { ...registered, repair: { ...registered.repair, regressionFlows: ['demo'] } }, proposal, randomUUID(), 'demo'))
      .rejects.toThrow('repair-dependency-unresolved')
    const dynamic = { ...registered, flows: { ...registered.flows, regression: registered.flows.regression!.replace('Hello, harness.', '{{outputs.unresolved}}') } }
    await expect(freezeLocatorPlan(store, dynamic, proposal, randomUUID(), 'demo')).rejects.toThrow('repair-dependency-unresolved')
  }, 20000)

  it('creates one durable private candidate and deduplicates the same request', async () => {
    const { provider, workbench, store } = await setup()
    provider.stableAnchor = true
    const yaml = demo.replace('1 actions received', 'Hello, harness.')
    const registered = project(yaml)
    registered.repair.permissions = ['plan', 'verify']
    registered.repair.navigation[0]!.page = trustedPage
    registered.repair.navigation[0]!.allowedTarget = { role: 'button', text: 'Navigation' }
    registered.repair.regressionFlows = ['regression']
    registered.flows.regression = yaml.replace('- tap:\n    accessibilityId: action-card\n', '')
    registered.provenance = { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1', resetContractVersion: 'reset-v1' }
    const baseline = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    provider.mode = 'missing'
    const failure = await workbench.start(yaml, undefined, undefined, { project: registered, flowId: 'demo' }); await workbench.wait()
    const original = (await store.readOnlySnapshot(failure.id)).manifestSha256
    const suites = new WorkbenchSuites(workbench)
    cleanups.push(() => suites.close())
    let current: ProjectSnapshot = registered
    const coordinator = new WorkbenchRepairCoordinator(workbench, suites, async () => current)
    const request = { requestId: randomUUID(), sourceRunId: failure.id, baselineRunId: baseline.id, flowId: 'demo' }
    const created = await coordinator.create(request, 'owner')
    expect(created.phase).toBe('awaiting-approval')
    expect((await coordinator.records.candidate(created.id))?.digest).toMatch(/^[a-f0-9]{64}$/)
    expect((await coordinator.records.plan(created.id)).requiredChecks).toHaveLength(4)
    expect((await coordinator.create(request, 'owner')).id).toBe(created.id)
    await coordinator.records.rebuildIndex()
    expect((await coordinator.create(request, 'owner')).id).toBe(created.id)
    expect((await coordinator.get(created.id, 'owner')).plan.digest).toMatch(/^[a-f0-9]{64}$/)
    await expect(coordinator.get(created.id, 'other')).rejects.toThrow('repair-not-found')
    expect((await store.readOnlySnapshot(failure.id)).manifestSha256).toBe(original)
    await expect(coordinator.create({ ...request, baselineRunId: randomUUID() }, 'owner')).rejects.toThrow('repair-request-conflict')
    await expect(coordinator.approvalChallenge(created.id, 'owner', created.revision, 'execution')).rejects.toThrow('repair-approval-required')
    const expired = await coordinator.approvalChallenge(created.id, 'owner', created.revision, 'scope')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expired.expiresAt) + 1)
    await expect(coordinator.approve(created.id, 'owner', created.revision, expired.nonce)).rejects.toThrow('repair-stale-approval')
    vi.restoreAllMocks()
    const scope = await coordinator.approvalChallenge(created.id, 'owner', created.revision, 'scope')
    const scoped = await coordinator.approve(created.id, 'owner', created.revision, scope.nonce)
    expect(scoped.phase).toBe('awaiting-approval')
    await expect(coordinator.approve(created.id, 'owner', created.revision, scope.nonce)).rejects.toThrow('repair-stale-approval')
    const wrongChannel = await coordinator.approvalChallenge(created.id, 'owner', scoped.revision, 'execution', 'interactive-cli')
    await expect(coordinator.approve(created.id, 'owner', scoped.revision, wrongChannel.nonce, 'local-viewer'))
      .rejects.toThrow('repair-stale-approval')
    await expect(coordinator.approve(created.id, 'owner', scoped.revision, wrongChannel.nonce, 'interactive-cli'))
      .rejects.toThrow('repair-stale-approval')
    const revoked = await coordinator.approvalChallenge(created.id, 'owner', scoped.revision, 'execution')
    current = { ...registered, repair: { ...registered.repair, permissions: ['plan'] } }
    await expect(coordinator.approve(created.id, 'owner', scoped.revision, revoked.nonce)).rejects.toThrow('repair-not-found')
    current = registered
    const execution = await coordinator.approvalChallenge(created.id, 'owner', scoped.revision, 'execution')
    const queued = await coordinator.approve(created.id, 'owner', scoped.revision, execution.nonce)
    expect(queued.phase).toBe('queued')
    expect((await coordinator.records.approvals(created.id)).map(value => value.level)).toEqual(['scope', 'execution'])
    const privateCandidate = await coordinator.prepareApprovedCandidate(created.id, 'owner')
    expect(privateCandidate.flowId).toMatch(/^repairCandidate_[a-f0-9]{32}$/)
    expect(privateCandidate.execution.yaml).toBe((await coordinator.records.candidate(created.id))!.yaml)
    expect(registered.flows[privateCandidate.flowId]).toBeUndefined()
    const node = privateCandidate.execution.nodes.find(value => value.kind === 'leaf')!
    if (node.kind !== 'leaf') throw new Error('Expected candidate leaf')
    expect(recordedTapIndices(privateCandidate.execution, { ...await workbench.get(failure.id),
      yaml: privateCandidate.execution.yaml, flowId: privateCandidate.flowId }, node)).toContain(2)
    const cancelled = await coordinator.cancel(created.id, 'owner', queued.revision)
    expect(cancelled).toMatchObject({ phase: 'finished', outcome: 'cancelled' })
    expect((await coordinator.get(created.id, 'owner')).case.outcome).toBe('cancelled')
    await coordinator.retire(created.id, 'owner', cancelled.revision)
    await coordinator.close()
  }, 30000)

  it('runs a reviewed Mock locator through fresh baseline, two candidates and frozen regression', async () => {
    const { workbench, store, coordinator, queued, failure } = await approvedMockCase()
    const result = await coordinator.verifyMock(queued.id, 'owner', queued.revision)
    expect(result.outcome, JSON.stringify(await coordinator.get(queued.id, 'owner'))).toBe('software-verified')
    const detail = await coordinator.get(queued.id, 'owner')
    expect(detail.resets.map(reset => reset.status)).toEqual(['completed', 'completed', 'completed', 'completed'])
    expect(new Set(detail.resets.map(reset => reset.receipt?.namespaceId)).size).toBe(4)
    expect(detail.attempts[0]?.childRunIds).toHaveLength(4)
    expect(detail.attempts[0]).toMatchObject({ baselineRuns: 1, candidateRuns: 2, regressionRuns: 1 })
    expect(detail.attempts[0]!.executionMs).toBeGreaterThan(0)
    expect(detail.verifications[0]?.grade).toBe('software')
    expect((await store.get(failure.id)).verdict).toBe('fail')
    const draft = await coordinator.acceptanceCandidate(queued.id, 'owner', result.revision, {
      contractVersion: 1, repository: 'Fixture repository', commit: 'a'.repeat(40), declarationsReviewed: true,
      cells: [{ id: 'repair-demo', title: 'Repair demo', platform: detail.plan.platform, appId: detail.plan.appId,
        binarySha256: detail.plan.baselineBuild, build: 'fixture', logicalTestKey: 'demo', inputDigest: detail.plan.paramsDigest,
        environment: { os: 'fixture', provider: 'mock', driver: 'fixture', viewport: 'fixture', backendEnvironment: 'test' },
        required: ['ui', 'cleanup', 'evidence'], historyRunIds: [] }],
    })
    expect(draft).toMatchObject({ grade: 'software', published: false, limitation: 'software-only-not-device-verified',
      input: { declarationsReviewed: false, cells: [{ runId: detail.attempts[0]!.childRunIds[2], historyRunIds: [failure.id] }] } })
    await expect(coordinator.acceptanceCandidate(queued.id, 'other', result.revision, draft.input)).rejects.toThrow('repair-not-found')
    expect((await store.get(failure.id)).verdict).toBe('fail')
    await coordinator.close()
  }, 60000)

  it('does not create another attempt or refresh a frozen budget for a duplicate accepted request', async () => {
    const { coordinator, queued } = await approvedMockCase()
    const plan = await coordinator.records.plan(queued.id)
    const duplicate = await coordinator.create({ requestId: queued.requestId, sourceRunId: queued.sourceSnapshot.runId,
      baselineRunId: plan.baselineSnapshot!.runId, flowId: 'demo' }, 'owner')
    expect(duplicate).toEqual(queued)
    const accepted = await coordinator.acceptMock(queued.id, 'owner', queued.revision)
    expect(accepted).toMatchObject({ phase: 'preparing', generation: 1, attempts: [expect.any(String)] })
    await expect(coordinator.acceptMock(queued.id, 'owner', queued.revision)).rejects.toThrow('repair-busy')
    const result = await coordinator.close().then(() => coordinator.records.get(queued.id))
    expect(result.budget).toEqual(queued.budget)
    expect(result.expiresAt).toBe(queued.expiresAt)
    expect(result.attempts).toHaveLength(1)
  }, 60000)

  it('does not verify a candidate when the original failure stops reproducing', async () => {
    const { provider, coordinator, queued, failure } = await approvedMockCase()
    provider.mode = 'normal'
    const result = await coordinator.verifyMock(queued.id, 'owner', queued.revision)
    expect(result.outcome).toBe('inconclusive')
    expect((await coordinator.get(queued.id, 'owner')).verifications[0]?.gaps).toContain('repair-not-reproduced')
    expect((await coordinator.get(queued.id, 'owner')).case.sourceSnapshot.runId).toBe(failure.id)
  }, 60000)

  it('does not dispatch a prepared repair child if repair reference publication fails', async () => {
    const { provider, workbench, coordinator, queued } = await approvedMockCase()
    const before = provider.writes
    let preparedId: string | undefined
    vi.spyOn(coordinator.records, 'protectChild').mockImplementation(async (_id, _revision, runId) => {
      preparedId = runId
      throw new Error('injected repair reference failure')
    })
    const result = await coordinator.verifyMock(queued.id, 'owner', queued.revision)
    expect(result.outcome).toBe('inconclusive')
    expect(preparedId).toBeDefined()
    expect((await workbench.get(preparedId!)).steps).toEqual([])
    expect(provider.writes).toBe(before)
  }, 60000)

  it('persists an in-flight reset receipt before completing cancellation', async () => {
    const { provider, coordinator, queued } = await approvedMockCase()
    const before = provider.writes, original = provider.resetRepairFixture.bind(provider)
    let entered!: () => void, release!: () => void
    const seen = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(provider, 'resetRepairFixture').mockImplementation(async () => { entered(); await gate; return original() })
    const verifying = coordinator.verifyMock(queued.id, 'owner', queued.revision)
    await seen
    const current = await coordinator.records.get(queued.id)
    const cancelling = await coordinator.cancel(queued.id, 'owner', current.revision)
    expect(cancelling.phase).toBe('cancelling')
    release()
    const result = await verifying
    expect(result.outcome, JSON.stringify(await coordinator.get(queued.id, 'owner'))).toBe('cancelled')
    expect((await coordinator.records.resets(queued.id))[0]?.status).toBe('completed')
    expect(provider.writes).toBe(before)
  }, 60000)

  it('fences control if a completed reset cannot be journaled', async () => {
    const { mirror, coordinator, queued } = await approvedMockCase()
    vi.spyOn(coordinator.records, 'completeReset').mockRejectedValue(new Error('ENOSPC reset receipt'))
    const result = await coordinator.verifyMock(queued.id, 'owner', queued.revision)
    expect(result).toMatchObject({ outcome: 'inconclusive', reason: 'repair-unknown-mutation' })
    expect((await coordinator.records.resets(queued.id))[0]?.status).toBe('prepared')
    await expect(mirror.action({ kind: 'tap', x: 100, y: 100 })).rejects.toThrow('uncertain')
  }, 60000)

  it('keeps cancellation pending until an in-flight repair child action actually settles', async () => {
    const { provider, workbench, coordinator, queued } = await approvedMockCase()
    const original = provider.action.bind(provider)
    let entered!: () => void, release!: () => void
    const seen = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(provider, 'action').mockImplementation(async action => { entered(); await gate; return original(action) })
    const verifying = coordinator.verifyMock(queued.id, 'owner', queued.revision)
    await seen
    const active = workbench.activeId
    expect(active).not.toBeNull()
    const current = await coordinator.records.get(queued.id)
    const cancelling = await coordinator.cancel(queued.id, 'owner', current.revision)
    expect(cancelling.phase).toBe('cancelling')
    expect((await coordinator.records.get(queued.id)).phase).toBe('cancelling')
    release()
    const result = await verifying
    expect(result.outcome).toBe('cancelled')
    expect((await coordinator.records.attempts(queued.id))[0]).toMatchObject({ baselineRuns: 1, candidateRuns: 1,
      regressionRuns: 0, outcome: 'cancelled', childRunIds: expect.any(Array) })
  }, 60000)

  it('rejects a repair execution capacity failure before reset or child dispatch', async () => {
    const { provider, store, coordinator, queued } = await approvedMockCase()
    const before = provider.writes, reserve = store.reserveEvidence.bind(store)
    vi.spyOn(store, 'reserveEvidence').mockImplementation(async (operationId, bytes) => {
      if (operationId.startsWith('repair-execution:')) throw new Error('storage-capacity-unknown')
      return reserve(operationId, bytes)
    })
    await expect(coordinator.verifyMock(queued.id, 'owner', queued.revision)).rejects.toThrow('repair-storage-insufficient')
    expect(provider.writes).toBe(before)
    expect((await coordinator.records.get(queued.id)).phase).toBe('queued')
    expect(await coordinator.records.resets(queued.id)).toEqual([])
  }, 60000)

  it('does not finish application shutdown before the repair child actually exits', async () => {
    const { provider, coordinator, queued } = await approvedMockCase()
    const original = provider.action.bind(provider)
    let entered!: () => void, release!: () => void
    const seen = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(provider, 'action').mockImplementation(async action => { entered(); await gate; return original(action) })
    const verifying = coordinator.verifyMock(queued.id, 'owner', queued.revision)
    await seen
    let closed = false
    const closing = coordinator.close().then(() => { closed = true })
    try {
      // Wait for persisted cancellation, not a filesystem-dependent 50 ms sleep.
      // The action remains gated, so shutdown must still be pending at this point.
      await expect.poll(async () => (await coordinator.records.get(queued.id)).phase, { timeout: 10000 }).toBe('cancelling')
      expect(closed).toBe(false)
    } finally {
      release()
      await closing
    }
    expect((await verifying).outcome).toBe('cancelled')
    expect(closed).toBe(true)
  }, 60000)

  it('keeps the WorkbenchApplication shutdown blocked until a child provider action really settles', async () => {
    const { provider, mirror, coordinator, queued, application } = await approvedMockCase(true)
    const original = provider.action.bind(provider)
    let entered!: () => void, release!: () => void
    const seen = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(provider, 'action').mockImplementation(async action => { entered(); await gate; return original(action) })
    const verifying = coordinator.verifyMock(queued.id, 'owner', queued.revision)
    await seen
    let closed = false
    const closing = application!.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(closed).toBe(false)
    expect(mirror.runOwner).not.toBeNull()
    expect((await coordinator.records.get(queued.id)).phase).toBe('cancelling')
    release()
    await closing
    expect((await verifying).outcome).toBe('cancelled')
    expect(mirror.runOwner).toBeNull()
  }, 60000)

  it('recovers a prepared but unreceipted reset read-only and never redispatches it', async () => {
    const { provider, store, coordinator, queued } = await approvedMockCase()
    const plan = await coordinator.records.plan(queued.id)
    const candidate = (await coordinator.records.candidate(queued.id))!
    const attempt = repairAttemptSchema.parse({ contractVersion: 1, id: randomUUID(), caseId: queued.id,
      generation: queued.generation + 1, requestDigest: queued.requestDigest, patchDigest: candidate.digest,
      planDigest: plan.digest, createdAt: new Date().toISOString(), childRunIds: [], commandReceipts: [],
      artifactRefs: [], baselineRuns: 0, candidateRuns: 0, regressionRuns: 0, executionMs: 0 })
    const begun = await coordinator.records.beginAttempt(queued.id, queued.revision, attempt)
    const intent = await coordinator.records.prepareReset(queued.id, begun.revision, attempt.id, plan.requiredChecks[0]!.id)
    const before = provider.writes
    const restarted = new WorkbenchRepairStore(store)
    expect(await restarted.recoverInterrupted()).toEqual([queued.id])
    expect(await restarted.get(queued.id)).toMatchObject({ phase: 'blocked', outcome: 'inconclusive',
      reason: 'repair-unknown-mutation', generation: 1 })
    expect((await restarted.resets(queued.id))[0]).toMatchObject({ id: intent.id, status: 'prepared' })
    await expect(restarted.completeReset(queued.id, (await restarted.get(queued.id)).revision, intent.id,
      { namespaceId: randomUUID(), initialStateSha256: 'a'.repeat(64), sessionId: 'mock' }))
      .rejects.toThrow('repair-unknown-mutation')
    expect(provider.writes).toBe(before)
  }, 30000)

  it('keeps source and runtime mapping after a readiness node', async () => {
    const { workbench } = await setup()
    const yaml = demo.replace('- launchApp', '- waitFor:\n    target: { testId: action-card }\n    state: visible')
    const started = await workbench.start(yaml, undefined, undefined, { project: project(yaml) }); await workbench.wait()
    const run = await workbench.get(started.id), tap = run.steps.find(step => step.kind === 'tap')!
    expect(run.verdict).toBe('pass')
    expect(tap.path).toBe('root/2/2'); expect(tap.sourceStep?.path).toBe('root/3')
    expect(tap.tapFact?.outcome).toBe('passed')
  }, 20000)
})

describe('compiler source identity is independent of runtime block offsets', () => {
  it('maps coalesced leaves after readiness and marks dynamic, loop and subflow sources', async () => {
    const yaml = demo.replace('- launchApp', '- waitFor:\n    target: { testId: action-card }\n    state: visible')
    const plan = await compilePlan(yaml, project(yaml))
    const leaf = plan.nodes.find(n => n.kind === 'leaf')!
    expect(leaf.kind).toBe('leaf')
    if (leaf.kind !== 'leaf') return
    expect(leaf.sourceSteps.map(s => s.path)).toEqual(['root/2', 'root/3', 'root/4', 'root/5'])
    expect(leaf.sourceSteps[1]?.stepSha256).toBe(stepDigest({ tap: { accessibilityId: 'action-card' } }))
    const nested = demo.replace('- tap:\n    accessibilityId: action-card', '- repeat:\n    times: 1\n    steps:\n      - tap: { accessibilityId: action-card }')
    const loopPlan = await compilePlan(nested, project(nested)), loop = loopPlan.nodes.find(n => n.kind === 'repeat')!
    if (loop.kind !== 'repeat' || loop.steps[0]?.kind !== 'leaf') throw new Error('Missing nested leaf')
    expect(loop.steps[0].sourceSteps[0]?.topLevel).toBe(false)
    const subYaml = demo.replace('- tap:\n    accessibilityId: action-card', '- runFlow: { ref: child }')
    const child = demo.replace('- launchApp\n', ''), subPlan = await compilePlan(subYaml, { ...project(subYaml), flows: { demo: subYaml, child } })
    const sub = subPlan.nodes.find(n => n.kind === 'leaf' && n.path.includes(':child'))!
    if (sub.kind !== 'leaf') throw new Error('Missing subflow leaf')
    expect(sub.sourceSteps[0]).toMatchObject({ topLevel: false, documentSha256: factDigest(child) })
    const dynamic = demo.replace('appId: com.example.mobilemirror.mock', 'appId: com.example.mobilemirror.mock\nparams:\n  target: { type: string, default: action-card }').replace('accessibilityId: action-card', "accessibilityId: '{{params.target}}'")
    const dynamicPlan = await compilePlan(dynamic, project(dynamic)), first = dynamicPlan.nodes[0]!
    if (first.kind !== 'leaf') throw new Error('Missing dynamic leaf')
    expect(first.sourceSteps[2]?.static).toBe(false)
  }, 20000)
})

describe('single-field locator AST allowlist', () => {
  const candidate = demo.replace('accessibilityId: action-card', 'accessibilityId: new-action-card')
  it('accepts exactly one static locator change including harmless formatting', () => {
    expect(() => assertLocatorOnlyDiff(demo, candidate + '# reviewed\n', 2)).not.toThrow()
  })
  it.each([
    candidate.replace('1 actions received', '0 actions received'),
    candidate.replace('- done', '- wait: 30\n- done'),
    candidate.replace('platform: ios', 'platform: android'),
    candidate.replace('appId: com.example.mobilemirror.mock', 'appId: com.example.other'),
    candidate.replace('appId: com.example.mobilemirror.mock', 'appId: com.example.mobilemirror.mock\nprepare: [{ ref: setup }]'),
    candidate.replace('appId: com.example.mobilemirror.mock', 'appId: com.example.mobilemirror.mock\nverify: [{ ref: oracle }]'),
    candidate.replace('appId: com.example.mobilemirror.mock', 'appId: com.example.mobilemirror.mock\nparams: { data: { type: string, default: alternate } }'),
    candidate.replace('accessibilityId: new-action-card', "accessibilityId: '{{params.target}}'"),
    candidate.replace('accessibilityId: new-action-card', 'id: new-action-card'),
    candidate.replace('accessibilityId: new-action-card', 'accessibilityId: new-action-card\n    index: 0'),
    demo,
  ])('rejects changes outside the approved scalar %#', yaml => {
    expect(() => assertLocatorOnlyDiff(demo, yaml, 2)).toThrow('repair-unsafe-diff')
  })
})
