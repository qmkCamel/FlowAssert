import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseReadyStep, resolveSemanticTarget, waitForReadiness } from '../src/workbench-readiness.js'
import { readinessCandidate } from '../src/workbench-selector-adapter.js'
import { normalizeScreenSource } from '../src/screen-source-normalizer.js'
import { WorkbenchDevice } from '../src/workbench-device.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { compilePlan } from '../src/workbench-plan.js'
import { emptyProject } from '../src/workbench-project.js'
import type { MirrorProvider, ScreenStructure } from '../src/types.js'

const xml = (attrs = '', duplicate = false) => `<hierarchy><node class="android.view.ViewGroup" resource-id="panel"><node class="android.widget.EditText" resource-id="field" text="prefix" enabled="true" displayed="true" focused="true" bounds="[10,20][210,70]" ${attrs}/></node>${duplicate ? '<node class="android.widget.EditText" resource-id="field"/>' : ''}</hierarchy>`
const tree = () => normalizeScreenSource(xml(), 'android')
const step = (extra: object = {}) => parseReadyStep({ operation: 'tapReady', target: { testId: 'field' }, timeoutMs: 500, pollMs: 50, ...extra })
const signal = () => new AbortController().signal
const yaml = (steps: string) => `name: Ready\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n${steps}\n- done\n`

it('exact identities, scoped descendants and Inspector suggestions reject duplicates and incomplete/sensitive trees', () => {
  const structure = normalizeScreenSource(xml('', true), 'android')
  expect(() => resolveSemanticTarget(structure, { testId: 'field' })).toThrow('ambiguous-target')
  expect(resolveSemanticTarget(structure, { testId: 'field', within: { testId: 'panel' } })).toHaveLength(1)
  expect(readinessCandidate(structure, structure.nodes.find(n => n.identifier === 'field')!.nodeId)).toBeDefined()
  expect(() => resolveSemanticTarget({ ...tree(), truncated: true }, { testId: 'field' })).toThrow('incomplete-tree')
  const sensitive = tree(); sensitive.nodes.find(n => n.identifier === 'field')!.sensitive = true
  expect(() => resolveSemanticTarget(sensitive, { testId: 'field' })).toThrow('sensitive-target')
  expect(readinessCandidate(sensitive, sensitive.nodes.find(n => n.identifier === 'field')!.nodeId)).toBeUndefined()
  expect(resolveSemanticTarget(tree(), { testId: 'FIELD' })).toEqual([])
  for (const target of [{}, { nodeId: '1' }, { testId: 'a', within: {} }]) expect(() => step({ target })).toThrow()
})

