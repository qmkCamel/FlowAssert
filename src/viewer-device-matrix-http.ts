import { z } from 'zod'
import type { LocalDeviceMatrix } from './device-matrix.js'
import { matrixSafeSummary } from './device-matrix-contracts.js'
export async function handleMatrixHttp(context: {
  url: URL; method: string | undefined; matrix: LocalDeviceMatrix;
  readJson(limit: number): Promise<Record<string, unknown>>; json(status: number, value: unknown): void;
}) {
  const { url, method, matrix, readJson, json } = context, path = url.pathname.slice('/api/workbench/matrices'.length)
  if (path === '/catalog' && method === 'GET') { json(200, await matrix.catalog()); return }
  if (path === '' && method === 'GET') { json(200, await matrix.list()); return }
  if (path === '/validate' && method === 'POST') { const body = z.object({ planId: z.string() }).strict().parse(await readJson(1024)); json(200, await matrix.validate(body.planId)); return }
  if (path === '' && method === 'POST') {
    const body = z.object({ planId: z.string(), confirm: z.string(), localEvidence: z.literal(true) }).strict().parse(await readJson(1024))
    json(202, matrixSafeSummary(await matrix.start(body.planId, body.confirm))); return
  }
  const target = /^\/([a-f0-9-]{36})(?:\/(cancel|retry|preview))?$/.exec(path)
  if (target) {
    if (method === 'GET' && !target[2]) { json(200, matrixSafeSummary(await matrix.get(target[1]!))); return }
    if (method === 'GET' && target[2] === 'preview') { json(200, { matrixId: target[1], slotId: url.searchParams.get('slot'), ...(await matrix.preview(target[1]!, url.searchParams.get('slot') ?? '')) }); return }
    if (method === 'POST' && target[2] === 'cancel') {
      const body = z.object({ slotId: z.string().optional(), confirm: z.string() }).strict().parse(await readJson(1024))
      if (body.confirm !== `CANCEL ${target[1]}${body.slotId ? ` ${body.slotId}` : ''}`) throw new Error('matrix-cancel-confirmation')
      json(200, matrixSafeSummary(await matrix.cancel(target[1]!, body.slotId))); return
    }
    if (method === 'POST' && target[2] === 'retry') {
      const body = z.object({ cellId: z.string(), confirm: z.string() }).strict().parse(await readJson(1024))
      json(202, matrixSafeSummary(await matrix.retry(target[1]!, body.cellId, body.confirm))); return
    }
  }
  throw new Error('matrix-endpoint-not-found')
}
