import { z } from 'zod'
import { acceptanceHash } from './workbench-change-contracts.js'
import { externalProjectSchema, type ExternalProject } from './workbench-external-contracts.js'
import type { WorkbenchExternalAssets } from './workbench-external-assets.js'
export async function handleExternalHttp(context: {
  url: URL; method: string | undefined; service: WorkbenchExternalAssets; project(): Promise<ExternalProject>;
  readJson(limit: number): Promise<Record<string, unknown>>; json(status: number, value: unknown): void;
  download(file: { bytes: Buffer; contentType: string; name: string }): void;
}) {
  const { url, method, service, readJson, json } = context, path = url.pathname.slice('/api/workbench/external-assets'.length)
  if (path === '/project' && method === 'GET') { json(200, await context.project()); return }
  if (path === '/preview' && method === 'POST') { json(202, await service.preview(await readJson(94 * 1024 * 1024))); return }
  if (path === '' && method === 'GET') { json(200, await service.list(Number(url.searchParams.get('offset') ?? 0))); return }
  const job = /^\/jobs\/([a-f0-9-]{36})(?:\/(confirm|cancel))?$/.exec(path)
  if (job) {
    if (method === 'GET' && !job[2]) { json(200, await service.getJob(job[1]!)); return }
    if (method === 'POST' && job[2] === 'confirm') { json(200, await service.confirm(job[1]!, await readJson(2048))); return }
    if (method === 'POST' && job[2] === 'cancel') { z.object({}).strict().parse(await readJson(1024)); json(200, await service.cancel(job[1]!)); return }
  }
  const asset = /^\/([a-f0-9-]{36})(?:\/(grant|retire|attachments)(?:\/([a-f0-9-]{36}))?)?$/.exec(path)
  if (asset) {
    const id = asset[1]!
    if (method === 'GET' && !asset[2]) { json(200, await service.get(id)); return }
    if (method === 'GET' && asset[2] === 'attachments' && asset[3]) { context.download(await service.download(id, asset[3])); return }
    if (method === 'POST' && asset[2] === 'grant') {
      const request = z.object({ project: externalProjectSchema, granted: z.boolean(), confirm: z.string() }).strict().parse(await readJson(2048)), project = await context.project()
      if (acceptanceHash(project) !== acceptanceHash(request.project) || request.confirm !== `${request.granted ? 'GRANT' : 'REVOKE'} ${id}`) throw new Error('external-authorization-confirmation')
      json(200, await service.grant(id, project, request.granted)); return
    }
    if (method === 'POST' && asset[2] === 'retire') {
      const request = z.object({ confirm: z.string() }).strict().parse(await readJson(1024))
      if (request.confirm !== `RETIRE ${id}`) throw new Error('external-retire-confirmation')
      json(200, await service.retire(id)); return
    }
  }
  throw new Error('external-endpoint-not-found')
}
