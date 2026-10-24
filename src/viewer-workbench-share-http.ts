import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { WorkbenchShareJobs } from './workbench-share-jobs.js'

const selection = z.object({ name: z.string().min(1).max(128), masks: z.array(z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }).strict()).max(64).optional() }).strict()
const jobInput = z.object({ kind: z.enum(['share-preview', 'share-export']), format: z.literal('html').optional(), contractVersion: z.literal(1).optional(), requestId: z.string().min(1).max(128), runId: z.string().uuid(), files: z.array(selection).max(64), reviewToken: z.string().uuid().optional(), reviewed: z.boolean().optional() }).strict().refine(value => value.format !== 'html' || value.contractVersion === 1, 'HTML requests require contractVersion 1').refine(value => value.format === 'html' || value.files.length > 0, 'JSON shares require selected evidence')
const legacyInput = z.object({ runId: z.string().uuid(), files: z.array(selection).min(1).max(64), previewDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), reviewed: z.boolean().optional() }).strict()

export interface ShareHttpContext {
  request: IncomingMessage
  response: ServerResponse
  pathname: string
  jobs: WorkbenchShareJobs
  readJson: (limit: number) => Promise<Record<string, unknown>>
  json: (status: number, value: unknown) => void
  responseSignal: () => AbortSignal
}

/** Authorization is performed once in ViewerServer before dispatching into this bounded handler. */
export async function handleWorkbenchShareHttp({ request, response, pathname, jobs, readJson, json, responseSignal }: ShareHttpContext): Promise<void> {
  if (pathname === '/api/workbench/share/jobs' && request.method === 'POST') {
    const body = jobInput.parse(await readJson(256 * 1024))
    json(202, await jobs.submit(body.kind, body.requestId, { ...(body.format ? { format: body.format } : {}), runId: body.runId, options: { files: body.files.map(file => ({ name: file.name, ...(file.masks ? { masks: file.masks } : {}) })) }, ...(body.reviewToken ? { reviewToken: body.reviewToken } : {}), ...(body.reviewed ? { reviewed: true } : {}) }))
    return
  }
  const jobRoute = /^\/api\/workbench\/share\/jobs\/([0-9a-f-]{36})(?:\/(cancel|result))?$/.exec(pathname)
  if (jobRoute) {
    const [, jobId, action] = jobRoute
    if (request.method === 'GET' && !action) json(200, await jobs.get(jobId!))
    else if (request.method === 'GET' && action === 'result') json(200, await jobs.result(jobId!))
    else if (request.method === 'POST' && action === 'cancel') json(200, await jobs.cancel(jobId!))
    else throw new Error('Unknown share job endpoint')
    return
  }
  if (request.method === 'POST' && (pathname === '/api/workbench/share/preview' || pathname === '/api/workbench/share/export')) {
    const body = legacyInput.parse(await readJson(16 * 1024))
    const options = { files: body.files.map(file => ({ name: file.name, ...(file.masks ? { masks: file.masks } : {}) })) }
    const kind = pathname.endsWith('/preview') ? 'share-preview' : 'share-export'
    const reviewToken = kind === 'share-export' ? jobs.reviewTokenForDigest(body.runId, options, body.previewDigest ?? '') : undefined
    const job = await jobs.submit(kind, randomUUID(), { runId: body.runId, options, ...(reviewToken ? { reviewToken } : {}), ...(body.reviewed ? { reviewed: true } : {}) })
    const signal = responseSignal()
    const cancel = () => { void jobs.cancel(job.jobId) }
    signal.addEventListener('abort', cancel, { once: true })
    try { json(200, await jobs.waitResult(job.jobId)) }
    finally { signal.removeEventListener('abort', cancel) }
    return
  }
  throw new Error('Unknown share endpoint')
}
