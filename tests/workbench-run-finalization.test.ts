import { describe, expect, it } from 'vitest'
import { aggregateRunVerdict, requireTerminalStepEvidence } from '../src/workbench-run-finalization.js'
import type { TestRun } from '../src/workbench-store.js'

const run = () => ({ steps: [{ index: 1, kind: 'assert', status: 'passed', evidence: [{ name: 'step-1.png', contentType: 'image/png' }, { name: 'step-1.xml', contentType: 'application/xml' }] }],
  visualVerification: 'not-performed', businessVerification: 'not-performed', aiRecovery: undefined }) as unknown as TestRun
const engine = { success: true } as Parameters<typeof aggregateRunVerdict>[1]['engineResult']

describe('terminal verdict aggregation', () => {
  it('keeps clean, declared-visual, recovered and cancelled outcomes distinct', () => {
    expect(aggregateRunVerdict(run(), { aborted: false, assertionFailure: false, engineResult: engine, declaredVisual: false }).verdict).toBe('pass')
    expect(aggregateRunVerdict(run(), { aborted: false, assertionFailure: false, engineResult: engine, declaredVisual: true }).verdict).toBe('inconclusive')
    expect(aggregateRunVerdict(run(), { aborted: true, abortReason: 'Cancelled by user', assertionFailure: false, engineResult: engine, declaredVisual: false }).verdict).toBe('cancelled')
    expect(aggregateRunVerdict(run(), { aborted: true, abortReason: 'Host interrupted', assertionFailure: false, engineResult: engine, declaredVisual: false }).verdict).toBe('inconclusive')
  })
  it('lets evidence conflict and business failure override a green engine result', () => {
    const conflict = run(); conflict.steps[0]!.verification = { status: 'evidence-conflict', message: 'Mismatch' }
    expect(aggregateRunVerdict(conflict, { aborted: false, assertionFailure: false, engineResult: engine, declaredVisual: false })).toMatchObject({ verdict: 'evidence-conflict', error: 'Mismatch' })
    const business = run(); business.businessVerification = 'fail'
    expect(aggregateRunVerdict(business, { aborted: false, assertionFailure: false, engineResult: engine, declaredVisual: false }).verdict).toBe('fail')
  })
  it('requires complete steps and registered PNG/XML before a clean pass', () => {
    expect(() => requireTerminalStepEvidence(run(), 2, 'pass')).toThrow(/all declared steps/)
    const missing = run(); missing.steps[0]!.evidence = []
    expect(() => requireTerminalStepEvidence(missing, 1, 'pass')).toThrow(/required evidence missing/)
    expect(() => requireTerminalStepEvidence(missing, 1, 'fail')).not.toThrow()
  })
})
