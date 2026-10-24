import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { RepairError, repairDigest } from './workbench-repair-contracts.js'
import { repairCommandReceiptSchema, hashRepairToolchain, runRepairCommand } from './workbench-repair-command-runner.js'
import { resolveRepairSource, type RepairBuildRegistration, type RepairSourceRegistration } from './workbench-repair-source.js'
import { applyRepairPatchForBuild, createRepairWorkspaces, hashRepairTree } from './workbench-repair-workspaces.js'
import type { WorkbenchStore } from './workbench-store.js'

const identitySchema = z.object({ appId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  buildMarker: z.string().min(1).max(256), version: z.string().min(1).max(128),
  signatureVerified: z.literal(true),
}).strict()

export const repairArtifactManifestSchema = z.object({ contractVersion: z.literal(1),
  id: z.string().uuid(), repositoryId: z.string().min(1).max(64), baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
  patchDigest: repairDigest, sourceTreeDigest: repairDigest, oracleDigest: repairDigest,
  buildConfigDigest: repairDigest, toolchainDigest: repairDigest,
  platform: z.enum(['android', 'ios']), kind: z.enum(['apk', 'ios-app']),
  appId: z.string().min(1).max(160), buildMarker: z.string().min(1).max(256), version: z.string().min(1).max(128),
  outputDirectory: z.string().min(1).max(1024), artifactPath: z.string().min(1).max(1024),
  artifactDigest: repairDigest, bytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  fileCount: z.number().int().positive().max(20_000), builtAt: z.string().datetime(),
  buildReceipt: repairCommandReceiptSchema, identityReceipt: repairCommandReceiptSchema,
}).strict()
export type RepairArtifactManifest = z.infer<typeof repairArtifactManifestSchema>

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return Boolean(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function buildConfig(policy: RepairSourceRegistration, platform: 'android' | 'ios', appId: string,
  evidenceRoot: string): Promise<{ config: RepairBuildRegistration; outputRoot: string }> {
  const resolved = await resolveRepairSource(policy, policy.repositoryId)
  if (policy.isolation !== 'trusted-local') throw new RepairError('repair-capability-unavailable')
  const config = policy.builds.find(item => item.platform === platform && item.appId === appId)
  if (!config) throw new RepairError('repair-capability-unavailable')
  const outputRoot = await realpath(config.outputRoot)
  const evidence = await realpath(evidenceRoot)
  if (outputRoot !== config.outputRoot || [resolved.root, resolved.oracleRoot, resolved.workspaceRoot, evidence]
    .some(root => root === outputRoot || within(root, outputRoot) || within(outputRoot, root)))
    throw new RepairError('repair-project-changed')
  return { config, outputRoot }
}

/** Reject links, special files, oversized output, and path escape before trusting any external identity helper. */
export async function inspectRepairArtifact(outputDirectory: string, config: RepairBuildRegistration) {
  const root = await realpath(outputDirectory)
  if (root !== outputDirectory || !within(config.outputRoot, root)) throw new RepairError('repair-project-changed')
  const artifactPath = resolve(root, config.artifactPath)
  if (!within(root, artifactPath)) throw new RepairError('repair-invalid-contract')
  let current = root
  for (const part of config.artifactPath.split('/')) {
    current = join(current, part)
    const info = await lstat(current)
    if (info.isSymbolicLink()) throw new RepairError('repair-invalid-contract')
  }
  const artifact = await lstat(artifactPath)
  if (config.artifactKind === 'apk') {
    if (!artifact.isFile() || artifact.size > config.maxArtifactBytes || artifact.size < 4)
      throw new RepairError('repair-invalid-contract')
    const handle = await open(artifactPath, 'r')
    try {
      const magic = Buffer.alloc(4)
      await handle.read(magic, 0, 4, 0)
      if (!magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new RepairError('repair-invalid-contract')
    } finally { await handle.close() }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(artifactPath)) hash.update(chunk)
    if ((await lstat(artifactPath)).size !== artifact.size) throw new RepairError('repair-project-changed')
    return { artifactPath, artifactDigest: hash.digest('hex'), bytes: artifact.size, fileCount: 1 }
  }
  if (!artifact.isDirectory()) throw new RepairError('repair-invalid-contract')
  const hash = createHash('sha256')
  let bytes = 0, fileCount = 0, hasInfo = false
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(directory, entry.name), info = await lstat(path)
      if (info.isSymbolicLink()) throw new RepairError('repair-invalid-contract')
      if (info.isDirectory()) { hash.update(`D\0${rel}\0`); await visit(path, rel); continue }
      if (!info.isFile() || ++fileCount > 20_000 || (bytes += info.size) > config.maxArtifactBytes)
        throw new RepairError('repair-budget-exhausted')
      if (rel === 'Info.plist') hasInfo = true
      hash.update(`F\0${rel}\0${info.size}\0`)
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      if ((await lstat(path)).size !== info.size) throw new RepairError('repair-project-changed')
    }
  }
  await visit(artifactPath, '')
  if (!hasInfo || !fileCount || !bytes) throw new RepairError('repair-invalid-contract')
  return { artifactPath, artifactDigest: hash.digest('hex'), bytes, fileCount }
}

