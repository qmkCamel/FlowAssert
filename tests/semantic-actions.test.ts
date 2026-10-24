import { describe, expect, it } from 'vitest'
import { nodeTapPoint, requirePositiveVisibleBounds, validatePublicText } from '../src/semantic-actions.js'

describe('semantic action safety helpers', () => {
  const viewport = { x: 0, y: 0, width: 100, height: 200 }

  it('uses the center of the exact positive viewport intersection', () => {
    expect(nodeTapPoint({ x: 10, y: 20, width: 40, height: 60 }, viewport)).toEqual({ x: 30, y: 50 })
    expect(requirePositiveVisibleBounds({ x: -20, y: 180, width: 50, height: 40 }, viewport)).toEqual({
      x: 0, y: 180, width: 30, height: 20,
    })
    expect(nodeTapPoint({ x: -20, y: 180, width: 50, height: 40 }, viewport)).toEqual({ x: 15, y: 190 })
  })

  it('rejects missing, zero-area, offscreen, and non-finite bounds without clamping', () => {
    for (const bounds of [
      undefined,
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 100, y: 0, width: 1, height: 1 },
      { x: -10, y: -10, width: 5, height: 5 },
      { x: Number.NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: Number.POSITIVE_INFINITY, width: 1, height: 1 },
    ]) expect(() => nodeTapPoint(bounds, viewport)).toThrow(expect.objectContaining({ code: 'screen_node_not_actionable' }))
  })

  it('accepts exact text boundaries and rejects controls, submit characters, overflow, or empty append', () => {
    expect(() => validatePublicText('a'.repeat(512), 'append')).not.toThrow()
    expect(() => validatePublicText('', 'replace')).not.toThrow()
    expect(() => validatePublicText('e\u0301', 'append')).not.toThrow()
    for (const text of [
      '',
      'a'.repeat(513),
      'line\n',
      'tab\t',
      `nul${String.fromCharCode(0)}`,
      `c1${String.fromCharCode(0x80)}`,
      `line${String.fromCharCode(0x2028)}`,
      `paragraph${String.fromCharCode(0x2029)}`,
    ]) expect(() => validatePublicText(text, 'append')).toThrow(expect.objectContaining({ code: 'screen_text_input_invalid' }))
  })
})
