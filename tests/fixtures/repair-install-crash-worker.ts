import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { WorkbenchService } from '../../src/workbench-service.js'
import { WorkbenchSuites } from '../../src/workbench-suites.js'
import { WorkbenchRepairCoordinator } from '../../src/workbench-repair-coordinator.js'
import { emptyProject } from '../../src/workbench-project.js'
import { repairProjectSchema } from '../../src/workbench-repair-project.js'

async function main() {
  const top = process.argv[2], point = process.argv[3]
  if (!top || !point) throw new Error('Crash worker requires root and cutpoint')
  const sourceRoot = join(top, 'source'), oracleRoot = join(top, 'oracle'), workspaceRoot = join(top, 'workspaces')
  const outputRoot = join(top, 'builds')
  await mkdir(join(sourceRoot, 'src'), { recursive: true })
  for (const path of [oracleRoot, workspaceRoot, outputRoot]) await mkdir(path)
  await writeFile(join(sourceRoot, 'src', 'app.ts'), 'bug\n')
  await writeFile(join(oracleRoot, 'oracle.txt'), 'independent\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', 'src/app.ts')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  const baseCommit = git('rev-parse', 'HEAD'), appId = 'com.example.mobilemirror.mock'
  const yaml = (await readFile(new URL('../../examples/flows/demo.yaml', import.meta.url), 'utf8'))
    .replace('1 actions received', 'wrong expected result')
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
          command: { id: 'build', executable: process.execPath,
            argv: ['-e', 'const f=require("fs"),p=require("path");f.mkdirSync(p.join(process.argv[1],"Fixture.app"));f.writeFileSync(p.join(process.argv[1],"Fixture.app","Info.plist"),"plist")', '%OUTPUT_ROOT%'],
            cwd: 'src', envAllowlist: [], timeoutMs: 3000, outputBytes: 4096 },
          identityCommand: { id: 'identity', executable: process.execPath,
            argv: ['-e', 'process.stdout.write(JSON.stringify({appId:"com.example.mobilemirror.mock",buildMarker:"fixture-marker",version:"1",signatureVerified:true}))', '%ARTIFACT%'],
            cwd: 'src', envAllowlist: [], timeoutMs: 3000, outputBytes: 4096 } }] } }) }
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => new MockProvider(0) })
  await mirror.start({ provider: 'mock' })
  const workbench = new WorkbenchService(mirror, { root: join(top, 'runs') })
  const coordinator = new WorkbenchRepairCoordinator(workbench, new WorkbenchSuites(workbench),
    async () => project, async reached => {
      if (reached !== point) return
      process.stdout.write(`CUTPOINT ${point}\n`)
      await new Promise<void>(() => {})
    })
  const failed = await workbench.start(yaml, undefined, undefined, { project, flowId: 'demo' })
  await workbench.wait()
  const created = await coordinator.createCode({ requestId: randomUUID(), sourceRunId: failed.id,
    flowId: 'demo', repositoryId: 'fixture' }, 'local')
  const scope = await coordinator.approvalChallenge(created.id, 'local', created.revision, 'scope')
  const scoped = await coordinator.approve(created.id, 'local', created.revision, scope.nonce)
  const request = (await coordinator.get(created.id, 'local')).hostRequest!
  await writeFile(join(request.generationWorkspace, 'src', 'app.ts'), 'fixed\n')
  const patch = execFileSync('git', ['diff', '--', 'src/app.ts'], { cwd: request.generationWorkspace, encoding: 'utf8' })
  const submitted = await coordinator.submitCodePatch(created.id, 'local', scoped.revision, {
    protocolVersion: 1, requestId: request.id, caseId: created.id, attemptId: request.attemptId,
    generation: request.generation, repositoryId: request.repositoryId, baseCommit, requestDigest: request.requestDigest,
    patchDigest: createHash('sha256').update(patch).digest('hex'), patch,
    host: { kind: 'codex-mcp', version: 'fixture', pluginVersion: '0.1.0' } })
  const execution = await coordinator.approvalChallenge(created.id, 'local', submitted.revision, 'execution')
  const queued = await coordinator.approve(created.id, 'local', submitted.revision, execution.nonce)
  const built = await coordinator.verifyCode(created.id, 'local', queued.revision)
  if (built.phase !== 'awaiting-approval') throw new Error(`Build did not finish: ${built.phase}/${built.reason}`)
  const installApproval = await coordinator.approvalChallenge(created.id, 'local', built.revision, 'installation')
  const approved = await coordinator.approve(created.id, 'local', built.revision, installApproval.nonce)
  await coordinator.acceptInstall(created.id, 'local', approved.revision)
  throw new Error('Install finished without reaching crash cutpoint')
}

void main().catch(error => { process.stderr.write(`${String(error?.stack ?? error)}\n`); process.exitCode = 1 })
