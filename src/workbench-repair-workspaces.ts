import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, mkdtemp, readdir, readlink, realpath, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { RepairError } from './workbench-repair-contracts.js'
import { assertPatchPathsSafe, inspectSourcePatch, type RepairSourceRegistration,
  resolveRepairSource } from './workbench-repair-source.js'
import { repairCommandReceiptSchema, runRepairCommand, type RepairCommandReceipt } from './workbench-repair-command-runner.js'

async function git(cwd: string, args: string[], stdin?: string): Promise<string> {
  const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, shell: false,
    env: { PATH: process.env.PATH ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_LFS_SKIP_SMUDGE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 64 * 1024) child.kill('SIGKILL') })
  child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 64 * 1024) child.kill('SIGKILL') })
  if (stdin) child.stdin.end(stdin)
  else child.stdin.end()
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
  try {
    const result = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', code => resolve(code))
    })
    if (result !== 0) throw new RepairError('repair-invalid-patch')
    return stdout.trim()
  } finally { clearTimeout(timer) }
}

export interface RepairWorkspaces {
  generationRoot: string
  verificationRoot: string
  baseTreeDigest: string
  close(): Promise<void>
}

/** A durable, host-visible generation checkout; the validation checkout is never this directory. */
export async function createGenerationWorkspace(policy: RepairSourceRegistration) {
  const { root, workspaceRoot } = await resolveRepairSource(policy, policy.repositoryId)
  const commit = await git(root, ['rev-parse', `${policy.baseCommit}^{commit}`])
  if (commit !== policy.baseCommit) throw new RepairError('repair-project-changed')
  const scratch = await realpath(await mkdtemp(join(workspaceRoot, 'repair-code-')))
  const path = join(scratch, 'generation')
  try {
    await git(scratch, ['clone', '--local', '--no-hardlinks', '--no-checkout', '--', root, path])
    await git(path, ['checkout', '--detach', '--force', policy.baseCommit])
    await git(path, ['remote', 'remove', 'origin'])
    const baseTreeDigest = await hashRepairTree(path)
    return { path, baseTreeDigest, close: () => rm(scratch, { recursive: true, force: true }) }
  } catch (error) { await rm(scratch, { recursive: true, force: true }); throw error }
}

export async function releaseGenerationWorkspace(policy: RepairSourceRegistration, path: string): Promise<void> {
  const { workspaceRoot } = await resolveRepairSource(policy, policy.repositoryId)
  const scratch = dirname(path)
  if (basename(path) !== 'generation' || dirname(scratch) !== workspaceRoot
    || !/^repair-code-[A-Za-z0-9]+$/.test(basename(scratch)))
    throw new RepairError('repair-project-changed')
  const info = await lstat(scratch)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new RepairError('repair-project-changed')
  await rm(scratch, { recursive: true, force: true })
}

/** Two independent copies from the exact trusted commit. Dirty user work is never copied or reset. */
export async function createRepairWorkspaces(policy: RepairSourceRegistration): Promise<RepairWorkspaces> {
  const { root } = await resolveRepairSource(policy, policy.repositoryId)
  const commit = await git(root, ['rev-parse', `${policy.baseCommit}^{commit}`])
  if (commit !== policy.baseCommit) throw new RepairError('repair-project-changed')
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'repair-code-')))
  const generationRoot = join(scratch, 'generation'), verificationRoot = join(scratch, 'verification')
  try {
    for (const target of [generationRoot, verificationRoot]) {
      await git(scratch, ['clone', '--local', '--no-hardlinks', '--no-checkout', '--', root, target])
      await git(target, ['checkout', '--detach', '--force', policy.baseCommit])
      if (await git(target, ['rev-parse', 'HEAD']) !== policy.baseCommit)
        throw new RepairError('repair-project-changed')
    }
    const baseTreeDigest = await hashRepairTree(verificationRoot)
    if (baseTreeDigest !== await hashRepairTree(generationRoot)) throw new RepairError('repair-project-changed')
    return { generationRoot, verificationRoot, baseTreeDigest,
      close: () => rm(scratch, { recursive: true, force: true }) }
  } catch (error) { await rm(scratch, { recursive: true, force: true }); throw error }
}

