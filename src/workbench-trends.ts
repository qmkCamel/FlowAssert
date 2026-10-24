import type { TestRun } from './workbench-domain.js'
import type { SuiteRun } from './workbench-suites.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { WorkbenchSuites } from './workbench-suites.js'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256 } from './workbench-store.js'
import { productContractReadState, runResultProjection } from './workbench-contracts.js'
import { WorkbenchCleanupJournal } from './workbench-cleanup-journal.js'
import { hasFrozenSuiteFacts } from './workbench-suite-facts.js'
import { verifyRunEvidence } from './workbench-run-finalization.js'

export type TrendOutcome = 'first-pass' | 'flaky' | 'recovered' | 'fail' | 'cancelled' | 'inconclusive' | 'not-executed'
export interface TrendCase {
  suiteId: string
  registeredId: string
  caseId: string
  inputDigest: string
  projectDigest: string
  planDigest: string
  visualScope: string
  environment: string
  comparable: boolean
  outcome: TrendOutcome
  attemptIds: string[]
  durationMs: number | null
  startedAt: string
  evidenceStatus: 'available' | 'missing' | 'trashed' | 'purged'
}
export interface TrendGroup {
  key: string
  registeredId: string
  caseId: string
  inputDigest: string
  projectDigest: string
  planDigest: string
  visualScope: string
  environment: string
  comparable: boolean
  planned: number
  attempts: number
  outcomes: Record<TrendOutcome, number>
  cases: TrendCase[]
}
export interface TrendSummary {
  version: 2
  coverage: { planned: number; attempts: number; firstPassRate: number | null; cleanPassRate: number | null; imported: number; derived: number; unplanned: number; corruptOrMissing: number; corruptSuites: number; activeSuites: number; from: string | null; to: string | null }
  groups: TrendGroup[]
}

const MAX_CASES = 10_000
const outcomeKeys: TrendOutcome[] = ['first-pass', 'flaky', 'recovered', 'fail', 'cancelled', 'inconclusive', 'not-executed']
const emptyOutcomes = (): Record<TrendOutcome, number> => Object.fromEntries(outcomeKeys.map(key => [key, 0])) as Record<TrendOutcome, number>

function environmentOf(run: TestRun | undefined): { key: string; comparable: boolean } {
  const context = run?.comparison
  if (!context) return { key: 'unknown', comparable: false }
  const values = [context.executionContext.platform, context.executionContext.provider, context.executionContext.os,
    context.executionContext.runtime, context.executionContext.viewport, context.appContext.appId, context.appContext.build]
  if (values.some(value => !value || value === 'unknown')) return { key: 'unknown', comparable: false }
  return { key: JSON.stringify(values), comparable: true }
}

type HistoricalRun = TestRun & { retainedEvidenceStatus?: 'trashed' | 'purged' }

function outcomeOf(attempts: TestRun[], plannedAttempts: number): TrendOutcome {
  if (!plannedAttempts) return 'not-executed'
  if (!attempts.length || attempts.some(run => run.phase !== 'finished' || run.recovery?.reason === 'Manifest unavailable')) return 'inconclusive'
  const last = attempts.at(-1)!
  if (runResultProjection(last).clean) return attempts.length === 1 ? 'first-pass' : 'flaky'
  if (last.verdict === 'recovered') return 'recovered'
  if (last.verdict === 'fail' || last.verdict === 'evidence-conflict' || last.verdict === 'evidence-contaminated') return 'fail'
  if (last.verdict === 'cancelled') return 'cancelled'
  return 'inconclusive'
}

