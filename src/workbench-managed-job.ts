import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { LocalDeviceRuntime } from './local-device-runtime.js'
import { loadStandaloneMcpConfig } from './mcp-config.js'
import { productTaskStatusSchema, type ProductTaskStatus, type RunResultProjection } from './workbench-contracts.js'
import { junitReport, type SuiteRun } from './workbench-suites.js'
import type { StartMirrorInput } from './types.js'

const MAX_LOCAL_INPUT_BYTES = 64 * 1024
const budgetSchema = z.object({
  startupMs: z.number().int().min(1_000).max(300_000).default(120_000),
  totalMs: z.number().int().min(1_000).max(86_400_000).default(3_600_000),
  shutdownMs: z.number().int().min(1_000).max(120_000).default(30_000),
  pollMs: z.number().int().min(50).max(5_000).default(250),
}).strict()

const connectionSchema = z.object({
  provider: z.enum(['mock', 'appium']),
  sessionId: z.string().min(1).max(512).optional(),
  capabilities: z.record(z.string().min(1).max(128), z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  if (value.provider === 'mock' && (value.sessionId || value.capabilities)) context.addIssue({ code: 'custom', message: 'Mock managed jobs do not accept session or capabilities' })
  if (value.provider === 'appium' && Boolean(value.sessionId) === Boolean(value.capabilities)) context.addIssue({ code: 'custom', message: 'Appium managed jobs require exactly one of sessionId or capabilities' })
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_LOCAL_INPUT_BYTES) context.addIssue({ code: 'custom', message: 'Connection input exceeds 64 KiB' })
})

export interface ManagedJobOptions {
  suiteId: string
  configPath: string
  connectionPath: string
  reportDir: string
  tags?: string[]
  platform?: 'android' | 'ios'
  budgets?: Partial<z.input<typeof budgetSchema>>
  signal?: AbortSignal
}

export interface ManagedJobError {
  phase: 'preflight' | 'startup' | 'execution' | 'report' | 'shutdown'
  message: string
}

export interface ManagedJobRecord {
  schemaVersion: 1
  id: string
  registeredSuite: string
  phase: 'finished'
  startedAt: string
  endedAt: string
  recording: 'not-performed'
  suite: null | {
    id: string
    exitCode: number | null
    error?: string
    cases: Array<{ id: string; flow: string; rowId: string; status: string; attempts: string[]; resultProjections?: RunResultProjection[] }>
  }
  suiteExitCode: number | null
  jobExitCode: 0 | 1 | 2 | 130
  errors: ManagedJobError[]
  task: ProductTaskStatus
}

export interface ManagedJobDependencies {
  createRuntime?: (config: Awaited<ReturnType<typeof loadStandaloneMcpConfig>>['mirror'], workbenchRoot: string) => LocalDeviceRuntime
  writeReports?: (directory: string, record: ManagedJobRecord, junit: string) => Promise<void>
  now?: () => Date
}

