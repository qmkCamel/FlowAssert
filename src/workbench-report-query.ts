import { z } from 'zod'
import { sha256 } from './content-hash.js'
import type { TestRun } from './workbench-domain.js'
import { safeReportSummary, type ReportSummary } from './workbench-report-presentation.js'

export const reportQuerySchema = z.object({
  query: z.string().max(160).default(''), result: z.enum(['all', 'pass', 'fail', 'recovered', 'cancelled', 'interrupted', 'inconclusive', 'evidence-conflict', 'evidence-contaminated', 'running', 'cancelling', 'finalizing']).default('all'),
  platform: z.enum(['all', 'android', 'ios', 'web', 'unknown']).default('all'), source: z.enum(['all', 'viewer', 'agent', 'import', 'derived', 'mock']).default('all'),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
  caseId: z.string().uuid().optional(), suiteCaseId: z.string().max(160).optional(), build: z.string().max(160).optional(),
  cursor: z.string().max(512).optional(),
}).strict().refine(value => !value.from || !value.to || Date.parse(value.from) < Date.parse(value.to), 'Report date interval must increase')

/** Metadata-only read model: counts and pages share one snapshot; artifacts are never opened. */
export function queryReports(runs: TestRun[], value: unknown) {
  if (runs.length > 10_000) throw new Error('report-summary-budget: at most 10000 records')
  return queryReportSummaries(runs.map(safeReportSummary), value)
}

export function queryReportSummaries(records: ReportSummary[], value: unknown) {
  if (records.length > 10_000) throw new Error('report-summary-budget: at most 10000 records')
  const { cursor, ...query } = reportQuerySchema.parse(value)
  const summaries = [...records].sort((a, b) => (Date.parse(b.startedAt) - Date.parse(a.startedAt) || 0) || a.id.localeCompare(b.id))
  const generation = sha256(JSON.stringify(summaries)), filter = sha256(JSON.stringify(query))
  let offset = 0
  if (cursor) {
    const item = z.object({ generation: z.string().regex(/^[a-f0-9]{64}$/), filter: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).max(10000) }).strict()
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    if (item.generation !== generation || item.filter !== filter) throw new Error('report-refresh-required: records or filters changed')
    offset = item.offset
  }
  const term = query.query.toLocaleLowerCase()
  const filtered = summaries.filter(run => (query.result === 'all' || run.status === query.result)
    && (query.platform === 'all' || run.platform === query.platform)
    && (query.source === 'all' || (query.source === 'mock' ? run.provider === 'mock' : run.source === query.source))
    && (!query.from || Date.parse(run.startedAt) >= Date.parse(query.from)) && (!query.to || Date.parse(run.startedAt) < Date.parse(query.to))
    && (!query.caseId || run.caseId === query.caseId) && (!query.suiteCaseId || run.suiteCaseId === query.suiteCaseId)
    && (!query.build || run.build === query.build)
    && (!term || [run.name, run.deviceName, run.id, run.caseId, run.appId, run.build].join(' ').toLocaleLowerCase().includes(term)))
  const counts: Record<string, number> = {}
  for (const run of filtered) counts[run.status] = (counts[run.status] ?? 0) + 1
  return { contractVersion: 1 as const, generation, query, counts, total: filtered.length,
    coverage: { records: summaries.length, unreadable: summaries.filter(run => run.unreadable).length, matchedUnreadable: filtered.filter(run => run.unreadable).length, complete: !summaries.some(run => run.unreadable) },
    items: filtered.slice(offset, offset + 50),
    nextCursor: offset + 50 < filtered.length ? Buffer.from(JSON.stringify({ generation, filter, offset: offset + 50 })).toString('base64url') : null }
}
