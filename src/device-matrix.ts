import { randomUUID } from 'node:crypto'
import { join, isAbsolute } from 'node:path'
import { z } from 'zod'
import { readExternalFile } from './workbench-external-files.js'
import { WorkbenchStore } from './workbench-store.js'
import { acceptanceDirectory, acceptanceEntries, readAcceptance, writeAcceptance } from './workbench-change-storage.js'
import { loadTestProject, type ProjectSnapshot } from './workbench-project.js'
import { compilePlan, inspectFlowHeader } from './workbench-plan.js'
import { acquireStoreOwner, releaseStoreOwner } from './workbench-store-owner.js'
import { matrixRegistrySchema, matrixCellSchema, matrixStateSchema, matrixHash, matrixExitCode, matrixRunStatus, matrixId, matrixSafeSummary,
  type MatrixRegistry, type MatrixState, type MatrixCell, type MatrixAttempt } from './device-matrix-contracts.js'
import { preflightMatrixResources } from './device-matrix-preflight.js'
import { MatrixProcess } from './device-matrix-process.js'
import type { TestRun } from './workbench-domain.js'
import { runResultProjection } from './workbench-contracts.js'
import { verifyRunEvidence } from './workbench-run-finalization.js'
import { WorkbenchReferences } from './workbench-references.js'
import { freezeMatrixArtifacts, bindMatrixArtifacts } from './device-matrix-artifacts.js'