export async function runManagedWorkbenchJob(options: ManagedJobOptions, dependencies: ManagedJobDependencies = {}): Promise<ManagedJobRecord> {
  validateManagedOptions(options)
  const budgets = budgetSchema.parse(options.budgets ?? {})
  const now = dependencies.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const id = randomUUID()
  const errors: ManagedJobError[] = []
  let runtime: LocalDeviceRuntime | null = null
  let executionId: string | null = null
  let suite: SuiteRun | null = null
  let suiteExitCode: number | null = null
  let userCancelled = false
  let timedOut = false
  let reportFailed = false
  let shutdownFailed = false
  const cancellation = new AbortController()
  const userAbort = () => { userCancelled = true; cancellation.abort(options.signal?.reason ?? new Error('Managed job cancelled')) }
  options.signal?.addEventListener('abort', userAbort, { once: true })
  if (options.signal?.aborted) userAbort()
  const totalTimer = setTimeout(() => { timedOut = true; cancellation.abort(new Error('Managed job total timeout exceeded')) }, budgets.totalMs)

  try {
    const [loaded, connection] = await Promise.all([
      loadStandaloneMcpConfig(options.configPath),
      readConnection(options.connectionPath),
    ])
    const policy = loaded.mirror.agentTestControl
    if (!policy?.enabled || !policy.allowedSuites.includes(options.suiteId)) throw new Error('Managed job suite is not enabled by trusted local policy')
    if (loaded.mirror.viewerHost !== '127.0.0.1' && loaded.mirror.viewerHost !== 'localhost' && loaded.mirror.viewerHost !== '::1') throw new Error('Managed job runtime must bind to loopback')
    await prepareReportRoot(options.reportDir)
    const workbenchRoot = join(options.reportDir, 'runs')
    runtime = dependencies.createRuntime?.(loaded.mirror, workbenchRoot) ?? new LocalDeviceRuntime(loaded.mirror, { workbenchRoot })
    await within(runtime.listen(), budgets.startupMs, 'Managed job runtime startup timed out', cancellation.signal)
    await within(runtime.service.start(connection, cancellation.signal), budgets.startupMs, 'Managed job device startup timed out', cancellation.signal)
    const catalog = await runtime.coordinator.catalog({ kind: 'suite', limit: 50 }) as { catalogRevision: string; items: Array<{ id: string }> }
    if (!catalog.items.some((entry) => entry.id === options.suiteId)) throw new Error('Managed job suite is not present in the authorized catalog')
    const accepted = await runtime.coordinator.start({
      requestId: `managed-job-${id}`,
      target: { kind: 'suite', id: options.suiteId },
      catalogRevision: catalog.catalogRevision,
      ...(options.tags ? { tags: options.tags } : {}),
      ...(options.platform ? { platform: options.platform } : {}),
    }, cancellation.signal) as { executionId: string }
    executionId = accepted.executionId
    const status = await waitForExecution(runtime, executionId, budgets, cancellation.signal)
    if (status.suiteId) suite = await runtime.coordinator.suites.get(String(status.suiteId))
    suiteExitCode = suite?.exitCode ?? numericExitCode(status.exitCode)
  } catch (error) {
    const phase: ManagedJobError['phase'] = runtime ? executionId ? 'execution' : 'startup' : 'preflight'
    errors.push({ phase, message: errorMessage(error) })
    if (runtime && executionId && cancellation.signal.aborted) {
      try {
        let status = await runtime.coordinator.status({ executionId }) as Record<string, unknown>
        if (status.phase !== 'finished') {
          await within(runtime.coordinator.cancel(executionId), budgets.shutdownMs, 'Managed job cancellation timed out')
          status = await waitForFinishedAfterCancel(runtime, executionId, budgets)
        }
        if (status.suiteId) suite = await runtime.coordinator.suites.get(String(status.suiteId))
        suiteExitCode = suite?.exitCode ?? numericExitCode(status.exitCode)
      } catch (cancelError) {
        errors.push({ phase: 'shutdown', message: errorMessage(cancelError) })
        shutdownFailed = true
      }
    }
  } finally {
    clearTimeout(totalTimer)
    options.signal?.removeEventListener('abort', userAbort)
    if (runtime) {
      try { await within(runtime.close(), budgets.shutdownMs, 'Managed job runtime shutdown timed out') }
      catch (error) { errors.push({ phase: 'shutdown', message: errorMessage(error) }); shutdownFailed = true }
    }
  }

  let jobExitCode: ManagedJobRecord['jobExitCode'] = shutdownFailed || timedOut || suiteExitCode === 2
    ? 2
    : userCancelled || suiteExitCode === 130 ? 130
      : suiteExitCode === null ? 2
      : suiteExitCode === 0 ? 0 : 1
  const endedAt = now().toISOString()
  const suiteSummary = suite ? {
    id: suite.id,
    exitCode: suite.exitCode ?? null,
    ...(suite.error ? { error: suite.error } : {}),
    cases: suite.cases.map((entry) => ({ id: entry.id, flow: entry.flow, rowId: entry.rowId, status: entry.status, attempts: [...entry.attempts],
      ...(entry.resultProjections ? { resultProjections: entry.resultProjections } : {}) })),
  } : null
  const buildRecord = (): ManagedJobRecord => ({
    schemaVersion: 1,
    id,
    registeredSuite: options.suiteId,
    phase: 'finished',
    startedAt,
    endedAt,
    recording: 'not-performed',
    suite: suiteSummary,
    suiteExitCode,
    jobExitCode,
    errors: [...errors],
    task: productTaskStatusSchema.parse({
      contractVersion: 1,
      taskId: `managed-job:${id}`,
      kind: 'suite-run',
      phase: 'finished',
      acceptedAt: startedAt,
      startedAt,
      endedAt,
      cancelRequested: userCancelled || timedOut,
      progress: { stage: 'finished', completed: suiteSummary?.cases.length ?? 0, total: suiteSummary?.cases.length ?? 0 },
      result: { exitCode: jobExitCode },
    }),
  })
  try {
    await (dependencies.writeReports ?? writeManagedJobReports)(options.reportDir, buildRecord(), suite ? junitReport(suite) : infrastructureJunit(options.suiteId, errors))
  } catch (error) {
    reportFailed = true
    errors.push({ phase: 'report', message: errorMessage(error) })
  }
  if (reportFailed) jobExitCode = 2
  return buildRecord()
}

