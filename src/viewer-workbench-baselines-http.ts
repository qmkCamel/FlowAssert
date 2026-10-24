import { z } from 'zod'
import { loadTestProject } from './workbench-project.js'
import type { WorkbenchService } from './workbench-service.js'

export interface BaselinesHttpContext {
  pathname: string
  method: string | undefined
  workbench: WorkbenchService
  readJson: (limit: number) => Promise<Record<string, unknown>>
  json: (status: number, value: unknown) => void
}

/** ViewerServer owns the common same-origin and mutation-origin checks. */
export async function handleWorkbenchBaselinesHttp({ pathname, method, workbench, readJson, json }: BaselinesHttpContext): Promise<void> {
  if (method === 'GET' && pathname === '/api/workbench/baselines') {
    const project = await loadTestProject(workbench.projectPath)
    const approved = await workbench.baselines.list()
    json(200, { profiles: Object.entries(project.visualProfiles).map(([id, profile]) => ({
      id, appId: profile.appId, platform: profile.platform, build: profile.build, referenceSha256: profile.referenceSha256,
      approved: approved.filter(row => row.profileId === id).sort((a, b) => b.revision - a.revision).map(row => ({
        revision: row.revision, sourceKind: row.sourceKind, sourceRunId: row.sourceRunId, sourceBuild: row.sourceBuild,
        allowedTargetBuilds: row.allowedTargetBuilds, approvedBy: row.approvedBy, approvedAt: row.approvedAt,
        sourceImageSha256: row.sourceImageSha256, rulesHash: row.rulesHash,
      })),
    })) }); return
  }
  if (method !== 'POST') throw new Error('Unknown baseline endpoint')
  if (pathname.endsWith('/candidate')) {
    const body = z.object({ profileId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/), sourceKind: z.enum(['project', 'run']), runId: z.string().uuid().optional(), evidenceName: z.string().min(1).max(128).optional(), allowedTargetBuilds: z.array(z.string().min(1).max(160)).min(1).max(10).optional() }).strict().parse(await readJson(2 * 1024))
    if (body.sourceKind === 'run' && (!body.runId || !body.evidenceName)) throw new Error('Run source requires a run and image')
    const source = body.sourceKind === 'project' ? { kind: 'project' as const } : { kind: 'run' as const, runId: body.runId!, evidenceName: body.evidenceName! }
    json(200, await workbench.baselines.candidate(body.profileId, source, body.allowedTargetBuilds)); return
  }
  if (pathname.endsWith('/approve')) {
    const body = z.object({ candidateId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), approvalRequestId: z.string().uuid(), approvedBy: z.string().min(1).max(160), reviewed: z.literal(true) }).strict().parse(await readJson(1024))
    const record = await workbench.baselines.approve(body.candidateId, body.digest, body.approvalRequestId, body.approvedBy, body.reviewed)
    json(200, { profileId: record.profileId, revision: record.revision, approvedBy: record.approvedBy, approvedAt: record.approvedAt, sourceImageSha256: record.sourceImageSha256, rulesHash: record.rulesHash }); return
  }
  throw new Error('Unknown baseline endpoint')
}
