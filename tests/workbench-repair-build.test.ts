import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildRepairArtifact, inspectRepairArtifact, verifyRepairArtifact } from '../src/workbench-repair-build.js'
import { hashRepairToolchain } from '../src/workbench-repair-command-runner.js'
import { repairSourceRegistrationSchema, type RepairBuildRegistration } from '../src/workbench-repair-source.js'
import { createRepairWorkspaces, hashRepairTree } from '../src/workbench-repair-workspaces.js'
import { WorkbenchStore } from '../src/workbench-store.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const patch = 'diff --git a/src/app.txt b/src/app.txt\nindex 3367afd..3e75765 100644\n--- a/src/app.txt\n+++ b/src/app.txt\n@@ -1 +1 @@\n-old\n+new\n'

async function fixture(kind: 'apk' | 'ios-app' = 'apk') {
  const top = await realpath(await mkdtemp(join(tmpdir(), 'repair-build-fixture-'))); roots.push(top)
  const root = join(top, 'source'), oracleRoot = join(top, 'oracle'), workspaceRoot = join(top, 'workspaces')
  const outputRoot = join(top, 'builds'), evidenceRoot = join(top, 'evidence')
  for (const dir of [root, oracleRoot, workspaceRoot, outputRoot, evidenceRoot]) await mkdir(dir)
  await mkdir(join(root, 'src')); await writeFile(join(root, 'src', 'app.txt'), 'old\n')
  await writeFile(join(oracleRoot, 'oracle.txt'), 'trusted\n')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', 'src/app.txt')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  const baseCommit = git('rev-parse', 'HEAD')
  await writeFile(join(root, 'src', 'app.txt'), 'dirty user edit\n')
  const appId = 'com.example.repair.fixture'
  const buildScript = kind === 'apk'
    ? 'require("fs").writeFileSync(require("path").join(process.argv[1],"fixture.apk"),Buffer.from([80,75,3,4,1,2,3,4]))'
    : 'const f=require("fs"),p=require("path");f.mkdirSync(p.join(process.argv[1],"Fixture.app"));f.writeFileSync(p.join(process.argv[1],"Fixture.app","Info.plist"),"plist")'
  const identityScript = 'const f=require("fs");if(!f.existsSync(process.argv[1]))process.exit(1);process.stdout.write(JSON.stringify({appId:"com.example.repair.fixture",buildMarker:"fixture-marker",version:"1",signatureVerified:true}))'
  const build = { platform: kind === 'apk' ? 'android' : 'ios', appId, outputRoot,
    artifactPath: kind === 'apk' ? 'fixture.apk' : 'Fixture.app', artifactKind: kind,
    reserveBytes: 2 * 1024 * 1024, maxArtifactBytes: 1024 * 1024,
    command: { id: 'build', executable: process.execPath, argv: ['-e', buildScript, '%OUTPUT_ROOT%'], cwd: 'src',
      envAllowlist: [], timeoutMs: 3000, outputBytes: 4096 },
    identityCommand: { id: 'identity', executable: process.execPath,
      argv: ['-e', identityScript, '%ARTIFACT%'], cwd: 'src', envAllowlist: [], timeoutMs: 3000, outputBytes: 4096 },
  } as const
  const policy = repairSourceRegistrationSchema.parse({ repositoryId: 'fixture', root, oracleRoot, workspaceRoot,
    baseCommit, isolation: 'trusted-local', writablePaths: ['src'], checks: [{ id: 'unit', executable: process.execPath,
      argv: ['-e', 'process.exit(0)'], cwd: 'src', envAllowlist: [], timeoutMs: 1000, outputBytes: 1024 }],
    regressionChecks: [{ id: 'regression', executable: process.execPath,
      argv: ['-e', 'process.exit(0)'], cwd: 'src', envAllowlist: [], timeoutMs: 1000, outputBytes: 1024 }], builds: [build] })
  const store = new WorkbenchStore(evidenceRoot, async () => 1024 * 1024 * 1024)
  const workspaces = await createRepairWorkspaces(policy)
  const baseTreeDigest = workspaces.baseTreeDigest
  await workspaces.close()
  return { top, root, oracleRoot, outputRoot, evidenceRoot, policy, store, baseTreeDigest, appId,
    oracleDigest: await hashRepairTree(oracleRoot), toolchainDigest: await hashRepairToolchain(policy) }
}

it.each(['apk', 'ios-app'] as const)('builds isolated %s fixture and detects post-build replacement', async kind => {
  const data = await fixture(kind)
  try {
    const manifest = await buildRepairArtifact(data.store, data.policy, { platform: kind === 'apk' ? 'android' : 'ios',
      appId: data.appId, patch, baseTreeDigest: data.baseTreeDigest, oracleDigest: data.oracleDigest,
      toolchainDigest: data.toolchainDigest, evidenceBytes: 1024 * 1024 })
    expect(manifest).toMatchObject({ kind, appId: data.appId, patchDigest: createHash('sha256').update(patch).digest('hex') })
    expect(await readFile(join(data.root, 'src', 'app.txt'), 'utf8')).toBe('dirty user edit\n')
    await verifyRepairArtifact(manifest, data.policy, data.evidenceRoot)
    await writeFile(kind === 'apk' ? manifest.artifactPath : join(manifest.artifactPath, 'Info.plist'), 'tampered')
    await expect(verifyRepairArtifact(manifest, data.policy, data.evidenceRoot)).rejects.toThrow()
  } finally { await data.store.close() }
})

it('rejects escaping links, unsupported type, and oversized artifacts before identity helper execution', async () => {
  const data = await fixture('ios-app')
  try {
    const config = data.policy.builds[0]!
    const outputDirectory = await realpath(await mkdtemp(join(data.outputRoot, 'repair-build-')))
    await mkdir(join(outputDirectory, 'Fixture.app'))
    await writeFile(join(outputDirectory, 'Fixture.app', 'Info.plist'), 'plist')
    await symlink(data.root, join(outputDirectory, 'Fixture.app', 'escape'))
    await expect(inspectRepairArtifact(outputDirectory, config)).rejects.toThrow('repair-invalid-contract')
    await rm(join(outputDirectory, 'Fixture.app', 'escape'))
    await writeFile(join(outputDirectory, 'Fixture.app', 'large.bin'), Buffer.alloc(1024 * 1024 + 1))
    await expect(inspectRepairArtifact(outputDirectory, config)).rejects.toThrow('repair-budget-exhausted')
    await expect(inspectRepairArtifact(outputDirectory, { ...config, artifactKind: 'apk' } as RepairBuildRegistration))
      .rejects.toThrow('repair-invalid-contract')
  } finally { await data.store.close() }
})
