import { randomUUID, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkbenchStore } from './workbench-store.js'
import type { TestRun } from './workbench-domain.js'
import { evaluateHealthWindow, type HealthBinding, type HealthCapability, type HealthWindow, type HealthReport } from './health-contracts.js'
export * from './health-contracts.js'

/** Raw platform logs never enter public evidence. Journal only binds lifecycle. */
export async function persistHealthJournal(store: WorkbenchStore, run: TestRun, binding: HealthBinding, phase: 'preparing' | 'observing' | 'draining' | 'finished'): Promise<void> {
  const dir = join(store.root, run.id, 'private')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const info = await lstat(dir)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('health-journal-invalid')
  const temporary = join(dir, 'health-' + randomUUID() + '.tmp'), handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, binding, phase })); await handle.sync() } finally { await handle.close() }
  await rename(temporary, join(dir, 'health.json'))
}

export async function persistHealthWindow(store: WorkbenchStore, run: TestRun, payload: { binding: HealthBinding; capability: HealthCapability; window: HealthWindow; operations: string[] }): Promise<string> {
  const bytes = JSON.stringify(payload)
  if (Buffer.byteLength(bytes) > 2 * 1024 * 1024) throw new Error('health-material-budget')
  const path = join(store.root, run.id, 'private', 'health-window.json'), handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  return createHash('sha256').update(bytes).digest('hex')
}

export async function verifyHealthReport(store: WorkbenchStore, run: TestRun, report: HealthReport): Promise<void> {
  if (report.status === 'inconclusive' && !report.windowSha256) return
  const handle = await open(join(store.root, run.id, 'private', 'health-window.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
  let bytes: string
  try { if ((await handle.stat()).size > 2 * 1024 * 1024) throw new Error('health-material-budget'); bytes = await handle.readFile('utf8') } finally { await handle.close() }
  if (createHash('sha256').update(bytes).digest('hex') !== report.windowSha256) throw new Error('health-material-conflict')
  const payload = JSON.parse(bytes)
  if (payload.binding.runId !== run.id || payload.binding.sessionId !== run.sessionId || payload.binding.appId !== run.productContract?.provenance.app.id.value) throw new Error('health-binding-conflict')
  const recalculated = evaluateHealthWindow(payload.capability, report.signals, payload.binding, payload.window, payload.operations)
  if (report.gaps.includes('health-close-failed')) {
    recalculated.coverage = 'incomplete'; recalculated.gaps.push('health-close-failed')
    if (recalculated.status !== 'fail') { recalculated.status = 'inconclusive'; recalculated.reason = 'health-close-failed' }
  }
  if (JSON.stringify({ ...recalculated, windowSha256: report.windowSha256 }) !== JSON.stringify(report)) throw new Error('health-report-conflict')
}
