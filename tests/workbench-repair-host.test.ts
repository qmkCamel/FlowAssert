import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertHostSubmission, createHostRepairRequest, hostCapabilities } from '../src/workbench-repair-host-contracts.js'
import { assertPatchPathsSafe, inspectSourcePatch, repairSourceRegistrationSchema,
  resolveRepairSource } from '../src/workbench-repair-source.js'
import { runRepairCommand } from '../src/workbench-repair-command-runner.js'
import { checkRepairPatch, createRepairWorkspaces, preflightRepairPatch } from '../src/workbench-repair-workspaces.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'repair-source-'))); roots.push(root)
  const oracleRoot = await realpath(await mkdtemp(join(tmpdir(), 'repair-oracle-'))); roots.push(oracleRoot)
  const workspaceRoot = await realpath(await mkdtemp(join(tmpdir(), 'repair-workspaces-'))); roots.push(workspaceRoot)
  await writeFile(join(oracleRoot, 'verifier.txt'), 'independent\n')
  await mkdir(join(root, 'src')); await writeFile(join(root, 'src', 'app.ts'), 'old\n')
  const policy = repairSourceRegistrationSchema.parse({ repositoryId: 'fixture', root, oracleRoot, workspaceRoot,
    isolation: 'trusted-local',
    baseCommit: 'a'.repeat(40), writablePaths: ['src'], protectedPaths: ['src/oracle.ts'],
    checks: [{ id: 'unit', executable: process.execPath, argv: ['-e', 'process.stdout.write("ok")'],
      cwd: 'src', envAllowlist: [], timeoutMs: 2000, outputBytes: 1024 }],
    regressionChecks: [{ id: 'regression', executable: process.execPath, argv: ['-e', 'process.exit(0)'],
      cwd: 'src', envAllowlist: [], timeoutMs: 2000, outputBytes: 1024 }] })
  return { root, policy }
}
const goodPatch = 'diff --git a/src/app.ts b/src/app.ts\nindex 3367afd..3e75765 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n'

it('binds handoff version, expiry, attempt, generation, commit and digest', () => {
  const now = new Date()
  const request = createHostRepairRequest({ protocolVersion: 1, id: randomUUID(), caseId: randomUUID(),
    attemptId: randomUUID(), generation: 1, repositoryId: 'fixture', baseCommit: 'a'.repeat(40),
    projectRevision: 'b'.repeat(64), planDigest: 'c'.repeat(64), sourceTreeDigest: 'd'.repeat(64),
    oracleDigest: 'e'.repeat(64), toolchainDigest: 'f'.repeat(64),
    generationWorkspace: '/tmp/repair-code-fixture/generation',
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString(),
    permittedPaths: ['src'], evidence: [] })
  const submission = { protocolVersion: 1, requestId: request.id, caseId: request.caseId,
    attemptId: request.attemptId, generation: request.generation, repositoryId: request.repositoryId,
    baseCommit: request.baseCommit, requestDigest: request.requestDigest, patch: goodPatch,
    patchDigest: createHash('sha256').update(goodPatch).digest('hex'),
    host: { kind: 'codex-mcp', version: '1.0', pluginVersion: '0.1.0' } }
  expect(assertHostSubmission(request, submission)).toEqual(submission)
  expect(() => assertHostSubmission(request, { ...submission, generation: 2 })).toThrow('repair-stale-approval')
  expect(() => assertHostSubmission(request, { ...submission, baseCommit: 'b'.repeat(40) })).toThrow('repair-stale-approval')
  expect(() => assertHostSubmission(request, { ...submission, patch: `${goodPatch}extra` })).toThrow('repair-invalid-patch')
  expect(() => assertHostSubmission(request, { ...submission, publish: true })).toThrow('repair-invalid-patch')
  expect(hostCapabilities(false, false)).toEqual({ protocolVersion: 1, locator: true, codePatch: false, buildInstall: false })
})