/** A read-only projection. Suites are the denominator; attempts are never counted as new cases. */
export function summarizeTrends(suites: SuiteRun[], runs: HistoricalRun[], range: { from?: string; to?: string } = {}): TrendSummary {
  for (const value of [range.from, range.to]) if (value !== undefined && (!Number.isFinite(Date.parse(value)) || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value))) throw new Error('Invalid trend time window')
  const fromMs = range.from ? Date.parse(range.from) : -Infinity, toMs = range.to ? Date.parse(range.to) : Infinity
  if (fromMs >= toMs) throw new Error('Invalid trend time window')
  const within = suites.filter(suite => Date.parse(suite.startedAt) >= fromMs && Date.parse(suite.startedAt) < toMs)
  const selected = within.filter(suite => suite.phase === 'finished')
  const planned = selected.reduce((count, suite) => count + suite.cases.length, 0)
  if (planned > MAX_CASES) throw new Error(`Trend scan exceeds ${MAX_CASES} planned cases; narrow the time window`)
  const byId = new Map(runs.map(run => [run.id, run]))
  const referencedAnywhere = new Set(suites.flatMap(suite => suite.cases.flatMap(item => item.attempts)))
  const grouped = new Map<string, TrendGroup>()
  let missing = 0, attempts = 0
  const caseIdentities = new Set<string>()
  for (const suite of selected) for (const item of suite.cases) {
    const identityKey = JSON.stringify([suite.id, item.id])
    if (caseIdentities.has(identityKey)) throw new Error('Duplicate planned case identity')
    caseIdentities.add(identityKey)
    const attemptIds = [...new Set(item.attempts)]
    const records = attemptIds.map(id => byId.get(id)).filter((run): run is HistoricalRun => Boolean(run))
    const local = records.filter(run => run.source !== 'import' && productContractReadState(run) !== 'unsupported'
      && !run.evidence.some(file => file.lineage?.kind === 'derived'))
    const last = local.at(-1)
    const identity = last?.comparison
    const environment = environmentOf(last)
    const inputDigest = identity?.inputDigest ?? 'unknown'
    const projectDigest = suite.snapshotSha256 || 'unknown', planDigest = identity?.planDigest ?? 'unknown'
    const visualScope = last ? JSON.stringify(last.steps.filter(step => step.kind === 'assertVisual').map(step => ({
      profile: step.visual?.profile ?? 'unknown', revision: step.visual?.revision ?? null,
      referenceSha256: step.visual?.referenceSha256 ?? 'unknown' }))) : 'unknown'
    const key = JSON.stringify([2, projectDigest, suite.registeredId, item.id, planDigest, inputDigest,
      last?.verificationScope ?? 'unknown', visualScope, environment.key])
    let group = grouped.get(key)
    if (!group) {
      group = { key, registeredId: suite.registeredId, caseId: item.id, projectDigest, planDigest, inputDigest,
        visualScope, environment: environment.key,
        comparable: environment.comparable && projectDigest !== 'unknown' && planDigest !== 'unknown' && inputDigest !== 'unknown',
        planned: 0, attempts: 0, outcomes: emptyOutcomes(), cases: [] }
      grouped.set(key, group)
    }
    const evidenceStatus = local.length === attemptIds.length
      ? local.some(run => run.retainedEvidenceStatus === 'purged') ? 'purged'
        : local.some(run => run.retainedEvidenceStatus === 'trashed') ? 'trashed' : 'available'
      : 'missing'
    if (evidenceStatus === 'missing') missing++
    let outcome = outcomeOf(local, attemptIds.length)
    if (evidenceStatus === 'missing' && attemptIds.length) outcome = 'inconclusive'
    const durationMs = last?.endedAt
      ? Math.max(0, Date.parse(last.endedAt) - Date.parse(last.startedAt)) : null
    const entry: TrendCase = { suiteId: suite.id, registeredId: suite.registeredId, caseId: item.id,
      projectDigest, planDigest, visualScope, inputDigest,
      environment: environment.key, comparable: group.comparable, outcome, attemptIds,
      durationMs: Number.isFinite(durationMs) ? durationMs : null, startedAt: suite.startedAt, evidenceStatus }
    group.planned++; group.attempts += attemptIds.length; group.outcomes[outcome]++; group.cases.push(entry)
    attempts += attemptIds.length
  }
  const withinRuns = runs.filter(run => Date.parse(run.startedAt) >= fromMs && Date.parse(run.startedAt) < toMs)
  if (withinRuns.length > MAX_CASES) throw new Error(`Trend scan exceeds ${MAX_CASES} run summaries; narrow the time window`)
  const imported = withinRuns.filter(run => run.source === 'import').length
  const derived = withinRuns.filter(run => run.source !== 'import' && (Boolean(run.share) || run.evidence.some(file => file.lineage?.kind === 'derived'))).length
  const unplanned = withinRuns.filter(run => run.source !== 'import' && !run.share && !run.evidence.some(file => file.lineage?.kind === 'derived') && !referencedAnywhere.has(run.id)).length
  const firstPass = [...grouped.values()].reduce((count, group) => count + group.outcomes['first-pass'], 0)
  const flaky = [...grouped.values()].reduce((count, group) => count + group.outcomes.flaky, 0)
  return { version: 2, coverage: { planned, attempts, firstPassRate: planned ? firstPass / planned : null, cleanPassRate: planned ? (firstPass + flaky) / planned : null,
    imported, derived, unplanned, corruptOrMissing: missing, corruptSuites: 0, activeSuites: within.length - selected.length,
    from: range.from ?? null, to: range.to ?? null }, groups: [...grouped.values()].sort((a, b) => a.key.localeCompare(b.key)) }
}

