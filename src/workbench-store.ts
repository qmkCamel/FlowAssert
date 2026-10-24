import { safeReportSummary, type ReportSummary } from './workbench-report-presentation.js'
import { isWebRun, validateWebRun, type WorkbenchRun } from './workbench-web-contracts.js'
import { randomUUID } from 'node:crypto'
import { sha256 } from './content-hash.js'
export { sha256 } from './content-hash.js'
import { constants } from 'node:fs'
import { copyFile, link, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunVideo } from './workbench-video.js'
import { evidenceLineageSchema, productContractReadState, runProductContractSchema, syncRunVerification, validateProductContractForWrite, type EvidenceLineage, type RunProductContract, type RunResultProjection } from './workbench-contracts.js'
import { acquireStoreOwner, assertStoreOwner, releaseStoreOwner, type StoreOwner } from './workbench-store-owner.js'
import { evidenceReadLeaseSchema, type EvidenceReadLease } from './workbench-evidence-contracts.js'
import { WorkbenchStorageAdmission } from './workbench-storage-admission.js'
import { runtimeFeaturesSchema, type RuntimeFeature } from './workbench-runtime-contracts.js'

export type { Verdict, EvidenceFile, RunStep, RunDiagnostic, RunComparisonIdentity, TestRun } from './workbench-domain.js'
import type { Verdict, EvidenceFile, RunStep, RunDiagnostic, RunComparisonIdentity, TestRun } from './workbench-domain.js'
export function validRunId(id: string): void { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid run id') }

export interface PortableRunArchive {
  format: 'mobile-mirror-run'
  version: 1 | 2 | 3 | 4
  run: TestRun
  files: { name: string; contentType: string; bytes: number; sha256: string; base64: string }[]
  sharing?: { shareId: string; reportedVerdict: Verdict; verification: 'not-revalidated'; withheld: string[]; reviewed: { file: string; transformation: 'png-masks-v1' | 'structure-allowlist-v1' }[]; rulesVersion: 1 | 2; requiredFeatures?: RuntimeFeature[] }
}

const ARCHIVE_MAX_FILES = 64
const ARCHIVE_MAX_FILE_BYTES = 4 * 1024 * 1024
const ARCHIVE_MAX_TOTAL_BYTES = 16 * 1024 * 1024

export class WorkbenchStore {
  #ready: Promise<void> | null = null
  #owner: StoreOwner | null = null
  #closed = false
  #gate: Promise<void> = Promise.resolve()
  #readLeases = new Map<string, Map<string, EvidenceReadLease>>()
  #admission: WorkbenchStorageAdmission
  constructor(readonly root: string, availableBytes?: (root: string) => Promise<number>,
    private readonly writeCutpoint: (phase: string) => Promise<void> = async () => {}) {
    this.#admission = new WorkbenchStorageAdmission(availableBytes)
  }
  get ownerGeneration(): string { if (!this.#owner) throw new Error('Workbench store has no owner'); return this.#owner.generation }
  async withMutationGate<T>(operation: () => Promise<T> | T): Promise<T> {
    await this.init()
    const previous = this.#gate
    let release!: () => void
    this.#gate = new Promise<void>(resolve => { release = resolve })
    await previous
    try { await assertStoreOwner(this.root, this.#owner!); return await operation() } finally { release() }
  }
  async lease(runIds: string[], operationId: string = randomUUID()): Promise<() => void> {
    for (const id of runIds) validRunId(id)
    await this.init()
    const unique = [...new Set(runIds)]
    if (!unique.length || unique.length > 10_000) throw new Error('Invalid read lease scope')
    return this.withMutationGate(async () => {
      for (const id of unique) await requireDirectory(join(this.root, id))
      const lease = evidenceReadLeaseSchema.parse({ contractVersion: 1, leaseId: randomUUID(), ownerGeneration: this.ownerGeneration,
        runIds: unique, operationId, acquiredAt: new Date().toISOString() })
      for (const id of unique) {
        const leases = this.#readLeases.get(id) ?? new Map<string, EvidenceReadLease>()
        leases.set(lease.leaseId, lease); this.#readLeases.set(id, leases)
      }
      let released = false
      return () => {
        if (released) return
        released = true
        for (const id of unique) {
          const leases = this.#readLeases.get(id)
          leases?.delete(lease.leaseId)
          if (!leases?.size) this.#readLeases.delete(id)
        }
      }
    })
  }
  hasReadLease(id: string): boolean { validRunId(id); return Boolean(this.#readLeases.get(id)?.size) }
  /** Reserve a bounded task's worst-case evidence before it can own a device or publish an export. */
  async reserveEvidence(operationId: string, bytes: number): Promise<() => void> {
    return this.withMutationGate(() => this.#admission.reserve(this.root, operationId, bytes))
  }
  /** Atomically accounts for build output and evidence, even when both roots share a volume. */
  async reserveBuildAndEvidence(operationId: string, buildRoot: string, buildBytes: number,
    evidenceBytes: number): Promise<() => void> {
    return this.withMutationGate(() => this.#admission.reserveGroup(operationId,
      [{ root: buildRoot, bytes: buildBytes }, { root: this.root, bytes: evidenceBytes }]))
  }
  async init(): Promise<void> {
    if (this.#closed) throw new Error('Workbench store is closed')
    return this.#ready ??= this.#initialize().catch(async (error) => {
      this.#ready = null
      const owner = this.#owner
      this.#owner = null
      if (owner) await releaseStoreOwner(this.root, owner)
      throw error
    })
  }
  async #initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    this.#owner = await acquireStoreOwner(this.root)
    for (const run of await this.listRecords()) {
      if (isWebRun(run)) {
        if (run.phase !== 'finished') {
          await copyFile(join(this.root, run.id, 'manifest.json'), join(this.root, run.id, `manifest-before-recovery-${randomUUID()}.json`), constants.COPYFILE_EXCL)
          run.phase = 'finished'; run.verdict = 'inconclusive'; run.cleanup = 'pending'; run.endedAt = new Date().toISOString()
          run.error = 'Web execution interrupted; owned resources require review. No automatic replay or PID cleanup.'
          run.recovery = { at: run.endedAt, reason: run.error }
          for (const step of run.steps) if (step.status === 'running') { step.status = 'failed'; step.error = 'Interrupted'; step.endedAt = run.endedAt }
          await this.saveRecord(run)
        }
        continue
      }
      if (productContractReadState(run) === 'unsupported') continue
      const recovered = await this.#recoverFiles(run)
      if (run.phase !== 'finished' || run.recovery?.reason === 'Manifest unavailable' || recovered) {
        // Preserve the previous manifest bytes, including corruption, before repair.
        try {
          const original = join(this.root, run.id, 'manifest.json'), backup = join(this.root, run.id, `manifest-before-recovery-${randomUUID()}.json`)
          if ((await lstat(original)).isSymbolicLink()) await rename(original, backup)
          else await copyFile(original, backup, constants.COPYFILE_EXCL)
        }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        run.phase = 'finished'; run.verdict = 'inconclusive'; run.endedAt = new Date().toISOString()
        run.error = 'Workbench interrupted or evidence recovered; device outcome and original evidence integrity are unknown'; run.cleanup = 'failed'
        run.recovery = { at: new Date().toISOString(), reason: run.error }
        delete run.activity
        if (run.productContract?.contractVersion === 2) for (const dimension of [run.productContract.verification.health, run.productContract.verification.performance])
          if (dimension.required) { dimension.status = 'inconclusive'; dimension.reason = 'runtime-interrupted' }
        for(const entry of run.extensionResults??[])if(entry.status==='running'){entry.status='inconclusive';entry.error='Interrupted; resources may require manual cleanup';entry.endedAt=run.endedAt}
        try {const resources=JSON.parse(await readFile(join(this.root,run.id,'private','resources.json'),'utf8'));if(Array.isArray(resources)&&resources.length)run.resourceCleanup='pending'}catch{/* no resource journal */}
        for (const step of run.steps) if (step.status === 'running') { step.status = 'failed'; step.error = 'Interrupted'; step.endedAt = run.endedAt }
        await this.save(run)
      }
    }
  }
  async close(): Promise<void> {
    this.#closed = true
    await this.#ready?.catch(() => {})
    await this.#gate
    const owner = this.#owner
    this.#owner = null
    if (owner) await releaseStoreOwner(this.root, owner)
  }
  async #assertWritable(): Promise<void> {
    if (this.#closed || !this.#owner) throw new Error('Workbench store has no writable owner')
    await assertStoreOwner(this.root, this.#owner)
  }
  async save(run: TestRun): Promise<void> {
    if (isWebRun(run)) throw new Error('Web record requires typed saveRecord')
    return this.saveRecord(run)
  }
  async saveRecord(run: WorkbenchRun): Promise<void> {
    await this.#assertWritable()
    validRunId(run.id)
    if (isWebRun(run)) validateWebRun(run)
    else { syncRunVerification(run); validateProductContractForWrite(run) }
    const dir = join(this.root, run.id)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await requireDirectory(dir)
    const path = join(dir, `manifest-${randomUUID()}.tmp`)
    const persisted = { ...run }
    if (!isWebRun(persisted)) delete persisted.resultProjection
    await this.writeCutpoint('manifest:before-write')
    await committedWrite(path, JSON.stringify(persisted, null, 2))
    await this.writeCutpoint('manifest:after-write')
    await rename(path, join(dir, 'manifest.json'))
    await this.writeCutpoint('manifest:after-rename')
    await syncDirectory(dir)
  }
  async put(id: string, name: string, bytes: Uint8Array | string, contentType: string): Promise<EvidenceFile> {
    await this.#assertWritable()
    validRunId(id); validFileName(name)
    const dir = join(this.root, id)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await requireDirectory(dir)
    // Immutable files: repeated writes must never overwrite earlier evidence.
    // Failed/partial temporaries remain private and are recovered as unverified.
    const temporary = join(dir, `.evidence-${randomUUID()}--${name}.tmp`)
    await this.writeCutpoint('evidence:before-write')
    await committedWrite(temporary, bytes)
    await this.writeCutpoint('evidence:after-write')
    await link(temporary, join(dir, name))
    await this.writeCutpoint('evidence:after-link')
    await rm(temporary)
    await syncDirectory(dir)
    return { name, sha256: sha256(bytes), bytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength, contentType, lineage: { contractVersion: 1, kind: 'original', integrity: 'verified', sharing: 'private' } }
  }
  async importArchive(value: unknown): Promise<TestRun> {
    await this.init()
    const archive = parsePortableRunArchive(value)
    const id = randomUUID()
    const releaseReservation = await this.reserveEvidence(`import:${id}`, ARCHIVE_MAX_TOTAL_BYTES + 4 * 1024 * 1024)
    const directory = join(this.root, id)
    try {
      for (const file of archive.files) {
        const bytes = decodeArchiveFile(file)
        const saved = await this.put(id, file.name, bytes, file.contentType)
        if (saved.bytes !== file.bytes || saved.sha256 !== file.sha256) throw new Error(`Archive evidence integrity failed: ${file.name}`)
      }
      const run = normalizeImportedRun(archive.run, id)
      if (archive.version === 2 || archive.version === 4) {
        run.verdict = 'inconclusive'
        run.share = { shareId: archive.sharing!.shareId, reportedVerdict: archive.sharing!.reportedVerdict, verification: 'not-revalidated', withheld: [...archive.sharing!.withheld],
          ...(archive.sharing!.requiredFeatures ? { requiredFeatures: archive.sharing!.requiredFeatures } : {}) }
        run.businessVerification = 'inconclusive'
      }
      await this.save(run)
      return this.get(id)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    } finally { releaseReservation() }
  }
  async saveVideoIndex(id: string, video: RunVideo): Promise<void> {
    await this.#assertWritable()
    validRunId(id)
    const dir = join(this.root, id); await requireDirectory(dir)
    const temporary = join(dir, `video-${randomUUID()}.tmp`)
    await committedWrite(temporary, JSON.stringify(video))
    await rename(temporary, join(dir, 'video.json')); await syncDirectory(dir)
  }
  async readVideoIndex(id: string): Promise<RunVideo | undefined> {
    validRunId(id); await requireDirectory(join(this.root, id))
    let handle
    try { handle = await open(join(this.root, id, 'video.json'), constants.O_RDONLY | constants.O_NOFOLLOW) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
    try { return JSON.parse(await handle.readFile('utf8')) as RunVideo }
    finally { await handle.close() }
  }
  async get(id: string, maxManifestBytes?: number): Promise<TestRun> {
    const run = await this.getRecord(id, maxManifestBytes)
    if (isWebRun(run)) throw new Error('Web run: native operation is not applicable')
    return run
  }
  async getRecord(id: string, maxManifestBytes?: number): Promise<WorkbenchRun> {
    validRunId(id)
    const directory = await requireDirectory(join(this.root, id))
    let webRecord = false
    try {
      const handle = await open(join(this.root, id, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
      let text: string
      try {
        if (maxManifestBytes !== undefined && (await handle.stat()).size > maxManifestBytes) throw new Error('report-manifest-budget: at most 8 MiB per record')
        text = await handle.readFile('utf8')
        if (maxManifestBytes !== undefined && Buffer.byteLength(text) > maxManifestBytes) throw new Error('report-manifest-budget: at most 8 MiB per record')
      } finally { await handle.close() }
      const run = JSON.parse(text) as WorkbenchRun
      if (isWebRun(run)) {
        webRecord = true
        if (run.id !== id || !Array.isArray(run.evidence) || !run.evidence.every(validEvidence)
          || !Array.isArray(run.steps) || !run.steps.every(step=>Array.isArray(step.evidence) && step.evidence.every(validEvidence))) throw new Error('Invalid Web evidence identity')
        return validateWebRun(run)
      }
      if (!run || run.schemaVersion !== 1 || run.id !== id || !Array.isArray(run.steps) || !Array.isArray(run.evidence)
        || !run.evidence.every(validEvidence) || !run.steps.every((step) => step && Number.isSafeInteger(step.index) && step.index > 0 && typeof step.kind === 'string' && Array.isArray(step.evidence) && step.evidence.every(validEvidence))
        || !['running', 'cancelling', 'finalizing', 'finished'].includes(run.phase)
        || typeof run.yaml !== 'string' || typeof run.startedAt !== 'string') throw new Error('Invalid run manifest')
      if (run.productContract && [1, 2].includes(run.productContract.contractVersion)) runProductContractSchema.parse(run.productContract)
      return run
    } catch (error) {
      if (webRecord) throw new Error(`Web manifest unavailable; native fallback forbidden: ${String(error)}`)
      // Preserve corrupt/orphaned files for diagnosis; do not hide the run or
      // overwrite its original manifest with a synthesized success record.
      return {
        schemaVersion: 1, id, name: 'Interrupted / unreadable run', yaml: '', engine: 'unknown',
        phase: 'finished', verdict: 'inconclusive', startedAt: directory.birthtime.toISOString(),
        sessionId: 'unknown', deviceName: 'unknown', platform: 'unknown', provider: 'unknown',
        verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
        steps: [], evidence: [], cleanup: 'failed', error: `Run manifest unavailable: ${error instanceof Error ? error.message : String(error)}`,
        recovery: { at: new Date().toISOString(), reason: 'Manifest unavailable' },
      }
    }
  }
  async list(): Promise<TestRun[]> {
    return (await this.listRecords()).filter((run): run is TestRun => !isWebRun(run))
  }
  async listRecords(): Promise<WorkbenchRun[]> {
    const dirs = await readdir(this.root, { withFileTypes: true })
    const entries = dirs.filter((d) => d.isDirectory() && /^[0-9a-f-]{36}$/.test(d.name))
    const runs: WorkbenchRun[] = new Array(entries.length)
    let cursor = 0
    // Bound file handles and pending reads at scale; still return every manifest,
    // including the existing conservative unreadable-record projection.
    await Promise.all(Array.from({ length: Math.min(16, entries.length) }, async () => {
      while (cursor < entries.length) { const index = cursor++; runs[index] = await this.getRecord(entries[index]!.name) }
    }))
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }
  /** No artifact/YAML files are opened; only four bounded manifests are held at once. */
  async listReportSummaries(maxEntries = 10_000): Promise<ReportSummary[]> {
    const entries = (await readdir(this.root, { withFileTypes: true })).filter(d => d.isDirectory() && /^[0-9a-f-]{36}$/.test(d.name))
    if (entries.length > maxEntries) throw new Error('report-summary-budget: at most 10000 records')
    const summaries: ReportSummary[] = new Array(entries.length)
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (cursor < entries.length) {
        const index = cursor++
        summaries[index] = safeReportSummary(await this.getRecord(entries[index]!.name, 8 * 1024 * 1024))
      }
    }))
    return summaries
  }
  async readEvidence(id: string, file: EvidenceFile): Promise<Buffer> {
    validRunId(id); validFileName(file.name)
    await requireDirectory(join(this.root, id))
    const handle = await open(join(this.root, id, file.name), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const bytes = await handle.readFile()
      if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Evidence integrity check failed: ${file.name}`)
      return bytes
    } finally { await handle.close() }
  }

  /** Reads an immutable comparison snapshot without store initialization or recovery writes. */
  async readOnlySnapshot(id: string): Promise<{ run: TestRun; manifestSha256: string }> {
    validRunId(id)
    await requireDirectory(join(this.root, id))
    const handle = await open(join(this.root, id, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const bytes = await handle.readFile()
      const run = JSON.parse(bytes.toString('utf8')) as TestRun
      if (isWebRun(run)) throw new Error('Web run: native comparison is not applicable')
      if (!run || run.schemaVersion !== 1 || run.id !== id || !Array.isArray(run.steps) || !Array.isArray(run.evidence)) throw new Error('Invalid run manifest')
      if (run.productContract && [1, 2].includes(run.productContract.contractVersion)) runProductContractSchema.parse(run.productContract)
      return { run, manifestSha256: sha256(bytes) }
    } finally { await handle.close() }
  }

  async #recoverFiles(run: TestRun): Promise<boolean> {
    const dir = join(this.root, run.id)
    const referenced = new Set([...run.evidence, ...run.steps.flatMap((step) => step.evidence)].map((file) => file.name))
    const entries = await readdir(dir, { withFileTypes: true })
    let recovered = false
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const temporary = entry.name.match(/^\.evidence-([0-9a-f-]{36})--([a-z0-9-]+\.(png|xml|yaml|json|txt))\.tmp$/)
      const final = /^(?:flow\.yaml|plan\.json|extension-\d+\.json|executor(?:-\d+)?\.txt|step-\d+\.(?:png|xml)|recovered-[0-9a-f-]{36}\.(?:png|xml|yaml|json|txt))$/.test(entry.name)
      if (!temporary && (!final || referenced.has(entry.name))) continue
      const name = temporary ? `recovered-${temporary[1]}.${temporary[3]}` : entry.name
      if (referenced.has(name)) continue
      const handle = await open(join(dir, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW)
      let bytes: Buffer
      try { bytes = await handle.readFile() } finally { await handle.close() }
      if (name === 'flow.yaml' && !run.yaml) run.yaml = bytes.toString('utf8')
      if (temporary) {
        try { await link(join(dir, entry.name), join(dir, name)) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      const ext = name.split('.').at(-1)!
      const file: EvidenceFile = { name, bytes: bytes.length, sha256: sha256(bytes), contentType: ({ png: 'image/png', xml: 'application/xml; charset=utf-8', yaml: 'text/yaml; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8' } as Record<string, string>)[ext]!, recovered: true, ...(temporary ? { incomplete: true } : {}), lineage: { contractVersion: 1, kind: 'original', integrity: 'unverified', sharing: 'private' } }
      // Recovery checksums describe bytes found now, not what the interrupted writer intended.
      const stepIndex = !temporary && name.match(/^step-(\d+)\./)?.[1]
      const step = stepIndex ? run.steps.find((candidate) => candidate.index === Number(stepIndex)) : undefined
      if (step) step.evidence.push(file)
      else run.evidence.push(file)
      referenced.add(name); recovered = true
    }
    return recovered
  }
}
function validFileName(name: string): void {
  if (!/^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/.test(name)) throw new Error('Invalid evidence filename')
}

function validEvidence(file: EvidenceFile): boolean {
  return Boolean(file && typeof file.name === 'string' && /^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/.test(file.name)
    && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)
    && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && typeof file.contentType === 'string'
    && (file.lineage === undefined || evidenceLineageSchema.safeParse(file.lineage).success))
}

function parsePortableRunArchive(value: unknown): PortableRunArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid run archive')
  const archive = value as Partial<PortableRunArchive>
  if (archive.format !== 'mobile-mirror-run' || ![1, 2, 3, 4].includes(archive.version!) || !archive.run || !Array.isArray(archive.files)) throw new Error('Unsupported run archive')
  if (archive.version === 3 ? archive.run.productContract?.contractVersion !== 2 : archive.run.productContract?.contractVersion === 2) throw new Error('Runtime archive requires v3 envelope')
  if (archive.version === 2 || archive.version === 4) {
    const sharing = archive.sharing
    if (!sharing || !/^[0-9a-f-]{36}$/.test(sharing.shareId) || sharing.verification !== 'not-revalidated' || sharing.rulesVersion !== (archive.version === 4 ? 2 : 1)
      || !['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated'].includes(sharing.reportedVerdict)
      || !Array.isArray(sharing.withheld) || sharing.withheld.length > 100 || !sharing.withheld.every(item => typeof item === 'string' && item.length <= 160)
      || !Array.isArray(sharing.reviewed) || sharing.reviewed.length !== archive.files.length
      || !sharing.reviewed.every(item => item && typeof item.file === 'string' && ['png-masks-v1', 'structure-allowlist-v1'].includes(item.transformation))
      || archive.run.id !== sharing.shareId || archive.run.verdict !== 'inconclusive' || archive.run.share !== undefined) throw new Error('Invalid derived archive metadata')
    if (archive.version === 4 ? !runtimeFeaturesSchema.safeParse(sharing.requiredFeatures).success : sharing.requiredFeatures !== undefined) throw new Error('Invalid derived runtime features')
    const permitted = new Set(['schemaVersion', 'id', 'name', 'yaml', 'engine', 'phase', 'verdict', 'startedAt', 'endedAt', 'sessionId', 'deviceName', 'platform', 'provider', 'verificationScope', 'visualVerification', 'businessVerification', 'steps', 'evidence', 'cleanup'])
    if (Object.keys(archive.run).some(key => !permitted.has(key)) || archive.run.name !== 'Reviewed shared run' || archive.run.yaml !== ''
      || archive.run.engine !== 'mobile-mirror-share' || archive.run.sessionId !== 'redacted' || archive.run.deviceName !== 'redacted' || archive.run.provider !== 'redacted'
      || archive.run.visualVerification !== 'not-performed' || archive.run.businessVerification !== 'inconclusive'
      || archive.run.steps.some(step => Object.keys(step).some(key => !['index', 'kind', 'status', 'startedAt', 'endedAt', 'evidence'].includes(key)))) throw new Error('Derived archive contains private or unsupported run fields')
    if (sharing.withheld.some(item => !/^\d+ evidence files omitted$/.test(item) && item !== 'video omitted' && item !== 'YAML, parameters, logs, identifiers, credentials, local paths and private journals omitted')) throw new Error('Derived archive has invalid withheld summary')
  } else if (archive.sharing !== undefined) throw new Error('Unexpected sharing metadata in native archive')
  const run = archive.run
  if (run.schemaVersion !== 1 || run.phase !== 'finished' || !run.verdict || !Array.isArray(run.steps) || !Array.isArray(run.evidence)
    || typeof run.yaml !== 'string' || typeof run.name !== 'string' || typeof run.startedAt !== 'string'
    || run.video !== undefined || !run.evidence.every(validEvidence)
    || !run.steps.every((step) => step && Number.isSafeInteger(step.index) && step.index > 0 && typeof step.kind === 'string'
      && ['passed', 'failed'].includes(step.status) && Array.isArray(step.evidence) && step.evidence.every(validEvidence))) throw new Error('Archive contains an invalid or unfinished run')
  if (archive.files.length > ARCHIVE_MAX_FILES) throw new Error(`Run archive exceeds ${ARCHIVE_MAX_FILES} files`)
  const references = [...run.evidence, ...run.steps.flatMap((step) => step.evidence)]
  const referenceNames = new Set(references.map((file) => file.name))
  if (referenceNames.size !== references.length) throw new Error('Archive contains duplicate evidence references')
  const fileNames = new Set<string>()
  let total = 0
  for (const file of archive.files) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.contentType !== 'string'
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > ARCHIVE_MAX_FILE_BYTES
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || typeof file.base64 !== 'string') throw new Error('Archive contains an invalid evidence file')
    validFileName(file.name)
    if (archiveContentType(file.name) !== file.contentType) throw new Error(`Archive evidence content type is not allowed: ${file.name}`)
    if (fileNames.has(file.name)) throw new Error(`Archive contains duplicate file: ${file.name}`)
    fileNames.add(file.name); total += file.bytes
    if (total > ARCHIVE_MAX_TOTAL_BYTES) throw new Error('Run archive evidence is too large')
    const reference = references.find((candidate) => candidate.name === file.name)
    if (!reference || reference.bytes !== file.bytes || reference.sha256 !== file.sha256 || reference.contentType !== file.contentType) throw new Error(`Archive file is not registered by the manifest: ${file.name}`)
  }
  if (fileNames.size !== referenceNames.size || [...referenceNames].some((name) => !fileNames.has(name))) throw new Error('Run archive is missing registered evidence')
  if ((archive.version === 2 || archive.version === 4) && (new Set(archive.sharing!.reviewed.map(item => item.file)).size !== fileNames.size
    || archive.sharing!.reviewed.some(item => !fileNames.has(item.file)
      || !/^share-[1-9][0-9]*\.(?:png|xml)$/.test(item.file)
      || (item.file.endsWith('.png') ? item.transformation !== 'png-masks-v1' : item.transformation !== 'structure-allowlist-v1'))
    || references.some(file => file.lineage?.kind !== 'derived' || file.lineage.sourceRef !== 'private:withheld'))) throw new Error('Derived archive review list does not match included evidence')
  return archive as PortableRunArchive
}

function decodeArchiveFile(file: PortableRunArchive['files'][number]): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw new Error(`Archive evidence is not valid base64: ${file.name}`)
  const bytes = Buffer.from(file.base64, 'base64')
  if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Archive evidence integrity failed: ${file.name}`)
  return bytes
}

function normalizeImportedRun(input: TestRun, id: string): TestRun {
  const text = (value: unknown, label: string, max = 16_384): string => {
    if (typeof value !== 'string' || value.length > max) throw new Error(`Archive has invalid ${label}`)
    return value
  }
  const date = (value: unknown, label: string): string => {
    const result = text(value, label, 64)
    if (!Number.isFinite(Date.parse(result))) throw new Error(`Archive has invalid ${label}`)
    return result
  }
  const verdict = input.verdict
  if (!verdict || !['pass', 'recovered', 'fail', 'cancelled', 'inconclusive', 'evidence-conflict', 'evidence-contaminated'].includes(verdict)) throw new Error('Archive has invalid verdict')
  if (!['android', 'ios', 'unknown'].includes(input.platform)) throw new Error('Archive has invalid platform')
  if (!['not-performed', 'pass', 'fail', 'inconclusive'].includes(input.businessVerification)) throw new Error('Archive has invalid business verification')
  if (!['pending', 'session-retained', 'failed'].includes(input.cleanup)) throw new Error('Archive has invalid cleanup state')
  if (input.steps.length > 500) throw new Error('Archive has too many steps')
  const steps: RunStep[] = input.steps.map((step) => {
    const normalized: RunStep = {
      index: step.index,
      kind: text(step.kind, 'step kind', 128),
      status: step.status,
      startedAt: date(step.startedAt, 'step start time'),
      evidence: step.evidence.map((file) => ({ ...file })),
    }
    if (step.endedAt !== undefined) normalized.endedAt = date(step.endedAt, 'step end time')
    if (step.target !== undefined) normalized.target = text(step.target, 'step target')
    if (step.path !== undefined) normalized.path = text(step.path, 'step path', 1024)
    if (step.sourceLine !== undefined && Number.isSafeInteger(step.sourceLine) && step.sourceLine > 0) normalized.sourceLine = step.sourceLine
    if (step.message !== undefined) normalized.message = text(step.message, 'step message')
    if (step.error !== undefined) normalized.error = text(step.error, 'step error')
    if (step.checkpointError !== undefined) normalized.checkpointError = text(step.checkpointError, 'checkpoint error')
    if (input.productContract?.contractVersion === 2) {
      if (step.temporal) normalized.temporal = structuredClone(step.temporal)
      if (step.business) normalized.business = structuredClone(step.business)
      if (step.restart) normalized.restart = structuredClone(step.restart)
    }
    if (step.verification !== undefined) {
      if (!step.verification || !['pass', 'fail', 'evidence-conflict', 'evidence-contaminated'].includes(step.verification.status)) throw new Error('Archive has invalid step verification')
      normalized.verification = { status: step.verification.status, message: text(step.verification.message, 'verification message') }
    }
    for (const key of ['executionMs', 'waitMs', 'executorOtherMs'] as const) if (step[key] !== undefined) {
      if (!Number.isFinite(step[key]) || step[key]! < 0) throw new Error(`Archive has invalid ${key}`)
      normalized[key] = step[key]
    }
    return normalized
  })
  return {
    schemaVersion: 1,
    id,
    name: text(input.name, 'run name', 512),
    yaml: text(input.yaml, 'YAML', 80 * 1024),
    engine: text(input.engine, 'engine', 512),
    phase: 'finished',
    verdict,
    startedAt: date(input.startedAt, 'run start time'),
    ...(input.endedAt === undefined ? {} : { endedAt: date(input.endedAt, 'run end time') }),
    sessionId: 'imported',
    deviceName: text(input.deviceName, 'device name', 512),
    platform: input.platform,
    provider: text(input.provider, 'provider', 128),
    verificationScope: 'declared-ui-assertions',
    visualVerification: 'not-performed',
    businessVerification: input.businessVerification,
    steps,
    evidence: input.evidence.map((file) => ({ ...file })),
    ...(input.error === undefined ? {} : { error: text(input.error, 'run error') }),
    cleanup: input.cleanup,
    ...(input.resourceCleanup && ['pending', 'pass', 'failed'].includes(input.resourceCleanup) ? { resourceCleanup: input.resourceCleanup } : {}),
    source: 'import',
    ...(input.productContract?.contractVersion === 2 ? { productContract: runProductContractSchema.parse(input.productContract),
      measurements: structuredClone(input.measurements ?? []), ...(input.health ? { health: structuredClone(input.health) } : {}) } : {}),
  }
}

function archiveContentType(name: string): string {
  const extension = name.split('.').at(-1)
  const contentType = ({
    png: 'image/png',
    xml: 'application/xml; charset=utf-8',
    yaml: 'text/yaml; charset=utf-8',
    json: 'application/json',
    txt: 'text/plain; charset=utf-8',
  } as Record<string, string | undefined>)[extension ?? '']
  if (!contentType) throw new Error(`Archive evidence type is not supported: ${name}`)
  return contentType
}

async function committedWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() }
  finally { await handle.close() }
}

async function requireDirectory(path: string) {
  const directory = await lstat(path)
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Run directory not found')
  return directory
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { await handle.sync() } finally { await handle.close() }
}