async function waitForExecution(runtime: LocalDeviceRuntime, executionId: string, budgets: z.output<typeof budgetSchema>, signal: AbortSignal): Promise<Record<string, unknown>> {
  while (true) {
    if (signal.aborted) throw signal.reason
    const status = await runtime.coordinator.status({ executionId }) as Record<string, unknown>
    if (status.phase === 'finished') return status
    await delay(budgets.pollMs, signal)
  }
}

async function waitForFinishedAfterCancel(runtime: LocalDeviceRuntime, executionId: string, budgets: z.output<typeof budgetSchema>): Promise<Record<string, unknown>> {
  const deadline = Date.now() + budgets.shutdownMs
  while (Date.now() < deadline) {
    const status = await runtime.coordinator.status({ executionId }) as Record<string, unknown>
    if (status.phase === 'finished') return status
    await delay(Math.min(budgets.pollMs, Math.max(1, deadline - Date.now())))
  }
  throw new Error('Managed job cancellation did not finish within the shutdown budget')
}

async function readConnection(path: string): Promise<StartMirrorInput> {
  if (!isAbsolute(path)) throw new Error('Managed job connection path must be absolute')
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_LOCAL_INPUT_BYTES) throw new Error('Invalid managed job connection file')
    return connectionSchema.parse(JSON.parse(await handle.readFile('utf8'))) as StartMirrorInput
  } finally { await handle.close() }
}

async function writeManagedJobReports(directory: string, record: ManagedJobRecord, junit: string): Promise<void> {
  await prepareReportRoot(directory)
  await atomicWrite(join(directory, `${record.id}.job.json`), `${JSON.stringify(record, null, 2)}\n`)
  await atomicWrite(join(directory, `${record.id}.junit.xml`), junit)
}

async function prepareReportRoot(directory: string): Promise<void> {
  if (!isAbsolute(directory)) throw new Error('Managed job report directory must be absolute')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid managed job report directory')
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporary = `${path}-${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try { await handle.writeFile(value); await handle.sync() } finally { await handle.close() }
  await rename(temporary, path)
}

function validateManagedOptions(options: ManagedJobOptions): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(options.suiteId)) throw new Error('Invalid managed job suite id')
  for (const [name, value] of [['config', options.configPath], ['connection', options.connectionPath], ['report', options.reportDir]] as const) {
    if (!isAbsolute(value)) throw new Error(`Managed job ${name} path must be absolute`)
  }
  if (options.tags && (options.tags.length > 32 || options.tags.some((tag) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(tag)))) throw new Error('Invalid managed job tags')
}

function numericExitCode(value: unknown): number | null {
  return typeof value === 'number' && [0, 1, 2, 130].includes(value) ? value : null
}

function infrastructureJunit(suiteId: string, errors: ManagedJobError[]): string {
  const escape = (value: string) => value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]!)
  const message = errors.map((entry) => `${entry.phase}: ${entry.message}`).join('; ') || 'Managed job did not produce a suite result'
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="${escape(suiteId)}" tests="1" failures="0" errors="1"><testcase name="managed-job"><error message="${escape(message)}"/></testcase></testsuite>`
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512)
}

async function within<T>(promise: Promise<T>, timeoutMs: number, message: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  if (combined.aborted) throw signal?.aborted ? signal.reason : new Error(message)
  return await Promise.race([promise, new Promise<T>((_resolve, reject) => combined.addEventListener('abort', () => reject(signal?.aborted ? signal.reason : new Error(message)), { once: true }))])
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