it('waits for delayed enablement and stable bounds, not one matching snapshot', async () => {
  let calls = 0
  const observe = async () => { const value = tree(); const node = value.nodes.find(n => n.identifier === 'field')!; node.enabled = ++calls > 1; node.bounds!.x = calls < 3 ? calls : 3; return value }
  expect((await waitForReadiness(step(), observe, signal()))?.identifier).toBe('field')
  expect(calls).toBe(4)
})
it.each(['missing', 'hidden', 'disabled', 'unstable'])('classifies bounded %s timeout', async reason => {
  let calls = 0
  const observe = async (): Promise<ScreenStructure> => { const value = tree(); const node = value.nodes.find(n => n.identifier === 'field')!; if (reason === 'missing') value.nodes = []; if (reason === 'hidden') node.visible = false; if (reason === 'disabled') node.enabled = false; if (reason === 'unstable') node.bounds!.x = ++calls; return value }
  await expect(waitForReadiness(step({ timeoutMs: 120 }), observe, signal())).rejects.toThrow(`readiness-timeout-${reason}`)
})
it('supports negative waiting and promptly cancels read-only polls', async () => {
  const hidden = step({ operation: 'waitFor', state: 'hidden', target: { testId: 'missing' } })
  await expect(waitForReadiness(hidden, async () => tree(), signal())).resolves.toBeUndefined()
  const controller = new AbortController(); controller.abort(new Error('user cancelled'))
  await expect(waitForReadiness(step(), async () => tree(), controller.signal)).rejects.toThrow('user cancelled')
  const midflight = new AbortController()
  let reads = 0
  await expect(waitForReadiness(step(), async () => { reads++; midflight.abort(new Error('cancelled during observation')); return tree() }, midflight.signal)).rejects.toThrow('cancelled during observation')
  expect(reads).toBe(1)
  await expect(waitForReadiness(step({ operation: 'assertReady', state: 'hidden', timeoutMs: 100, target: { testId: 'missing', within: { testId: 'absent-panel' } } }), async () => tree(), signal())).rejects.toThrow('readiness-timeout-scope-missing')
})
it('focus deadline is classified without repeated focus taps or late text writes', async () => {
  const action = vi.fn(), inputText = vi.fn()
  const provider = { screenSource: async () => ({ kind: 'xml', platform: 'android', xml: xml().replace('focused="true"', 'focused="false"') }), screenGeometry: async () => ({ viewport: { x: 0, y: 0, width: 400, height: 800 } }), action, inputText } as unknown as MirrorProvider
  const device = new WorkbenchDevice('test', 'android', provider, fn => fn(signal()), () => {}, async () => {})
  await expect(device.executeReady(step({ operation: 'fillReady', text: 'hello', timeoutMs: 150 }), signal())).rejects.toThrow('readiness-timeout-unfocused')
  expect(action).toHaveBeenCalledTimes(1); expect(inputText).not.toHaveBeenCalled()
})
it.each(['android', 'ios'] as const)('journals and rechecks %s before exactly one dispatch; fills public input', async platform => {
  const source = platform === 'android' ? xml() : '<AppiumAUT><XCUIElementTypeTextField name="field" value="prefix" visible="true" enabled="true" focused="true" x="10" y="20" width="200" height="50"/></AppiumAUT>'
  const action = vi.fn(), inputText = vi.fn(), journal = vi.fn(async () => {})
  const provider = { screenSource: async () => ({ kind: 'xml', platform, xml: source }), screenGeometry: async () => ({ viewport: { x: 0, y: 0, width: 400, height: 800 } }), action, inputText } as unknown as MirrorProvider
  const device = new WorkbenchDevice('test', platform, provider, fn => fn(signal()), () => {}, journal)
  device.onDispatch = journal
  await device.executeReady(step(), signal()); expect(action).toHaveBeenCalledTimes(1)
  await device.executeReady(step({ operation: 'fillReady', text: 'suffix', mode: 'append' }), signal())
  expect(inputText).toHaveBeenCalledTimes(1); expect(inputText.mock.calls[0]![0]).toMatchObject({ mode: 'replace', text: 'prefixsuffix' })
  expect(journal).toHaveBeenCalled()
})
it.each([true, false])('iOS readiness uses provider-attested focus (%s), not raw XML focus', async focused => {
  // XCTest XML may omit focus or carry an untrusted flag. The provider resolves
  // focus independently against a stable active element before returning source.
  const raw = `<AppiumAUT><XCUIElementTypeTextField name="field" value="prefix" visible="true" enabled="true" focused="${!focused}" x="10" y="20" width="200" height="50"/></AppiumAUT>`
  const structure = normalizeScreenSource(raw, 'ios')
  structure.nodes.find(n => n.identifier === 'field')!.focused = focused
  const action = vi.fn(), inputText = vi.fn()
  const screenSource = vi.fn(async () => ({ kind: 'xml', platform: 'ios', xml: raw, structure }))
  const provider = { screenSource, action, inputText, screenGeometry: async () => ({ viewport: { x: 0, y: 0, width: 400, height: 800 } }) } as unknown as MirrorProvider
  const device = new WorkbenchDevice('test', 'ios', provider, fn => fn(signal()), () => {}, async () => {})
  const execution = device.executeReady(step({ operation: 'fillReady', text: 'public', timeoutMs: 200 }), signal())
  if (focused) {
    await execution
    expect(action).not.toHaveBeenCalled()
    expect(inputText).toHaveBeenCalledExactlyOnceWith({ mode: 'replace', text: 'public', expectedBounds: { x: 10, y: 20, width: 200, height: 50 } }, expect.any(AbortSignal))
  } else {
    await expect(execution).rejects.toThrow('readiness-timeout-unfocused')
    expect(action).toHaveBeenCalledTimes(1)
    expect(inputText).not.toHaveBeenCalled()
  }
  expect(screenSource).toHaveBeenCalledWith(expect.any(AbortSignal), { resolveFocus: true })
})
it('changed target after durable intent is not dispatched and unknown mutation is never retried', async () => {
  let changed = false
  const action = vi.fn(async () => { throw new Error('unknown mutation') })
  const provider = { screenSource: async () => ({ kind: 'normalized', structure: changed ? { ...tree(), nodes: [] } : tree() }), screenGeometry: async () => ({ viewport: { x: 0, y: 0, width: 400, height: 800 } }), action } as unknown as MirrorProvider
  const device = new WorkbenchDevice('test', 'android', provider, fn => fn(signal()), () => {}, async () => {})
  device.onDispatch = async () => { changed = true }
  await expect(device.executeReady(step(), signal())).rejects.toThrow('target-changed'); expect(action).not.toHaveBeenCalled()
  changed = false
  const other = new WorkbenchDevice('test', 'android', provider, fn => fn(signal()), () => {}, async () => {})
  await expect(other.executeReady(step(), signal())).rejects.toThrow('unknown mutation'); expect(action).toHaveBeenCalledTimes(1)
})
it('compiles opt-in steps with original source location; wait alone is not an assertion', async () => {
  const compiled = await compilePlan(yaml('- assertReady: {target: {testId: public-input}}'), emptyProject())
  expect(compiled.nodes[0]).toMatchObject({ kind: 'ready', line: 5 })
  await expect(compilePlan(yaml('- waitFor: {target: {testId: public-input}}'), emptyProject())).rejects.toThrow()
})
it('native run preserves ready assertions, checkpoint evidence and typed failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-ready-'))
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => new MockProvider(0) })
  const wb = new WorkbenchService(mirror, { root })
  try {
    await mirror.start({ provider: 'mock' })
    for (const missing of [false, true]) {
      const started = await wb.start(yaml(`- fillReady: {target: {testId: public-input}, text: hello}\n- assertReady: {target: {testId: ${missing ? 'absent' : 'public-input'}, within: {role: application, name: FlowAssert demo}}, timeoutMs: 150}`))
      await wb.wait(); const run = await wb.get(started.id)
      expect(run.verdict, JSON.stringify(run)).toBe(missing ? 'fail' : 'pass')
      expect(run.steps[1]?.kind).toBe('assert'); expect(run.steps[1]?.sourceLine).toBe(6)
      expect(run.steps[1]?.evidence).toHaveLength(2)
      if (missing) expect(run.diagnostics?.some(item => item.code === 'readiness-timeout-missing')).toBe(true)
    }
  } finally { await wb.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) }
}, 20000)
