import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { runResultProjection } from './workbench-contracts.js'
import { verifyRunEvidence } from './workbench-run-finalization.js'
import type { TestRun } from './workbench-domain.js'
import type { WorkbenchStore } from './workbench-store.js'
import { acceptanceDimensions, acceptanceDimensionsForVersion, type AcceptanceCell, type AcceptanceInput } from './workbench-change-contracts.js'
import type { WorkbenchExternalAssets } from './workbench-external-assets.js'
import type { ExternalAsset } from './workbench-external-contracts.js'

export interface AcceptanceSource {
  run: TestRun
  manifestSha256: string
  availability: 'verified' | 'unavailable'
  storage?: 'matrix'
  recheck?: () => Promise<void>
}
export interface ExternalAcceptanceSource { asset: ExternalAsset; digest: string; availability: string }
export interface AcceptanceSourceLease { sources: Map<string, AcceptanceSource>; external?: Map<string, ExternalAcceptanceSource>; release(): void }
/** Trusted registry seam. Input IDs are never paths. No provider or device capability. */
export interface AcceptanceSourceResolver {
  acquire(input: AcceptanceInput, signal?: AbortSignal): Promise<AcceptanceSourceLease>
}
export class NativeAcceptanceSources implements AcceptanceSourceResolver {
  constructor(readonly store: WorkbenchStore) {}
  async acquire(input: AcceptanceInput, signal?: AbortSignal): Promise<AcceptanceSourceLease> {
    const ids = [...new Set(input.cells.flatMap(cell => [...(cell.runId ? [cell.runId] : []), ...cell.historyRunIds]))]
    const sources = new Map<string, AcceptanceSource>(), releases: (() => void)[] = []
    let totalBytes = 0
    try {
      for (const id of ids) {
        signal?.throwIfAborted()
        try {
          releases.push(await this.store.lease([id], `acceptance:${id}`))
          const stat = await lstat(join(this.store.root, id, 'manifest.json'))
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('manifest-budget')
          totalBytes += stat.size
          if (totalBytes > 64 * 1024 * 1024) throw new Error('source-budget')
          const { run, manifestSha256 } = await this.store.readOnlySnapshot(id)
          if (run.steps.length > 2000 || (run.diagnostics?.length ?? 0) > 5000) throw new Error('source-budget')
          const files = [...run.evidence, ...run.steps.flatMap(step => step.evidence)]
          let availability: AcceptanceSource['availability'] = 'verified'
          if (!files.length || !run.steps.length || files.length > 5000 || run.steps.some(step => !step.evidence.some(file => file.name.endsWith('.xml')) || !step.evidence.some(file => file.contentType === 'image/png'))) availability = 'unavailable'
          else for (const file of files) {
            signal?.throwIfAborted()
            totalBytes += file.bytes
            if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 16 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024
              || file.incomplete || file.recovered || file.lineage?.integrity === 'failed' || file.lineage?.integrity === 'unverified') { availability = 'unavailable'; break }
            try {
              if (!/^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/.test(file.name)) throw new Error('evidence-path')
              const fileStat = await lstat(join(this.store.root, id, file.name))
              if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== file.bytes) throw new Error('evidence-budget')
              await this.store.readEvidence(id, file)
            } catch { availability = 'unavailable'; break }
          }
          if (availability === 'verified' && run.productContract?.contractVersion === 2) {
            try { await verifyRunEvidence(this.store, run) } catch { availability = 'unavailable' }
          }
          sources.set(id, { run, manifestSha256, availability })
        } catch { signal?.throwIfAborted() /* Missing sources stay explicit; never invent provenance. */ }
      }
      signal?.throwIfAborted()
      return { sources, release: () => { for (const release of releases.splice(0)) release() } }
    } catch (error) { for (const release of releases) release(); throw error }
  }
}

