import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchTrendIndex, compareTrendWindows, performanceSignal, summarizeTrends } from '../src/workbench-trends.js'
import { WorkbenchStore, sha256 } from '../src/workbench-store.js'
import type { TestRun } from '../src/workbench-store.js'
import type { SuiteRun, WorkbenchSuites } from '../src/workbench-suites.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const run = (n: number, verdict: NonNullable<TestRun['verdict']>, extra: Partial<TestRun> = {}): TestRun => ({
  schemaVersion: 1, id: id(n), name: 'case', yaml: '', engine: 'test', phase: 'finished', verdict,
  startedAt: `2026-09-24T00:00:0${n}Z`, endedAt: `2026-09-24T00:00:1${n}Z`, sessionId: 'session',
  deviceName: 'phone', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions',
  visualVerification: 'not-performed', businessVerification: 'not-performed', steps: [], evidence: [], cleanup: 'session-retained',
  comparison: { contractVersion: 1, logicalTestKey: 'suite:case', inputDigest: 'input', inputKeyId: 'key', planDigest: 'plan',
    executionContext: { platform: 'ios', provider: 'mock', deviceName: 'phone', os: '18.0', runtime: '1', viewport: '390x844' },
    appContext: { appId: 'example.app', version: '1', build: '1' }, implementationDigest: 'unknown' }, ...extra,
})
const suite = (attempts: string[], extra: Partial<SuiteRun> = {}): SuiteRun => ({
  id: id(90), name: 'suite', registeredId: 'regression', phase: 'finished', startedAt: '2026-09-24T00:00:00Z',
  sessionId: 'session', cases: [{ id: 'case:row', flow: 'flow', rowId: 'row', status: 'flaky', attempts, retries: 1,
  retrySafe: true, params: {} }], project: {} as SuiteRun['project'], snapshotSha256: sha256('{}'), stopOnFailure: false,
  timeoutMs: 60_000, ...extra,
})

