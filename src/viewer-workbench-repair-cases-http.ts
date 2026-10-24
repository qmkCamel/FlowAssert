import { z } from 'zod'
import type { WorkbenchRepairCoordinator } from './workbench-repair-coordinator.js'
import { repairId } from './workbench-repair-contracts.js'
import { patchSubmissionSchema } from './workbench-repair-host-contracts.js'

const revision = z.number().int().positive()
const flowId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
const createBody = z.union([
  z.object({ requestId: repairId, sourceRunId: repairId, baselineRunId: repairId,
    flowId, route: z.literal('locator-maintenance').optional() }).strict(),
  z.object({ requestId: repairId, sourceRunId: repairId, flowId,
    route: z.literal('product-code'), repositoryId: flowId }).strict(),
])
const challengeBody = z.object({ expectedRevision: revision, level: z.enum(['scope', 'execution', 'installation']) }).strict()
const approveBody = z.object({ expectedRevision: revision, nonce: repairId }).strict()
const mutationBody = z.object({ expectedRevision: revision }).strict()

/** Browser/interactive CLI transport only. No agent approval tool imports this handler. */
export async function handleRepairCasesHttp(input: {
  pathname: string
  method: string | undefined
  searchParams: URLSearchParams
  channel: 'local-viewer' | 'interactive-cli'
  service: WorkbenchRepairCoordinator
  readJson: (limit: number) => Promise<unknown>
  json: (status: number, value: unknown) => void
}): Promise<void> {
  const { pathname, method, searchParams, channel, service, readJson, json } = input
  await service.recoverInterrupted()
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== 'workbench' || parts[2] !== 'repairs') throw new Error('Unknown repair endpoint')
  if (parts.length === 3 && method === 'POST') {
    const body = createBody.parse(await readJson(4096))
    const created = body.route === 'product-code' ? await service.createCode(body, 'local')
      : await service.create(body, 'local')
    json(202, { caseId: created.id, revision: created.revision, phase: created.phase, outcome: created.outcome ?? null })
    return
  }
  if (parts.length === 3 && method === 'GET') {
    const limit = searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined
    json(200, await service.records.listOwned('local', { ...(limit !== undefined ? { limit } : {}),
      ...(searchParams.has('after') ? { after: searchParams.get('after')! } : {}) }))
    return
  }
  const id = repairId.parse(parts[3])
  if (parts.length === 4 && method === 'GET') { json(200, await service.get(id, 'local')); return }
  if (parts.length === 5 && method === 'POST') {
    switch (parts[4]) {
      case 'challenge': {
        const body = challengeBody.parse(await readJson(2048))
        json(200, await service.approvalChallenge(id, 'local', body.expectedRevision, body.level, channel)); return
      }
      case 'approve': {
        const body = approveBody.parse(await readJson(2048))
        json(200, await service.approve(id, 'local', body.expectedRevision, body.nonce, channel)); return
      }
      case 'verify': {
        const body = mutationBody.parse(await readJson(2048))
        const current = await service.get(id, 'local')
        const accepted = current.case.route === 'product-code'
          ? await service.acceptCode(id, 'local', body.expectedRevision)
          : await service.acceptMock(id, 'local', body.expectedRevision)
        json(202, { caseId: accepted.id, revision: accepted.revision, phase: accepted.phase }); return
      }
      case 'install': {
        const body = mutationBody.parse(await readJson(2048))
        const accepted = await service.acceptInstall(id, 'local', body.expectedRevision)
        json(202, { caseId: accepted.id, revision: accepted.revision, phase: accepted.phase }); return
      }
      case 'inspect-install': {
        await readJson(2048)
        json(200, await service.inspectInstallAfterInterruption(id, 'local')); return
      }
      case 'submit': {
        const body = z.object({ expectedRevision: revision, submission: patchSubmissionSchema }).strict()
          .parse(await readJson(600 * 1024))
        const accepted = await service.submitCodePatch(id, 'local', body.expectedRevision, body.submission)
        json(202, { caseId: accepted.id, revision: accepted.revision, phase: accepted.phase }); return
      }
      case 'cancel': {
        const body = mutationBody.parse(await readJson(2048))
        const accepted = await service.cancel(id, 'local', body.expectedRevision)
        json(202, { caseId: accepted.id, revision: accepted.revision, phase: accepted.phase,
          outcome: accepted.outcome ?? null }); return
      }
      case 'retire': {
        const body = mutationBody.parse(await readJson(2048))
        await service.retire(id, 'local', body.expectedRevision)
        json(200, { caseId: id, retired: true }); return
      }
      case 'acceptance-candidate': {
        const body = z.object({ expectedRevision: revision, confirm: z.string(), input: z.unknown() }).strict()
          .parse(await readJson(8192))
        if (body.confirm !== `ACCEPT REPAIR ${id} R${body.expectedRevision}`) throw new Error('repair-confirmation-required')
        json(200, await service.acceptanceCandidate(id, 'local', body.expectedRevision, body.input)); return
      }
    }
  }
  throw new Error('Unknown repair endpoint')
}
