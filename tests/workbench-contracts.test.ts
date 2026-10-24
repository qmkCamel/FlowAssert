import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  assertRequiredProvenance,
  createRunProvenance,
  createRunVerification,
  evidenceLineageSchema,
  productTaskStatusSchema,
  runProductContractSchema,
  runResultProjection,
  validateProductContractForWrite,
} from '../src/workbench-contracts.js'
import type { TestRun } from '../src/workbench-store.js'

const at = '2026-09-25T00:00:00.000Z'
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`./fixtures/workbench-contracts/${name}.json`, import.meta.url), 'utf8'))

function run(verdict: TestRun['verdict'] = 'pass'): TestRun {
  return {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: 'contract fixture',
    yaml: '',
    engine: 'fixture',
    phase: 'finished',
    verdict,
    startedAt: at,
    endedAt: at,
    sessionId: 'fixture',
    deviceName: 'fixture',
    platform: 'ios',
    provider: 'mock',
    verificationScope: 'declared-ui-assertions',
    visualVerification: 'not-performed',
    businessVerification: 'not-performed',
    steps: [],
    evidence: [],
    cleanup: 'session-retained',
    resourceCleanup: 'pass',
  }
}

describe('versioned workbench product contracts', () => {
  it('keeps observed, declared, and unknown provenance distinct', () => {
    const provenance = createRunProvenance({
      capturedAt: at,
      appId: 'com.example.declared',
      platform: 'ios',
      runtime: '0.8.0-rc.8',
      observed: { appId: 'com.example.observed', appVersion: '1.2.3', os: 'iOS 19.0', provider: 'appium' },
      declared: { appBuild: '42', sourceCommit: 'abcdef1234567', required: [] },
    })

    expect(provenance.app.id).toMatchObject({ source: 'observed', value: 'com.example.observed' })
    expect(provenance.app.version).toMatchObject({ source: 'observed', value: '1.2.3' })
    expect(provenance.app.build).toMatchObject({ source: 'declared', value: '42' })
    expect(provenance.environment.driver).toMatchObject({ source: 'unknown', value: 'unknown' })
    expect(provenance.project.sourceCommit).toMatchObject({ source: 'declared', value: 'abcdef1234567' })
  })

  it('rejects missing strict provenance before execution', async () => {
    const input = await fixture('missing-provenance') as { required: Array<'appVersion' | 'driver'>; observed: { driver: string } }
    const provenance = createRunProvenance({ capturedAt: at, appId: 'com.example', platform: 'ios', runtime: 'rc.8', observed: input.observed })
    expect(() => assertRequiredProvenance(provenance, input.required)).toThrow('appVersion')
  })

  it('rejects path-like public declarations and unknown contract fields', () => {
    expect(() => createRunProvenance({
      capturedAt: at,
      appId: 'com.example',
      platform: 'ios',
      runtime: 'rc.8',
      declared: { backendEnvironment: '/private/project', required: [] },
    })).toThrow()
    expect(() => runProductContractSchema.parse({
      contractVersion: 1,
      summaryRulesVersion: 1,
      provenance: createRunProvenance({ capturedAt: at, appId: 'com.example', platform: 'ios', runtime: 'rc.8' }),
      verification: createRunVerification(false),
      futureField: true,
    })).toThrow()
  })

  it('projects legacy and future manifests safely without rewriting them', async () => {
    const legacyFixture = await fixture('legacy-run')
    const legacy = { ...run('pass'), ...(legacyFixture.productContract ? { productContract: legacyFixture.productContract } : {}) }
    expect(runResultProjection(legacy)).toMatchObject({ readState: 'legacy', clean: true, exitCode: 0 })
    expect(legacy.productContract).toBeUndefined()

    const futureFixture = await fixture('future-run')
    const future = { ...run('inconclusive'), productContract: futureFixture.productContract } as unknown as TestRun
    const projected = runResultProjection(future)
    expect(projected).toMatchObject({ readState: 'unsupported', clean: false, exitCode: 2 })
    expect(JSON.stringify(projected)).not.toContain('futurePrivateField')
    expect(() => validateProductContractForWrite(future)).toThrow()
  })

  it.each([
    ['pass', true, 0],
    ['recovered', false, 1],
    ['fail', false, 1],
    ['evidence-conflict', false, 1],
    ['inconclusive', false, 2],
    ['cancelled', false, 130],
  ] as const)('uses one clean/exit rule for %s', (verdict, clean, exitCode) => {
    expect(runResultProjection(run(verdict))).toMatchObject({ verdict, clean, exitCode })
  })

  it('keeps 100 deliberately non-clean offline samples out of false-pass results', () => {
    const scenarios = ['ui-fail', 'business-fail', 'visual-fail', 'cleanup-fail', 'recovered',
      'evidence-conflict', 'evidence-contaminated', 'inconclusive', 'cancelled', 'missing-evidence'] as const
    let falsePasses = 0
    const observed = new Set<string>()
    for (const [category, scenario] of scenarios.entries()) for (let variant = 0; variant < 10; variant++) {
      const sample = run('pass')
      sample.id = `00000000-0000-4000-8000-${String(category * 10 + variant + 1).padStart(12, '0')}`
      sample.name = `${scenario}-${variant + 1}`
      sample.diagnostics = [{ domain: 'policy', code: scenario, phase: 'finished', retryable: false, observedAt: at, message: scenario, evidenceRefs: [] }]
      let availability: 'verified' | 'unavailable' = 'verified'
      switch (scenario) {
        case 'ui-fail': sample.steps = [{ index: 1, kind: 'assert', status: 'failed', startedAt: at, endedAt: at, evidence: [] }]; break
        case 'business-fail': sample.businessVerification = 'fail'; break
        case 'visual-fail': sample.visualVerification = 'fail'; break
        case 'cleanup-fail': sample.resourceCleanup = 'failed'; break
        case 'recovered': sample.verdict = 'recovered'; break
        case 'evidence-conflict': sample.verdict = 'evidence-conflict'; break
        case 'evidence-contaminated': sample.verdict = 'evidence-contaminated'; break
        case 'inconclusive': sample.verdict = 'inconclusive'; break
        case 'cancelled': sample.verdict = 'cancelled'; break
        case 'missing-evidence': availability = 'unavailable'; break
      }
      const projected = runResultProjection(sample, availability)
      observed.add(sample.id)
      if (projected.clean || projected.exitCode === 0 || projected.verdict === 'pass') falsePasses++
    }
    expect(observed.size).toBe(100)
    expect(falsePasses).toBe(0)
  })

  it('keeps the reported verdict separate from damaged or derived evidence', () => {
    const original = run('pass')
    expect(runResultProjection(original, 'unavailable')).toMatchObject({
      reportedVerdict: 'pass', verdict: 'inconclusive', clean: false, exitCode: 2,
      evidenceAvailability: 'unavailable', verification: { evidence: { status: 'fail' } },
      reasons: [{ code: 'evidence-unavailable' }],
    })
    expect(original.verdict).toBe('pass')
    const derived = { ...run('inconclusive'), share: { shareId: 'share-1', reportedVerdict: 'pass' as const,
      verification: 'not-revalidated' as const, withheld: ['original evidence'] } }
    expect(runResultProjection(derived, 'verified')).toMatchObject({ verdict: 'inconclusive', clean: false,
      evidenceAvailability: 'not-revalidated', sourceReport: { verdict: 'pass', verification: 'not-revalidated' } })
  })

  it.each([
    { label: 'old YAML', verdict: 'pass', visual: 'not-performed', expectedExit: 0 },
    { label: 'visual mismatch', verdict: 'fail', visual: 'fail', expectedExit: 1 },
    { label: 'missing visual evidence', verdict: 'inconclusive', visual: 'inconclusive', expectedExit: 2 },
    { label: 'recovered execution', verdict: 'recovered', visual: 'pass', expectedExit: 1 },
    { label: 'user cancellation', verdict: 'cancelled', visual: 'not-performed', expectedExit: 130 },
    { label: 'evidence conflict', verdict: 'evidence-conflict', visual: 'pass', expectedExit: 1 },
  ] as const)('projects $label without visual success overriding the run verdict', ({ verdict, visual, expectedExit }) => {
    const item = run(verdict)
    item.visualVerification = visual
    item.steps = visual === 'not-performed' ? [] : [{ index: 1, kind: 'assertVisual', status: visual === 'pass' ? 'passed' : 'failed',
      startedAt: at, endedAt: at, evidence: [], visual: { status: visual, message: 'fixture', profile: 'home', revision: 2,
        rulesVersion: 1, referenceSha256: 'a'.repeat(64), comparedPixels: visual === 'pass' ? 1 : 0, differentPixels: 0 } }]
    const projected = runResultProjection(item, 'verified')
    expect(projected).toMatchObject({ reportedVerdict: verdict, verdict, exitCode: expectedExit,
      verification: { visual: { status: visual } } })
    expect(projected.visualBaselines).toEqual(visual === 'not-performed' ? [] : [{ profile: 'home', revision: 2, referenceSha256: 'a'.repeat(64) }])
  })

  it('requires lineage for derived evidence and validates the background task shape', async () => {
    expect(() => evidenceLineageSchema.parse({ contractVersion: 1, kind: 'derived', integrity: 'verified', sharing: 'content' })).toThrow()
    expect(evidenceLineageSchema.parse(await fixture('derived-evidence'))).toMatchObject({ kind: 'derived' })
    expect(productTaskStatusSchema.parse({
      contractVersion: 1,
      taskId: 'test-run:fixture',
      kind: 'test-run',
      phase: 'running',
      acceptedAt: at,
      startedAt: at,
      cancelRequested: false,
      progress: { stage: 'execute', completed: 1, total: 3 },
    })).toMatchObject({ phase: 'running' })
  })
})
