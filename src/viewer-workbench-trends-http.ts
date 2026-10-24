import { z } from 'zod'
import type { WorkbenchTrendIndex } from './workbench-trends.js'

export interface TrendsHttpContext {
  pathname: string
  method: string | undefined
  searchParams: URLSearchParams
  trends: WorkbenchTrendIndex
  readJson: (limit: number) => Promise<Record<string, unknown>>
  json: (status: number, value: unknown) => void
  responseSignal: () => AbortSignal
}

/** ViewerServer owns the common same-origin and mutation-origin checks. */
export async function handleWorkbenchTrendsHttp({ pathname, method, searchParams, trends, readJson, json, responseSignal }: TrendsHttpContext): Promise<void> {
  if (method === 'GET' && pathname === '/api/workbench/trends') {
    const page = Number(searchParams.get('page') ?? 0)
    const generation = searchParams.get('generation'), manifestSha256 = searchParams.get('manifestSha256')
    if (Boolean(generation) !== Boolean(manifestSha256)) throw new Error('Trend page cursor is incomplete')
    json(200, await trends.page(page, generation && manifestSha256 ? { generation, manifestSha256 } : undefined)); return
  }
  if (method === 'POST' && pathname === '/api/workbench/trends/rebuild') {
    const body = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }).strict().parse(await readJson(1024))
    const from = body.from ? new Date(body.from).toISOString() : undefined
    const to = body.to ? new Date(body.to).toISOString() : undefined
    if (from && to && from >= to) throw new Error('Invalid trend time window')
    json(200, await trends.rebuild({ ...(from ? { from } : {}), ...(to ? { to } : {}) }, responseSignal())); return
  }
  if (method === 'POST' && pathname === '/api/workbench/trends/compare') {
    const window = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict()
    const body = z.object({ previous: window, current: window,
      builds: z.object({ previous: z.string().min(1).max(160), current: z.string().min(1).max(160) }).strict().optional(),
      budget: z.object({ version: z.literal(1), slowerByMs: z.number().finite().nonnegative(), slowerByRatio: z.number().finite().nonnegative() }).strict().optional() }).strict().parse(await readJson(2 * 1024))
    const previous = { from: new Date(body.previous.from).toISOString(), to: new Date(body.previous.to).toISOString() }
    const current = { from: new Date(body.current.from).toISOString(), to: new Date(body.current.to).toISOString() }
    json(200, await trends.compare(previous, current, { ...(body.builds ? { builds: body.builds } : {}), ...(body.budget ? { budget: body.budget } : {}) }, responseSignal())); return
  }
  throw new Error('Unknown trend endpoint')
}
