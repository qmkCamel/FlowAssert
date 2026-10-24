import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchSuites } from '../src/workbench-suites.js'
import { WorkbenchRepairCoordinator } from '../src/workbench-repair-coordinator.js'
import { emptyProject } from '../src/workbench-project.js'
import { repairProjectSchema } from '../src/workbench-repair-project.js'

const yaml = (await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8'))
  .replace('1 actions received', 'wrong expected result')

it('persists exact-artifact approval, installs only through MirrorService and leaves device grade pending', async () => {
  const top = await realpath(await mkdtemp(join(tmpdir(), 'repair-build-install-')))
  const sourceRoot = join(top, 'source'), oracleRoot = join(top, 'oracle'), workspaceRoot = join(top, 'workspaces')
  const outputRoot = join(top, 'builds')
  await mkdir(join(sourceRoot, 'src'), { recursive: true })
  for (const path of [oracleRoot, workspaceRoot, outputRoot]) await mkdir(path)
  await writeFile(join(sourceRoot, 'src', 'app.ts'), 'bug\n')
  await writeFile(join(oracleRoot, 'oracle.txt'), 'independent\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', 'src/app.ts')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  const baseCommit = git('rev-parse', 'HEAD')
  await writeFile(join(sourceRoot, 'src', 'app.ts'), 'dirty user work\n')
  const appId = 'com.example.mobilemirror.mock'
  const buildScript = 'const f=require("fs"),p=require("path");f.mkdirSync(p.join(process.argv[1],"Fixture.app"));f.writeFileSync(p.join(process.argv[1],"Fixture.app","Info.plist"),"plist")'
  const identityScript = 'const f=require("fs");if(!f.existsSync(process.argv[1]))process.exit(1);process.stdout.write(JSON.stringify({appId:"com.example.mobilemirror.mock",buildMarker:"fixture-marker",version:"1",signatureVerified:true}))'
  const project = { ...emptyProject(), flows: { demo: yaml, smoke: yaml.replace('wrong expected result', '1 actions received') },
    provenance: { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1', resetContractVersion: 'reset-v1' },
    repair: repairProjectSchema.parse({ enabled: true, projectId: 'sample', permissions: ['plan', 'submit', 'verify', 'cancel'],
      allowedFlows: ['demo'], allowedPlatforms: ['ios'], allowedAppIds: [appId], regressionFlows: ['smoke'],
      source: { repositoryId: 'fixture', root: sourceRoot, oracleRoot, workspaceRoot, baseCommit,
        isolation: 'trusted-local', writablePaths: ['src'], checks: [{ id: 'unit', executable: process.execPath,
          argv: ['-e', 'process.exit(require("fs").readFileSync("app.ts","utf8") === "fixed\\n" ? 0 : 1)'],
          cwd: 'src', envAllowlist: [], timeoutMs: 2000, outputBytes: 1024 }],
        regressionChecks: [{ id: 'regression', executable: process.execPath,
          argv: ['-e', 'process.exit(0)'], cwd: 'src', envAllowlist: [], timeoutMs: 2000, outputBytes: 1024 }],
        builds: [{ platform: 'ios', appId, outputRoot, artifactPath: 'Fixture.app', artifactKind: 'ios-app',
          reserveBytes: 2 * 1024 * 1024, maxArtifactBytes: 1024 * 1024,
          command: { id: 'build', executable: process.execPath, argv: ['-e', buildScript, '%OUTPUT_ROOT%'],
            cwd: 'src', envAllowlist: [], timeoutMs: 3000, outputBytes: 4096 },
          identityCommand: { id: 'identity', executable: process.execPath, argv: ['-e', identityScript, '%ARTIFACT%'],
            cwd: 'src', envAllowlist: [], timeoutMs: 3000, outputBytes: 4096 } }] } }) }
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => new MockProvider(0) })
  const store = new WorkbenchStore(join(top, 'runs'))
  const workbench = new WorkbenchService(mirror, { store })
  let fault = false
  const coordinator = new WorkbenchRepairCoordinator(workbench, new WorkbenchSuites(workbench),
    async () => project, async point => { if (fault && point === 'install:after-dispatch') throw new Error('receipt lost') })
  try {
    await mirror.start({ provider: 'mock' })
    const failed = await workbench.start(yaml, undefined, undefined, { project, flowId: 'demo' })
    await workbench.wait()
    expect((await workbench.get(failed.id)).verdict).toBe('fail')
    project.repair.regressionFlows = []
    await expect(coordinator.createCode({ requestId: randomUUID(), sourceRunId: failed.id,
      flowId: 'demo', repositoryId: 'fixture' }, 'local')).rejects.toThrow('repair-dependency-unresolved')
    project.repair.regressionFlows = ['smoke']
    async function prepare() {
      const created = await coordinator.createCode({ requestId: randomUUID(), sourceRunId: failed.id,
        flowId: 'demo', repositoryId: 'fixture' }, 'local')
      const scope = await coordinator.approvalChallenge(created.id, 'local', created.revision, 'scope')
      const scoped = await coordinator.approve(created.id, 'local', created.revision, scope.nonce)
      const request = (await coordinator.get(created.id, 'local')).hostRequest!
      await writeFile(join(request.generationWorkspace, 'src', 'app.ts'), 'fixed\n')
      const patch = execFileSync('git', ['diff', '--', 'src/app.ts'], { cwd: request.generationWorkspace, encoding: 'utf8' })
      const submitted = await coordinator.submitCodePatch(created.id, 'local', scoped.revision, {
        protocolVersion: 1, requestId: request.id, caseId: created.id, attemptId: request.attemptId,
        generation: request.generation, repositoryId: request.repositoryId, baseCommit,
        requestDigest: request.requestDigest, patchDigest: createHash('sha256').update(patch).digest('hex'),
        patch, host: { kind: 'codex-mcp', version: 'fixture', pluginVersion: '0.1.0' } })
      const execution = await coordinator.approvalChallenge(created.id, 'local', submitted.revision, 'execution')
      const queued = await coordinator.approve(created.id, 'local', submitted.revision, execution.nonce)
      const built = await coordinator.verifyCode(created.id, 'local', queued.revision)
      const detail = await coordinator.get(created.id, 'local')
      expect(built, JSON.stringify({ outcome: built.outcome, reason: built.reason,
        checks: detail.sourceChecks.map(item => ({ passed: item.passed, receipts: item.receipts,
          regressions: item.regressionReceipts })) })).toMatchObject({ phase: 'awaiting-approval', resumePhase: 'installing' })
      expect(detail.verifications.at(-1)).toMatchObject({ grade: 'software', outcome: 'software-verified' })
      expect(detail.buildArtifact?.artifactDigest).toMatch(/^[a-f0-9]{64}$/)
      return detail
    }
    const detail = await prepare()
    const artifact = detail.buildArtifact!
    project.repair.enabled = false
    await expect(coordinator.approvalChallenge(detail.case.id, 'local', detail.case.revision, 'installation'))
      .rejects.toThrow('repair-not-found')
    project.repair.enabled = true
    await writeFile(join(artifact.artifactPath, 'Info.plist'), 'tampered')
    await expect(coordinator.approvalChallenge(detail.case.id, 'local', detail.case.revision, 'installation'))
      .rejects.toThrow('repair-project-changed')
    await writeFile(join(artifact.artifactPath, 'Info.plist'), 'plist')
    const challenge = await coordinator.approvalChallenge(detail.case.id, 'local', detail.case.revision, 'installation')
    expect(challenge).toMatchObject({ artifactDigest: artifact.artifactDigest, appId, targetDeviceBinding: detail.plan.targetDeviceBinding })
    const approved = await coordinator.approve(detail.case.id, 'local', detail.case.revision, challenge.nonce)
    expect(approved.phase).toBe('installing')
    await coordinator.acceptInstall(detail.case.id, 'local', approved.revision)
    let installed = await coordinator.get(detail.case.id, 'local')
    for (let i = 0; i < 100 && installed.case.phase !== 'blocked'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20)); installed = await coordinator.get(detail.case.id, 'local')
    }
    expect(installed.installIntent).toMatchObject({ status: 'completed', identityState: 'verified' })
    expect(installed.case).toMatchObject({ phase: 'blocked', outcome: 'inconclusive', reason: 'repair-dependency-unresolved' })
    expect(installed.verifications.at(-1)?.grade).toBe('software')
    expect(await readFile(join(sourceRoot, 'src', 'app.ts'), 'utf8')).toBe('dirty user work\n')

    const second = await prepare()
    const secondChallenge = await coordinator.approvalChallenge(second.case.id, 'local', second.case.revision, 'installation')
    const secondApproved = await coordinator.approve(second.case.id, 'local', second.case.revision, secondChallenge.nonce)
    fault = true
    await coordinator.acceptInstall(second.case.id, 'local', secondApproved.revision)
    let unknown = await coordinator.get(second.case.id, 'local')
    for (let i = 0; i < 100 && unknown.case.phase !== 'blocked'; i++) {
      await new Promise(resolve => setTimeout(resolve, 20)); unknown = await coordinator.get(second.case.id, 'local')
    }
    expect(unknown.installIntent?.status).toBe('unknown')
    expect(unknown.case.reason).toBe('repair-unknown-mutation')
    expect((await coordinator.inspectInstallAfterInterruption(second.case.id, 'local')).state).toBe('verified')
    await expect(coordinator.acceptInstall(second.case.id, 'local', unknown.case.revision)).rejects.toThrow()
    coordinator.stopAccepting()
    await expect(coordinator.createCode({ requestId: randomUUID(), sourceRunId: failed.id,
      flowId: 'demo', repositoryId: 'fixture' }, 'local')).rejects.toThrow('repair-interrupted')
    await coordinator.close()
    const recovered = new WorkbenchRepairCoordinator(workbench, new WorkbenchSuites(workbench), async () => project)
    await recovered.recoverInterrupted()
    expect((await recovered.get(second.case.id, 'local')).installIntent).toMatchObject({ status: 'unknown' })
    expect((await recovered.get(second.case.id, 'local')).buildArtifact?.artifactDigest).toBe(second.buildArtifact?.artifactDigest)
    await recovered.close()
  } finally { await coordinator.close(); await workbench.close(); await mirror.dispose(); await rm(top, { recursive: true, force: true }) }
}, 30_000)
