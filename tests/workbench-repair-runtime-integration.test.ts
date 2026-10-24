import { describe, expect, it } from 'vitest'
import { compilePlan } from '../src/workbench-plan.js'
import { emptyProject } from '../src/workbench-project.js'
import { factDigest, stepDigest } from '../src/workbench-tap-facts.js'

const header = 'name: Merge integration\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n'

describe('repair source identity with runtime gates', () => {
  it('retains the child document identity inside measure, branch and repeat nodes', async () => {
    const tap = { tap: { accessibilityId: 'action-card' } }
    const child = header + '- measure:\n    id: child-window\n    maxElapsedMs: 5000\n    steps:\n      - if:\n          condition: { platform: ios }\n          then:\n            - repeat:\n                times: 1\n                steps:\n                  - tap: { accessibilityId: action-card }\n                  - assertVisible: { text: "Hello, harness." }\n'
    const root = header + '- runFlow: { ref: child }\n'
    const plan = await compilePlan(root, { ...emptyProject(), flows: { child } })
    expect(plan.requiredFeatures).toEqual(['e2e-measure-v1'])
    const measure = plan.nodes[0]
    if (measure?.kind !== 'measure') throw new Error('Missing measure')
    const branch = measure.steps[0]
    if (branch?.kind !== 'if') throw new Error('Missing branch')
    const loop = branch.then[0]
    if (loop?.kind !== 'repeat') throw new Error('Missing repeat')
    const leaf = loop.steps[0]
    if (leaf?.kind !== 'leaf') throw new Error('Missing leaf')
    expect(leaf.sourceSteps[0]).toMatchObject({
      documentSha256: factDigest(child), stepSha256: stepDigest(tap), topLevel: false, static: true,
    })
    expect(leaf.sourceSteps[0]?.documentSha256).not.toBe(factDigest(root))
    expect(leaf.sourceSteps[0]?.line).toBe(15)
  })

  it('does not lose the nested-measure prohibition when traversing a subflow', async () => {
    const child = header + '- measure: { id: inner, maxElapsedMs: 5000, steps: [ { assertVisible: { text: Ready } } ] }\n'
    const root = header + '- measure: { id: outer, maxElapsedMs: 5000, steps: [ { runFlow: { ref: child } } ] }\n'
    await expect(compilePlan(root, { ...emptyProject(), flows: { child } }))
      .rejects.toThrow('measurement-nested-duplicate-or-budget')
  })

  it('retains top-level tap identity alongside a versioned temporal assertion', async () => {
    const yaml = header + '- tap: { accessibilityId: action-card }\n- assertEventually: { predicate: { assertVisible: { text: Ready } }, withinMs: 1000, pollMs: 100, maxSampleGapMs: 200 }\n'
    const plan = await compilePlan(yaml, emptyProject())
    expect(plan.requiredFeatures).toEqual(['temporal-ui-v1'])
    expect(plan.nodes[0]).toMatchObject({ kind: 'leaf', sourceSteps: [{
      path: 'root/1', documentSha256: factDigest(yaml), topLevel: true, static: true,
    }] })
    expect(plan.nodes[1]).toMatchObject({ kind: 'temporal', operation: 'assertEventually' })
  })
})
