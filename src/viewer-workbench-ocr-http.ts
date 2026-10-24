import { z } from 'zod'
import type { WorkbenchApplication } from './workbench-application.js'
import { loadTestProject, ocrProjectDigest } from './workbench-project.js'
import { requireOcrApproval } from './workbench-ocr-approval.js'
export async function handleOcrHttp(context: {
  url: URL; method: string | undefined; application: WorkbenchApplication;
  readJson(limit: number): Promise<Record<string, unknown>>; json(status: number, value: unknown): void;
}) {
  const { url, method, application, readJson, json } = context, path = url.pathname.slice('/api/workbench/ocr'.length)
  if (path === '/identity' && method === 'GET') { json(200, { identity: await application.workbench.ocr.identity(), productionEnabled: false }); return }
  if (path === '/profiles' && method === 'GET') {
    const project = await loadTestProject(application.workbench.projectPath)
    json(200, { profiles: Object.entries(project.ocrProfiles ?? {}).map(([id, registration]) => {
      let approved = false; try { requireOcrApproval(registration, ocrProjectDigest(project)); approved = true } catch { /* default closed */ }
      return { id, profile: registration.profile, approvalStatus: approved ? 'scope-approved-runtime-check-required' : 'unapproved-or-stale' }
    }) }); return
  }
  if (path === '/preview' && method === 'POST') { json(202, application.ocrPreviews.start(await readJson(23 * 1024 * 1024))); return }
  const job = /^\/jobs\/([a-f0-9-]{36})(\/cancel)?$/.exec(path)
  if (job && method === 'GET' && !job[2]) { json(200, application.ocrPreviews.get(job[1]!)); return }
  if (job && method === 'POST' && job[2]) { z.object({}).strict().parse(await readJson(1024)); json(200, await application.ocrPreviews.cancel(job[1]!)); return }
  throw new Error('ocr-endpoint-not-found')
}
