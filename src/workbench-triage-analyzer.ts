import { runOwnedWorker, WorkerExitError, WorkerTimeoutError, WorkerTerminationError, type WorkerFactory } from './workbench-worker-lifecycle.js'
import { createHash } from 'node:crypto'
import type { TestRun } from './workbench-domain.js'
import { runResultProjection } from './workbench-contracts.js'
import { triageAnalysisSchema, triageAnalyzerIdentitySchema, type TriageReport } from './workbench-triage-contracts.js'
import type { TriageAnalysis, TriageComparisonContext } from './workbench-triage-rules.js'

export type AnalyzerIdentity = NonNullable<TriageReport['analyzer']>

/** Trusted application configuration, never tool/HTTP/YAML input. Workers are NOT a sandbox. */
export interface TriageAnalyzer {
  readonly id: string
  readonly version: string
  readonly moduleUrl: URL
  readonly config?: Readonly<Record<string, unknown>>
  readonly timeoutMs?: number
}
export function defaultTriageAnalyzer(): TriageAnalyzer {
  return { id: 'builtin.evidence-rules', version: '1', moduleUrl: new URL(import.meta.url.endsWith('.ts') ? './workbench-triage-rules.ts' : './triage-rules.js', import.meta.url) }
}


/** One frozen selection per application. It has no store, device, transport or model service. */
export class TriageAnalyzerRunner {
  readonly identity: Readonly<AnalyzerIdentity>
  readonly #moduleUrl: string
  readonly #config: Record<string, unknown>
  readonly #timeoutMs: number

  constructor(analyzer: TriageAnalyzer, private readonly createWorker?: WorkerFactory) {
    const url = new URL(analyzer.moduleUrl)
    if (url.protocol !== 'file:') throw new TypeError('Analyzer must be an explicit local file URL')
    this.#moduleUrl = url.href
    const config = JSON.stringify(analyzer.config ?? {})
    if (Buffer.byteLength(config) > 16 * 1024) throw new TypeError('Analyzer configuration exceeds budget')
    this.#config = JSON.parse(config)
    this.#timeoutMs = analyzer.timeoutMs ?? 10_000
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 10_000) throw new TypeError('Invalid analyzer timeout')
    this.identity = Object.freeze(triageAnalyzerIdentitySchema.parse({ id: analyzer.id, version: analyzer.version,
      configDigest: createHash('sha256').update(config).digest('hex') }))
  }

  async analyze(input: { run: TestRun; comparison?: TriageComparisonContext; locatorEvidence: string[]; manifestSha256: string }, signal: AbortSignal, remainingMs: number): Promise<TriageAnalysis> {
    const analysis = await runOwnedWorker(new URL('../scripts/workbench-triage-worker.mjs', import.meta.url), {
      workerData: { ...input, moduleUrl: this.#moduleUrl, config: this.#config },
      execArgv: this.#moduleUrl.endsWith('.ts') ? ['--import', 'tsx'] : [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    }, reply => {
      if (!reply || typeof reply !== 'object' || !('ok' in reply) || reply.ok !== true || !('analysis' in reply)) throw new Error('analysis-failed')
      return reply.analysis
    }, signal, Math.max(1, Math.min(remainingMs, this.#timeoutMs)), 'Analyzer', this.createWorker).catch(error => {
      if (signal.aborted) throw new Error('cancelled', { cause: error })
      if (error instanceof WorkerTimeoutError) throw new Error('analysis-timeout', { cause: error })
      if (error instanceof WorkerExitError || error instanceof WorkerTerminationError) throw new Error('analysis-interrupted', { cause: error })
      throw new Error('analysis-failed', { cause: error })
    })
    try {
      const value = triageAnalysisSchema.parse(analysis)
      const known = new Set([...input.run.evidence, ...input.run.steps.flatMap(step => step.evidence)].map(file => file.name))
      const ids = new Set(value.facts.map(fact => fact.id))
      if (ids.size !== value.facts.length || value.facts.some(fact => fact.evidenceRefs.some(ref => !known.has(ref)))
        || value.routes.some(route => [...route.supportFactIds, ...route.counterFactIds].some(id => !ids.has(id)))) throw new Error('Invalid analyzer references')
      const projection = runResultProjection(input.run, input.run.share ? 'not-checked' : 'verified')
      // Extensions can suggest routes, never author execution facts or verdicts.
      delete value.reportedVerdict; delete value.effectiveVerdict
      if (projection.reportedVerdict) value.reportedVerdict = projection.reportedVerdict
      if (projection.verdict) value.effectiveVerdict = projection.verdict
      value.verification = { ui: projection.verification.ui.status, business: projection.verification.business.status,
        visual: projection.verification.visual.status, cleanup: projection.verification.cleanup.status, evidence: projection.verification.evidence.status }

      return value
    } catch { throw new Error('invalid-analysis') }
  }
}
