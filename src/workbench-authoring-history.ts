import { z } from 'zod'
import { sha256 } from './content-hash.js'
import { stableJson } from './workbench-comparison.js'
import type { TestRun } from './workbench-domain.js'

/** Additive authoring read model. The legacy run-list API is unchanged. */
export function authoringHistory(runs: TestRun[], value: unknown) {
  const input = z.object({ query: z.string().max(160).default(''), cursor: z.string().max(256).optional() }).strict().parse(value)
  if (runs.length > 10000) throw new Error('authoring-history-budget')
  const summaries = runs.map(run => ({ id: run.id, name: run.name, phase: run.phase, verdict: run.verdict, startedAt: run.startedAt, deviceName: run.deviceName,
    platform: run.platform, appId: run.comparison?.appContext.appId, appBuild: run.comparison?.appContext.build,
    suiteId: run.suiteId, suiteCaseId: run.caseId, attempt: run.attempt, authoringOrigin: run.authoringOrigin,
    paramsDigest: run.params === undefined ? undefined : sha256(stableJson(run.params)), inputDigest: run.comparison?.inputDigest, source: run.source }))
  const generation = sha256(JSON.stringify(summaries)), query = input.query.toLowerCase(), filter = sha256(query)
  let offset = 0
  if (input.cursor) {
    const cursor = z.object({ generation: z.string(), filter: z.string(), offset: z.number().int().min(0).max(10000) }).strict().parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString()))
    if (cursor.generation !== generation || cursor.filter !== filter) throw new Error('authoring-history-refresh-required')
    offset = cursor.offset
  }
  const filtered = summaries.filter(run => `${run.name} ${run.deviceName} ${run.id} ${run.platform} ${run.appId} ${run.authoringOrigin?.caseId ?? ''} ${run.verdict} ${run.startedAt}`.toLowerCase().includes(query))
  return { generation, total: filtered.length, runs: filtered.slice(offset, offset + 50),
    cursor: offset + 50 < filtered.length ? Buffer.from(JSON.stringify({ generation, filter, offset: offset + 50 })).toString('base64url') : null }
}
