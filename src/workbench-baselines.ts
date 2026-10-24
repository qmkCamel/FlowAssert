import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { loadTestProject, nameSchema, type ProjectSnapshot } from './workbench-project.js'
import { registerVisualProfile, visualProfileSchema, type VisualProfile } from './workbench-visual.js'
import { productContractReadState } from './workbench-contracts.js'
import { sha256, validRunId, type WorkbenchStore } from './workbench-store.js'
import { referencePublicationsSchema } from './workbench-evidence-contracts.js'
import { syncBuiltinReferences } from './workbench-builtin-references.js'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const approvedBaselineSchema = z.object({
  referencePublications: referencePublicationsSchema.optional(),
  schemaVersion: z.literal(1), baselineId: z.string().uuid(), profileId: nameSchema, revision: z.number().int().positive(),
  approvalRequestId: z.string().uuid(), candidateDigest: hash, sourceKind: z.enum(['project', 'run']),
  sourceRunId: z.string().uuid().optional(), sourceManifestSha256: hash.optional(), sourceImageSha256: hash,
  sourceBuild: z.string().min(1).max(160), allowedTargetBuilds: z.array(z.string().min(1).max(160)).min(1).max(10),
  rulesHash: hash, approvedBy: z.string().min(1).max(160), approvedAt: z.string().datetime({ offset: true }),
  profile: visualProfileSchema.extend({ referenceBase64: z.string().min(1), width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096), allowedTargetBuilds: z.array(z.string().min(1).max(160)).min(1).max(10) }),
}).strict()
export type ApprovedBaseline = z.infer<typeof approvedBaselineSchema>
export interface BaselineCandidateView {
  candidateId: string; digest: string; profileId: string; expectedRevision: number; expiresAt: string
  sourceKind: 'project' | 'run'; sourceRunId?: string; sourceImageSha256: string; sourceBuild: string
  allowedTargetBuilds: string[]; rulesHash: string; imageBase64: string; width: number; height: number
}
interface PendingCandidate { view: BaselineCandidateView; profile: VisualProfile; configuredBuild: string; configuredReferenceSha256: string; sourceManifestSha256?: string; release?: () => void; timer: NodeJS.Timeout }
function rulesHash(profile: VisualProfile, sourceBuild: string, targets: string[]): string {
  return sha256(JSON.stringify({ platform: profile.platform, appId: profile.appId, theme: profile.theme, sourceBuild, targets,
    regions: profile.regions, masks: profile.masks, channelDelta: profile.channelDelta,
    maxDifferentRatio: profile.maxDifferentRatio, rulesVersion: profile.rulesVersion }))
}

/** Approval records are immutable and protect their source in the same committed file. */
export class WorkbenchBaselines {
  readonly root: string
  #pending = new Map<string, PendingCandidate>()
  constructor(private readonly store: WorkbenchStore, private readonly projectPath: string | undefined,
    private readonly cutpoint: (phase: string) => Promise<void> = async () => {}) { this.root = join(store.root, 'baselines') }