/** Hashes the actual filesystem, including untracked files; no symlink can evade a snapshot. */
export async function hashRepairTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  let files = 0, bytes = 0
  async function visit(dir: string, prefix: string): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === '.git' && prefix === '') continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(dir, entry.name), info = await lstat(path)
      if (info.isSymbolicLink()) { hash.update(`L\0${relative}\0${await readlink(path)}\0`); continue }
      if (info.isDirectory()) { hash.update(`D\0${relative}\0`); await visit(path, relative); continue }
      if (!info.isFile() || ++files > 20_000 || (bytes += info.size) > 1024 * 1024 * 1024)
        throw new RepairError('repair-budget-exhausted')
      const content = await readFile(path)
      hash.update(`F\0${relative}\0${info.mode & 0o777}\0${content.length}\0`)
      hash.update(content)
    }
  }
  await visit(root, '')
  return hash.digest('hex')
}

export interface SourceCheckResult { beforeDigest: string; patchDigest: string; afterPatchDigest: string;
  finalDigest: string; oracleDigest: string; baselineReceipts: RepairCommandReceipt[];
  receipts: RepairCommandReceipt[]; regressionReceipts: RepairCommandReceipt[]; passed: boolean }
export const sourceCheckResultSchema = z.object({
  beforeDigest: z.string().regex(/^[a-f0-9]{64}$/), patchDigest: z.string().regex(/^[a-f0-9]{64}$/),
  afterPatchDigest: z.string().regex(/^[a-f0-9]{64}$/), finalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  oracleDigest: z.string().regex(/^[a-f0-9]{64}$/),
  baselineReceipts: z.array(repairCommandReceiptSchema).min(1).max(20),
  receipts: z.array(repairCommandReceiptSchema).min(1).max(20),
  regressionReceipts: z.array(repairCommandReceiptSchema).max(20), passed: z.boolean(),
}).strict()

/** Syntax, path, and exact-base applicability only; no submitted code is executed before approval. */
export async function preflightRepairPatch(workspaces: RepairWorkspaces, policy: RepairSourceRegistration,
  patch: string): Promise<{ paths: string[]; patchDigest: string }> {
  const files = inspectSourcePatch(patch, policy)
  await assertPatchPathsSafe(workspaces.verificationRoot, files)
  await assertTrackedEntryModes(workspaces.verificationRoot, files.map(file => file.path))
  if (await hashRepairTree(workspaces.verificationRoot) !== workspaces.baseTreeDigest)
    throw new RepairError('repair-project-changed')
  await git(workspaces.verificationRoot, ['apply', '--check', '--whitespace=error', '-'], patch)
  return { paths: files.map(file => file.path), patchDigest: createHash('sha256').update(patch).digest('hex') }
}

/** Build input is replayed from the trusted commit, never copied from the host generation checkout. */
export async function applyRepairPatchForBuild(workspaces: RepairWorkspaces, policy: RepairSourceRegistration,
  patch: string): Promise<string> {
  await preflightRepairPatch(workspaces, policy, patch)
  await git(workspaces.verificationRoot, ['apply', '--whitespace=error', '-'], patch)
  return hashRepairTree(workspaces.verificationRoot)
}

