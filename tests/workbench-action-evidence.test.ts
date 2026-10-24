import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchStore } from '../src/workbench-store.js'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const demo = await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8')
async function run(failBefore = false, failAction = false) {
  class Provider extends MockProvider {
    events: string[] = []; armed = false
    override async screenGeometry() { const geometry = await super.screenGeometry(); this.armed = true; return geometry }
    override async snapshot(signal?: AbortSignal) {
      this.events.push('snapshot')
      if (failBefore && this.events.filter(event => event === 'snapshot').length === 3) { failBefore = false; throw new Error('capture unavailable') }
      return super.snapshot()
    }
    override async action(action: Parameters<MockProvider['action']>[0]) { this.events.push('action'); if (failAction) throw new Error('lost reply'); return super.action(action) }
  }
  const root = await mkdtemp(join(tmpdir(), 'action-evidence-')), provider = new Provider(0)
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
  await mirror.start({ provider: 'mock' }); const store = new WorkbenchStore(root), workbench = new WorkbenchService(mirror, { store })
  cleanup.push(async () => { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) })
  const run = await workbench.start(demo); await workbench.wait()
  return { run: await workbench.get(run.id), provider, store, mirror }
}
it('persists an actual before image and dispatch fact separately from the terminal checkpoint', async () => {
  const { run: result, provider, store } = await run()
  expect(result.verdict).toBe('pass')
  const step = result.steps.find(step => step.kind === 'tap')!, action = step.actionEvidence!.actions[0]!
  expect(action).toMatchObject({ kind: 'tap', dispatch: 'settled', before: `step-${step.index}-action-1-before.png` })
  expect(action.points).toHaveLength(1)
  expect(step.actionEvidence?.after).toBe(`step-${step.index}.png`)
  expect(step.evidence[0]?.name).toBe(step.actionEvidence?.after)
  const file = step.evidence.find(file => file.name === action.before)!
  expect((await store.readEvidence(result.id, file)).subarray(1, 4).toString()).toBe('PNG')
  expect(provider.events[provider.events.indexOf('action') - 1]).toBe('snapshot')
})
it('retains unknown dispatch rather than claiming success after a provider failure', async () => {
  const { run: result } = await run(false, true)
  const action = result.steps.flatMap(step => step.actionEvidence?.actions ?? [])[0]
  expect(action?.dispatch).toBe('unknown'); expect(result.verdict).not.toBe('pass')
})
it('keeps an auxiliary image failure explicit without changing a successful action result', async () => {
  const { run: result } = await run(true)
  const action = result.steps.flatMap(step => step.actionEvidence?.actions ?? [])[0]
  expect(result.verdict).toBe('pass')
  expect(action).toMatchObject({ dispatch: 'settled', reason: 'before-image-unavailable' })
  expect(action?.before).toBeUndefined()
})
it('bounds auxiliary captures without dropping authorized actions', async () => {
  const { mirror, provider } = await run(), lease = mirror.acquireRun('capture-budget', new AbortController().signal)
  const captures: string[] = []; provider.events = []
  lease.visualCaptureBudget = 2
  lease.onVisualAction = async record => { captures.push(record.kind); return async () => {} }
  try {
    for (let i = 0; i < 3; i++) {
      await lease.callTool('appium_get_page_source', {}, 'com.example.mobilemirror.mock')
      await lease.callTool('appium_gesture', { action: 'tap', x: 50, y: 100 }, 'com.example.mobilemirror.mock')
    }
    expect(captures).toEqual(['tap', 'tap'])
    expect(provider.events.filter(event => event === 'action')).toHaveLength(3)
    expect(provider.events.filter(event => event === 'snapshot')).toHaveLength(2)
  } finally { await lease.release() }
})
it('cancellation during evidence persistence never dispatches the pending action', async () => {
  const { mirror, provider } = await run(), cancellation = new AbortController(), lease = mirror.acquireRun('capture-cancel', cancellation.signal)
  const states: string[] = []; provider.events = []; lease.visualCaptureBudget = 1
  lease.onVisualAction = async () => async state => { states.push(state); if (state === 'unknown') cancellation.abort(new Error('cancel during persist')) }
  try {
    await lease.callTool('appium_get_page_source', {}, 'com.example.mobilemirror.mock')
    await expect(lease.callTool('appium_gesture', { action: 'tap', x: 50, y: 100 }, 'com.example.mobilemirror.mock')).rejects.toThrow()
    expect(provider.events.filter(event => event === 'action')).toHaveLength(0)
    expect(states).toEqual(['unknown', 'not-dispatched'])
    expect(lease.dispatches[0]?.state).toBe('not-dispatched')
  } finally { await lease.release() }
})