  async candidate(profileId: string, source: { kind: 'project' } | { kind: 'run'; runId: string; evidenceName: string }, allowedTargetBuilds?: string[]): Promise<BaselineCandidateView> {
    nameSchema.parse(profileId)
    if (this.#pending.size >= 4) throw new Error('Too many pending baseline previews')
    await this.store.init()
    const project = await loadTestProject(this.projectPath)
    const base = project.visualProfiles[profileId]
    if (!base) throw new Error('Visual profile is not registered in the local project')
    const latest = await this.latest(profileId)
    let release: (() => void) | undefined
    try {
      let bytes: Buffer = Buffer.from(base.referenceBase64, 'base64'), sourceBuild = base.build, sourceManifestSha256: string | undefined
      if (source.kind === 'run') {
        validRunId(source.runId)
        release = await this.store.lease([source.runId], `baseline-candidate:${profileId}`)
        const snapshot = await this.store.readOnlySnapshot(source.runId)
        const run = snapshot.run
        if (run.phase !== 'finished' || run.verdict !== 'pass' || run.source === 'import' || run.share
          || (run.attempt ?? 1) !== 1 || run.recovery || run.aiRecovery?.attempts.some(attempt => attempt.status === 'recovered')
          || productContractReadState(run) !== 'supported' || run.platform !== base.platform
          || run.comparison?.appContext.appId !== base.appId || !run.comparison.appContext.build || run.comparison.appContext.build === 'unknown')
          throw new Error('Baseline source must be an original clean completed run in the same App and platform')
        const all = [...run.evidence, ...run.steps.flatMap(step => step.evidence)]
        for (const file of all) {
          if (file.incomplete || file.recovered || file.lineage?.integrity !== 'verified') throw new Error('Baseline source evidence is not fully verified')
          await this.store.readEvidence(source.runId, file)
        }
        const image = all.find(file => file.name === source.evidenceName && file.contentType === 'image/png')
        if (!image) throw new Error('Baseline source image is not registered')
        bytes = await this.store.readEvidence(source.runId, image)
        sourceBuild = run.comparison.appContext.build
        sourceManifestSha256 = snapshot.manifestSha256
      }
      const targets = allowedTargetBuilds ? [...new Set(allowedTargetBuilds)] : [sourceBuild]
      if (!targets.includes(sourceBuild) || targets.length > 10 || targets.some(build => !build || build === 'unknown' || build.length > 160)) throw new Error('Invalid approved target builds')
      const expectedRevision = latest?.revision ?? 0
      const baseInput = Object.fromEntries(Object.entries(base).filter(([key]) => !['referenceBase64', 'width', 'height'].includes(key))) as z.input<typeof visualProfileSchema>
      const profile = await registerVisualProfile({ ...baseInput, revision: expectedRevision + 1,
        build: sourceBuild, referenceSha256: sha256(bytes), reference: `approved:${profileId}:${expectedRevision + 1}`,
        approvedBy: 'pending-review', approvedAt: new Date().toISOString(), allowedTargetBuilds: targets }, bytes)
      const digestRules = rulesHash(profile, sourceBuild, targets)
      const candidateId = randomUUID(), expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
      const digest = sha256(JSON.stringify({ candidateId, profileId, expectedRevision, source,
        sourceManifestSha256, sourceImageSha256: profile.referenceSha256, sourceBuild, targets, rulesHash: digestRules, expiresAt }))
      const view: BaselineCandidateView = { candidateId, digest, profileId, expectedRevision, expiresAt,
        sourceKind: source.kind, ...(source.kind === 'run' ? { sourceRunId: source.runId } : {}),
        sourceImageSha256: profile.referenceSha256, sourceBuild, allowedTargetBuilds: targets, rulesHash: digestRules,
        imageBase64: profile.referenceBase64, width: profile.width, height: profile.height }
      const timer = setTimeout(() => this.#discard(candidateId), 10 * 60_000); timer.unref()
      this.#pending.set(candidateId, { view, profile, configuredBuild: base.build, configuredReferenceSha256: base.referenceSha256,
        ...(sourceManifestSha256 ? { sourceManifestSha256 } : {}), ...(release ? { release } : {}), timer })
      release = undefined
      return view
    } finally { release?.() }
  }