/** Replays a reviewed patch only in verificationRoot; host-provided success is ignored. */
export async function checkRepairPatch(workspaces: RepairWorkspaces, policy: RepairSourceRegistration,
  patch: string, signal?: AbortSignal): Promise<SourceCheckResult> {
  const files = inspectSourcePatch(patch, policy)
  await assertPatchPathsSafe(workspaces.verificationRoot, files)
  await assertTrackedEntryModes(workspaces.verificationRoot, files.map(file => file.path))
  const beforeDigest = await hashRepairTree(workspaces.verificationRoot)
  const { oracleRoot } = await resolveRepairSource(policy, policy.repositoryId)
  const oracleDigest = await hashRepairTree(oracleRoot)
  if (beforeDigest !== workspaces.baseTreeDigest) throw new RepairError('repair-project-changed')
  const baselineReceipts: RepairCommandReceipt[] = []
  for (const command of policy.checks) {
    if (signal?.aborted) throw new RepairError('repair-cancelled')
    baselineReceipts.push(await runRepairCommand(policy, command.id, workspaces.verificationRoot, beforeDigest, signal))
    if (await hashRepairTree(workspaces.verificationRoot) !== beforeDigest
      || await hashRepairTree(oracleRoot) !== oracleDigest) throw new RepairError('repair-invalid-patch')
  }
  if (baselineReceipts.every(receipt => receipt.passed)) throw new RepairError('repair-not-reproduced')
  await git(workspaces.verificationRoot, ['apply', '--check', '--whitespace=error', '-'], patch)
  await git(workspaces.verificationRoot, ['apply', '--whitespace=error', '-'], patch)
  const afterPatchDigest = await hashRepairTree(workspaces.verificationRoot)
  const patchDigest = createHash('sha256').update(patch).digest('hex')
  const receipts: RepairCommandReceipt[] = []
  for (const command of policy.checks) {
    if (signal?.aborted) throw new RepairError('repair-cancelled')
    const before = await hashRepairTree(workspaces.verificationRoot)
    if (before !== afterPatchDigest) throw new RepairError('repair-invalid-patch')
    receipts.push(await runRepairCommand(policy, command.id, workspaces.verificationRoot, before, signal))
    if (await hashRepairTree(workspaces.verificationRoot) !== before) throw new RepairError('repair-invalid-patch')
    if (await hashRepairTree(oracleRoot) !== oracleDigest) throw new RepairError('repair-invalid-patch')
    if (!receipts.at(-1)!.passed) break
  }
  const regressionReceipts: RepairCommandReceipt[] = []
  if (receipts.length === policy.checks.length && receipts.every(receipt => receipt.passed)) {
    for (const command of policy.regressionChecks) {
      if (signal?.aborted) throw new RepairError('repair-cancelled')
      const before = await hashRepairTree(workspaces.verificationRoot)
      if (before !== afterPatchDigest) throw new RepairError('repair-invalid-patch')
      regressionReceipts.push(await runRepairCommand(policy, command.id, workspaces.verificationRoot, before, signal))
      if (await hashRepairTree(workspaces.verificationRoot) !== before
        || await hashRepairTree(oracleRoot) !== oracleDigest) throw new RepairError('repair-invalid-patch')
      if (!regressionReceipts.at(-1)!.passed) break
    }
  }
  const finalDigest = await hashRepairTree(workspaces.verificationRoot)
  return { beforeDigest, patchDigest, afterPatchDigest, finalDigest, oracleDigest, baselineReceipts,
    receipts, regressionReceipts,
    passed: receipts.length === policy.checks.length && receipts.every(receipt => receipt.passed)
      && regressionReceipts.length === policy.regressionChecks.length
      && regressionReceipts.every(receipt => receipt.passed) }
}

async function assertTrackedEntryModes(root: string, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const parts = path.split('/')
    for (let length = 1; length <= parts.length; length++) {
      const prefix = parts.slice(0, length).join('/')
      const staged = await git(root, ['ls-files', '--stage', '--', prefix])
      for (const line of staged.split('\n')) {
        const match = /^(\d{6}) [a-f0-9]+ \d+\t(.+)$/.exec(line)
        if (match?.[2] === prefix && match[1] !== '100644')
          throw new RepairError('repair-invalid-patch')
      }
    }
  }
}
