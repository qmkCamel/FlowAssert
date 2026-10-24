import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { runOwnedWorker, type WorkerFactory } from './workbench-worker-lifecycle.js'
import { normalizeScreenSource } from './screen-source-normalizer.js'
import { sha256, type PortableRunArchive, type WorkbenchStore } from './workbench-store.js'
import type { EvidenceFile, RunStep, TestRun } from './workbench-domain.js'
import { publishConsumer, retireConsumerUnderMutationGate, type ReferencePublication, type ReferenceCutpoint } from './workbench-consumer-references.js'
import { validRunId } from './workbench-store.js'

export interface ShareMask { x: number; y: number; width: number; height: number }
export interface ShareSelection { name: string; masks?: ShareMask[] }
export interface ShareOptions { files: ShareSelection[] }
export interface SharePreview { digest: string; sourceManifestSha256: string; files: { sourceName: string; kind: 'image' | 'structure'; bytes: number; masks: number; preview: string }[]; withheld: string[]; suggestions: { kind: 'source-secret-like' | 'hierarchy-secret-like'; file?: string }[]; warning: string }
interface ShareMap { sourceRunId: string; sourceManifestSha256: string; createdAt: string; files: { sourceName: string; derivedName: string; sourceSha256: string }[]; referencePublication?: ReferencePublication }

const MAX_FILES = 64
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
export const WORKBENCH_SHARE_IMAGE_WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? '../scripts/workbench-share-image-worker.mjs' : './workbench-share-image-worker.js', import.meta.url)

/** Creates a content-only, human-reviewed package. It never writes into the source run. */
export class WorkbenchShare {
  constructor(private readonly store: WorkbenchStore, private readonly cutpoint: ReferenceCutpoint = async () => {}) {}

