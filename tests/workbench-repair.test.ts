import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchRepair } from '../src/workbench-repair.js'
import { WorkbenchStore, type TestRun } from '../src/workbench-store.js'
import { compilePlan } from '../src/workbench-plan.js'
import { emptyProject } from '../src/workbench-project.js'
import { repairRegistration, assertRepairPermission } from '../src/workbench-repair-project.js'
import { NativeWorkerProtocol } from '../src/workbench-worker-protocol.js'

const roots: string[] = [], stores: WorkbenchStore[] = []
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture(currentLabel = 'Continue') {
  const root = await mkdtemp(join(tmpdir(), 'mirror-repair-')); roots.push(root)
  const store = new WorkbenchStore(root); stores.push(store); await store.init()
  const baselineId = 'd4cc8549-53a1-426f-bc56-9aee71fe2d44', sourceId = 'dfc337c1-1202-4216-b96d-d0efdf803c31'
  const yaml = 'name: Locator repair\nplatform: ios\nappId: com.example.fixture\n---\n- tap: {accessibilityId: old-action}\n- assertVisible: {text: Continue}\n- done\n'
  const now = new Date().toISOString()
  async function run(id: string, verdict: 'pass' | 'fail', selector: string, label: string): Promise<TestRun> {
    const xml = `<AppiumAUT><XCUIElementTypeButton type="XCUIElementTypeButton" name="${selector}" label="${label}" visible="true" x="0" y="0" width="20" height="20"/></AppiumAUT>`
    const file = await store.put(id, 'step-1.xml', xml, 'application/xml; charset=utf-8')
    const value: TestRun = { schemaVersion: 1, id, ...(verdict === 'fail' ? { parentRunId: baselineId } : {}), name: 'Locator repair', yaml, engine: 'fixture', phase: 'finished', verdict,
      startedAt: now, endedAt: now, sessionId: 's', deviceName: 'd', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
      steps: [{ index: 1, kind: 'tap', path: 'root/1', sourceLine: 5, status: verdict === 'pass' ? 'passed' : 'failed', startedAt: now, endedAt: now, evidence: [file] }], evidence: [], cleanup: 'session-retained' }
    await store.save(value); return value
  }
  const baseline = await run(baselineId, 'pass', 'old-action', 'Continue')
  const source = await run(sourceId, 'fail', 'new-action', currentLabel)
  return { store, baseline, source }
}

describe('evidence-linked locator repair', () => {
  it('changes only the locator in a separate draft and rejects a stale confirmation', async () => {
    const { store, baseline, source } = await fixture()
    const repair = new WorkbenchRepair(store)
    const proposal = await repair.suggest(source.id)
    expect(proposal.status).toBe('candidate')
    if (proposal.status !== 'candidate') return
    expect(proposal).toMatchObject({ baselineRunId: baseline.id, before: { value: 'old-action' }, after: { value: 'new-action' } })
    expect(proposal.yaml).toContain('accessibilityId: new-action')
    expect(proposal.yaml).toContain('assertVisible: { text: Continue }')
    await expect(compilePlan(proposal.yaml, emptyProject())).resolves.toMatchObject({ header: { appId: 'com.example.fixture' } })
    expect((await store.get(source.id)).yaml).toBe(source.yaml)
    await expect(repair.confirm(source.id, baseline.id, proposal.digest)).resolves.toMatchObject({ digest: proposal.digest })
    source.error = 'updated failure details'; await store.save(source)
    await expect(repair.confirm(source.id, baseline.id, proposal.digest)).rejects.toThrow(/stale/)
  })

  it('keeps a real assertion/control mismatch failed instead of inventing a passing repair', async () => {
    const { store, source } = await fixture('Removed feature')
    const result = await new WorkbenchRepair(store).suggest(source.id)
    expect(result).toMatchObject({ status: 'no-safe-repair' })
    expect((await store.get(source.id)).verdict).toBe('fail')
  })

  it('keeps legacy suggestions separate from new repair execution grants', async () => {
    const { store, source } = await fixture()
    expect((await new WorkbenchRepair(store).suggest(source.id)).status).toBe('candidate')
    expect(() => assertRepairPermission(repairRegistration(emptyProject()), 'verify', {
      projectId: 'fixture', flowId: 'navigation', platform: 'ios', appId: 'com.example.fixture',
    })).toThrow('repair-not-found')
    expect((await store.get(source.id)).verdict).toBe('fail')
  })

  it('does not treat the native executor free-text failure as a structured missing-target attestation', () => {
    const protocol = new NativeWorkerProtocol(['tap'])
    protocol.accept({ protocolVersion: 1, sequence: 1, type: 'step', step: 1, total: 1, kind: 'tap', status: 'running' })
    const event = protocol.accept({ protocolVersion: 1, sequence: 2, type: 'step', step: 1, total: 1, kind: 'tap', status: 'failed', error: 'target-not-found' })
    expect(event).not.toHaveProperty('failureCode')
    expect(event).not.toHaveProperty('dispatch')
    const other = new NativeWorkerProtocol(['tap'])
    other.accept({ protocolVersion: 1, sequence: 1, type: 'step', step: 1, total: 1, kind: 'tap', status: 'running' })
    expect(() => other.accept({ protocolVersion: 1, sequence: 2, type: 'step', step: 1, total: 1, kind: 'tap', status: 'failed',
      error: 'target-not-found', failureCode: 'target-not-found', dispatch: 'not-dispatched' })).toThrow()
  })
})