export class CombinedAcceptanceSources implements AcceptanceSourceResolver {
  constructor(readonly native: AcceptanceSourceResolver, readonly external: WorkbenchExternalAssets) {}
  async acquire(input: AcceptanceInput, signal?: AbortSignal): Promise<AcceptanceSourceLease> {
    const native = await this.native.acquire(input, signal), leases: Array<{ release(): void }> = [], external = new Map<string, ExternalAcceptanceSource>()
    let total = 0
    try {
      for (const id of new Set(input.cells.flatMap(cell => (cell.externalResults ?? []).map(ref => ref.assetId)))) {
        signal?.throwIfAborted()
        try {
          if (total >= 64 * 1024 * 1024) continue
          const lease = await this.external.lease(id); leases.push(lease)
          total += lease.asset.reportBytes + lease.asset.attachments.reduce((n, f) => n + f.bytes, 0) + Buffer.byteLength(JSON.stringify(lease.asset))
          if (total > 64 * 1024 * 1024) continue
          const current = await this.external.get(id); external.set(id, { asset: lease.asset, digest: lease.digest, availability: current.availability })
        } catch { signal?.throwIfAborted() }
      }
      signal?.throwIfAborted()
      return { sources: native.sources, external, release: () => { native.release(); for (const lease of leases.splice(0)) lease.release() } }
    } catch (error) { native.release(); for (const lease of leases) lease.release(); throw error }
  }
}
export function evaluateAcceptanceCell(input: AcceptanceInput, cell: AcceptanceInput['cells'][number], sources: Map<string, AcceptanceSource>, external?: Map<string, ExternalAcceptanceSource>): AcceptanceCell {
  const reasons = new Set<string>()
  const source = cell.runId ? sources.get(cell.runId) : undefined
  const history = cell.historyRunIds.map(runId => {
    const prior = sources.get(runId)
    return { runId, ...(prior ? { manifestSha256: prior.manifestSha256 } : {}), verdict: prior?.run.verdict ?? 'unavailable' as const }
  })
  const selectedDimensions = acceptanceDimensionsForVersion(input.contractVersion)
  const empty = Object.fromEntries(selectedDimensions.map(d => [d, 'not-performed'])) as AcceptanceCell['dimensions']
  const base = { id: cell.id, title: cell.title, platform: cell.platform, appId: cell.appId, required: cell.required, ...(cell.runId ? { runId: cell.runId } : {}), ...(cell.matrixCell ? { matrixCell: cell.matrixCell } : {}), history }
  const externalResults: NonNullable<AcceptanceCell['externalResults']> = (cell.externalResults ?? []).map(ref => {
    const value = external?.get(ref.assetId), test = value?.asset.parsed.tests.find(t => t.id === ref.testId)
    const matches = value && test && value.availability === 'verified' && value.asset.declaration.commit === input.commit && value.asset.declaration.appId === cell.appId && value.asset.declaration.platform === cell.platform && value.asset.declaration.binarySha256 === cell.binarySha256 && value.asset.declaration.build === cell.build && test.logicalTestKey === cell.logicalTestKey && test.inputDigest === cell.inputDigest
    if (!matches) reasons.add('external-source-unmatched')
    return { ...ref, ...(value ? { digest: value.digest } : {}), reportedStatus: test?.reportedStatus ?? 'unknown', availability: matches ? 'verified' : 'unavailable', source: 'external-report-not-revalidated' }
  })
  const externalBase = externalResults.length ? { externalResults } : {}
  if (!source) return { ...base, ...externalBase, dimensions: empty, status: 'incomplete', outcome: 'not-clean', reasons: ['run-unavailable', ...(externalResults.length ? ['external-not-revalidated', ...reasons] : [])] }
  const { run } = source
  const projection = runResultProjection(run, source.availability)
  const projected = (d: typeof acceptanceDimensions[number]) => d === 'health' || d === 'performance'
    ? projection.verification.contractVersion === 2 ? projection.verification[d] : { required: false, status: 'not-performed' as const }
    : projection.verification[d]
  const dimensions = Object.fromEntries(selectedDimensions.map(d => [d, projected(d).status])) as AcceptanceCell['dimensions']
  if (input.contractVersion === 1 && projection.verification.contractVersion === 2
    && (projection.verification.health.required || projection.verification.performance.required)) reasons.add('acceptance-runtime-version-required')
  if (run.phase !== 'finished') reasons.add('run-not-final')
  if (run.source === 'import' || run.share) reasons.add('import-not-revalidated')
  if (projection.readState !== 'supported') reasons.add('provenance-unavailable')
  if (source.availability !== 'verified') reasons.add('evidence-unavailable')
  if (!input.declarationsReviewed) reasons.add('declarations-not-reviewed')
  const p = projection.provenance
  const same = (actual: { source: string; value: string }, expected: string, reason: string) => { if (actual.source === 'unknown' || actual.value !== expected) reasons.add(reason) }
  same(p.project.sourceCommit, input.commit, 'commit-mismatch')
  same(p.app.id, cell.appId, 'app-mismatch')
  same(p.app.build, cell.build, 'build-mismatch')
  same(p.app.binarySha256, cell.binarySha256, 'binary-mismatch')
  same(p.environment.platform, cell.platform, 'platform-mismatch')
  for (const field of ['os', 'provider', 'driver', 'viewport'] as const) same(p.environment[field], cell.environment[field], `${field}-mismatch`)
  same(p.project.backendEnvironment, cell.environment.backendEnvironment, 'backend-environment-mismatch')
  if (run.platform !== cell.platform) reasons.add('platform-mismatch')
  if (run.comparison?.logicalTestKey !== cell.logicalTestKey) reasons.add('scenario-mismatch')
  if (run.comparison?.inputDigest !== cell.inputDigest) reasons.add('params-mismatch')
  for (const d of selectedDimensions) if (dimensions[d] === 'fail' || ((cell.required.includes(d) || projected(d).required || ['ui', 'cleanup', 'evidence'].includes(d)) && dimensions[d] !== 'pass')) reasons.add(`${d}-not-pass`)
  // An explicitly enumerated parent chain is required, including successful/recovered ancestors.
  let parent = run.parentRunId
  const seen = new Set<string>()
  while (parent && seen.size <= 10) {
    if (seen.has(parent) || !cell.historyRunIds.includes(parent)) { reasons.add('history-chain-incomplete'); break }
    seen.add(parent)
    const prior = sources.get(parent)
    if (!prior) { reasons.add('history-unavailable'); break }
    if (prior.run.source === 'import' || prior.run.share || prior.run.platform !== cell.platform || prior.run.productContract?.provenance.app.id.value !== cell.appId
      || prior.run.comparison?.logicalTestKey !== cell.logicalTestKey || prior.run.comparison?.inputDigest !== cell.inputDigest) reasons.add('history-scope-mismatch')
    if (prior.availability !== 'verified' || prior.run.phase !== 'finished') reasons.add('history-unavailable')
    parent = prior.run.parentRunId
  }
  if (cell.historyRunIds.some(id => !seen.has(id))) reasons.add('history-unrelated')
  if (run.verdict === 'recovered') reasons.add('recovered-not-clean')
  if (!run.verdict || run.verdict === 'inconclusive') reasons.add('run-inconclusive')
  const failure = ['fail', 'evidence-conflict', 'evidence-contaminated'].includes(run.verdict ?? '') || acceptanceDimensions.some(d => dimensions[d] === 'fail' && d !== 'evidence')
  const status = failure ? 'fail' : reasons.size ? 'incomplete' : run.verdict === 'cancelled' ? 'cancelled' : run.verdict === 'pass' ? 'pass' : 'incomplete'
  return { ...base, ...externalBase, manifestSha256: source.manifestSha256, dimensions, status,
    outcome: status === 'pass' ? history.length ? 'followup-pass' : 'first-pass' : 'not-clean',
    ...(run.verdict ? { reportedVerdict: run.verdict } : {}), reasons: [...reasons].sort() }
}
