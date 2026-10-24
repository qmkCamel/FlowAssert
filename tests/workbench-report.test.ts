import { describe, it, expect } from 'vitest'
import { queryReports } from '../src/workbench-report-query.js'
import { reportDetail, reportSummary } from '../src/workbench-report-presentation.js'
import { renderReviewedReport } from '../src/workbench-report-html.js'
import { createRunProvenance, createRunVerification, enableRuntimeContract } from '../src/workbench-contracts.js'
import { createReviewedReportSnapshot } from '../src/workbench-report-html.js'
import { sha256 } from '../src/content-hash.js'
import type { TestRun } from '../src/workbench-domain.js'

export function reportFixture(index = 1): TestRun {
  return { schemaVersion: 1, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: 'Report', yaml: 'private-yaml', engine: 'fixture', phase: 'finished', verdict: 'pass', startedAt: '2026-10-05T16:00:00Z', endedAt: '2026-10-05T16:00:02Z', sessionId: 'private-session', deviceName: 'Device', platform: 'android', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed', cleanup: 'session-retained', steps: [], evidence: [] }
}
describe('report metadata and authority', () => {
  it('keeps generation, stable tie order and counts across pages; rejects changed filter or source', () => {
    const runs = Array.from({ length: 101 }, (_, index) => reportFixture(102-index))
    runs[0]!.verdict = 'cancelled'; runs[1]!.verdict = 'recovered'
    const first = queryReports(runs, {})
    expect(first).toMatchObject({ contractVersion: 1, total: 101, counts: { pass: 99, cancelled: 1, recovered: 1 } })
    expect(first.items[0]!.id).toBe(reportFixture(2).id)
    const second = queryReports(runs, { cursor: first.nextCursor })
    expect(second.items).toHaveLength(50); expect(second.counts).toEqual(first.counts)
    const third = queryReports(runs, { cursor: second.nextCursor }); expect(third.items).toHaveLength(1)
    expect(() => queryReports(runs, { query: 'Device', cursor: first.nextCursor })).toThrow(/refresh-required/)
    runs[0]!.name = 'Changed'; expect(() => queryReports(runs, { cursor: first.nextCursor })).toThrow(/refresh-required/)
  })
  it('uses inclusive start, exclusive end and timezone-aware bounds; enforces query and record budgets', () => {
    const run = reportFixture()
    expect(queryReports([run], { from: '2026-10-06T00:00:00+08:00', to: '2026-10-07T00:00:00+08:00' }).total).toBe(1)
    expect(queryReports([run], { to: '2026-10-06T00:00:00+08:00' }).total).toBe(0)
    expect(() => queryReports([run], { from: '2026-10-07T00:00:00Z', to: '2026-10-06T00:00:00Z' })).toThrow()
    expect(() => queryReports([run], { unrelated: true })).toThrow()
    const boundary = queryReports(Array.from({length:10000}, (_, index) => reportFixture(index + 1)), {})
    expect(boundary).toMatchObject({total:10000,counts:{pass:10000}}); expect(boundary.items).toHaveLength(50)
    expect(() => queryReports(Array(10001).fill(run), {})).toThrow(/budget/)
    expect(queryReports([run], { source: 'mock' }).total).toBe(1)
    expect(queryReports([run], { source: 'agent' }).total).toBe(0)
  })
  it('makes unreadable coverage explicit and keeps run-level failures separate from recorded steps', () => {
    const run = reportFixture(); run.name = 'Interrupted / unreadable run'; run.verdict = 'inconclusive'
    expect(queryReports([run], {}).coverage).toMatchObject({ unreadable: 1, complete: false })
    const detail = reportDetail(run); expect(detail.failures).toEqual([]); expect(detail.runtimeDeclared).toBe(false)
    expect(reportSummary(run).durationMs).toBe(2000)
    const missing = reportFixture(); missing.resultProjection = { ...reportDetail(missing).projection, verdict: 'inconclusive', evidenceAvailability: 'unavailable' }
    expect(reportSummary(missing)).toMatchObject({ recordedVerdict: 'pass', currentVerdict: 'inconclusive', status: 'pass' })
  })
  it('never reads attachment payloads during metadata queries', () => {
    const run = reportFixture(); run.evidence = [{ name: 'step-1.png', bytes: 1, sha256: '0'.repeat(64), contentType: 'image/png' }]; Object.defineProperty(run.evidence[0], 'base64', { get: () => { throw new Error('artifact payload read') } })
    expect(queryReports([run], {}).total).toBe(1)
  })
})
const snapshot = () => ({ contractVersion: 1, templateVersion: 1, shareId: reportFixture().id, generatedAt: '2026-10-06T00:00:00Z', sourceVerdict: 'pass', sourceTime: 'withheld', derivedStatus: 'not-revalidated', platform: 'android', runtimeDeclared: false, unsupportedContract: false, dimensions: [], steps: [{ index: 1, title: '<script>alert(1)</script>', expectation: 'https://private.invalid/?token=secret', observation: '" onerror="alert(1)', status: 'passed', assets: [], omitted: true }], withheld: ['private fields omitted'] })
describe('passive reviewed HTML', () => {
  it('escapes text and never turns source content into executable markup or network links', () => {
    const report = renderReviewedReport(snapshot())
    expect(report.html).toContain('&lt;script&gt;'); expect(report.html).not.toContain('<script>')
    expect(report.html).not.toMatch(/href="https?:|src="https?:|<script|<form/)
    expect(report.html).toContain("connect-src 'none'"); expect(report.html).toContain('Not revalidated')
    expect(report.sha256).toBe(sha256(report.html)); expect(renderReviewedReport(snapshot())).toEqual(report)
    expect(() => renderReviewedReport({ ...snapshot(), rawSource: 'private' })).toThrow()
  })
  it('rejects oversized text, step count, invalid assets and unrecognized scope', () => {
    const data = snapshot()
    expect(() => renderReviewedReport({ ...data, steps: [{ ...data.steps[0], title: 'x'.repeat(8193) }] })).toThrow()
    expect(() => renderReviewedReport({ ...data, steps: Array(501).fill(data.steps[0]) })).toThrow()
    expect(() => renderReviewedReport({ ...data, steps: [{ ...data.steps[0], assets: [{ kind: 'image', content: 'data:image/png;base64,ZmFrZQ==', sha256: sha256('fake') }] }] })).toThrow(/PNG/)
    expect(() => renderReviewedReport({ ...data, dimensions: [{ kind: 'unknown', status: 'pass', required: true }] })).toThrow()
    expect(() => renderReviewedReport({ ...data, steps: Array.from({ length: 40 }, (_, i) => ({ ...data.steps[0], index: i + 1, observation: 'x'.repeat(8192) })) })).toThrow(/budget/)
  })
})

it('preserves required unsupported runtime checks without inventing a failed step or inferred pass', () => {
  const run = reportFixture(); run.productContract = { contractVersion: 1, summaryRulesVersion: 1, provenance: createRunProvenance({ capturedAt: run.startedAt, platform: run.platform, runtime: 'fixture' }), verification: createRunVerification(false) }
  enableRuntimeContract(run, ['app-health-v1'], true, false)
  const verification = (run as TestRun).productContract!.verification; if (verification.contractVersion !== 2) throw new Error('Expected runtime contract')
  verification.health.status = 'inconclusive'; verification.health.reason = 'health-source-unsupported'
  const detail = reportDetail(run); expect(detail.failures).toEqual([]); expect(detail.runChecks).toContainEqual(expect.objectContaining({ kind: 'health', status: 'inconclusive' }))
  const data = createReviewedReportSnapshot(run, { digest: 'a'.repeat(64), sourceManifestSha256: 'b'.repeat(64), files: [], withheld: [], suggestions: [], warning: '' }, { shareId: reportFixture(10).id, generatedAt: run.startedAt })
  expect(data.dimensions).toContainEqual({ kind: 'health', required: true, status: 'inconclusive', limitation: 'unsupported' })
  expect(renderReviewedReport(data).html).toContain('未支持 / Unsupported')
})

it('uses recorded case identity rather than a display name and handles corrupt metadata conservatively', () => {
  const first = reportFixture(1), second = reportFixture(2); first.name = second.name = 'Same name'
  first.authoringOrigin = { caseId: reportFixture(10).id, revisionId: reportFixture(11).id, inputDigest: 'a'.repeat(64) }
  second.authoringOrigin = { caseId: reportFixture(20).id, revisionId: reportFixture(21).id, inputDigest: 'b'.repeat(64) }
  expect(queryReports([first, second], { caseId: first.authoringOrigin.caseId }).items.map(item => item.id)).toEqual([first.id])
  const corrupt = { ...reportFixture(3), steps: [null] } as unknown as TestRun
  expect(queryReports([first, corrupt], {}).coverage).toMatchObject({ unreadable: 1, complete: false })
})