  async preview(runId: string, options: ShareOptions, signal?: AbortSignal): Promise<SharePreview> {
    const release = await this.store.lease([runId])
    try { return (await this.#prepare(runId, options, AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30_000)]))).preview }
    finally { release() }
  }

  async export(runId: string, options: ShareOptions, previewDigest: string, reviewed: boolean, signal?: AbortSignal, identity?: { shareId: string; generatedAt: string }): Promise<PortableRunArchive> {
    if (!reviewed || !/^[a-f0-9]{64}$/.test(previewDigest)) throw new Error('Explicit review of the current share preview is required')
    const release = await this.store.lease([runId])
    try {
    const deadline = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30_000)])
    const { preview, source, selected } = await this.#prepare(runId, options, deadline, Boolean(identity))
    if (preview.digest !== previewDigest) throw new Error('Share preview is stale; review the source and masks again')
    const shareId = identity?.shareId ?? randomUUID(), now = identity?.generatedAt ?? new Date().toISOString()
    validRunId(shareId)
    const files: PortableRunArchive['files'] = []
    const evidenceByName = new Map<string, EvidenceFile>()
    for (const [index, entry] of selected.entries()) {
      const name = `share-${index + 1}.${entry.kind === 'image' ? 'png' : 'xml'}`
      const contentType = entry.kind === 'image' ? 'image/png' : 'application/xml; charset=utf-8'
      const file = { name, contentType, bytes: entry.bytes.length, sha256: sha256(entry.bytes), base64: entry.bytes.toString('base64') }
      files.push(file)
      evidenceByName.set(entry.sourceName, { name, contentType, bytes: file.bytes, sha256: file.sha256,
        lineage: { contractVersion: 1, kind: 'derived', sourceRef: 'private:withheld', transformation: entry.kind === 'image' ? 'png-masks-v1' : 'structure-allowlist-v1', integrity: 'verified', sharing: 'content' } })
    }
    const evidenceFor = (items: EvidenceFile[]) => items.flatMap(item => evidenceByName.get(item.name) ? [evidenceByName.get(item.name)!] : [])
    const steps: RunStep[] = source.steps.map(step => ({ index: step.index, kind: safeKind(step.kind), status: step.status === 'passed' ? 'passed' : 'failed', startedAt: now, endedAt: now, evidence: evidenceFor(step.evidence) }))
    const run: TestRun = {
      schemaVersion: 1, id: shareId, name: 'Reviewed shared run', yaml: '', engine: 'mobile-mirror-share', phase: 'finished', verdict: 'inconclusive',
      startedAt: now, endedAt: now, sessionId: 'redacted', deviceName: 'redacted', platform: source.platform, provider: 'redacted',
      verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'inconclusive',
      steps, evidence: evidenceFor(source.evidence), cleanup: 'session-retained',
    }
    const runtime = source.productContract?.contractVersion === 2 ? source.productContract.requiredFeatures : undefined
    const archive: PortableRunArchive = { format: 'mobile-mirror-run', version: runtime ? 4 : 2, run, files, sharing: { shareId, reportedVerdict: source.verdict!, verification: 'not-revalidated', withheld: preview.withheld,
      reviewed: selected.map((entry, index) => ({ file: files[index]!.name, transformation: entry.kind === 'image' ? 'png-masks-v1' : 'structure-allowlist-v1' })), rulesVersion: runtime ? 2 : 1,
      ...(runtime ? { requiredFeatures: runtime } : {}) } }
    deadline.throwIfAborted()
    if (Buffer.byteLength(JSON.stringify(archive)) > 24 * 1024 * 1024) throw new Error('Derived archive exceeds serialized request budget')
    const map: ShareMap = { sourceRunId: runId, sourceManifestSha256: preview.sourceManifestSha256, createdAt: now,
      files: selected.map((entry, index) => ({ sourceName: entry.sourceName, derivedName: files[index]!.name, sourceSha256: [...source.evidence, ...source.steps.flatMap(step => step.evidence)].find(file => file.name === entry.sourceName)!.sha256 })) }
    await publishConsumer(this.store, 'workbench:share', shareId, shareReferenceTargets(map), async publication => {
      deadline.throwIfAborted()
      await this.#savePrivateMap(shareId, { ...map, referencePublication: publication })
    }, this.cutpoint)
    return archive
    } finally { release() }
  }

  /** Retires only the local source mapping; already exported bytes cannot be recalled. */
  async retire(shareId: string): Promise<void> {
    validRunId(shareId)
    await this.store.withMutationGate(async () => {
      const dir = await lstat(join(this.store.root, 'shares'))
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Unsafe share journal directory')
      const handle = await open(join(this.store.root, 'shares', `${shareId}.json`), constants.O_RDONLY | constants.O_NOFOLLOW)
      let map: ShareMap
      try { if ((await handle.stat()).size > 4 * 1024 * 1024) throw new Error('Share map exceeds budget'); map = JSON.parse(await handle.readFile('utf8')) }
      finally { await handle.close() }
      if (!map.referencePublication) throw new Error('Legacy share retirement requires explicit migration')
      await retireConsumerUnderMutationGate(this.store, map.referencePublication, 'workbench:share', shareId, shareReferenceTargets(map),
        publication => this.#savePrivateMap(shareId, { ...map, referencePublication: publication }), this.cutpoint)
    })
  }

  async prepareReport(runId: string, options: ShareOptions, signal?: AbortSignal) {
    const release = await this.store.lease([runId])
    try { const { source, preview } = await this.#prepare(runId, options, signal, true); return { source, preview } }
    finally { release() }
  }

  async #prepare(runId: string, options: ShareOptions, signal?: AbortSignal, allowEmpty = false) {
    if (!options || !Array.isArray(options.files) || options.files.length < (allowEmpty ? 0 : 1) || options.files.length > MAX_FILES) throw new Error('Select 1–64 evidence files')
    const { run: source, manifestSha256 } = await this.store.readOnlySnapshot(runId)
    if (source.phase !== 'finished' || !source.verdict || source.source === 'import') throw new Error('Only completed original runs can be shared')
    const originals = [...source.evidence, ...source.steps.flatMap(step => step.evidence)]
    const known = new Map(originals.map(file => [file.name, file]))
    const seen = new Set<string>()
    const suggestions: SharePreview['suggestions'] = []
    if (secretLike(`${source.yaml}\n${JSON.stringify(source.params ?? {})}`)) suggestions.push({ kind: 'source-secret-like' })
    const selected: { sourceName: string; kind: 'image' | 'structure'; bytes: Buffer; masks: number }[] = []
    let total = 0, inputTotal = 0
    for (const item of options.files) {
      signal?.throwIfAborted()
      if (!item || typeof item.name !== 'string' || seen.has(item.name)) throw new Error('Invalid or duplicate share selection')
      seen.add(item.name)
      const original = known.get(item.name)
      if (!original || !['image/png', 'application/xml; charset=utf-8'].includes(original.contentType)) throw new Error('Share supports registered PNG and XML evidence only')
      if (original.incomplete || original.recovered || original.lineage?.integrity === 'unverified') throw new Error('Unverified evidence cannot be shared')
      if (original.bytes > MAX_FILE_BYTES || (inputTotal += original.bytes) > MAX_TOTAL_BYTES) throw new Error('Share source exceeds evidence budget')
      const input = await this.store.readEvidence(runId, original)
      let bytes: Buffer
      let kind: 'image' | 'structure'
      if (original.contentType === 'image/png') {
        kind = 'image'
        const masks = item.masks ?? []
        bytes = await transformShareImage(input, masks, signal)
      } else {
        kind = 'structure'
        if (item.masks?.length) throw new Error('Image masks do not apply to XML')
        const structure = normalizeScreenSource(input.toString('utf8'), source.platform)
        if (structure.nodes.some(node => node.sensitive || secretLike(`${node.name ?? ''} ${node.text ?? ''} ${node.value ?? ''}`))) suggestions.push({ kind: 'hierarchy-secret-like', file: item.name })
        // Structure-only allowlist: no attributes, text, values, identifiers, paths, or raw XML.
        const roles = structure.nodes.map(node => /^[a-z][a-z-]{0,31}$/.test(node.role) ? node.role : 'unknown')
        bytes = Buffer.from(`<structure>${roles.map(role => `<node role="${role}"/>`).join('')}</structure>`)
      }
      if (bytes.length > MAX_FILE_BYTES || (total += bytes.length) > MAX_TOTAL_BYTES) throw new Error('Share archive exceeds evidence budget')
      signal?.throwIfAborted()
      selected.push({ sourceName: item.name, kind, bytes, masks: item.masks?.length ?? 0 })
    }
    const withheld = [
      `${originals.length - selected.length} evidence files omitted`,
      ...(source.video ? ['video omitted'] : []),
      'YAML, parameters, logs, identifiers, credentials, local paths and private journals omitted',
    ]
    const digest = sha256(JSON.stringify({ rulesVersion: 1, runId, manifestSha256, options, output: selected.map(item => sha256(item.bytes)) }))
    const preview: SharePreview = { digest, sourceManifestSha256: manifestSha256, files: selected.map(item => ({ sourceName: item.sourceName, kind: item.kind, bytes: item.bytes.length, masks: item.masks,
      preview: item.kind === 'image' ? `data:image/png;base64,${item.bytes.toString('base64')}` : item.bytes.toString('utf8') })), withheld,
      suggestions,
      warning: 'Review every selected screenshot. Unmasked pixels remain visible; shared results are not revalidated.' }
    return { source, selected, preview }
  }

  async #savePrivateMap(shareId: string, value: unknown): Promise<void> {
    const directory = join(this.store.root, 'shares')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Share journal directory is unsafe')
    const parent = await open(this.store.root, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await parent.sync() } finally { await parent.close() }
    const temporary = join(directory, `.share-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
    await rename(temporary, join(directory, `${shareId}.json`))
    const dir = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW)
    try { await dir.sync() } finally { await dir.close() }
  }
}

export function shareReferenceTargets(map: ShareMap) { return [{ runId: map.sourceRunId, sourceHash: map.sourceManifestSha256, evidenceRefs: map.files.map(file => file.sourceName) }] }

function safeKind(value: string): string { return /^(?:tap|type|assert|assertVisible|assertNotVisible|wait|launchApp|done)$/.test(value) ? value : 'step' }
function secretLike(value: string): boolean { return /(?:password|passcode|token|secret|authorization|bearer|api[_-]?key|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i.test(value) }

export function transformShareImage(input: Buffer, masks: ShareMask[], signal?: AbortSignal, createWorker?: WorkerFactory): Promise<Buffer> {
  if (input.length > MAX_FILE_BYTES || !Array.isArray(masks) || masks.length > 64) return Promise.reject(new Error('Share image exceeds input budget'))
  return runOwnedWorker(WORKBENCH_SHARE_IMAGE_WORKER_URL, { workerData: { input, masks }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 } }, raw => {
    const value = raw as { bytes?: Uint8Array; error?: string }
    if (typeof value?.error === 'string') throw new Error(value.error.slice(0, 400))
    if (!(value?.bytes instanceof Uint8Array) || value.bytes.byteLength > MAX_FILE_BYTES) throw new Error('Share image worker returned invalid output')
    return Buffer.from(value.bytes)
  }, signal, 30_000, 'Share image conversion', createWorker)
}