export interface PerformanceSignal { version: 1; previousSamples: number; currentSamples: number; previousMedianMs: number | null; currentMedianMs: number | null; relativeChange: number | null; status: 'insufficient-samples' | 'within-budget' | 'slower-than-budget'; slowerByMs: number; slowerByRatio: number }
/** Budget is explicit and versioned; noisy small samples never become regression claims. */
export function performanceSignal(previous: number[], current: number[], budget: { version: 1; slowerByMs: number; slowerByRatio: number }): PerformanceSignal {
  if (![budget.slowerByMs, budget.slowerByRatio].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid performance budget')
  const median = (values: number[]): number | null => {
    const clean = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
    return clean.length ? (clean[Math.floor((clean.length - 1) / 2)]! + clean[Math.floor(clean.length / 2)]!) / 2 : null
  }
  const previousMedianMs = median(previous), currentMedianMs = median(current)
  const previousSamples = previous.filter(value => Number.isFinite(value) && value >= 0).length
  const currentSamples = current.filter(value => Number.isFinite(value) && value >= 0).length
  const relativeChange = previousMedianMs === null || previousMedianMs === 0 || currentMedianMs === null ? null : (currentMedianMs - previousMedianMs) / previousMedianMs
  const status = previousSamples < 30 || currentSamples < 30 ? 'insufficient-samples'
    : currentMedianMs! - previousMedianMs! > budget.slowerByMs && (previousMedianMs === 0 ? currentMedianMs! > 0 : relativeChange! > budget.slowerByRatio)
      ? 'slower-than-budget' : 'within-budget'
  return { version: 1, previousSamples, currentSamples, previousMedianMs, currentMedianMs, relativeChange, status,
    slowerByMs: budget.slowerByMs, slowerByRatio: budget.slowerByRatio }
}

export interface TrendWindow { from: string; to: string }
export interface TrendWindowComparison {
  version: 1
  previous: TrendSummary['coverage']
  current: TrendSummary['coverage']
  builds: { previous: string; current: string } | null
  budget: { version: 1; slowerByMs: number; slowerByRatio: number } | null
  groups: { key: string; registeredId: string; caseId: string; previousRunIds: string[]; currentRunIds: string[];
    previousExcluded: number; currentExcluded: number; status: 'not-comparable' | 'no-budget' | PerformanceSignal['status'];
    signal: PerformanceSignal | null;
    otherDurations: { previous: TrendOtherDurations; current: TrendOtherDurations } }[]
}

type OtherDurationOutcome = 'fail' | 'cancelled' | 'recovered'
type TrendOtherDurations = Record<OtherDurationOutcome, { samples: number; medianMs: number | null }>
const otherDurationOutcomes: OtherDurationOutcome[] = ['fail', 'cancelled', 'recovered']
const emptyOtherDurations = (): Record<OtherDurationOutcome, number[]> => ({ fail: [], cancelled: [], recovered: [] })
function summarizeOtherDurations(values: Record<OtherDurationOutcome, number[]>): TrendOtherDurations {
  return Object.fromEntries(otherDurationOutcomes.map(outcome => {
    const sorted = [...values[outcome]].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return [outcome, { samples: sorted.length,
      medianMs: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[middle]!) / 2 : null }]
  })) as TrendOtherDurations
}