it('rejects entire malicious diffs and checks symlink ancestors', async () => {
  const { root, policy } = await fixture()
  expect((await resolveRepairSource(policy, 'fixture')).root).toBe(root)
  expect(inspectSourcePatch(goodPatch, policy)).toEqual([{ path: 'src/app.ts', added: false }])
  await assertPatchPathsSafe(root, inspectSourcePatch(goodPatch, policy))
  for (const payload of [
    goodPatch.replaceAll('src/app.ts', '../outside'),
    goodPatch.replaceAll('src/app.ts', 'src/oracle.ts'),
    goodPatch.replaceAll('src/app.ts', 'src/package.json'),
    goodPatch.replace('index 3367afd..3e75765 100644', 'old mode 100644\nnew mode 100755'),
    `${goodPatch}GIT binary patch\n`,
    goodPatch.replaceAll('src/app.ts', 'src/bad\\name.ts'),
  ]) expect(() => inspectSourcePatch(payload, policy)).toThrow('repair-invalid-patch')
  await symlink(root, join(root, 'src', 'escape'))
  const added = goodPatch.replaceAll('src/app.ts', 'src/escape/new.ts')
    .replace('index 3367afd..3e75765 100644', 'new file mode 100644\nindex 0000000..3e75765')
    .replace('--- a/src/escape/new.ts', '--- /dev/null')
  await expect(assertPatchPathsSafe(root, inspectSourcePatch(added, policy))).rejects.toThrow('repair-invalid-patch')
})

it('executes only a registered non-shell command and waits for termination on timeout', async () => {
  const { root, policy } = await fixture()
  const receipt = await runRepairCommand(policy, 'unit', root, 'd'.repeat(64))
  expect(receipt).toMatchObject({ commandId: 'unit', exitCode: 0, passed: true, stdoutBytes: 2,
    stdoutHead: 'ok', stdoutTail: 'ok' })
  const failing = { ...policy, checks: [{ ...policy.checks[0]!, argv: ['-e', 'console.error("fixture failure");process.exit(1)'] }] }
  expect(await runRepairCommand(failing, 'unit', root, 'd'.repeat(64))).toMatchObject({
    passed: false, stderrHead: 'fixture failure\n', stderrTail: 'fixture failure\n' })
  await expect(runRepairCommand(policy, 'unknown', root, 'd'.repeat(64))).rejects.toThrow('repair-capability-unavailable')
  await expect(runRepairCommand({ ...policy, isolation: 'sandbox-required' }, 'unit', root, 'd'.repeat(64)))
    .rejects.toThrow('repair-capability-unavailable')
  const slow = { ...policy, checks: [{ ...policy.checks[0]!, argv: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 50 }] }
  expect(await runRepairCommand(slow, 'unit', root, 'd'.repeat(64))).toMatchObject({ timedOut: true, passed: false })
})

it('creates separate exact-commit copies, leaves dirty main intact and checks a replayed patch', async () => {
  const { root, policy } = await fixture()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', 'src/app.ts')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  const baseCommit = git('rev-parse', 'HEAD')
  await writeFile(join(root, 'src', 'app.ts'), 'dirty user edit\n')
  const registered = { ...policy, baseCommit, checks: [{ ...policy.checks[0]!,
    argv: ['-e', 'process.exit(require("fs").readFileSync("app.ts","utf8").includes("new") ? 0 : 1)'] }] }
  const workspaces = await createRepairWorkspaces(registered)
  try {
    expect(await readFile(join(workspaces.generationRoot, 'src', 'app.ts'), 'utf8')).toBe('old\n')
    expect(await readFile(join(workspaces.verificationRoot, 'src', 'app.ts'), 'utf8')).toBe('old\n')
    const checked = await checkRepairPatch(workspaces, registered, goodPatch)
    expect(checked.passed).toBe(true)
    expect(checked.baselineReceipts[0]?.passed).toBe(false)
    expect(checked.receipts).toHaveLength(1)
    expect(await readFile(join(workspaces.verificationRoot, 'src', 'app.ts'), 'utf8')).toBe('new\n')
    expect(await readFile(join(workspaces.generationRoot, 'src', 'app.ts'), 'utf8')).toBe('old\n')
    expect(await readFile(join(root, 'src', 'app.ts'), 'utf8')).toBe('dirty user edit\n')
  } finally { await workspaces.close() }
})

