import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { runResultProjection } from './workbench-contracts.js'
import { analyzeTriage } from './workbench-triage-rules.js'
import { stableJson } from './workbench-comparison.js'
import { validRunId, type WorkbenchStore } from './workbench-store.js'
import type { TestRun } from './workbench-domain.js'

export type InvestigationCheck = 'restore-evidence' | 'check-environment' | 'confirm-page' | 'inspect-locator' | 'check-readiness' | 'verify-business' | 'review-cleanup' | 'review-expectation' | 'reproduce'
const environmentCodes = new Set(['appium_server_unreachable', 'appium_request_timeout', 'appium_session_command_timeout', 'device-disconnected', 'wda-session-failed', 'session-not-created', 'device-command-timeout', 'transport-disconnected', 'model-service-unavailable', 'model-service-timeout'])
const locatorCodes = new Set(['target-not-found', 'ambiguous-target', 'ambiguous-scope', 'readiness-timeout-missing', 'readiness-timeout-scope-missing', 'readiness-target-changed'])
const readyCodes = new Set(['readiness-timeout-hidden', 'readiness-timeout-disabled', 'readiness-timeout-unstable', 'readiness-timeout-unfocused', 'readiness-timeout-still-visible', 'readiness-not-input'])

/** Finite proposals from typed facts only. No free-form error or screen text becomes an instruction. */
export function investigationPlan(run: TestRun, availability: 'verified' | 'unavailable' | 'not-checked', manifestSha256 = '') {
  const imported = run.source === 'import' || Boolean(run.share)
  const projection = runResultProjection(run, imported ? 'unavailable' : availability)
  const analysis = analyzeTriage(run, undefined, [], manifestSha256)
  const incomplete = availability !== 'verified' || imported || projection.readState === 'unsupported' || run.steps.some(step => !step.evidence.some(file => file.name.endsWith('.xml')) || !step.evidence.some(file => file.contentType === 'image/png'))
  const facts = analysis.facts
  const checks: { id: InvestigationCheck; status: 'proposed'; factIds: string[]; evidenceRefs: string[]; interpretationKey: InvestigationCheck }[] = []
  const add = (id: InvestigationCheck, relevant = facts) => {
    if (checks.some(check => check.id === id)) return
    checks.push({ id, status: 'proposed', factIds: relevant.map(f => f.id), evidenceRefs: availability === 'verified' && !imported ? [...new Set(relevant.flatMap(f => f.evidenceRefs))].slice(0, 32) : [], interpretationKey: id })
  }
  if (incomplete) add('restore-evidence')
  else {
    const environment = facts.filter(f => environmentCodes.has(f.code))
    if (environment.length) add('check-environment', environment)
    const locator = facts.filter(f => locatorCodes.has(f.code))
    if (locator.length) { add('confirm-page', locator); add('inspect-locator', locator); add('check-readiness', locator) }
    const readiness = facts.filter(f => readyCodes.has(f.code))
    if (readiness.length) { add('check-readiness', readiness); add('confirm-page', readiness) }
    if (run.businessVerification === 'fail' || run.businessVerification === 'inconclusive') add('verify-business', facts.filter(f => f.domain === 'business-assertion'))
    if (run.resourceCleanup === 'failed' || run.cleanup === 'failed') add('review-cleanup', facts.filter(f => f.domain === 'cleanup'))
    if (facts.some(f => ['ui-assertion', 'visual'].includes(f.domain))) add('review-expectation', facts.filter(f => ['ui-assertion', 'visual'].includes(f.domain)))
    if (!projection.clean) add('reproduce')
  }
  const failed = run.steps.find(step => step.status === 'failed')
  return {
    schemaVersion: 1 as const, runId: run.id, manifestSha256, generatedAt: new Date().toISOString(), projection,
    ...(failed ? { earliestFailure: { index: failed.index, sourceLine: failed.sourceLine ?? null, path: failed.path ?? null, evidenceRefs: availability === 'verified' && !imported ? failed.evidence.map(file => file.name).slice(0, 8) : [] } } : {}),
    facts, checks,
    directions: incomplete ? ['evidence-gap'] : analysis.routes.map(route => route.direction),
    gaps: [...new Set([...analysis.limitations, ...(incomplete ? ['evidence-incomplete'] : []), ...(!run.comparison || Object.values(run.comparison.appContext).includes('unknown') ? ['app-build-unverified'] : [])])],
    boundary: 'proposals-not-performed; no-root-cause-claim; original-run-unchanged' as const,
  }
}

