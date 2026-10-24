import { runResultProjection } from './workbench-contracts.js'
import type { RunStep, TestRun } from './workbench-domain.js'
import { isWebRun, type WorkbenchRun, type WebTestRun } from './workbench-web-contracts.js'

export type ReportLocale = 'zh-CN' | 'en'
const labels: Record<string, [string, string]> = {
  pass: ['通过', 'Passed'], passed: ['步骤通过', 'Step passed'], fail: ['失败', 'Failed'], failed: ['步骤失败', 'Step failed'],
  recovered: ['恢复后通过', 'Recovered'], cancelled: ['已取消', 'Cancelled'], interrupted: ['已中断', 'Interrupted'],
  inconclusive: ['未确定', 'Inconclusive'], running: ['运行中', 'Running'], cancelling: ['正在取消', 'Cancelling'], finalizing: ['封存中', 'Finalizing'],
  'not-performed': ['未执行', 'Not performed'], 'not-checked': ['尚未检查材料', 'Materials not checked'],
  verified: ['材料完整性校验通过', 'Material integrity checked'], unavailable: ['材料不可用，原结果保留', 'Materials unavailable; original result retained'],
  'not-revalidated': ['派生材料未重新验证', 'Derived materials not revalidated'],
  'evidence-conflict': ['证据冲突', 'Evidence conflict'], 'evidence-contaminated': ['证据受污染', 'Evidence contaminated'],
  tap: ['点击', 'Tap'], type: ['输入文字', 'Type text'], assert: ['检查预期', 'Check expectation'], assertVisible: ['检查可见', 'Check visible'],
  assertNotVisible: ['检查不可见', 'Check not visible'], wait: ['等待', 'Wait'], launchApp: ['打开应用', 'Launch app'],
  derived: ['派生副本', 'Derived copy'], viewer: ['本机运行', 'Local run'], agent: ['Agent 运行', 'Agent run'], import: ['导入', 'Imported'], mock: ['Mock 演示', 'Mock demo'],
  health: ['健康检查', 'Health'], performance: ['性能检查', 'Performance'], ui: ['界面', 'UI'], business: ['业务', 'Business'],
  visual: ['视觉', 'Visual'], cleanup: ['资源清理', 'Cleanup'], evidence: ['证据', 'Evidence'], unknown: ['未知', 'Unknown'],
}
export function reportLabel(value: string | undefined, locale: ReportLocale = 'en'): string {
  const key = value ?? 'unknown'
  return labels[key]?.[locale === 'zh-CN' ? 0 : 1] ?? (locale === 'zh-CN' ? `未支持的结果项：${key}` : `Unsupported value: ${key}`)
}
export function isFailedReportStep(step: RunStep): boolean {
  return step.status === 'failed' || Boolean(step.checkpointError) || Boolean(step.verification && step.verification.status !== 'pass')
    || [step.temporal?.result, step.business, step.visual, step.ocr].some(value => value && value.status !== 'pass')
}
export function reportStepTitle(step: RunStep, locale: ReportLocale = 'en'): string {
  return `${step.index}. ${labels[step.kind]?.[locale === 'zh-CN' ? 0 : 1] ?? step.kind}`
}
export function reportStepObservation(step: RunStep): string {
  return (step.verification?.message ?? step.error ?? step.checkpointError ?? step.temporal?.result.reason ?? step.business?.reason ?? step.visual?.message ?? step.ocr?.reason ?? step.message ?? step.status).slice(0, 8192)
}
export function reportDetail(run: TestRun) {
  const projection = run.resultProjection ?? runResultProjection(run)
  const failures = run.steps.filter(isFailedReportStep)
  const dimensions = Object.entries(projection.verification).filter(([key]) => key !== 'contractVersion').map(([kind, value]) => ({ kind, ...value }))
  const runtimeDeclared = run.productContract?.contractVersion === 2
  return { projection, failures, dimensions, runtimeDeclared,
    runChecks: dimensions.filter(item => item.required && item.status !== 'pass'),
    measurements: run.measurements ?? [], health: run.health ?? null }
}
export function reportSummary(run: TestRun) {
  const detail = reportDetail(run), failed = detail.failures[0]
  const unreadable = run.recovery?.reason === 'Manifest unavailable' || run.name === 'Interrupted / unreadable run'
  const status = run.phase !== 'finished' ? run.phase : run.recovery && run.verdict === 'inconclusive' ? 'interrupted' : run.verdict ?? 'inconclusive'
  const start = Date.parse(run.startedAt), end = Date.parse(run.endedAt ?? '')
  return { id: run.id, name: typeof run.name === 'string' ? run.name.slice(0, 200) : 'Unknown run', status,
    recordedVerdict: detail.projection.reportedVerdict, currentVerdict: detail.projection.verdict,
    platform: run.platform, deviceName: run.deviceName?.slice(0, 160) ?? 'unknown', provider: run.provider,
    source: run.share ? 'derived' : run.source ?? 'viewer', startedAt: run.startedAt, endedAt: run.endedAt,
    durationMs: Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null,
    build: run.comparison?.appContext.build ?? 'unknown', appId: run.comparison?.appContext.appId ?? 'unknown',
    caseId: run.authoringOrigin?.caseId ?? null, revisionId: run.authoringOrigin?.revisionId ?? null,
    suiteId: run.suiteId ?? null, suiteCaseId: run.caseId ?? null, attempt: run.attempt ?? null,
    inputDigest: run.comparison?.inputDigest ?? run.authoringOrigin?.inputDigest ?? null,
    failureCount: detail.failures.length, firstFailure: failed ? { index: failed.index, kind: failed.kind, observation: reportStepObservation(failed).slice(0, 512) } : null,
    runChecks: detail.runChecks.map(({ kind, status }) => ({ kind, status })),
    evidenceAvailability: detail.projection.evidenceAvailability, readState: detail.projection.readState, runtimeDeclared: detail.runtimeDeclared,
    unreadable: Boolean(unreadable) }
}
function webReportSummary(run: WebTestRun) {
  const failed = run.steps.filter(step => step.status === 'failed')
  return { id: run.id, name: run.name, status: run.phase !== 'finished' ? run.phase : run.recovery ? 'interrupted' : run.verdict ?? 'inconclusive',
    recordedVerdict: run.verdict ?? null, currentVerdict: run.verdict ?? null, executionKind: 'web' as const,
    platform: 'web' as const, deviceName: null, browserName: 'Chrome / agent-browser', provider: 'agent-browser', source: 'viewer',
    startedAt: run.startedAt, endedAt: run.endedAt, durationMs: run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : null,
    build: run.resources.buildSha256 ?? 'not-recorded', appId: null, caseId: run.authoringOrigin.caseId, revisionId: run.authoringOrigin.revisionId,
    suiteId: null, suiteCaseId: null, attempt: null, inputDigest: run.authoringOrigin.inputDigest, failureCount: failed.length,
    firstFailure: failed[0] ? { index: failed[0].index, kind: failed[0].kind, observation: failed[0].error ?? 'Web assertion failed' } : null,
    runChecks: [{ kind: 'visual', status: run.visualReview.status }, { kind: 'independent', status: run.independentCheck }].filter(item=>item.status!=='pass'),
    evidenceAvailability: 'not-checked', readState: 'supported', runtimeDeclared: false, unreadable: false }
}
export type ReportSummary = ReturnType<typeof reportSummary> | ReturnType<typeof webReportSummary>

/** Corrupt metadata remains visible without synthesizing a passing record. */
export function safeReportSummary(run: WorkbenchRun): ReportSummary {
  if (isWebRun(run)) return webReportSummary(run)
  try { return reportSummary(run) }
  catch { return reportSummary({ schemaVersion: 1, id: run.id, name: 'Interrupted / unreadable run', yaml: '', engine: 'unknown', phase: 'finished', verdict: 'inconclusive', startedAt: typeof run.startedAt === 'string' ? run.startedAt : '', sessionId: 'unknown', deviceName: 'unknown', platform: 'unknown', provider: 'unknown', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed', cleanup: 'failed', steps: [], evidence: [] }) }
}