it('replays ten distinct fixture bugs with baseline failure and independent patched software checks', async () => {
  const { root, policy } = await fixture()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  for (let index = 1; index <= 10; index++) await writeFile(join(root, 'src', `case${index}.txt`), `bug-${index}\n`)
  git('init', '-q'); git('add', 'src')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'ten bugs')
  const baseCommit = git('rev-parse', 'HEAD')
  for (let index = 1; index <= 10; index++) {
    const path = `src/case${index}.txt`
    const patch = `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-bug-${index}\n+fixed-${index}\n`
    const registered = { ...policy, baseCommit, checks: [{ ...policy.checks[0]!,
      argv: ['-e', `process.exit(require("fs").readFileSync("case${index}.txt","utf8") === "fixed-${index}\\n" ? 0 : 1)`] }] }
    const workspaces = await createRepairWorkspaces(registered)
    try {
      const checked = await checkRepairPatch(workspaces, registered, patch)
      expect(checked.baselineReceipts[0]?.passed, `baseline ${index}`).toBe(false)
      expect(checked.passed, `candidate ${index}`).toBe(true)
      expect(checked.finalDigest).toBe(checked.afterPatchDigest)
    } finally { await workspaces.close() }
  }
}, 30_000)

it('refuses host success claims, changed oracle, and checks that alter the validation source', async () => {
  const { root, policy } = await fixture()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', 'src/app.ts')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  const baseCommit = git('rev-parse', 'HEAD')
  const oracleMutation = { ...policy, baseCommit, checks: [{ ...policy.checks[0]!,
    argv: ['-e', `require("fs").writeFileSync(${JSON.stringify(join(policy.oracleRoot, 'verifier.txt'))},"forged")`] }] }
  const first = await createRepairWorkspaces(oracleMutation)
  try { await expect(checkRepairPatch(first, oracleMutation, goodPatch)).rejects.toThrow('repair-invalid-patch') }
  finally { await first.close() }
  const sourceMutation = { ...policy, baseCommit, checks: [{ ...policy.checks[0]!,
    argv: ['-e', 'require("fs").writeFileSync("app.ts","forged")'] }] }
  const second = await createRepairWorkspaces(sourceMutation)
  try { await expect(checkRepairPatch(second, sourceMutation, goodPatch)).rejects.toThrow('repair-invalid-patch') }
  finally { await second.close() }
})

it('kills the registered process group before reporting cancellation', async () => {
  const { root, policy } = await fixture()
  const sentinel = join(root, 'sentinel.txt')
  const childCode = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'late'), 300)`
  const parentCode = `require('child_process').spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`
  const slow = { ...policy, checks: [{ ...policy.checks[0]!, argv: ['-e', parentCode], timeoutMs: 2000 }] }
  const abort = new AbortController()
  const running = runRepairCommand(slow, 'unit', root, 'd'.repeat(64), abort.signal)
  setTimeout(() => abort.abort(), 50)
  const receipt = await running
  expect(receipt).toMatchObject({ cancelled: true, passed: false })
  await new Promise(resolve => setTimeout(resolve, 450))
  await expect(access(sentinel)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('rejects a new file beneath a tracked submodule gitlink before applying the patch', async () => {
  const { root, policy } = await fixture()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', 'src/app.ts')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base')
  const first = git('rev-parse', 'HEAD')
  git('update-index', '--add', '--cacheinfo', '160000', first, 'src/linked')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'gitlink')
  const registered = { ...policy, baseCommit: git('rev-parse', 'HEAD') }
  const added = 'diff --git a/src/linked/new.ts b/src/linked/new.ts\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/src/linked/new.ts\n@@ -0,0 +1 @@\n+unsafe\n'
  const workspaces = await createRepairWorkspaces(registered)
  try { await expect(preflightRepairPatch(workspaces, registered, added)).rejects.toThrow('repair-invalid-patch') }
  finally { await workspaces.close() }
})