type Artifacts = Awaited<ReturnType<typeof freezeMatrixArtifacts>>
interface ActiveMatrix { state: MatrixState; registry: MatrixRegistry; project: ProjectSnapshot; cells: MatrixCell[]; artifacts: Artifacts; children: Map<string, MatrixProcess>; cancelled: Set<string>; done: Promise<void>; locked: Set<string>; poisoned: Set<string> }
const snapshotSchema = z.object({ registry: matrixRegistrySchema, project: z.unknown(), cells: z.array(matrixCellSchema).max(100), artifacts: z.record(z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), extension: z.enum(['.apk', '.ipa']) }).strict()), inputDigest: z.string() }).strict()
export class LocalDeviceMatrix {
  readonly root: string
  #ready: Promise<void> | undefined; #active: ActiveMatrix | undefined; #closed = false; #starting = false
  #readers = 0
  #startIdle: Promise<void> = Promise.resolve()
  #unpersisted = new Map<string, MatrixState>()
  constructor(readonly store: WorkbenchStore, readonly projectPath?: string, readonly registryPath = process.env.MOBILE_MIRROR_MATRIX_REGISTRY) { this.root = join(store.root, 'matrices') }
  #path(id: string) { return join(this.root, matrixId.parse(id)) }
  async #init() { return this.#ready ??= (async () => {
    await this.store.init(); await acceptanceDirectory(this.root)
    for (const id of await acceptanceEntries(this.root)) {
      if (!matrixId.safeParse(id).success) continue
      const state = await readAcceptance(join(this.#path(id), 'state.json'), matrixStateSchema)
      if (state.phase !== 'finished') {
        state.phase = 'finished'; state.error = 'matrix-interrupted-no-automatic-replay'; state.completedAt = new Date().toISOString()
        for (const slot of state.slots) if (slot.phase !== 'closed') slot.phase = 'quarantined'
        for (const cell of state.cells) for (const attempt of cell.attempts) if (attempt.phase !== 'terminal') { attempt.phase = 'terminal'; attempt.status = 'incomplete'; attempt.reason = 'matrix-interrupted'; attempt.endedAt = state.completedAt }
        state.exitCode = matrixExitCode(state)
        const release = await this.store.reserveEvidence(`matrix-recover:${id}`, 4 * 1024 * 1024)
        try { await this.#save(state) } finally { release() }
      }
    }
  })() }
  async #save(state: MatrixState) { await this.store.withMutationGate(() => writeAcceptance(join(this.#path(state.id), 'state.json'), matrixStateSchema.parse(state), true)) }
  async registry(): Promise<MatrixRegistry> {
    if (!this.registryPath || !isAbsolute(this.registryPath)) throw new Error('matrix-registry-not-configured')
    return matrixRegistrySchema.parse(JSON.parse((await readExternalFile(this.registryPath, 256 * 1024)).toString('utf8')))
  }
  async catalog() { const r = await this.registry(); return { plans: Object.entries(r.plans).map(([id, p]) => ({ id, cells: p.cells.map(c => ({ id: c.id, slotId: c.slotId, flow: c.flow })) })), slots: r.slots.map(s => ({ id: s.id, platform: s.platform, provider: s.provider })) } }
  async validate(planId: string) {
    const registry = await this.registry(), plan = registry.plans[planId]; if (!plan) throw new Error('matrix-plan-unregistered')
    const project = await loadTestProject(this.projectPath)
    await this.#validateSnapshot(registry, project, planId)
    const release = await preflightMatrixResources(registry); await release()
    return { valid: true, planId, cells: plan.cells.length, projectDigest: matrixHash(project), registryDigest: matrixHash(registry), deviceClaims: 'checked-at-start' }
  }
  async #validateSnapshot(registry: MatrixRegistry, project: ProjectSnapshot, planId: string) {
    const plan = registry.plans[planId]; if (!plan) throw new Error('matrix-plan-unregistered')
    for (const cell of plan.cells) {
      const yaml = project.flows[cell.flow]; if (!yaml) throw new Error('matrix-flow-unregistered')
      const header = inspectFlowHeader(yaml)
      const params = { ...cell.params, ...(header.prepare.length ? { matrixNamespace: `validation-${cell.fixture.namespace}` } : {}) }
      if (header.prepare.length && (!header.params.matrixNamespace || !JSON.stringify(header.prepare).includes('params.matrixNamespace'))) throw new Error('matrix-fixture-namespace-unbound')
      if (header.prepare.some(hook => !project.extensions[hook.ref]?.cleanup)) throw new Error('matrix-fixture-cleanup-required')
      const compiled = await compilePlan(yaml, project, params)
      if (compiled.header.platform !== registry.slots.find(s => s.id === cell.slotId)?.platform) throw new Error('matrix-platform-mismatch')
    }
  }
  async start(planId: string, confirm: string): Promise<MatrixState> {
    if (confirm !== `START ${planId}`) throw new Error('matrix-explicit-confirmation-required')
    if (this.#closed || this.#starting || this.#active) throw new Error('matrix-busy-or-closed')
    this.#starting = true
    let startFinished!: () => void
    this.#startIdle = new Promise(resolve => { startFinished = resolve })
    try {
      await this.#init(); await this.validate(planId)
      if (this.#closed) throw new Error('matrix-closed')
      const registry = await this.registry(), project = await loadTestProject(this.projectPath), id = randomUUID()
      // Revalidate the exact frozen inputs, not an earlier snapshot a user may have edited.
      await this.#validateSnapshot(registry, project, planId)
      const cells = structuredClone(registry.plans[planId]!.cells)
      for (const cell of cells) if (inspectFlowHeader(project.flows[cell.flow]!).prepare.length) cell.params.matrixNamespace = `${id}-${cell.slotId}-${cell.fixture.namespace}`
      const used = registry.slots.filter(s => cells.some(c => c.slotId === s.id))
      const state: MatrixState = { contractVersion: 1, id, planId, generation: randomUUID(), revision: 1, phase: 'accepted', createdAt: new Date().toISOString(),
        projectDigest: matrixHash(project), registryDigest: matrixHash(registry), inputDigest: matrixHash({ registry, project, cells }),
        slots: used.map(s => ({ id: s.id, platform: s.platform, storeId: randomUUID(), generation: randomUUID(), phase: 'preparing' })),
        cells: [] }
      state.cells = cells.map(c => ({ id: c.id, slotId: c.slotId, attempts: [{ id: randomUUID(), storeId: state.slots.find(s => s.id === c.slotId)!.storeId, phase: 'queued', status: 'pending' }] }))
      const reservation = await this.store.reserveEvidence(`matrix:${id}`, 192 * 1024 * 1024)
      try {
        await acceptanceDirectory(this.#path(id))
        await this.#save(state)
        const directory = join(this.#path(id), 'artifacts'); await acceptanceDirectory(directory)
        const artifacts = await freezeMatrixArtifacts(registry, directory)
        state.inputDigest = matrixHash({ registry, project, cells, artifacts })
        await writeAcceptance(join(this.#path(id), 'input.json'), { registry, project, cells, artifacts, inputDigest: state.inputDigest })
        await this.#save(state)
        if (this.#closed) throw new Error('matrix-closed')
        const active: ActiveMatrix = { state, registry, project, cells, artifacts, children: new Map(), cancelled: new Set(), done: Promise.resolve(), locked: new Set(), poisoned: new Set() }
        this.#active = active; active.done = this.#execute(active, false).finally(() => { reservation(); if (this.#active === active) this.#active = undefined })
        void active.done.catch(() => {})
        return structuredClone(state)
      } catch (error) {
        state.phase = 'finished'; state.error = 'matrix-preparation-failed'; state.completedAt = new Date().toISOString(); state.exitCode = 2
        for (const slot of state.slots) slot.phase = 'closed'
        for (const cell of state.cells) for (const attempt of cell.attempts) { attempt.phase = 'terminal'; attempt.status = 'blocked'; attempt.endedAt = state.completedAt }
        await this.#save(state).catch(() => {}); reservation(); throw error
      }
    } finally { this.#starting = false; startFinished() }
  }
  async #execute(active: ActiveMatrix, retry: boolean) {
    const { state, registry, project } = active
    const participating = state.slots.filter(s => active.cells.some(c => c.slotId === s.id))
    let ports: (() => Promise<void>) | undefined
    try {
      state.phase = 'preparing'; await this.#save(state)
      const runtimeRegistry = await bindMatrixArtifacts(registry, join(this.#path(state.id), 'artifacts'), active.artifacts)
      ports = await preflightMatrixResources({ ...registry, slots: registry.slots.filter(s => participating.some(p => p.id === s.id)) })
      for (const slot of participating) {
        const definition = runtimeRegistry.slots.find(s => s.id === slot.id)!, child = new MatrixProcess(state.id, slot.id, slot.generation)
        active.children.set(slot.id, child); Object.assign(slot, await child.identity()); await this.#save(state)
        const root = join(this.#path(state.id), 'stores', slot.storeId); await acceptanceDirectory(root)
        await child.request('prepare', slot.storeId, { root, slot: definition, project, projectDigest: state.projectDigest, cells: active.cells.filter(c => c.slotId === slot.id), retry })
        slot.phase = 'ready'; await this.#save(state)
      }
      if (this.#closed) for (const slot of participating) active.cancelled.add(slot.id)
      await ports(); ports = undefined
      await Promise.all(participating.filter(slot => !active.cancelled.has(slot.id)).map(async slot => {
        try { await active.children.get(slot.id)!.request('connect', slot.storeId, {}, 180_000) }
        catch { slot.phase = 'quarantined' }
      }))
      state.phase = 'running'; await this.#save(state)
      await Promise.all(participating.map(slot => this.#runSlot(active, slot.id, retry)))
    } catch { state.error = 'matrix-execution-incomplete' }
    finally {
      await ports?.(); state.phase = 'finalizing'
      await Promise.all(participating.map(async slot => {
        const child = active.children.get(slot.id)
        try { if (child) await child.close(slot.storeId); slot.cleanupConfirmed = true; if (slot.phase !== 'quarantined') slot.phase = 'closed' }
        catch { slot.phase = 'quarantined'; slot.cleanupConfirmed = false }
      }))
      for (const cell of state.cells) for (const attempt of cell.attempts) if (attempt.phase !== 'terminal') {
        attempt.phase = 'terminal'; attempt.status = active.cancelled.has(cell.slotId) ? 'cancelled' : 'blocked'; attempt.endedAt = new Date().toISOString()
      }
      const terminal = structuredClone(state)
      terminal.phase = 'finished'; terminal.completedAt = new Date().toISOString(); terminal.exitCode = matrixExitCode(terminal)
      try { await writeAcceptance(join(this.#path(state.id), `result-${state.revision}.json`), terminal); await this.#save(terminal); Object.assign(state, terminal) }
      catch { Object.assign(state, terminal, { error: 'matrix-terminal-persistence-failed', exitCode: 2 }); this.#unpersisted.set(state.id, structuredClone(state)) }
    }
  }
  async #runSlot(active: ActiveMatrix, slotId: string, retry: boolean) {
    const { state } = active, slot = state.slots.find(s => s.id === slotId)!, child = active.children.get(slotId)!
    for (const cell of active.cells.filter(c => c.slotId === slotId)) {
      const record = state.cells.find(c => c.id === cell.id)!, attempt = record.attempts.at(-1)!
      if (attempt.phase === 'terminal') continue
      while (!active.cancelled.has(slotId) && slot.phase !== 'quarantined' && !cell.fixture.resourceKeys.some(key => active.poisoned.has(key)) && cell.fixture.resourceKeys.some(key => active.locked.has(key))) {
        attempt.reason = 'matrix-exclusive-resource-queued'; await new Promise(resolve => setTimeout(resolve, 25))
      }
      if (active.cancelled.has(slotId) || slot.phase === 'quarantined' || cell.fixture.resourceKeys.some(key => active.poisoned.has(key))) {
        attempt.phase = 'terminal'; attempt.status = active.cancelled.has(slotId) ? 'cancelled' : 'blocked'; attempt.endedAt = new Date().toISOString(); await this.#save(state); continue
      }
      cell.fixture.resourceKeys.forEach(key => active.locked.add(key)); slot.phase = 'running'; attempt.phase = 'claimed'; attempt.startedAt = new Date().toISOString(); delete attempt.reason
      try {
        await this.#save(state); attempt.phase = 'running'; await this.#save(state)
        const parentRunId = record.attempts.at(-2)?.runId
        const result = await child.request('run', attempt.id, { cell, reset: retry, ...(parentRunId ? { parentRunId } : {}) }, 660_000)
        if (!result?.run || result.run.id !== attempt.id || !/^[a-f0-9]{64}$/.test(result.manifestSha256) || !matrixId.safeParse(result.referenceId).success) throw new Error('matrix-child-result-identity')
        const run = result.run as TestRun
        attempt.runId = run.id; attempt.manifestSha256 = result.manifestSha256; attempt.referenceId = result.referenceId; attempt.projection = result.projection
        attempt.status = matrixRunStatus(run, run.resultProjection?.verification.evidence.status === 'pass' ? 'verified' : 'unavailable')
        if (result.quarantined) { slot.phase = 'quarantined'; attempt.reason = 'matrix-device-state-unconfirmed'; if (attempt.status === 'pass') attempt.status = 'incomplete' }
      } catch { slot.phase = 'quarantined'; attempt.status = 'incomplete'; attempt.reason = 'matrix-dispatch-or-result-unconfirmed' }
      finally {
        attempt.phase = 'terminal'; attempt.endedAt = new Date().toISOString()
        cell.fixture.resourceKeys.forEach(key => { if (slot.phase === 'quarantined') active.poisoned.add(key); else active.locked.delete(key) })
        await this.#save(state)
      }
    }
  }
  async cancel(id: string, slotId?: string) {
    const active = this.#active; if (!active || active.state.id !== id) throw new Error('matrix-not-active')
    const slots = active.state.slots.filter(s => !slotId || s.id === slotId); if (!slots.length) throw new Error('matrix-slot-not-found')
    if (!slotId) active.state.phase = 'cancelling'
    await Promise.all(slots.map(async slot => {
      active.cancelled.add(slot.id); slot.phase = 'cancelling'
      const attempt = active.state.cells.filter(c => c.slotId === slot.id).flatMap(c => c.attempts).find(a => a.phase === 'running')
      try { if (attempt) await active.children.get(slot.id)?.request('cancel', attempt.id, {}, 45_000) } catch { slot.phase = 'quarantined' }
    }))
    await this.#save(active.state); return structuredClone(active.state)
  }
  async status(id: string): Promise<MatrixState> { await this.#init(); const cached = this.#active?.state.id === id ? this.#active.state : this.#unpersisted.get(id); return cached ? structuredClone(cached) : readAcceptance(join(this.#path(id), 'state.json'), matrixStateSchema) }
  async list() {
    await this.#init()
    const ids = (await acceptanceEntries(this.root)).filter(id => matrixId.safeParse(id).success)
    const states = await Promise.all(ids.map(id => this.status(id)))
    const rows = []
    for (const state of states.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)) rows.push(matrixSafeSummary(await this.get(state.id)))
    return rows
  }
  async get(id: string) {
    const state = await this.status(id)
    if (state.phase !== 'finished') return state
    for (const cell of state.cells) for (const attempt of cell.attempts) {
      if (!attempt.runId) continue
      try { const source = await this.readAttempt(id, attempt), current = matrixRunStatus(source.run, 'verified'); if (attempt.status !== 'fail' && (current === 'fail' || current === 'incomplete')) attempt.status = current }
      catch { if (attempt.status !== 'fail') attempt.status = 'incomplete'; attempt.reason = 'matrix-current-evidence-unavailable' }
    }
    state.exitCode = matrixExitCode(state); return state
  }
  async readAttempt(id: string, attempt: MatrixAttempt): Promise<{ run: TestRun; manifestSha256: string }> {
    if (this.#readers >= 2) throw new Error('matrix-read-budget')
    this.#readers++
    try {
      const state = await this.status(id)
      const registered = state.cells.flatMap(c => c.attempts).find(a => a.id === attempt.id)
      if (!registered?.runId || registered.storeId !== attempt.storeId || registered.manifestSha256 !== attempt.manifestSha256) throw new Error('matrix-source-not-registered')
      const slot = state.slots.find(s => s.storeId === registered.storeId); if (!slot) throw new Error('matrix-store-unregistered')
      const child = this.#active?.state.id === id ? this.#active.children.get(slot.id) : undefined
      if (child && slot.phase !== 'closed') {
        const result = await child.request('read', attempt.id, { runId: registered.runId })
        if (result.manifestSha256 !== registered.manifestSha256 || result.run.resultProjection?.verification.evidence.status !== 'pass') throw new Error('matrix-source-unavailable')
        if (!result.references?.some((r: { refId: string; consumerKind: string; consumerId: string; sourceHash: string; targetRunId: string }) => r.refId === registered.referenceId && r.consumerKind === 'matrix:attempt' && r.consumerId === `${id}:${attempt.id}` && r.sourceHash === registered.manifestSha256 && r.targetRunId === registered.runId)) throw new Error('matrix-reference-unavailable')
        return result
      }
      const root = join(this.#path(id), 'stores', matrixId.parse(registered.storeId)), owner = await acquireStoreOwner(root), reader = new WorkbenchStore(root)
      try {
        const result = await reader.readOnlySnapshot(registered.runId)
        if (result.manifestSha256 !== registered.manifestSha256 || result.run.phase !== 'finished') throw new Error('matrix-source-integrity')
        const reference = (await new WorkbenchReferences(reader).list()).find(r => r.refId === registered.referenceId)
        if (!reference || reference.consumerKind !== 'matrix:attempt' || reference.consumerId !== `${id}:${attempt.id}` || reference.sourceHash !== result.manifestSha256 || reference.targetRunId !== registered.runId) throw new Error('matrix-reference-unavailable')
        await verifyRunEvidence(reader, result.run)
        result.run.resultProjection = runResultProjection(result.run, 'verified'); return result
      } finally { await releaseStoreOwner(root, owner) }
    } finally { this.#readers-- }
  }
  async preview(id: string, slotId: string) {
    const active = this.#active, slot = active?.state.slots.find(s => s.id === slotId)
    if (!active || active.state.id !== id || !slot || !['ready', 'running'].includes(slot.phase)) throw new Error('matrix-preview-unavailable')
    return active.children.get(slotId)!.request('preview', slot.storeId, {}, 10_000)
  }
  async authorizedCells(id: string, currentProject: ProjectSnapshot) {
    const state = await this.status(id)
    if (state.projectDigest !== matrixHash(currentProject) || matrixHash(await this.registry()) !== state.registryDigest) throw new Error('matrix-project-version-unavailable')
    const frozen = await readAcceptance(join(this.#path(id), 'input.json'), snapshotSchema)
    if (matrixHash({ registry: frozen.registry, project: frozen.project, cells: frozen.cells, artifacts: frozen.artifacts }) !== state.inputDigest) throw new Error('matrix-snapshot-integrity')
    return (frozen.cells as MatrixCell[]).map(c => ({ ...c, header: inspectFlowHeader(currentProject.flows[c.flow]!) }))
  }
  async retry(id: string, cellId: string, confirm: string) {
    if (this.#active || this.#starting || this.#closed || confirm !== `RETRY ${id} ${cellId}`) throw new Error('matrix-retry-confirmation-or-busy')
    this.#starting = true
    let startFinished!: () => void
    this.#startIdle = new Promise(resolve => { startFinished = resolve })
    try {
      const state = await this.status(id)
      if (state.phase !== 'finished' || state.error === 'matrix-terminal-persistence-failed') throw new Error('matrix-prior-cleanup-unconfirmed')
      const frozen = await readAcceptance(join(this.#path(id), 'input.json'), snapshotSchema), registry = frozen.registry, project = frozen.project as ProjectSnapshot
      const cells = registry.plans[state.planId]!.cells, cell = cells.find(c => c.id === cellId), record = state.cells.find(c => c.id === cellId)
      if (!cell || !record || !cell.fixture.reset || !project.flows[cell.fixture.reset] || record.attempts.length >= 10) throw new Error('matrix-safe-reset-required')
      if (matrixHash({ registry, project, cells: frozen.cells, artifacts: frozen.artifacts }) !== state.inputDigest || matrixHash(project) !== state.projectDigest) throw new Error('matrix-snapshot-integrity')
      // Current registration must still explicitly authorize the frozen execution.
      if (matrixHash(await this.registry()) !== state.registryDigest) throw new Error('matrix-registry-changed')
      const slot = state.slots.find(s => s.id === cell.slotId)!
      if (slot.phase !== 'closed' && !slot.cleanupConfirmed) throw new Error('matrix-prior-cleanup-unconfirmed')
      record.attempts.push({ id: randomUUID(), storeId: slot.storeId, phase: 'queued', status: 'pending' })
      state.revision++; state.generation = randomUUID(); state.phase = 'accepted'; delete state.completedAt; delete state.exitCode; delete state.error
      slot.generation = randomUUID(); slot.phase = 'preparing'; slot.cleanupConfirmed = false
      const release = await this.store.reserveEvidence(`matrix-retry:${id}:${state.revision}`, 192 * 1024 * 1024)
      try {
        await this.#save(state)
        if (this.#closed) throw new Error('matrix-closed')
        const frozenCell = (frozen.cells as MatrixCell[]).find(c => c.id === cell.id)!
        const active: ActiveMatrix = { state, registry, project, cells: [structuredClone(frozenCell)], artifacts: frozen.artifacts, children: new Map(), cancelled: new Set(), done: Promise.resolve(), locked: new Set(), poisoned: new Set() }
        this.#active = active; active.done = this.#execute(active, true).finally(() => { release(); if (this.#active === active) this.#active = undefined })
        void active.done.catch(() => {})
        return structuredClone(state)
      } catch (error) { release(); throw error }
    } finally { this.#starting = false; startFinished() }
  }
  async wait() { await this.#active?.done }
  async close() { this.#closed = true; await this.#startIdle; if (this.#active) { await this.cancel(this.#active.state.id); await this.wait() } }
}