export function validateFollowup(original: TestRun, followup: TestRun): void {
  const app = original.comparison?.appContext.appId
  if (original.phase !== 'finished' || followup.phase !== 'finished' || !original.verdict || !followup.verdict) throw new Error('investigation-run-not-final')
  if (original.source === 'import' || followup.source === 'import' || original.share || followup.share) throw new Error('investigation-import-not-revalidated')
  if (followup.parentRunId !== original.id || followup.id === original.id) throw new Error('investigation-unrelated-followup')
  if (!app || app === 'unknown' || app !== followup.comparison?.appContext.appId || original.platform === 'unknown' || original.platform !== followup.platform) throw new Error('investigation-app-platform-mismatch')
}

/** Shared, local read-only service. Evidence leases prevent retention races; no provider is held. */
export class WorkbenchInvestigation {
  #active = 0
  #closed = false
  #pending = new Set<Promise<unknown>>()
  constructor(readonly store: WorkbenchStore) {}
  stopAccepting() { this.#closed = true }
  async close() { this.stopAccepting(); await Promise.allSettled(this.#pending) }
  async inspect(runId: string, followupRunId?: string, signal?: AbortSignal) {
    if (this.#closed) throw new Error('investigation-closed')
    const pending = this.#inspect(runId, followupRunId, signal); this.#pending.add(pending)
    try { return await pending } finally { this.#pending.delete(pending) }
  }
  async #inspect(runId: string, followupRunId?: string, signal?: AbortSignal) {
    validRunId(runId); if (followupRunId) validRunId(followupRunId)
    if (this.#active >= 2) throw new Error('investigation-busy')
    this.#active++
    let release: (() => void) | undefined
    try {
      release = await this.store.lease([runId, ...(followupRunId ? [followupRunId] : [])])
      const read = async (id: string) => {
        signal?.throwIfAborted()
        const stat = await lstat(join(this.store.root, id, 'manifest.json'))
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('investigation-manifest-budget')
        const { run, manifestSha256 } = await this.store.readOnlySnapshot(id)
        if (run.phase !== 'finished' || !run.verdict) throw new Error('investigation-run-not-final')
        if (run.steps.length > 2000 || (run.diagnostics?.length ?? 0) > 5000) throw new Error('investigation-facts-budget')
        let availability: 'verified' | 'unavailable' | 'not-checked' = 'verified'
        const files = [...run.evidence, ...run.steps.flatMap(step => step.evidence)]
        const total = files.reduce((sum, file) => sum + file.bytes, 0)
        if (!files.length || !run.steps.length || run.steps.some(step => !step.evidence.some(file => file.name.endsWith('.xml')) || !step.evidence.some(file => file.contentType === 'image/png')) || files.length > 5000 || !Number.isSafeInteger(total) || total > 64 * 1024 * 1024 || files.some(file => !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.incomplete || file.recovered || file.lineage?.integrity === 'failed' || file.lineage?.integrity === 'unverified')) availability = 'unavailable'
        else if (run.share || run.source === 'import') availability = 'not-checked'
        else for (const file of files) {
          signal?.throwIfAborted()
          try {
            if (!/^[a-z0-9-]+\.(png|xml|yaml|json|txt|webm|mp4)$/.test(file.name)) throw new Error('evidence-path')
            const stat = await lstat(join(this.store.root, id, file.name))
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes || stat.size > 16 * 1024 * 1024) throw new Error('evidence-budget')
            await this.store.readEvidence(id, file)
          } catch { availability = 'unavailable'; break }
        }
        signal?.throwIfAborted()
        return { run, plan: investigationPlan(run, availability, manifestSha256) }
      }
      const original = await read(runId)
      if (!followupRunId) return { plan: original.plan }
      const next = await read(followupRunId)
      validateFollowup(original.run, next.run)
      return { plan: original.plan, followup: {
        runId: next.run.id, manifestSha256: next.plan.manifestSha256, projection: next.plan.projection,
        yamlChanged: original.run.yaml !== next.run.yaml,
        paramsChanged: stableJson(original.run.params ?? {}) !== stableJson(next.run.params ?? {}),
        environmentChanged: stableJson(original.run.comparison?.executionContext) !== stableJson(next.run.comparison?.executionContext),
        appBuildChanged: stableJson(original.run.comparison?.appContext) !== stableJson(next.run.comparison?.appContext),
        observation: next.plan.projection.clean ? 'followup-clean-not-causal-proof' as const : 'followup-not-clean' as const,
      } }
    } finally { release?.(); this.#active-- }
  }
}