  async approve(candidateId: string, digest: string, approvalRequestId: string, approvedBy: string, reviewed: boolean): Promise<ApprovedBaseline> {
    z.string().uuid().parse(candidateId); hash.parse(digest); z.string().uuid().parse(approvalRequestId)
    if (reviewed !== true) throw new Error('Baseline image and rules require explicit review')
    if (!approvedBy || approvedBy.length > 160) throw new Error('Local reviewer alias is required')
    await this.store.init()
    const releaseReservation = await this.store.reserveEvidence(`baseline:${approvalRequestId}:${randomUUID()}`, 4 * 1024 * 1024)
    try { return await this.store.withMutationGate(async () => {
      for (const existing of await this.list()) if (existing.approvalRequestId === approvalRequestId) {
        if (existing.candidateDigest !== digest) throw new Error('Approval request was reused with different content')
        return existing
      }
      const pending = this.#pending.get(candidateId)
      if (!pending || pending.view.digest !== digest || Date.parse(pending.view.expiresAt) <= Date.now()) throw new Error('Baseline candidate expired or changed; preview again')
      const { view } = pending
      const project = await loadTestProject(this.projectPath)
      const current = project.visualProfiles[view.profileId]
      if (!current) throw new Error('Visual profile was removed after preview')
      if (current.build !== pending.configuredBuild || current.referenceSha256 !== pending.configuredReferenceSha256) throw new Error('Visual profile source configuration changed after preview')
      if (rulesHash(current, view.sourceBuild, view.allowedTargetBuilds) !== view.rulesHash) throw new Error('Visual rules changed after preview')
      const latest = await this.latest(view.profileId)
      if ((latest?.revision ?? 0) !== view.expectedRevision) throw new Error('Baseline revision changed after preview')
      if (view.sourceKind === 'project') {
        if (sha256(Buffer.from(current.referenceBase64, 'base64')) !== view.sourceImageSha256) throw new Error('Project reference changed after preview')
      } else {
        const snapshot = await this.store.readOnlySnapshot(view.sourceRunId!)
        if (snapshot.manifestSha256 !== pending.sourceManifestSha256) throw new Error('Run source changed after preview')
        const image = [...snapshot.run.evidence, ...snapshot.run.steps.flatMap(step => step.evidence)].find(file => file.sha256 === view.sourceImageSha256 && file.contentType === 'image/png')
        if (!image || sha256(await this.store.readEvidence(view.sourceRunId!, image)) !== view.sourceImageSha256) throw new Error('Run image changed after preview')
      }
      const approvedAt = new Date().toISOString()
      const record = approvedBaselineSchema.parse({ schemaVersion: 1, baselineId: randomUUID(), profileId: view.profileId,
        revision: view.expectedRevision + 1, approvalRequestId, candidateDigest: digest, sourceKind: view.sourceKind,
        ...(view.sourceRunId ? { sourceRunId: view.sourceRunId, sourceManifestSha256: pending.sourceManifestSha256 } : {}),
        sourceImageSha256: view.sourceImageSha256, sourceBuild: view.sourceBuild, allowedTargetBuilds: view.allowedTargetBuilds,
        rulesHash: view.rulesHash, approvedBy, approvedAt, profile: { ...pending.profile, approvedBy, approvedAt } })
      const publish = async () => {
        const directory = join(this.root, view.profileId)
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        const rootInfo = await lstat(this.root)
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Unsafe baseline root')
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const profileInfo = await lstat(directory)
        if (!profileInfo.isDirectory() || profileInfo.isSymbolicLink()) throw new Error('Unsafe baseline profile directory')
        const temporary = join(directory, `.baseline-${randomUUID()}.tmp`)
        await this.cutpoint('approval:before-temporary')
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify(record)); await handle.sync() } finally { await handle.close() }
        await this.cutpoint('approval:after-temporary')
        await this.cutpoint('approval:before-publish')
        try { await link(temporary, join(directory, `revision-${record.revision}.json`)) }
        finally { await rm(temporary, { force: true }) }
        await this.cutpoint('approval:after-publish')
        const dir = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
        try { await dir.sync() } finally { await dir.close() }
        await this.cutpoint('approval:after-directory-sync')
      }
      if (record.sourceRunId) await syncBuiltinReferences(this.store, 'workbench:baseline', record.baselineId, undefined, [record.sourceRunId], async publications => {
        record.referencePublications = publications; await publish()
      }, this.cutpoint)
      else await publish()
      this.#discard(candidateId)
      return record
    }) } finally { releaseReservation() }
  }

  async latest(profileId: string): Promise<ApprovedBaseline | null> {
    nameSchema.parse(profileId)
    const rows = (await this.list()).filter(row => row.profileId === profileId)
    return rows.sort((a, b) => b.revision - a.revision)[0] ?? null
  }

  async list(): Promise<ApprovedBaseline[]> {
    let profiles
    try {
      const root = await lstat(this.root)
      if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Unsafe baseline root')
      profiles = await readdir(this.root, { withFileTypes: true })
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    if (profiles.length > 1_000) throw new Error('Baseline index exceeds budget')
    const rows: ApprovedBaseline[] = []
    let recordCount = 0, recordBytes = 0
    for (const profile of profiles) {
      if (!profile.isDirectory() || !nameSchema.safeParse(profile.name).success) throw new Error('Unsafe baseline index')
      const directory = join(this.root, profile.name)
      const entries = await readdir(directory, { withFileTypes: true })
      if (entries.length > 1_000) throw new Error('Baseline revisions exceed budget')
      for (const entry of entries) {
        if (entry.isFile() && /^\.baseline-[0-9a-f-]{36}\.tmp$/.test(entry.name)) continue
        if (!entry.isFile() || !/^revision-[1-9]\d*\.json$/.test(entry.name)) throw new Error('Unsafe baseline revision')
        const handle = await open(join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const size = (await handle.stat()).size
          recordCount++; recordBytes += size
          if (size > 6 * 1024 * 1024 || recordCount > 1_000 || recordBytes > 64 * 1024 * 1024) throw new Error('Baseline record exceeds budget')
          const record = approvedBaselineSchema.parse(JSON.parse(await handle.readFile('utf8')))
          if (record.profileId !== profile.name || entry.name !== `revision-${record.revision}.json`
            || sha256(Buffer.from(record.profile.referenceBase64, 'base64')) !== record.sourceImageSha256
            || rulesHash(record.profile, record.sourceBuild, record.allowedTargetBuilds) !== record.rulesHash) throw new Error('Baseline record integrity failed')
          if (record.sourceKind === 'run') {
            if (!record.sourceRunId || !record.sourceManifestSha256) throw new Error('Baseline run source is incomplete')
            const source = await this.store.readOnlySnapshot(record.sourceRunId)
            if (source.manifestSha256 !== record.sourceManifestSha256) throw new Error('Baseline source manifest changed')
            const image = [...source.run.evidence, ...source.run.steps.flatMap(step => step.evidence)].find(file => file.sha256 === record.sourceImageSha256 && file.contentType === 'image/png')
            if (!image || sha256(await this.store.readEvidence(record.sourceRunId, image)) !== record.sourceImageSha256) throw new Error('Baseline source image changed')
          }
          rows.push(record)
        } finally { await handle.close() }
      }
    }
    return rows
  }

  async applyApproved(project: ProjectSnapshot): Promise<ProjectSnapshot> {
    const rows = await this.list()
    if (!rows.length) return project
    const copy = structuredClone(project)
    for (const row of rows.sort((a, b) => a.revision - b.revision)) if (copy.visualProfiles[row.profileId]) {
      if (copy.visualProfiles[row.profileId]!.platform !== row.profile.platform || copy.visualProfiles[row.profileId]!.appId !== row.profile.appId)
        throw new Error('Approved baseline no longer matches the registered App')
      copy.visualProfiles[row.profileId] = row.profile
    }
    copy.sha256 = sha256(JSON.stringify({ ...copy, sha256: undefined }))
    return copy
  }

  close(): void { for (const id of this.#pending.keys()) this.#discard(id) }
  #discard(id: string): void { const pending = this.#pending.get(id); if (!pending) return; clearTimeout(pending.timer); pending.release?.(); this.#pending.delete(id) }
}