/** Descriptive comparison only; never changes an original verdict. */
export function compareTrendWindows(suites: SuiteRun[], runs: TestRun[], previous: TrendWindow, current: TrendWindow,
  options: { builds?: { previous: string; current: string }; budget?: { version: 1; slowerByMs: number; slowerByRatio: number } } = {}): TrendWindowComparison {
  const validUtc = (value: string) => /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value))
  if (![previous.from, previous.to, current.from, current.to].every(validUtc)
    || Date.parse(previous.from) >= Date.parse(previous.to) || Date.parse(current.from) >= Date.parse(current.to)
    || Date.parse(previous.to) > Date.parse(current.from)) throw new Error('Trend comparison requires ordered, non-overlapping UTC half-open windows')
  if (options.builds && Object.values(options.builds).some(build => !build || build === 'unknown' || build.length > 160)) throw new Error('Invalid explicit comparison builds')
  if (options.budget && options.budget.version !== 1) throw new Error('Unknown performance budget version')
  const left = summarizeTrends(suites, runs, previous), right = summarizeTrends(suites, runs, current)
  const byRun = new Map(runs.map(run => [run.id, run])), bySuite = new Map(suites.map(suite => [suite.id, suite]))
  type BucketSide = { ids: string[]; durations: number[]; excluded: number; other: Record<OtherDurationOutcome, number[]> }
  const emptySide = (): BucketSide => ({ ids: [], durations: [], excluded: 0, other: emptyOtherDurations() })
  type Bucket = { key: string; registeredId: string; caseId: string; previous: BucketSide; current: BucketSide; comparable: boolean }
  const buckets = new Map<string, Bucket>()
  for (const [window, summary] of [['previous', left], ['current', right]] as const) for (const group of summary.groups) for (const entry of group.cases) {
    const suite = bySuite.get(entry.suiteId)
    const run = byRun.get(entry.attemptIds.at(-1) ?? '')
    const identity = run?.comparison, context = identity?.executionContext, app = identity?.appContext
    const values = [suite?.snapshotSha256, identity?.planDigest, identity?.inputDigest,
      context?.platform, context?.provider, context?.os, context?.runtime, context?.viewport,
      app?.appId, app?.build, run?.verificationScope]
    const comparable = entry.comparable && values.every(value => value && value !== 'unknown')
    const build = app?.build ?? 'unknown'
    const key = JSON.stringify([suite?.snapshotSha256 ?? 'unknown', entry.registeredId, entry.caseId,
      identity?.planDigest ?? 'unknown', entry.inputDigest, run?.verificationScope ?? 'unknown',
      context?.platform ?? 'unknown', context?.provider ?? 'unknown', context?.os ?? 'unknown',
      context?.runtime ?? 'unknown', context?.viewport ?? 'unknown', app?.appId ?? 'unknown',
      options.builds ? 'explicit-build-dimension' : build])
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { key, registeredId: entry.registeredId, caseId: entry.caseId,
        previous: emptySide(), current: emptySide(), comparable }
      buckets.set(key, bucket)
    }
    bucket.comparable &&= comparable
    const side = bucket[window]
    const matchesBuild = !options.builds || build === options.builds[window]
    if (comparable && matchesBuild && entry.evidenceStatus === 'available'
      && entry.durationMs !== null && Number.isFinite(entry.durationMs)
      && (entry.outcome === 'fail' || entry.outcome === 'cancelled' || entry.outcome === 'recovered')) {
      side.other[entry.outcome].push(entry.durationMs)
    }
    if (entry.outcome === 'first-pass' && entry.evidenceStatus === 'available' && comparable && matchesBuild
      && entry.durationMs !== null && Number.isFinite(entry.durationMs)) {
      side.ids.push(entry.attemptIds[0]!); side.durations.push(entry.durationMs)
    } else side.excluded++
  }
  if (buckets.size > 500) throw new Error('Trend comparison exceeds 500 groups; narrow the windows')
  if (!options.builds) {
    const scopes = new Map<string, Set<string>>()
    for (const bucket of buckets.values()) {
      const parts = JSON.parse(bucket.key) as string[]
      const build = parts.pop()!
      const key = JSON.stringify(parts)
      const builds = scopes.get(key) ?? new Set<string>()
      builds.add(build); scopes.set(key, builds)
    }
    for (const bucket of buckets.values()) {
      const parts = JSON.parse(bucket.key) as string[]
      parts.pop()
      if ((scopes.get(JSON.stringify(parts))?.size ?? 0) > 1) bucket.comparable = false
    }
  }
  const groups = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)).map(bucket => {
    const signal = bucket.comparable && options.budget
      ? performanceSignal(bucket.previous.durations, bucket.current.durations, options.budget) : null
    return { key: bucket.key, registeredId: bucket.registeredId, caseId: bucket.caseId,
      previousRunIds: bucket.previous.ids, currentRunIds: bucket.current.ids,
      previousExcluded: bucket.previous.excluded, currentExcluded: bucket.current.excluded,
      status: !bucket.comparable ? 'not-comparable' as const : !options.budget ? 'no-budget' as const : signal!.status,
      signal, otherDurations: { previous: summarizeOtherDurations(bucket.previous.other), current: summarizeOtherDurations(bucket.current.other) } }
  })
  return { version: 1, previous: left.coverage, current: right.coverage, builds: options.builds ?? null,
    budget: options.budget ?? null, groups }
}

