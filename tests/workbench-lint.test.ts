import { describe, expect, it } from 'vitest'
import { lintWorkbenchFlow, lintWorkbenchSyntax, validationErrorLine } from '../src/workbench-lint.js'
import { compilePlan } from '../src/workbench-plan.js'
import { emptyProject } from '../src/workbench-project.js'

describe('workbench maintenance lint', () => {
  it('returns advice with source lines without weakening parser acceptance', () => {
    const yaml = 'name: A\nplatform: ios\nappId: example.app\n---\n- wait: 5\n- tap: {text: Continue}\n- assertVisible: {type: Button}\n- done\n'
    expect(lintWorkbenchFlow(yaml).map(issue => [issue.code, issue.line])).toEqual([
      ['fixed-wait', 5], ['text-selector', 6], ['class-selector', 7],
    ])
  })

  it('does not expose source or fail on invalid YAML', () => {
    expect(lintWorkbenchFlow('name: [')).toEqual([])
    expect(lintWorkbenchFlow('x'.repeat(65 * 1024))).toEqual([])
  })

  it('keeps blocking syntax errors and maintenance advice in separate grades', () => {
    expect(lintWorkbenchSyntax('name: [')).toMatchObject([{ severity: 'error', code: 'yaml-syntax', line: 1 }])
    expect(lintWorkbenchSyntax('name: A\nplatform: ios')).toMatchObject([{ severity: 'error', code: 'yaml-structure', line: 1 }])
    const valid = 'name: A\nplatform: ios\nappId: example.app\n---\n- wait: 5\n- assertVisible: {text: Continue}\n'
    expect(lintWorkbenchSyntax(valid)).toEqual([])
    expect(lintWorkbenchFlow(valid)).toMatchObject([{ severity: 'advice', line: 5 }, { severity: 'advice', line: 6 }])
  })

  it('reports header and nested-plan errors on the original draft lines', async () => {
    const header = 'name: A\nplatform: bogus\nappId: example.app\n---\n- assertVisible: {text: Continue}\n'
    let headerError: unknown
    try { await compilePlan(header, emptyProject()) } catch (error) { headerError = error }
    expect(validationErrorLine(header, headerError)).toBe(2)
    const step = 'name: A\nplatform: ios\nappId: example.app\n---\n- assertVisual: {profile: missing}\n- done\n'
    let stepError: unknown
    try { await compilePlan(step, emptyProject()) } catch (error) { stepError = error }
    expect(validationErrorLine(step, stepError)).toBe(5)
  })
})
