import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { RepairError, repairDigest, repairName } from './workbench-repair-contracts.js'

const relPath = z.string().min(1).max(256).regex(/^[A-Za-z0-9._/-]+$/)
export const repairSourceCommandSchema = z.object({ id: repairName, executable: z.string().min(1).max(512),
  argv: z.array(z.string().max(1024)).max(32), cwd: relPath,
  envAllowlist: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(32),
  timeoutMs: z.number().int().min(1).max(600_000), outputBytes: z.number().int().min(1).max(10 * 1024 * 1024),
}).strict()
const command = repairSourceCommandSchema

export const repairBuildRegistrationSchema = z.object({
  platform: z.enum(['android', 'ios']), appId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  outputRoot: z.string().min(1).max(1024), artifactPath: relPath,
  artifactKind: z.enum(['apk', 'ios-app']),
  reserveBytes: z.number().int().min(1024 * 1024).max(4 * 1024 * 1024 * 1024),
  maxArtifactBytes: z.number().int().min(1).max(2 * 1024 * 1024 * 1024),
  command, identityCommand: command,
}).strict().superRefine((value, ctx) => {
  if (!isAbsolute(value.outputRoot) || !validRelativePath(value.artifactPath)
    || (value.platform === 'android' ? value.artifactKind !== 'apk' || !value.artifactPath.endsWith('.apk')
      : value.artifactKind !== 'ios-app' || !value.artifactPath.endsWith('.app'))
    || value.maxArtifactBytes > value.reserveBytes || value.command.id === value.identityCommand.id
    || !value.command.argv.includes('%OUTPUT_ROOT%') || !value.identityCommand.argv.includes('%ARTIFACT%')
    || !isAbsolute(value.command.executable) || !isAbsolute(value.identityCommand.executable))
    ctx.addIssue({ code: 'custom', message: 'Invalid trusted build registration' })
})
export type RepairBuildRegistration = z.infer<typeof repairBuildRegistrationSchema>

/** Trusted local project registration; never filled from an Agent, report, diff, or source comment. */
export const repairSourceRegistrationSchema = z.object({ repositoryId: repairName,
  root: z.string().min(1).max(1024), oracleRoot: z.string().min(1).max(1024),
  workspaceRoot: z.string().min(1).max(1024),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  writablePaths: z.array(relPath).min(1).max(50), protectedPaths: z.array(relPath).max(100).default([]),
  evidenceNames: z.array(repairName).max(20).default([]),
  isolation: z.enum(['trusted-local', 'sandbox-required']).default('sandbox-required'),
  checks: z.array(command).min(1).max(20), regressionChecks: z.array(command).min(1).max(20),
  builds: z.array(repairBuildRegistrationSchema).max(2).default([]),
}).strict().superRefine((value, ctx) => {
  if (!isAbsolute(value.root) || !isAbsolute(value.oracleRoot) || !isAbsolute(value.workspaceRoot)
    || value.root === value.oracleRoot
    || value.writablePaths.some(path => !validRelativePath(path))
    || value.protectedPaths.some(path => !validRelativePath(path))
    || value.checks.some(check => !isAbsolute(check.executable) || !validRelativePath(check.cwd))
    || value.regressionChecks.some(check => !isAbsolute(check.executable) || !validRelativePath(check.cwd))
    || new Set([...value.checks, ...value.regressionChecks].map(check => check.id)).size
      !== value.checks.length + value.regressionChecks.length
    || new Set([...value.checks, ...value.regressionChecks,
      ...value.builds.flatMap(build => [build.command, build.identityCommand])].map(check => check.id)).size
      !== value.checks.length + value.regressionChecks.length + value.builds.length * 2
    || new Set(value.builds.map(build => build.platform)).size !== value.builds.length)
    ctx.addIssue({ code: 'custom', message: 'Invalid trusted source registration' })
})
export type RepairSourceRegistration = z.infer<typeof repairSourceRegistrationSchema>

const protectedNames = new Set(['.git', '.gitmodules', '.gitattributes', '.npmrc', '.yarnrc',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'package.json', 'Makefile', 'justfile', 'Dockerfile', '.gitlab-ci.yml', 'CODEOWNERS', 'SECURITY.md'])
const protectedSegments = new Set(['.git', '.github', '.gitlab', '.husky', 'node_modules', '.pnpm', 'certificates', 'secrets', 'signing'])

export function validRelativePath(value: string): boolean {
  return Boolean(value && !isAbsolute(value) && !value.includes('\\') && !value.includes('\0')
    && value.split('/').every(part => part && part !== '.' && part !== '..'))
}

