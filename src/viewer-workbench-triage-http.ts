import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import type { WorkbenchTriageService } from './workbench-triage-service.js'

const start = z.object({ requestId: z.string().uuid(), targetRunId: z.string().uuid(), comparisonId: z.string().uuid().optional() }).strict()
const review = z.object({ reportId: z.string().uuid(), reportDigest: z.string().regex(/^[a-f0-9]{64}$/), expectedRevision: z.number().int().nonnegative(),
  reviewer: z.string().min(1).max(80), note: z.string().max(2000), directions: z.array(z.enum(['product-behavior', 'locator-change', 'environment', 'evidence-gap'])).max(4),
  evidenceRefs: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/)).max(16) }).strict()

export async function handleWorkbenchTriageHttp(context: {
  pathname: string; request: IncomingMessage; service: WorkbenchTriageService
  readJson: (limit: number) => Promise<Record<string, unknown>>; json: (status: number, value: unknown) => void
}): Promise<void> {
  const { pathname, request, service, readJson, json } = context
  if (pathname === '/api/workbench/triage-jobs' && request.method === 'POST') {
    json(202, await service.start(start.parse(await readJson(2048))))
    return
  }
  const job = /^\/api\/workbench\/triage-jobs\/([0-9a-f-]{36})(?:\/(cancel))?$/.exec(pathname)
  if (job) {
    if (request.method === 'GET' && !job[2]) json(200, await service.getJob(job[1]!))
    else if (request.method === 'POST' && job[2] === 'cancel') json(202, await service.cancel(job[1]!))
    else throw new Error('Unknown triage job endpoint')
    return
  }
  const report = /^\/api\/workbench\/triage-reports\/([0-9a-f-]{36})(?:\/(reviews|retire|evidence)(?:\/([A-Za-z0-9:._-]+))?)?$/.exec(pathname)
  if (report) {
    const id = report[1]!, action = report[2]
    if (request.method === 'GET' && !action) json(200, await service.getReport(id))
    else if (request.method === 'GET' && action === 'evidence' && report[3]) json(200, await service.evidence(id, report[3]))
    else if (request.method === 'GET' && action === 'reviews') json(200, await service.reviews(id))
    else if (request.method === 'POST' && action === 'reviews') json(201, await service.review(id, review.parse(await readJson(4096))))
    else if (request.method === 'POST' && action === 'retire') json(200, await service.retire(id))
    else throw new Error('Unknown triage report endpoint')
    return
  }
  throw new Error('Unknown triage endpoint')
}