export async function verifyRepairArtifact(manifest: RepairArtifactManifest,
  policy: RepairSourceRegistration, evidenceRoot: string): Promise<void> {
  const checked = repairArtifactManifestSchema.parse(manifest)
  const { config, outputRoot } = await buildConfig(policy, checked.platform, checked.appId, evidenceRoot)
  if (checked.repositoryId !== policy.repositoryId || checked.kind !== config.artifactKind
    || checked.baseCommit !== policy.baseCommit
    || checked.buildConfigDigest !== digest(config) || checked.outputDirectory !== join(outputRoot, basename(checked.outputDirectory))
    || !/^repair-build-[A-Za-z0-9]+$/.test(basename(checked.outputDirectory))
    || checked.toolchainDigest !== await hashRepairToolchain(policy)
    || checked.oracleDigest !== await hashRepairTree(policy.oracleRoot))
    throw new RepairError('repair-project-changed')
  const actual = await inspectRepairArtifact(checked.outputDirectory, config)
  if (actual.artifactPath !== checked.artifactPath || actual.artifactDigest !== checked.artifactDigest
    || actual.bytes !== checked.bytes || actual.fileCount !== checked.fileCount)
    throw new RepairError('repair-project-changed')
}

/** Local trusted build, not an Agent command. The main checkout and oracle are never build inputs. */
export async function buildRepairArtifact(store: WorkbenchStore, policy: RepairSourceRegistration,
  input: { platform: 'android' | 'ios'; appId: string; patch: string; baseTreeDigest: string;
    oracleDigest: string; toolchainDigest: string; evidenceBytes: number }, signal?: AbortSignal): Promise<RepairArtifactManifest> {
  const { config, outputRoot } = await buildConfig(policy, input.platform, input.appId, store.root)
  const release = await store.reserveBuildAndEvidence(`repair-build:${randomUUID()}`, outputRoot,
    config.reserveBytes, input.evidenceBytes).catch(() => { throw new RepairError('repair-storage-insufficient') })
  let outputDirectory: string | undefined
  try {
    signal?.throwIfAborted()
    const workspaces = await createRepairWorkspaces(policy)
    try {
      if (workspaces.baseTreeDigest !== input.baseTreeDigest
        || await hashRepairToolchain(policy) !== input.toolchainDigest
        || await hashRepairTree(policy.oracleRoot) !== input.oracleDigest)
        throw new RepairError('repair-project-changed')
      const sourceTreeDigest = await applyRepairPatchForBuild(workspaces, policy, input.patch)
      outputDirectory = await realpath(await mkdtemp(join(outputRoot, 'repair-build-')))
      const buildReceipt = await runRepairCommand(policy, config.command.id, workspaces.verificationRoot,
        sourceTreeDigest, signal, { outputRoot: outputDirectory })
      if (!buildReceipt.passed) throw new RepairError(signal?.aborted ? 'repair-cancelled' : 'repair-ineligible')
      if (await hashRepairTree(workspaces.verificationRoot) !== sourceTreeDigest
        || await hashRepairTree(policy.oracleRoot) !== input.oracleDigest
        || await hashRepairToolchain(policy) !== input.toolchainDigest)
        throw new RepairError('repair-project-changed')
      const artifact = await inspectRepairArtifact(outputDirectory, config)
      const identity = await runRepairCommand(policy, config.identityCommand.id, workspaces.verificationRoot,
        sourceTreeDigest, signal, { outputRoot: outputDirectory, artifactPath: artifact.artifactPath, captureStdout: true })
      if (!identity.passed || !identity.stdoutText || Buffer.byteLength(identity.stdoutText) > 4096)
        throw new RepairError('repair-ineligible')
      let identityValue: unknown
      try { identityValue = JSON.parse(identity.stdoutText) }
      catch { throw new RepairError('repair-install-identity-unverified') }
      const parsed = identitySchema.safeParse(identityValue)
      if (!parsed.success || parsed.data.appId !== config.appId) throw new RepairError('repair-install-identity-unverified')
      const { stdoutText: _text, ...identityReceipt } = identity
      const afterInspect = await inspectRepairArtifact(outputDirectory, config)
      if (afterInspect.artifactDigest !== artifact.artifactDigest || await hashRepairTree(policy.oracleRoot) !== input.oracleDigest)
        throw new RepairError('repair-project-changed')
      const manifest = repairArtifactManifestSchema.parse({ contractVersion: 1, id: randomUUID(),
        repositoryId: policy.repositoryId, baseCommit: policy.baseCommit,
        patchDigest: createHash('sha256').update(input.patch).digest('hex'), sourceTreeDigest,
        oracleDigest: input.oracleDigest, buildConfigDigest: digest(config), toolchainDigest: input.toolchainDigest,
        platform: config.platform, kind: config.artifactKind, appId: parsed.data.appId,
        buildMarker: parsed.data.buildMarker, version: parsed.data.version,
        outputDirectory, artifactPath: artifact.artifactPath, artifactDigest: artifact.artifactDigest,
        bytes: artifact.bytes, fileCount: artifact.fileCount, builtAt: new Date().toISOString(),
        buildReceipt, identityReceipt })
      await verifyRepairArtifact(manifest, policy, store.root)
      return manifest
    } finally { await workspaces.close() }
  } catch (error) {
    if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true })
    throw error
  } finally { release() }
}
