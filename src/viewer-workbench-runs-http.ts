import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { parseVideoRequest, sendVideo } from './workbench-video.js'
import type { WorkbenchService } from './workbench-service.js'
import type { WorkbenchRepair } from './workbench-repair.js'
import type { WorkbenchCaseLibrary } from './workbench-cases.js'
import { isWebRun, webCaseSchema } from './workbench-web-contracts.js'
import { reviewWebRun } from './workbench-web-review.js'

export interface RunsHttpContext {
  pathname: string
  method: string | undefined
  request: IncomingMessage
  response: ServerResponse
  workbench: WorkbenchService
  repair: WorkbenchRepair
  cases: WorkbenchCaseLibrary
  origin: string
  sessionId: () => string | null
  readJson: (limit: number) => Promise<Record<string, unknown>>
  json: (status: number, value: unknown) => void
}

/** ViewerServer owns the common same-origin and mutation-origin checks. */
export async function handleWorkbenchRunsHttp({ pathname, method, request, response, workbench, repair, cases, origin, sessionId, readJson, json }: RunsHttpContext): Promise<void> {
  const parts = pathname.split('/').filter(Boolean)
  if (method === 'GET' && parts.length === 2) {
    const runs = await workbench.records()
    json(200, { activeId: workbench.activeId, webTests: { enabled: workbench.webEnabled, target: 'synthetic-viewer', scenarioVersion: 1 }, runs: runs.map(run => isWebRun(run) ? ({
      id: run.id, name: run.name, executionKind: 'web', platform: 'web', source: 'viewer', phase: run.phase, verdict: run.verdict, startedAt: run.startedAt, endedAt: run.endedAt, stepCount: run.steps.length,
    }) : ({
      id: run.id, name: run.name, parentRunId: run.parentRunId, phase: run.phase, verdict: run.verdict,
      startedAt: run.startedAt, endedAt: run.endedAt, stepCount: run.steps.length, deviceName: run.deviceName, source: run.source ?? 'viewer',
      platform: run.platform, appId: run.comparison?.appContext.appId, derived: Boolean(run.share),
    })) })
    return
  }
  if (method === 'POST' && parts.length === 2) {
    const body = await readJson(80 * 1024)
    if (body.executionKind === 'web') {
      const input = z.object({ executionKind: z.literal('web'), localEvidence: z.literal(true), requestId: z.string().uuid(), caseId: z.string().uuid(), revisionId: z.string().uuid(), parentRunId: z.string().uuid().optional() }).strict().parse(body)
      const record = await cases.get(input.caseId); if (record.archivedAt) throw new Error('Case is archived')
      const revision = await cases.revision(input.caseId, input.revisionId)
      if (revision.platform !== 'web') throw new Error('Web revision required')
      const { schemaVersion: _, caseId, revisionId, projectDigest: _project, contentDigest, createdAt: _created, requestHash: _request, ...content } = revision
      json(202, await workbench.startWeb(webCaseSchema.parse(content), { caseId, revisionId, inputDigest: contentDigest }, input.requestId, origin, input.parentRunId)); return
    }
    if (body.localEvidence !== true || typeof body.yaml !== 'string'
      || (body.parentRunId !== undefined && typeof body.parentRunId !== 'string')
      || Object.keys(body).some(key => !['yaml', 'localEvidence', 'parentRunId', 'video', 'params', 'repairDigest', 'repairBaselineRunId'].includes(key))) {
      throw new Error('Run requires YAML and explicit local evidence consent')
    }
    const confirmedRepair = body.repairDigest !== undefined || body.repairBaselineRunId !== undefined
      ? await repair.confirm(z.string().uuid().parse(body.parentRunId), z.string().uuid().parse(body.repairBaselineRunId), z.string().regex(/^[a-f0-9]{64}$/).parse(body.repairDigest)) : undefined
    if (confirmedRepair && confirmedRepair.yaml !== body.yaml) throw new Error('Edited repair draft requires fresh review')
    json(202, await workbench.start(body.yaml, body.parentRunId as string | undefined, body.video === undefined ? undefined : parseVideoRequest(body.video, sessionId()), { params: body.params === undefined ? {} : z.record(z.string(), z.unknown()).parse(body.params), ...(confirmedRepair ? { repair: confirmedRepair } : {}) }))
    return
  }
  if (method === 'POST' && parts.length === 3 && parts[2] === 'import') {
    const body = await readJson(24 * 1024 * 1024)
    if (body.localEvidence !== true || !body.archive || Object.keys(body).some(key => !['archive', 'localEvidence'].includes(key))) throw new Error('Import requires a run archive and explicit local evidence consent')
    json(201, await workbench.store.importArchive(body.archive)); return
  }
  const id = parts[2] ?? ''
  if (method === 'POST' && parts.length === 4 && parts[3] === 'replay') {
    const body = await readJson(1024)
    if (body.localEvidence !== true) throw new Error('Local evidence consent required')
    json(202, await workbench.replay(id)); return
  }
  if (method === 'POST' && parts.length === 4 && parts[3] === 'video') {
    // Raw manifest preserves the original binding even if its read view says interrupted.
    await workbench.store.init()
    const run = await workbench.store.get(id)
    json(200, await workbench.videos.upload(run, request)); return
  }
  if (method === 'POST' && parts.length === 4 && parts[3] === 'cancel') { json(202, await workbench.cancelRecord(id)); return }
  if (method === 'POST' && parts.length === 4 && parts[3] === 'web-review') { json(200, await reviewWebRun(workbench.store, id, await readJson(32 * 1024))); return }
  if (method === 'GET' && parts.length === 3) { json(200, await workbench.record(id)); return }
  if (method === 'GET' && parts.length === 5 && parts[3] === 'artifacts') {
    const release = await workbench.store.lease([id])
    let responseOwnsLease = false
    try {
      const run = await workbench.record(id)
      const file = [...run.evidence, ...run.steps.flatMap(step => step.evidence), ...(!isWebRun(run) && run.video?.file ? [run.video.file] : [])].find(entry => entry.name === parts[4])
      if (!file) throw new Error('Evidence file not found')
      const bytes = await workbench.store.readEvidence(id, file)
      response.once('finish', release); response.once('close', release)
      responseOwnsLease = true
      if (file.contentType.startsWith('video/')) { sendVideo(response, request, bytes, file); return }
      response.writeHead(200, { 'content-type': file.contentType, 'cache-control': 'no-store',
        'content-disposition': `${file.contentType === 'image/png' ? 'inline' : 'attachment'}; filename="${file.name}"` })
      response.end(bytes)
    } finally { if (!responseOwnsLease) release() }
    return
  }
  json(404, { error: 'Run route not found' })
}
