import { z } from 'zod'
import type { WorkbenchRetention, RetentionPlan } from './workbench-retention.js'

export interface RetentionHttpContext {
  pathname: string
  method: string | undefined
  retention: WorkbenchRetention
  readJson: (limit: number) => Promise<Record<string, unknown>>
  json: (status: number, value: unknown) => void
}

/** ViewerServer owns the common same-origin and mutation-origin checks. */
export async function handleWorkbenchRetentionHttp({ pathname, method, retention, readJson, json }: RetentionHttpContext): Promise<void> {
  if (method === 'GET' && pathname === '/api/workbench/retention') { json(200, await retention.snapshot()); return }
  if (method !== 'POST') throw new Error('Unknown retention endpoint')
  if (pathname.endsWith('/plan')) {
    const body = z.object({ olderThanDays: z.number().int().min(0).max(3650), maxRuns: z.number().int().min(1).max(100) }).strict().parse(await readJson(1024))
    json(200, await retention.plan(body.olderThanDays, body.maxRuns)); return
  }
  if (pathname.endsWith('/confirm')) {
    const body = z.object({ plan: z.unknown(), reviewed: z.literal(true) }).strict().parse(await readJson(2 * 1024 * 1024))
    json(200, await retention.confirm(body.plan as RetentionPlan)); return
  }
  if (pathname.endsWith('/restore')) {
    const body = z.object({ runId: z.string().uuid() }).strict().parse(await readJson(1024))
    await retention.restore(body.runId); json(200, { restored: body.runId }); return
  }
  if (pathname.endsWith('/purge')) {
    const body = z.object({ runId: z.string().uuid(), confirmPhrase: z.string().max(64) }).strict().parse(await readJson(1024))
    json(200, { freedBytes: await retention.purge(body.runId, body.confirmPhrase) }); return
  }
  if (pathname.endsWith('/pin')) {
    const body = z.object({ runId: z.string().uuid(), pinned: z.boolean() }).strict().parse(await readJson(1024))
    await retention.pin(body.runId, body.pinned); json(200, { runId: body.runId, pinned: body.pinned }); return
  }
  throw new Error('Unknown retention endpoint')
}
