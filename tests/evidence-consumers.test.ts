import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import type { TestRun } from '../src/workbench-domain.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { WorkbenchComparisonService } from '../src/workbench-comparison.js'
import { WorkbenchShare } from '../src/workbench-share.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'
import { mkdir } from 'node:fs/promises'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mirror-consumers-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const store = new WorkbenchStore(root); await store.init(); cleanups.push(() => store.close())
  const make = async () => {
    const id = randomUUID(), now = '2026-01-01T00:00:00.000Z'
    const file = await store.put(id, 'step-1.xml', '<AppiumAUT><XCUIElementTypeButton name="OK"/></AppiumAUT>', 'application/xml; charset=utf-8')
    const run: TestRun = { schemaVersion: 1, id, name: 'fixture', yaml: '', engine: 'fixture', phase: 'finished', verdict: 'pass', startedAt: now,
      sessionId: 'mock', deviceName: 'mock', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed', cleanup: 'session-retained', steps: [], evidence: [file] }
    await store.save(run); return run
  }
  const base = await make(), target = await make()
  return { root, store, base, target }
}
const selection = { files: [{ name: 'step-1.xml' }] }
const failAt = (point: string) => async (name: string) => { if (name === point) throw new Error(`cut:${point}`) }

it('bounds concurrent history reads without losing records or ordering', async () => {
  const { root, store, base } = await fixture()
  for (let n = 0; n < 80; n++) await mkdir(join(root, randomUUID()))
  let active = 0, peak = 0
  const original = store.getRecord.bind(store)
  store.getRecord = async id => {
    active++; peak = Math.max(peak, active)
    try { await new Promise(resolve => setTimeout(resolve, 2)); return await original(id) } finally { active-- }
  }
  const runs = await store.list()
  expect(runs).toHaveLength(82); expect(peak).toBeLessThanOrEqual(16); expect(peak).toBeGreaterThan(1)
  expect(runs.some(run => run.id === base.id)).toBe(true)
  expect(runs.filter(run => run.recovery?.reason === 'Manifest unavailable')).toHaveLength(80)
  expect(runs.map(run => run.startedAt)).toEqual(runs.map(run => run.startedAt).sort((a, b) => b.localeCompare(a)))
})

it('publishes comparison/share references before visibility, retains them on restart, and retires idempotently without changing sources', async () => {
  const { root, store, base, target } = await fixture()
  const original = await readFile(join(root, base.id, 'manifest.json'))
  const comparison = await new WorkbenchComparisonService(store).start(base.id, target.id)
  const share = new WorkbenchShare(store), preview = await share.preview(base.id, selection)
  const archive = await share.export(base.id, selection, preview.digest, true)
  expect(await new WorkbenchReferences(store).list()).toHaveLength(3)
  expect(JSON.stringify(archive)).not.toContain('referencePublication')
  await store.close()
  const reopened = new WorkbenchStore(root); await reopened.init(); cleanups.push(() => reopened.close())
  let snapshot = await new WorkbenchRetention(reopened, () => null).snapshot()
  expect(snapshot.runs.find(run => run.id === base.id)?.protectedBy).toEqual(expect.arrayContaining(['workbench:comparison', 'workbench:share']))
  const comparisons = new WorkbenchComparisonService(reopened)
  await comparisons.retire(comparison.id); await comparisons.retire(comparison.id)
  await new WorkbenchShare(reopened).retire(archive.sharing!.shareId)
  await new WorkbenchShare(reopened).retire(archive.sharing!.shareId)
  snapshot = await new WorkbenchRetention(reopened, () => null).snapshot()
  expect(snapshot.runs.every(run => run.protectedBy.length === 0)).toBe(true)
  expect(await readFile(join(root, base.id, 'manifest.json'))).toEqual(original)
  await expect(comparisons.diagnosticContext(comparison.id)).rejects.toThrow('retired')
})

it.each(['publication:after-reference', 'publication:after-commit'])('keeps protective references when comparison publication fails at %s', async point => {
  const { store, base, target, root } = await fixture()
  await expect(new WorkbenchComparisonService(store, failAt(point)).start(base.id, target.id)).rejects.toThrow('cut:')
  const references = await new WorkbenchReferences(store).list()
  expect(references.length).toBe(point.endsWith('reference') ? 1 : 2)
  if (point.endsWith('reference')) expect((await readdir(join(root, 'comparisons'))).filter(name => !name.startsWith('.'))).toHaveLength(0)
  const snapshot = await new WorkbenchRetention(store, () => null).snapshot()
  expect(snapshot.runs.find(run => run.id === base.id)?.protectedBy).toContain('workbench:comparison')
})

