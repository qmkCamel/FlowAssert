import { describe, expect, it } from 'vitest'
import { selectorCandidates, selectorFields } from '../src/workbench-selector-adapter.js'
import type { ScreenNode, ScreenStructure } from '../src/types.js'

const bounds = { x: 0, y: 0, width: 100, height: 40 }
const node = (overrides: Partial<ScreenNode>): ScreenNode => ({ nodeId: 'n1', role: 'button', bounds, visible: true, ...overrides })
const structure = (...nodes: ScreenNode[]): ScreenStructure => ({ nodes, truncated: false })

describe('read-only workbench selector adapter', () => {
  it('converts full Android role to the executor type and counts ambiguous identifiers', () => {
    const first = node({ identifier: 'dev.fixture:id/submit', platformRole: 'android.widget.Button', name: 'Submit', text: 'Send' })
    const second = node({ nodeId: 'n2', identifier: 'dev.fixture:id/submit', platformRole: 'android.widget.Button', name: 'Other', text: 'Other' })
    const candidates = selectorCandidates(structure(first, second), 'n1', 'android')
    expect(candidates.find(c => c.kind === 'id')).toMatchObject({ selector: { id: first.identifier }, matchCount: 2, risk: ['ambiguous', 'current-only'] })
    expect(candidates.find(c => c.kind === 'type-and-text')).toMatchObject({ selector: { type: 'Button', text: 'Send' }, matchCount: 1 })
    expect(candidates.every(c => !('nodeId' in c.selector))).toBe(true)
  })

  it('does not offer sensitive or unusable nodes and never falls back to coordinates', () => {
    expect(selectorCandidates(structure(node({ sensitive: true, identifier: 'secret', text: 'password' })), 'n1', 'ios')).toEqual([])
    expect(selectorFields(node({ bounds: { ...bounds, width: 0 }, identifier: 'id' }), 'ios')).toEqual({})
    expect(selectorCandidates(structure(node({ platformRole: 'UnknownRole' })), 'n1', 'ios')).toEqual([])
  })

  it('uses current-only risk even for unique iOS identifiers and flags truncated observations', () => {
    const captured = structure(node({ identifier: 'submit.button', platformRole: 'XCUIElementTypeButton', text: 'Submit' }))
    captured.truncated = true
    const candidates = selectorCandidates(captured, 'n1', 'ios')
    expect(candidates[0]).toMatchObject({ kind: 'id', selector: { id: 'submit.button' }, matchCount: 1, risk: ['truncated-source', 'current-only'] })
    expect(candidates.find(c => c.kind === 'type')).toMatchObject({ selector: { type: 'Button' }, matchCount: 1 })
  })
})
