import { z } from 'zod'
import { LocalDeviceRuntime } from './local-device-runtime.js'
import { DeviceOwnerClaim, type DeviceOwnerLease } from './device-owner-claim.js'
import { resolveMirrorConfig } from './mcp-config.js'
import { matrixCellSchema, matrixMessageSchema, matrixSlotSchema, matrixHash, type MatrixMessage } from './device-matrix-contracts.js'
import { WorkbenchReferences } from './workbench-references.js'
import type { ProjectSnapshot } from './workbench-project.js'
import { compilePlan } from './workbench-plan.js'
import { runResultProjection } from './workbench-contracts.js'
import { randomUUID } from 'node:crypto'

let binding: Pick<MatrixMessage, 'matrixId' | 'slotId' | 'generation'> | undefined, sequence = 0
let runtime: LocalDeviceRuntime | undefined, lease: DeviceOwnerLease | undefined, slot: z.infer<typeof matrixSlotSchema> | undefined
let project: ProjectSnapshot | undefined, work: Promise<unknown> | undefined, currentAttempt: string | undefined, connected = false, closing = false
const cancelled = new Set<string>()
const preparedSchema = z.object({ root: z.string(), slot: matrixSlotSchema, project: z.unknown(), projectDigest: z.string(), cells: z.array(matrixCellSchema), retry: z.boolean() }).strict()
function reply(message: MatrixMessage, payload: unknown, ok = true) {
  if (!process.connected) return
  const data = { ...message, payload: { ok, value: payload } }
  if (Buffer.byteLength(JSON.stringify(data)) > 8 * 1024 * 1024) process.send?.({ ...message, payload: { ok: false, value: 'matrix-reply-budget' } })
  else process.send?.(data)
}
async function close() {
  if (closing) return
  closing = true
  if (runtime?.application.workbench.activeId) await runtime.application.workbench.cancel(runtime.application.workbench.activeId)
  await work?.catch(() => {})
  await runtime?.close()
  if (!connected || slot?.provider === 'mock') await lease?.release()
}
async function run(message: MatrixMessage) {
  const input = z.object({ cell: matrixCellSchema, parentRunId: z.string().uuid().optional(), reset: z.boolean() }).strict().parse(message.payload)
  if (!runtime || !project || !slot || input.cell.slotId !== slot.id) throw new Error('matrix-not-prepared')
  const wb = runtime.application.workbench, flow = project.flows[input.cell.flow]
  if (!flow) throw new Error('matrix-flow-missing')
  if (cancelled.has(message.attemptId)) throw new Error('matrix-cancelled')
  if (input.reset) {
    const reset = input.cell.fixture.reset && project.flows[input.cell.fixture.reset]
    if (!reset) throw new Error('matrix-reset-missing')
    let dispatch!: () => void
    const gate = new Promise<void>(resolve => { dispatch = resolve })
    let resetRun
    try {
      resetRun = await wb.start(reset, undefined, undefined, { project, executeGate: gate })
      if (cancelled.has(message.attemptId) || closing) await wb.cancel(resetRun.id)
    } finally { dispatch() }
    await wb.wait()
    const completed = await wb.get(resetRun.id)
    if (completed.verdict !== 'pass' || completed.cleanup !== 'session-retained' || completed.resourceCleanup === 'failed') throw new Error('matrix-reset-unconfirmed')
  }
  if (cancelled.has(message.attemptId) || closing) throw new Error('matrix-cancelled')
  let dispatch!: () => void
  const gate = new Promise<void>(resolve => { dispatch = resolve })
  let started
  try {
    started = await wb.start(flow, input.parentRunId, undefined, { project, params: input.cell.params, id: message.attemptId, flowId: input.cell.flow, comparisonKey: input.cell.flow, executeGate: gate })
    if (cancelled.has(message.attemptId) || closing) await wb.cancel(started.id)
  } finally { dispatch() }
  await wb.wait()
  const completed = await wb.get(started.id), snapshot = await wb.store.readOnlySnapshot(started.id)
  const reference = await new WorkbenchReferences(wb.store).publish({ contractVersion: 3, refId: randomUUID(), consumerKind: 'matrix:attempt', consumerId: `${message.matrixId}:${message.attemptId}`, targetRunId: started.id,
    sourceHash: snapshot.manifestSha256, evidenceRefs: [], createdAt: new Date().toISOString() })
  return { run: completed, manifestSha256: snapshot.manifestSha256, referenceId: reference.refId,
    projection: runResultProjection(completed, completed.resultProjection?.verification.evidence.status === 'pass' ? 'verified' : 'unavailable'),
    quarantined: completed.dispatches?.some(d => d.state === 'unknown') || completed.cleanup !== 'session-retained' || completed.diagnostics?.some(d => d.domain === 'device-driver' && completed.verdict === 'inconclusive') || false }
}
process.on('message', value => {
  let message: MatrixMessage
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) return
    message = matrixMessageSchema.parse(value)
    if (!binding) { if (message.operation !== 'prepare') return; binding = { matrixId: message.matrixId, slotId: message.slotId, generation: message.generation } }
    if (message.matrixId !== binding.matrixId || message.slotId !== binding.slotId || message.generation !== binding.generation || message.sequence <= sequence) return
    sequence = message.sequence
    if (closing && message.operation !== 'close') return
  } catch { return }
  const handle = async () => {
    if (message.operation === 'prepare') {
      if (runtime) throw new Error('matrix-already-prepared')
      const input = preparedSchema.parse(message.payload); slot = input.slot
      if (slot.id !== message.slotId || matrixHash(input.project) !== input.projectDigest) throw new Error('matrix-prepare-identity')
      project = input.project as ProjectSnapshot
      // Compile all cells and reset paths before any device session is created.
      for (const cell of input.cells) {
        const flow = project.flows[cell.flow]; if (!flow) throw new Error('matrix-flow-missing')
        const plan = await compilePlan(flow, project, cell.params)
        if (plan.header.platform !== slot.platform) throw new Error('matrix-platform-mismatch')
        if (input.retry) { const reset = cell.fixture.reset && project.flows[cell.fixture.reset]; if (!reset) throw new Error('matrix-reset-missing'); await compilePlan(reset, project) }
      }
      lease = await new DeviceOwnerClaim().acquire(slot.platform, slot.udid)
      let handed = false
      const config = resolveMirrorConfig({ ...slot.config, viewerHost: '127.0.0.1', viewerPort: 0, viewerMediaMode: 'polling', agentTestControl: { enabled: false, projectPath: '', allowedFlows: [], allowedSuites: [], allowedPlatforms: [], allowedAppIds: [], sharedEvidence: [] } })
      runtime = new LocalDeviceRuntime(config, { workbenchRoot: input.root, deviceClaim: { acquire: async (platform, udid) => {
        if (handed || platform !== slot!.platform || udid !== slot!.udid || !lease) throw new Error('matrix-claim-identity')
        handed = true; return lease
      } } })
      await runtime.application.workbench.store.init()
      return { prepared: true, pid: process.pid }
    }
    if (!runtime || !slot || !project) throw new Error('matrix-not-prepared')
    if (message.operation === 'connect') {
      if (connected) throw new Error('matrix-already-connected')
      const capabilities = { ...slot.capabilities, platformName: slot.platform === 'ios' ? 'iOS' : 'Android', 'appium:udid': slot.udid,
        ...(slot.platform === 'ios' ? { 'appium:wdaLocalPort': slot.ports.driver, 'appium:derivedDataPath': slot.derivedDataPath } : { 'appium:systemPort': slot.ports.driver }),
        'appium:mjpegServerPort': slot.ports.mjpeg, ...(slot.ports.webview ? { 'appium:webviewDevtoolsPort': slot.ports.webview } : {}) }
      await runtime.service.start({ provider: slot.provider, capabilities }); connected = true
      if (slot.provider === 'mock') await lease!.markActive()
      return { connected: true }
    }
    if (message.operation === 'run') {
      if (work || !connected) throw new Error('matrix-slot-busy')
      currentAttempt = message.attemptId; work = run(message)
      try { return await work } finally { work = undefined; currentAttempt = undefined }
    }
    if (message.operation === 'cancel') {
      if (work && message.attemptId !== currentAttempt) throw new Error('matrix-attempt-mismatch')
      cancelled.add(message.attemptId)
      if (runtime.application.workbench.activeId) await runtime.application.workbench.cancel(runtime.application.workbench.activeId)
      await work?.catch(() => {})
      return { cancelled: true }
    }
    if (message.operation === 'read') {
      const { runId } = z.object({ runId: z.string().uuid() }).strict().parse(message.payload)
      const release = await runtime.application.workbench.store.lease([runId])
      try { return { ...(await runtime.application.workbench.store.readOnlySnapshot(runId)), run: await runtime.application.workbench.get(runId), references: (await new WorkbenchReferences(runtime.application.workbench.store).list()).filter(r => r.targetRunId === runId) } } finally { release() }
    }
    if (message.operation === 'preview') {
      const frame = await runtime.service.frame(); if (frame.bytes.length > 4 * 1024 * 1024) throw new Error('matrix-frame-budget')
      return { contentType: frame.contentType, base64: Buffer.from(frame.bytes).toString('base64') }
    }
    await close(); return { closed: true }
  }
  void handle().then(value => { reply(message, value); if (message.operation === 'close') process.disconnect?.() }, () => reply(message, 'matrix-child-operation-failed', false))
})
process.once('disconnect', () => { void close().finally(() => { process.exitCode = 0 }) })
process.once('SIGTERM', () => { void close().finally(() => { process.exitCode = 0; process.disconnect?.() }) })