describe('workbench trend projection', () => {
  it('counts one planned flaky case for two attempts and excludes its imported copy', () => {
    const source = [run(1, 'fail'), run(2, 'pass')]
    const imported = run(3, 'pass', { source: 'import' })
    const result = summarizeTrends([suite(source.map(item => item.id))], [...source, imported])
    expect(result.coverage).toMatchObject({ planned: 1, attempts: 2, firstPassRate: 0, cleanPassRate: 1, imported: 1, derived: 0, unplanned: 0 })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({ comparable: true, planned: 1, attempts: 2, outcomes: { flaky: 1, 'first-pass': 0 } })
    expect(result.groups[0]?.cases[0]?.attemptIds).toEqual(source.map(item => item.id))
  })

  it('keeps unknown environments apart and treats missing evidence as inconclusive', () => {
    const known = run(1, 'pass')
    const unknown = run(2, 'pass', { comparison: { ...known.comparison!, appContext: { ...known.comparison!.appContext, build: 'unknown' } } })
    const result = summarizeTrends([suite([known.id]), suite([unknown.id], { id: id(91) }),
      suite([id(99)], { id: id(92) })], [known, unknown])
    expect(result.groups).toHaveLength(3)
    expect(result.groups.find(group => group.environment === 'unknown' && group.inputDigest === 'input'))
      .toMatchObject({ comparable: false, planned: 1, outcomes: { 'first-pass': 1 } })
    expect(result.groups.find(group => group.inputDigest === 'unknown'))
      .toMatchObject({ comparable: false, planned: 1, outcomes: { inconclusive: 1 } })
    expect(result.coverage.corruptOrMissing).toBe(1)
  })

  it('refuses silent truncation beyond the planned-case cap', () => {
    const cases = Array.from({ length: 10_001 }, (_, n) => ({ id: `c${n}`, flow: 'flow', rowId: 'row', status: 'skipped' as const,
      attempts: [], retries: 0, retrySafe: false, params: {} }))
    expect(() => summarizeTrends([suite([], { cases })], [])).toThrow(/narrow the time window/)
  })

  it('counts only summaries inside the selected window against the 10,000-run cap', () => {
    const imported = Array.from({ length: 10_001 }, (_, n) => run(n + 1, 'inconclusive', {
      source: 'import', startedAt: n === 10_000 ? '2026-09-25T00:00:00Z' : '2026-09-24T00:00:00Z',
    }))
    expect(() => summarizeTrends([], imported)).toThrow(/narrow the time window/)
    expect(summarizeTrends([], imported, { from: '2026-09-25T00:00:00Z', to: '2026-09-26T00:00:00Z' }).coverage)
      .toMatchObject({ imported: 1, planned: 0 })
  })

  it('requires two 30-sample windows and an explicit versioned performance budget', () => {
    const budget = { version: 1 as const, slowerByMs: 100, slowerByRatio: 0.1 }
    expect(performanceSignal([100], [1000], budget).status).toBe('insufficient-samples')
    expect(performanceSignal(Array(30).fill(100), Array(30).fill(250), budget).status).toBe('slower-than-budget')
    expect(performanceSignal(Array(30).fill(100), Array(30).fill(150), budget).status).toBe('within-budget')
    expect(performanceSignal(Array(30).fill(0), Array(30).fill(101), budget)).toMatchObject({ status: 'slower-than-budget', relativeChange: null })
    expect(performanceSignal(Array(30).fill(100), Array(30).fill(200), budget).status).toBe('within-budget')
    expect(() => performanceSignal([], [], { version: 1, slowerByMs: Infinity, slowerByRatio: 0.1 })).toThrow(/budget/)
    expect(performanceSignal(Array(30).fill(NaN), Array(30).fill(250), budget).status).toBe('insufficient-samples')
    expect(performanceSignal(Array(29).fill(100), Array(30).fill(250), budget).status).toBe('insufficient-samples')
    expect(performanceSignal(Array(30).fill(100), Array(30).fill(201), budget).status).toBe('slower-than-budget')
    expect(performanceSignal(Array(30).fill(100), Array(30).fill(100), budget).status).toBe('within-budget')
    expect(performanceSignal(Array(30).fill(100), Array(30).fill(Infinity), budget).status).toBe('insufficient-samples')
    expect(() => performanceSignal([], [], { version: 1, slowerByMs: -1, slowerByRatio: 0 })).toThrow(/budget/)
  })

  it('deduplicates attempt identities and applies the same UTC window to excluded counts', () => {
    const first = run(1, 'pass')
    const laterImport = run(2, 'pass', { source: 'import', startedAt: '2026-09-26T00:00:00Z' })
    const laterUnplanned = run(3, 'fail', { startedAt: '2026-09-26T00:00:00Z' })
    const result = summarizeTrends([suite([first.id, first.id])], [first, laterImport, laterUnplanned], {
      from: '2026-09-24T00:00:00.000Z', to: '2026-09-25T00:00:00.000Z',
    })
    expect(result.coverage).toMatchObject({ planned: 1, attempts: 1, imported: 0, unplanned: 0 })
    expect(result.groups[0]?.cases[0]).toMatchObject({ outcome: 'first-pass', attemptIds: [first.id] })
    expect(() => summarizeTrends([], [], { from: '2026-09-25T00:00:00Z', to: '2026-09-25T00:00:00Z' })).toThrow(/time window/)
  })

  it('excludes derived copies separately from original unplanned runs', () => {
    const source = run(1, 'pass')
    const derived = run(2, 'inconclusive', { share: { shareId: id(70), reportedVerdict: 'pass', verification: 'not-revalidated', withheld: [] } as NonNullable<TestRun['share']> })
    const stray = run(3, 'fail')
    const result = summarizeTrends([suite([source.id])], [source, derived, stray])
    expect(result.coverage).toMatchObject({ planned: 1, firstPassRate: 1, cleanPassRate: 1, derived: 1, unplanned: 1 })
  })

  it('compares non-overlapping UTC windows only with explicit build dimension and 30-sample budget', () => {
    const previous = { from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' }
    const current = { from: '2026-09-21T00:00:00.000Z', to: '2026-09-22T00:00:00.000Z' }
    const records: TestRun[] = [], suites: SuiteRun[] = []
    for (let n = 0; n < 60; n++) {
      const start = Date.parse(n < 30 ? previous.from : current.from) + n * 1000
      const duration = n < 30 ? 100 : 250
      const source = run(n + 1, 'pass', { startedAt: new Date(start).toISOString(), endedAt: new Date(start + duration).toISOString() })
      source.comparison = { ...source.comparison!, appContext: { ...source.comparison!.appContext, build: n < 30 ? '1' : '2' } }
      records.push(source)
      suites.push(suite([source.id], { id: id(1000 + n), startedAt: source.startedAt }))
    }
    const options = { builds: { previous: '1', current: '2' }, budget: { version: 1 as const, slowerByMs: 100, slowerByRatio: 0.1 } }
    const compared = compareTrendWindows(suites, records, previous, current, options)
    expect(compared.groups).toHaveLength(1)
    expect(compared.groups[0]).toMatchObject({ status: 'slower-than-budget', signal: { previousSamples: 30, currentSamples: 30, previousMedianMs: 100, currentMedianMs: 250 } })
    expect(compareTrendWindows(suites.slice(1), records, previous, current, options).groups[0]?.status).toBe('insufficient-samples')
    expect(compareTrendWindows(suites, records, previous, current).groups.every(group => group.status === 'not-comparable')).toBe(true)
    expect(() => compareTrendWindows(suites, records, previous, { ...current, from: previous.to, to: previous.to }, options)).toThrow(/UTC/)
    expect(() => compareTrendWindows(suites, records, previous, { ...current, from: '2026-09-20T12:00:00.000Z' }, options)).toThrow(/UTC/)
  })

  it('reports failed, cancelled and recovered durations apart from pass regression samples', () => {
    const previous = { from: '2026-09-20T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' }
    const current = { from: '2026-09-21T00:00:00.000Z', to: '2026-09-22T00:00:00.000Z' }
    const verdicts = ['fail', 'cancelled', 'recovered'] as const
    const records = verdicts.map((verdict, index) => {
      const started = Date.parse(previous.from) + index * 1000
      return run(index + 1, verdict, { startedAt: new Date(started).toISOString(), endedAt: new Date(started + 100 + index).toISOString() })
    })
    const suites = records.map((record, index) => suite([record.id], { id: id(index + 500), startedAt: record.startedAt }))
    const compared = compareTrendWindows(suites, records, previous, current, { budget: { version: 1, slowerByMs: 50, slowerByRatio: 0.1 } })
    expect(compared.groups[0]?.signal?.previousSamples).toBe(0)
    expect(compared.groups[0]?.otherDurations.previous).toEqual({
      fail: { samples: 1, medianMs: 100 }, cancelled: { samples: 1, medianMs: 101 }, recovered: { samples: 1, medianMs: 102 },
    })
    expect(compared.groups[0]?.otherDurations.current.fail.samples).toBe(0)
  })

  it('atomically switches derived generations and rebuilds a corrupt page without changing originals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-trend-index-'))
    const store = new WorkbenchStore(root)
    try {
      await store.init()
      const source = run(1, 'pass')
      await store.save(source)
      const suitesRoot = join(root, 'suites'); await mkdir(suitesRoot)
      const fixture = suite([source.id]); await writeFile(join(suitesRoot, `${fixture.id}.json`), JSON.stringify(fixture))
      await writeFile(join(suitesRoot, `${id(91)}.json`), '{corrupt')
      const index = new WorkbenchTrendIndex(store, { root: suitesRoot } as WorkbenchSuites)
      const first = await index.rebuild()
      expect(first.groups[0]?.cases[0]?.outcome).toBe('first-pass')
      expect(first.coverage.corruptSuites).toBe(1)
      const pointer = JSON.parse(await readFile(join(index.root, 'current.json'), 'utf8')) as { generation: string }
      await writeFile(join(index.root, pointer.generation, 'page-00000.json'), 'corrupt')
      await expect(index.page()).rejects.toThrow(/rebuild from original runs/)
      const next = await index.rebuild()
      expect(next.generation).not.toBe(first.generation)
      expect(next.groups[0]?.cases[0]?.outcome).toBe('first-pass')
      const cancelled = new AbortController(); cancelled.abort()
      await expect(index.rebuild({}, cancelled.signal)).rejects.toThrow()
      expect((await index.page()).generation).toBe(next.generation)
      await writeFile(join(index.root, 'current.json'), JSON.stringify({ version: 1, generation: next.generation, sha256: next.manifestSha256 }))
      await expect(index.page()).rejects.toThrow(/rebuild from original runs/)
      expect((await index.rebuild()).version).toBe(2)
      expect((await store.get(source.id)).verdict).toBe('pass')
    } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('keeps the last trend generation readable when rebuild capacity admission fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-trend-capacity-'))
    let available = 1024 * 1024 * 1024
    const store = new WorkbenchStore(root, async () => available)
    try {
      await store.init()
      const source = run(1, 'pass'); await store.save(source)
      const suitesRoot = join(root, 'suites'); await mkdir(suitesRoot)
      const fixture = suite([source.id]); await writeFile(join(suitesRoot, `${fixture.id}.json`), JSON.stringify(fixture))
      const index = new WorkbenchTrendIndex(store, { root: suitesRoot } as WorkbenchSuites)
      const first = await index.rebuild()
      available = 256 * 1024 * 1024 + 127 * 1024 * 1024
      await expect(index.rebuild()).rejects.toThrow('storage-insufficient')
      expect((await index.page()).generation).toBe(first.generation)
      expect((await store.get(source.id)).verdict).toBe('pass')
    } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('binds an older page cursor to its original generation after a rebuild', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-trend-cursor-'))
    const store = new WorkbenchStore(root)
    try {
      await store.init()
      const source = run(1, 'pass'); await store.save(source)
      const suitesRoot = join(root, 'suites'); await mkdir(suitesRoot)
      const fixture = suite([source.id]); await writeFile(join(suitesRoot, `${fixture.id}.json`), JSON.stringify(fixture))
      const index = new WorkbenchTrendIndex(store, { root: suitesRoot } as WorkbenchSuites)
      const first = await index.rebuild()
      await writeFile(join(suitesRoot, `${fixture.id}.json`), JSON.stringify({ ...fixture, registeredId: 'changed' }))
      const second = await index.rebuild()
      expect(second.generation).not.toBe(first.generation)
      const old = await index.page(0, { generation: first.generation, manifestSha256: first.manifestSha256 })
      expect(old.groups[0]?.registeredId).toBe('regression')
      expect(second.groups[0]?.registeredId).toBe('changed')
      await expect(index.page(0, { generation: first.generation, manifestSha256: '0'.repeat(64) })).rejects.toThrow(/rebuild from original runs/)
    } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
  })
})