const TREND_INDEX_VERSION = 2
const PAGE_SIZE = 100
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024
interface TrendGeneration {
  version: 2
  id: string
  createdAt: string
  coverage: TrendSummary['coverage']
  totalGroups: number
  pages: { file: string; sha256: string; count: number }[]
}
interface TrendPointer { version: 2; generation: string; sha256: string }
export interface TrendPage { version: 2; generation: string; manifestSha256: string; createdAt: string; coverage: TrendSummary['coverage']; totalGroups: number; page: number; nextPage: number | null; groups: TrendGroup[] }

/** Derived cache only: originals remain the sole fact source, and pointer replacement is atomic. */
export class WorkbenchTrendIndex {
  readonly root: string
  #building = false
  constructor(readonly store: WorkbenchStore, readonly suites: WorkbenchSuites) { this.root = join(store.root, 'trends') }

  async compare(previous: TrendWindow, current: TrendWindow,
    options: { builds?: { previous: string; current: string }; budget?: { version: 1; slowerByMs: number; slowerByRatio: number } } = {},
    signal?: AbortSignal): Promise<TrendWindowComparison> {
    signal?.throwIfAborted()
    await this.store.init()
    const entries = (await readdir(this.store.root, { withFileTypes: true })).filter(item => item.isDirectory() && /^[0-9a-f-]{36}$/.test(item.name))
    if (entries.length > 100_000) throw new Error('Trend directory scan coverage incomplete')
    const release = entries.length ? await this.store.lease(entries.map(item => item.name), 'trend-window-compare') : undefined
    try {
      let bytes = 0
      for (const entry of entries) {
        signal?.throwIfAborted()
        const source = await lstat(join(this.store.root, entry.name, 'manifest.json'))
        if (!source.isFile()) throw new Error('Trend run manifest is unsafe')
        bytes += source.size
        if (bytes > MAX_MANIFEST_BYTES) throw new Error('Trend scan exceeds 128 MiB of run manifests')
      }
      const sourceSuites = await readSuitesForTrends(this.suites.root, signal)
      if (sourceSuites.corrupt) throw new Error('Trend comparison requires complete suite coverage')
      signal?.throwIfAborted()
      const sourceRuns = await historicalRuns(this.store, sourceSuites.suites, await this.store.list(), signal)
      signal?.throwIfAborted()
      return compareTrendWindows(sourceSuites.suites, sourceRuns, previous, current, options)
    } finally { release?.() }
  }

