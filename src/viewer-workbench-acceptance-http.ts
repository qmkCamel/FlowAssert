import { z } from 'zod'
import type { WorkbenchChangeAcceptance } from './workbench-change-acceptance.js'

export async function handleAcceptanceHttp(context: {
  url: URL; method: string | undefined; service: WorkbenchChangeAcceptance;
  readJson(limit: number): Promise<Record<string, unknown>>; json(status: number, value: unknown): void;
  download(name: string, contentType: string, text: string): void;
  signal: AbortSignal;
}) {
  const { url, method, service, readJson, json, signal } = context
  const prefix = '/api/workbench/acceptance-records', path = url.pathname.slice(prefix.length)
  if (path === '/preview' && method === 'POST') { json(200, await service.preview(await readJson(1024 * 1024), signal)); return }
  if (path === '' && method === 'POST') { json(202, await service.publish(await readJson(2048))); return }
  if (path === '' && method === 'GET') { json(200, await service.list(Number(url.searchParams.get('offset') ?? 0))); return }
  const job = /^\/jobs\/([a-f0-9-]{36})(?:\/(cancel))?$/.exec(path)
  if (job) {
    if (method === 'GET' && !job[2]) { json(200, await service.getJob(job[1]!)); return }
    if (method === 'POST' && job[2] === 'cancel') { z.object({}).strict().parse(await readJson(1024)); json(202, await service.cancel(job[1]!)); return }
  }
  const record = /^\/([a-f0-9-]{36})(?:\/(retire|revisions)(?:\/(\d+)\/(export))?)?$/.exec(path)
  if (record) {
    const id = record[1]!
    if (method === 'GET' && !record[2]) { json(200, await service.get(id, url.searchParams.has('revision') ? Number(url.searchParams.get('revision')) : undefined, signal)); return }
    if (method === 'POST' && record[2] === 'retire') {
      const body = z.object({ confirm: z.string() }).strict().parse(await readJson(1024))
      if (body.confirm !== `RETIRE ACCEPTANCE ${id}`) throw new Error('acceptance-confirmation-required')
      json(200, await service.retire(id)); return
    }
    if (method === 'GET' && record[2] === 'revisions' && record[4] === 'export') {
      const format = z.enum(['json', 'markdown']).parse(url.searchParams.get('format'))
      context.download(`acceptance-${id}-r${record[3]}.${format === 'json' ? 'json' : 'md'}`, format === 'json' ? 'application/json' : 'text/markdown', await service.export(id, Number(record[3]), format, signal)); return
    }
  }
  throw new Error('acceptance-endpoint-not-found')
}
