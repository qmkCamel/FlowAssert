import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchSuites } from '../src/workbench-suites.js'
import { WorkbenchRepairCoordinator } from '../src/workbench-repair-coordinator.js'
import { emptyProject } from '../src/workbench-project.js'
import { repairProjectSchema } from '../src/workbench-repair-project.js'
import { repairExitCode } from '../src/workbench-repair-contracts.js'

const yaml = (await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8'))
  .replace('1 actions received', 'wrong expected result')
it('uses a real failed Workbench run and two independent source replays; host cannot self-report success', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'repair-code-end-to-end-')))
  const sourceRoot = join(root, 'source'), oracleRoot = join(root, 'oracle'), workspaceRoot = join(root, 'workspaces')
  await mkdir(join(sourceRoot, 'src'), { recursive: true }); await mkdir(oracleRoot); await mkdir(workspaceRoot)
  await writeFile(join(sourceRoot, 'src', 'app.ts'), 'bug\n')
  await writeFile(join(oracleRoot, 'oracle.txt'), 'independent\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', 'src/app.ts')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  const baseCommit = git('rev-parse', 'HEAD')
  await writeFile(join(sourceRoot, 'src', 'app.ts'), 'dirty user work\n')
  const project = { ...emptyProject(), flows: { demo: yaml },
    provenance: { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1',
      resetContractVersion: 'reset-v1' },
    repair: repairProjectSchema.parse({ enabled: true, projectId: 'sample',
      permissions: ['plan', 'submit', 'verify', 'cancel'], allowedFlows: ['demo'], allowedPlatforms: ['ios'],
      allowedAppIds: ['com.example.mobilemirror.mock'],
      source: { repositoryId: 'fixture', root: sourceRoot, oracleRoot, workspaceRoot, baseCommit,
        isolation: 'trusted-local',
        writablePaths: ['src'], protectedPaths: ['src/oracle.ts'], evidenceNames: [],
        checks: [{ id: 'unit', executable: process.execPath,
          argv: ['-e', 'process.exit(require("fs").readFileSync("app.ts","utf8") === "fixed\\n" ? 0 : 1)'],
          cwd: 'src', envAllowlist: [], timeoutMs: 2000, outputBytes: 1024 }],
        regressionChecks: [{ id: 'regression', executable: process.execPath,
          argv: ['-e', 'process.exit(0)'], cwd: 'src', envAllowlist: [], timeoutMs: 2000, outputBytes: 1024 }] } }) }
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => new MockProvider(0) })
  const store = new WorkbenchStore(join(root, 'runs'))
  const workbench = new WorkbenchService(mirror, { store }), suites = new WorkbenchSuites(workbench)
  let failFinalize = false
  const coordinator = new WorkbenchRepairCoordinator(workbench, suites, async () => project, async point => {
    if (point === 'code:before-finalize' && failFinalize) {
      failFinalize = false
      vi.spyOn(store, 'reserveEvidence').mockImplementationOnce(async () => {
        throw Object.assign(new Error('No space'), { code: 'ENOSPC' })
      })
    }
  })
  try {
    await mirror.start({ provider: 'mock' })
    const failure = await workbench.start(yaml, undefined, undefined, { project, flowId: 'demo' })
    await workbench.wait()
    expect((await workbench.get(failure.id)).verdict).toBe('fail')
    const created = await coordinator.createCode({ requestId: randomUUID(), sourceRunId: failure.id,
      flowId: 'demo', repositoryId: 'fixture' }, 'local')
    expect(created).toMatchObject({ route: 'product-code', phase: 'awaiting-approval' })
    const scope = await coordinator.approvalChallenge(created.id, 'local', created.revision, 'scope')
    const scoped = await coordinator.approve(created.id, 'local', created.revision, scope.nonce)
    const request = (await coordinator.get(created.id, 'local')).hostRequest!
    expect(request).toMatchObject({ baseCommit, generation: 1, caseId: created.id })
    expect(await readFile(join(request.generationWorkspace, 'src', 'app.ts'), 'utf8')).toBe('bug\n')
    expect(request.generationWorkspace).not.toBe(sourceRoot)
    expect((await coordinator.getForAgent(created.id)).hostRequest).toMatchObject({ id: request.id })
    await writeFile(join(request.generationWorkspace, 'src', 'app.ts'), 'fixed\n')
    const patch = execFileSync('git', ['diff', '--', 'src/app.ts'],
      { cwd: request.generationWorkspace, encoding: 'utf8' })
    const submission = { protocolVersion: 1, requestId: request.id, caseId: created.id,
      attemptId: request.attemptId, generation: request.generation, repositoryId: request.repositoryId,
      baseCommit, requestDigest: request.requestDigest, patchDigest: createHash('sha256').update(patch).digest('hex'),
      patch, host: { kind: 'codex-mcp', version: 'gpt-6', pluginVersion: '0.1.0' } }
    await expect(coordinator.submitCodePatch(created.id, 'local', scoped.revision,
      { ...submission, generation: 2 })).rejects.toThrow('repair-stale-approval')
    const submitted = await coordinator.submitCodePatch(created.id, 'local', scoped.revision, submission)
    expect(submitted.phase).toBe('awaiting-approval')
    const execution = await coordinator.approvalChallenge(created.id, 'local', submitted.revision, 'execution')
    const queued = await coordinator.approve(created.id, 'local', submitted.revision, execution.nonce)
    expect(queued.phase).toBe('queued')
    const accepted = await coordinator.acceptCode(created.id, 'local', queued.revision)
    expect(accepted.phase).toBe('preparing')
    let detail = await coordinator.get(created.id, 'local')
    for (let index = 0; index < 300 && detail.case.phase !== 'finished'; index++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      detail = await coordinator.get(created.id, 'local')
    }
    expect(detail.case).toMatchObject({ phase: 'finished', outcome: 'software-verified' })
    expect(detail.sourceChecks).toHaveLength(2)
    expect(detail.verifications[0]).toMatchObject({ grade: 'software', outcome: 'software-verified' })
    expect(repairExitCode(detail.case.outcome!, 'device')).toBe(1)
    expect((await workbench.get(failure.id)).verdict).toBe('fail')
    expect(await readFile(join(sourceRoot, 'src', 'app.ts'), 'utf8')).toBe('dirty user work\n')
    await coordinator.retire(created.id, 'local', detail.case.revision)
    await expect(access(request.generationWorkspace)).rejects.toMatchObject({ code: 'ENOENT' })

    project.repair.source!.checks[0]!.argv = ['-e', 'setInterval(() => {}, 1000)']
    const cancelledCase = await coordinator.createCode({ requestId: randomUUID(), sourceRunId: failure.id,
      flowId: 'demo', repositoryId: 'fixture' }, 'local')
    const cancelledScope = await coordinator.approvalChallenge(cancelledCase.id, 'local', cancelledCase.revision, 'scope')
    const cancelledScoped = await coordinator.approve(cancelledCase.id, 'local', cancelledCase.revision, cancelledScope.nonce)
    const newRequest = (await coordinator.get(cancelledCase.id, 'local')).hostRequest!
    const newSubmission = { ...submission, requestId: newRequest.id, caseId: cancelledCase.id,
      attemptId: newRequest.attemptId, requestDigest: newRequest.requestDigest }
    const cancelledSubmitted = await coordinator.submitCodePatch(cancelledCase.id, 'local',
      cancelledScoped.revision, newSubmission)
    const cancelledExecution = await coordinator.approvalChallenge(cancelledCase.id, 'local',
      cancelledSubmitted.revision, 'execution')
    const cancelledQueued = await coordinator.approve(cancelledCase.id, 'local',
      cancelledSubmitted.revision, cancelledExecution.nonce)
    await coordinator.acceptCode(cancelledCase.id, 'local', cancelledQueued.revision)
    await new Promise(resolve => setTimeout(resolve, 100))
    const active = await coordinator.get(cancelledCase.id, 'local')
    await coordinator.cancel(cancelledCase.id, 'local', active.case.revision)
    let cancelled = await coordinator.get(cancelledCase.id, 'local')
    for (let index = 0; index < 100 && cancelled.case.phase !== 'finished'; index++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      cancelled = await coordinator.get(cancelledCase.id, 'local')
    }
    expect(cancelled.case).toMatchObject({ phase: 'finished', outcome: 'cancelled' })
    expect(cancelled.verifications).toEqual([])

    project.repair.source!.checks[0]!.argv = ['-e', 'process.exit(require("fs").readFileSync("app.ts","utf8") === "fixed\\n" ? 0 : 1)']
    const failedWrite = await coordinator.createCode({ requestId: randomUUID(), sourceRunId: failure.id,
      flowId: 'demo', repositoryId: 'fixture' }, 'local')
    const failedScope = await coordinator.approvalChallenge(failedWrite.id, 'local', failedWrite.revision, 'scope')
    const failedScoped = await coordinator.approve(failedWrite.id, 'local', failedWrite.revision, failedScope.nonce)
    const failedRequest = (await coordinator.get(failedWrite.id, 'local')).hostRequest!
    const failedSubmission = { ...submission, requestId: failedRequest.id, caseId: failedWrite.id,
      attemptId: failedRequest.attemptId, requestDigest: failedRequest.requestDigest }
    const failedSubmitted = await coordinator.submitCodePatch(failedWrite.id, 'local',
      failedScoped.revision, failedSubmission)
    const failedExecution = await coordinator.approvalChallenge(failedWrite.id, 'local',
      failedSubmitted.revision, 'execution')
    const failedQueued = await coordinator.approve(failedWrite.id, 'local',
      failedSubmitted.revision, failedExecution.nonce)
    failFinalize = true
    await coordinator.verifyCode(failedWrite.id, 'local', failedQueued.revision)
    const failed = await coordinator.get(failedWrite.id, 'local')
    expect(failed.case).toMatchObject({ phase: 'finished', outcome: 'inconclusive', reason: 'repair-storage-insufficient' })
    expect(failed.sourceChecks).toHaveLength(2)
    expect(failed.verifications).toEqual([])

    project.repair.source!.checks[0]!.argv = ['-e', 'setInterval(() => {}, 1000)']
    const draining = await coordinator.createCode({ requestId: randomUUID(), sourceRunId: failure.id,
      flowId: 'demo', repositoryId: 'fixture' }, 'local')
    const drainScope = await coordinator.approvalChallenge(draining.id, 'local', draining.revision, 'scope')
    const drainScoped = await coordinator.approve(draining.id, 'local', draining.revision, drainScope.nonce)
    const drainRequest = (await coordinator.get(draining.id, 'local')).hostRequest!
    const drainSubmitted = await coordinator.submitCodePatch(draining.id, 'local', drainScoped.revision,
      { ...submission, requestId: drainRequest.id, caseId: draining.id,
        attemptId: drainRequest.attemptId, requestDigest: drainRequest.requestDigest })
    const drainExecution = await coordinator.approvalChallenge(draining.id, 'local', drainSubmitted.revision, 'execution')
    const drainQueued = await coordinator.approve(draining.id, 'local', drainSubmitted.revision, drainExecution.nonce)
    await coordinator.acceptCode(draining.id, 'local', drainQueued.revision)
    await new Promise(resolve => setTimeout(resolve, 100))
    coordinator.stopAccepting()
    await expect(coordinator.createCode({ requestId: randomUUID(), sourceRunId: failure.id,
      flowId: 'demo', repositoryId: 'fixture' }, 'local')).rejects.toThrow('repair-interrupted')
    await coordinator.close()
    expect((await coordinator.get(draining.id, 'local')).case).toMatchObject({ phase: 'finished', outcome: 'cancelled' })
  } finally {
    vi.restoreAllMocks()
    await coordinator.close(); await suites.close(); await workbench.close(); await mirror.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 90_000)