export async function resolveRepairSource(registration: RepairSourceRegistration,
  expectedRepositoryId: string, expectedRevision?: string) {
  const policy = repairSourceRegistrationSchema.parse(registration)
  if (policy.repositoryId !== expectedRepositoryId) throw new RepairError('repair-not-found')
  const root = await realpath(policy.root)
  const oracleRoot = await realpath(policy.oracleRoot)
  const workspaceRoot = await realpath(policy.workspaceRoot)
  if (root !== policy.root || oracleRoot !== policy.oracleRoot || root === oracleRoot
    || workspaceRoot !== policy.workspaceRoot || workspaceRoot === root || workspaceRoot === oracleRoot
    || oracleRoot.startsWith(`${root}${sep}`) || root.startsWith(`${oracleRoot}${sep}`)
    || workspaceRoot.startsWith(`${root}${sep}`) || root.startsWith(`${workspaceRoot}${sep}`)
    || workspaceRoot.startsWith(`${oracleRoot}${sep}`) || oracleRoot.startsWith(`${workspaceRoot}${sep}`))
    throw new RepairError('repair-project-changed')
  const revision = createHash('sha256').update(JSON.stringify(policy)).digest('hex')
  if (expectedRevision && revision !== expectedRevision) throw new RepairError('repair-project-changed')
  return { policy, root, oracleRoot, workspaceRoot, revision }
}

export interface PatchFile { path: string; added: boolean }

/** Deliberately narrower than git apply: no rename, deletion, binary, mode or exotic path syntax. */
export function inspectSourcePatch(patch: string, policy: RepairSourceRegistration): PatchFile[] {
  if (Buffer.byteLength(patch, 'utf8') > 512 * 1024 || patch.includes('\0') || patch.includes('\r')
    || !patch.endsWith('\n') || patch.includes('GIT binary patch') || patch.includes('Binary files '))
    throw new RepairError('repair-invalid-patch')
  const files: PatchFile[] = []
  const chunks = patch.split(/^diff --git /m).slice(1)
  if (!chunks.length || chunks.length > 20 || !patch.startsWith('diff --git '))
    throw new RepairError('repair-invalid-patch')
  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const match = /^a\/([A-Za-z0-9._/-]+) b\/([A-Za-z0-9._/-]+)$/.exec(lines[0] ?? '')
    const path = match?.[1]
    if (!path || path !== match?.[2] || !validRelativePath(path) || !relPath.safeParse(path).success
      || files.some(file => file.path === path) || isProtected(path, policy)
      || !policy.writablePaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`)))
      throw new RepairError('repair-invalid-patch')
    const header = lines.slice(1, lines.findIndex(line => line.startsWith('@@ ')))
    if (!header.length || !lines.some(line => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line))
      || header.some(line => /^(old mode|new mode|deleted file mode|rename |copy |similarity |dissimilarity |index .* (?:120000|160000))/.test(line))
      || header.some(line => !/^(index [a-f0-9]+\.\.[a-f0-9]+(?: 100644)?|new file mode 100644|--- (?:a\/[A-Za-z0-9._/-]+|\/dev\/null)|\+\+\+ b\/[A-Za-z0-9._/-]+)$/.test(line)))
      throw new RepairError('repair-invalid-patch')
    const added = header.includes('new file mode 100644')
    if (!header.includes(added ? '--- /dev/null' : `--- a/${path}`)
      || !header.includes(`+++ b/${path}`)) throw new RepairError('repair-invalid-patch')
    files.push({ path, added })
  }
  return files
}

function isProtected(path: string, policy: RepairSourceRegistration): boolean {
  const pieces = path.split('/')
  return pieces.some(piece => protectedSegments.has(piece) || protectedNames.has(piece))
    || policy.protectedPaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
    || /(?:^|\/)(?:.*\.lock|.*\.p12|.*\.mobileprovision|.*\.keystore|.*\.key)$/.test(path)
}

/** Check every existing ancestor to prevent symlink and submodule traversal before git apply. */
export async function assertPatchPathsSafe(root: string, files: readonly PatchFile[]): Promise<void> {
  const canonical = await realpath(root)
  if (canonical !== root) throw new RepairError('repair-project-changed')
  for (const file of files) {
    if (!validRelativePath(file.path)) throw new RepairError('repair-invalid-patch')
    const full = resolve(root, file.path), rel = relative(root, full)
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new RepairError('repair-invalid-patch')
    const parts = file.path.split('/')
    let current = root
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index]!)
      const info = await lstat(current).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      if (!info) { if (!file.added) throw new RepairError('repair-invalid-patch'); break }
      if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory())
        || (index === parts.length - 1 && !info.isFile())) throw new RepairError('repair-invalid-patch')
    }
  }
}