it.each(['retirement:after-tombstone', 'retirement:after-revoke'])('keeps tombstones and completes comparison retirement after %s', async point => {
  const { store, base, target } = await fixture()
  const report = await new WorkbenchComparisonService(store).start(base.id, target.id)
  await expect(new WorkbenchComparisonService(store, failAt(point)).retire(report.id)).rejects.toThrow('cut:')
  expect((await new WorkbenchComparisonService(store).get(report.id)).referencePublication?.retiredAt).toBeTruthy()
  await new WorkbenchRetention(store, () => null).snapshot()
  await new WorkbenchComparisonService(store).retire(report.id)
  expect(await new WorkbenchReferences(store).list()).toEqual([])
})

it('keeps the source protected when share publication/retirement is interrupted', async () => {
  const { store, base } = await fixture()
  const share = new WorkbenchShare(store), preview = await share.preview(base.id, selection)
  await expect(new WorkbenchShare(store, failAt('publication:after-reference')).export(base.id, selection, preview.digest, true)).rejects.toThrow('cut:')
  const orphan = (await new WorkbenchReferences(store).list())[0]!
  const archive = await share.export(base.id, selection, preview.digest, true)
  await expect(new WorkbenchShare(store, failAt('retirement:after-tombstone')).retire(archive.sharing!.shareId)).rejects.toThrow('cut:')
  await share.retire(archive.sharing!.shareId)
  expect(await new WorkbenchReferences(store).list()).toEqual([orphan])
  expect((await new WorkbenchRetention(store, () => null).snapshot()).runs.find(run => run.id === base.id)?.protectedBy).toContain('workbench:share')
})

it.each(['missing', 'wrong-owner', 'unknown-version'])('fails closed for %s references instead of falling back to an unprotected consumer', async mutation => {
  const { root, store, base, target } = await fixture()
  const report = await new WorkbenchComparisonService(store).start(base.id, target.id)
  const ref = report.referencePublication!.references[0]!, path = join(root, 'references', `${ref.refId}.json`)
  if (mutation === 'missing') await rm(path)
  else await writeFile(path, JSON.stringify({ ...ref, ...(mutation === 'wrong-owner' ? { consumerId: randomUUID() } : { contractVersion: 99 }) }))
  await expect(new WorkbenchRetention(store, () => null).snapshot()).rejects.toThrow()
})

it('preserves legacy comparison/share protection and refuses implicit retirement migration', async () => {
  const { root, store, base, target } = await fixture()
  const comparisons = new WorkbenchComparisonService(store), report = await comparisons.start(base.id, target.id)
  const share = new WorkbenchShare(store), preview = await share.preview(base.id, selection), archive = await share.export(base.id, selection, preview.digest, true)
  const { referencePublication: _, ...legacy } = report
  await writeFile(join(root, 'comparisons', report.id, 'report.json'), JSON.stringify(legacy))
  const path = join(root, 'shares', `${archive.sharing!.shareId}.json`), map = JSON.parse(await readFile(path, 'utf8'))
  delete map.referencePublication; await writeFile(path, JSON.stringify(map))
  for (const ref of await new WorkbenchReferences(store).list()) await new WorkbenchReferences(store).revoke(ref.refId, ref.consumerKind, ref.consumerId)
  const snapshot = await new WorkbenchRetention(store, () => null).snapshot()
  expect(snapshot.runs.find(run => run.id === base.id)?.protectedBy).toEqual(expect.arrayContaining(['comparison', 'share-export']))
  await expect(comparisons.retire(report.id)).rejects.toThrow('Legacy')
  await expect(share.retire(archive.sharing!.shareId)).rejects.toThrow('Legacy')
})

it('retains published protection after a real process SIGKILL before consumer commit', async () => {
  const { root, store, base, target } = await fixture(); await store.close()
  const script = `import { WorkbenchStore } from './src/workbench-store.ts'; import { WorkbenchComparisonService } from './src/workbench-comparison.ts';
    const store = new WorkbenchStore(${JSON.stringify(root)}); await store.init();
    await new WorkbenchComparisonService(store, async name => { if (name === 'publication:after-reference') process.kill(process.pid, 'SIGKILL') }).start(${JSON.stringify(base.id)}, ${JSON.stringify(target.id)});`
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: 'pipe' })
  const outcome = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })) })
  expect(outcome.signal).toBe('SIGKILL')
  const reopened = new WorkbenchStore(root); await reopened.init(); cleanups.push(() => reopened.close())
  expect((await new WorkbenchRetention(reopened, () => null).snapshot()).runs.find(run => run.id === base.id)?.protectedBy).toContain('workbench:comparison')
}, 15_000)