  async rebuild(range: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<TrendPage> {
    if (this.#building) throw new Error('Trend rebuild already running')
    this.#building = true
    let release: (() => void) | undefined
    let releaseReservation: (() => void) | undefined
    try {
      signal?.throwIfAborted()
      await this.store.init()
      releaseReservation = await this.store.reserveEvidence(`trend:${randomUUID()}`, 128 * 1024 * 1024)
      const runEntries = (await readdir(this.store.root, { withFileTypes: true })).filter(item => item.isDirectory() && /^[0-9a-f-]{36}$/.test(item.name))
      if (runEntries.length > 100_000) throw new Error('Trend directory scan coverage incomplete')
      if (runEntries.length) release = await this.store.lease(runEntries.map(entry => entry.name), 'trend-rebuild')
      let bytes = 0
      for (const entry of runEntries) {
        signal?.throwIfAborted()
        try {
          const source = await lstat(join(this.store.root, entry.name, 'manifest.json'))
          if (source.isFile()) bytes += source.size
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (bytes > MAX_MANIFEST_BYTES) throw new Error('Trend scan exceeds 128 MiB of run manifests')
      }
      const { suites: sourceSuites, corrupt: corruptSuites } = await readSuitesForTrends(this.suites.root, signal)
      signal?.throwIfAborted()
      const sourceRuns = await historicalRuns(this.store, sourceSuites, await this.store.list(), signal)
      signal?.throwIfAborted()
      const summary = summarizeTrends(sourceSuites, sourceRuns, range)
      summary.coverage.corruptSuites = corruptSuites
      const generation = randomUUID()
      const directory = join(this.root, generation)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const pages: TrendGeneration['pages'] = []
      for (let offset = 0; offset < summary.groups.length; offset += PAGE_SIZE) {
        signal?.throwIfAborted()
        const groups = summary.groups.slice(offset, offset + PAGE_SIZE)
        const file = `page-${String(pages.length).padStart(5, '0')}.json`
        const data = JSON.stringify(groups)
        await durableWrite(join(directory, file), data)
        pages.push({ file, sha256: sha256(data), count: groups.length })
      }
      const manifest: TrendGeneration = { version: TREND_INDEX_VERSION, id: generation, createdAt: new Date().toISOString(),
        coverage: summary.coverage, totalGroups: summary.groups.length, pages }
      const manifestData = JSON.stringify(manifest)
      await durableWrite(join(directory, 'manifest.json'), manifestData)
      signal?.throwIfAborted()
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const pointer: TrendPointer = { version: TREND_INDEX_VERSION, generation, sha256: sha256(manifestData) }
      const temporary = join(this.root, `current-${randomUUID()}.tmp`)
      await durableWrite(temporary, JSON.stringify(pointer))
      signal?.throwIfAborted()
      await rename(temporary, join(this.root, 'current.json'))
      const directoryHandle = await open(this.root, 'r'); try { await directoryHandle.sync() } finally { await directoryHandle.close() }
      return this.page(0)
    } finally { release?.(); releaseReservation?.(); this.#building = false }
  }

  async page(index = 0, cursor?: { generation: string; manifestSha256: string }): Promise<TrendPage> {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid trend page')
    let pointer: TrendPointer, manifest: TrendGeneration
    try {
      pointer = cursor ? { version: 2, generation: cursor.generation, sha256: cursor.manifestSha256 }
        : JSON.parse(await readFile(join(this.root, 'current.json'), 'utf8')) as TrendPointer
      if (pointer.version !== TREND_INDEX_VERSION || !/^[0-9a-f-]{36}$/.test(pointer.generation)) throw new Error('Invalid trend pointer')
      if (!/^[a-f0-9]{64}$/.test(pointer.sha256)) throw new Error('Invalid trend manifest digest')
      const data = await readFile(join(this.root, pointer.generation, 'manifest.json'), 'utf8')
      if (sha256(data) !== pointer.sha256) throw new Error('Trend manifest integrity failed')
      manifest = JSON.parse(data) as TrendGeneration
      if (manifest.version !== TREND_INDEX_VERSION || manifest.id !== pointer.generation || !Array.isArray(manifest.pages)) throw new Error('Invalid trend generation')
    } catch { throw new Error('Trend index unavailable; rebuild from original runs') }
    if (index >= manifest.pages.length && (index !== 0 || manifest.pages.length)) throw new Error('Trend page out of range')
    const info = manifest.pages[index]
    let groups: TrendGroup[] = []
    if (info) {
      if (!/^page-\d{5}\.json$/.test(info.file)) throw new Error('Invalid trend page name')
      try {
        const data = await readFile(join(this.root, pointer.generation, info.file), 'utf8')
        if (sha256(data) !== info.sha256) throw new Error('Trend page integrity failed')
        groups = JSON.parse(data) as TrendGroup[]
        if (!Array.isArray(groups) || groups.length !== info.count || groups.length > PAGE_SIZE) throw new Error('Invalid trend page')
      } catch { throw new Error('Trend page unavailable; rebuild from original runs') }
    }
    return { version: TREND_INDEX_VERSION, generation: pointer.generation, manifestSha256: pointer.sha256, createdAt: manifest.createdAt,
      coverage: manifest.coverage, totalGroups: manifest.totalGroups, page: index,
      nextPage: index + 1 < manifest.pages.length ? index + 1 : null, groups }
  }
}

async function durableWrite(path: string, data: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
}

async function readSuitesForTrends(root: string, signal?: AbortSignal): Promise<{ suites: SuiteRun[]; corrupt: number }> {
  let entries: string[]
  try { entries = (await readdir(root)).filter(name => /^[0-9a-f-]{36}\.json$/.test(name)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { suites: [], corrupt: 0 }; throw error }
  if (entries.length > 100_000) throw new Error('Trend suite directory scan coverage incomplete')
  let bytes = 0, corrupt = 0
  const suites: SuiteRun[] = []
  for (const file of entries) {
    signal?.throwIfAborted()
    try {
      const handle = await open(join(root, file), constants.O_RDONLY | constants.O_NOFOLLOW)
      let data: string
      try {
        const info = await handle.stat()
        bytes += info.size
        if (bytes > MAX_MANIFEST_BYTES) throw new Error('Trend scan exceeds 128 MiB of suite manifests')
        data = await handle.readFile('utf8')
      } finally { await handle.close() }
      const suite = JSON.parse(data) as SuiteRun
      if (suite.id !== file.slice(0, -5) || !Array.isArray(suite.cases) || !suite.project || sha256(JSON.stringify(suite.project)) !== suite.snapshotSha256) throw new Error('Invalid suite manifest')
      suites.push(suite)
    } catch (error) {
      if (error instanceof Error && error.message.includes('exceeds 128 MiB')) throw error
      corrupt++
    }
  }
  return { suites, corrupt }
}

/** Only a matching committed lifecycle journal can turn a frozen suite fact into history. */
async function historicalRuns(store: WorkbenchStore, suites: SuiteRun[], live: TestRun[], signal?: AbortSignal): Promise<HistoricalRun[]> {
  let bytes = 0
  for (const run of live) if (run.productContract?.contractVersion === 2 && run.phase === 'finished') {
    signal?.throwIfAborted()
    bytes += [...run.evidence, ...run.steps.flatMap(step => step.evidence)].reduce((total, file) => total + file.bytes, 0)
    if (!Number.isSafeInteger(bytes) || bytes > 128 * 1024 * 1024) throw new Error('Trend runtime verification exceeds 128 MiB; narrow the source store')
    try { await verifyRunEvidence(store, run) }
    catch { run.verdict = 'inconclusive'; run.productContract.verification.evidence.status = 'fail' }
  }
  const known = new Set(live.map(run => run.id))
  const result: HistoricalRun[] = [...live]
  const journals = new WorkbenchCleanupJournal(join(store.root, 'retention', 'journals'))
  for (const suite of suites) for (const item of suite.cases) for (const fact of suite.phase === 'finished' && hasFrozenSuiteFacts(item) ? item.frozenAttempts! : []) {
    if (known.has(fact.runId) || !item.attempts.includes(fact.runId)
      || fact.projection?.runId !== fact.runId || fact.projection.evidenceAvailability !== 'verified') continue
    try {
      const journal = await journals.read(fact.runId)
      if (journal.manifestSha256 !== fact.manifestSha256 || !['trashed', 'purged'].includes(journal.state)) continue
      result.push({ ...fact.trendRun, retainedEvidenceStatus: journal.state as 'trashed' | 'purged' })
      known.add(fact.runId)
    } catch { /* Missing or inconsistent lifecycle facts remain an unexplained gap. */ }
  }
  return result
}
