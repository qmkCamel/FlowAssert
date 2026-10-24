import { describe, expect, it, vi } from 'vitest'
vi.mock('../viewer/journey-common.js', () => ({ node: vi.fn(), button: vi.fn(), copy: vi.fn() }))
// @ts-expect-error Viewer module is deliberately plain JavaScript.
import { actionPoints, stepCaption, stepDuration, resultImage } from '../viewer/report-workbench.js'

describe('report workbench presentation facts', () => {
  it('uses recorded semantic targets without echoing typed secrets', () => {
    expect(stepCaption({ kind: 'tap', target: 'selector(text="复核箱"/contains)' }, 'zh-CN')).toBe('点击 · 复核箱')
    expect(stepCaption({ kind: 'type', target: 'private input value' })).toBe('Type text')
    expect(stepCaption({ kind: 'done', target: 'done' })).toBe('Done')
  })
  it('separates actual duration from playback pace and does not invent unknown timing', () => {
    expect(stepDuration({ executionMs: 1234 })).toBe('1.23 s')
    expect(stepDuration({})).toBe('—')
    expect(stepDuration({ executionMs: -3 })).toBe('—')
  })
  it('never substitutes an action before-image for the terminal result', () => {
    expect(resultImage({ evidence: [{ name: 'step-1-action-1-before.png', contentType: 'image/png' }] })).toBeUndefined()
  })
  it('maps only registered matching geometry and dispatched coordinates', () => {
    const action = { kind: 'tap', dispatch: 'settled', viewport: { x: 0, y: 0, width: 100, height: 200 }, image: { width: 200, height: 400 }, points: [{ x: 25, y: 50 }] }
    expect(actionPoints(action, 200, 400)).toEqual([{ x: 25, y: 25 }])
    expect(actionPoints(action, 200, 200)).toBeNull()
    expect(actionPoints({ ...action, dispatch: 'not-dispatched' }, 200, 400)).toBeNull()
    expect(actionPoints({ ...action, viewport: { ...action.viewport, y: 10 } }, 200, 400)).toBeNull()
    expect(actionPoints({ ...action, points: [{ x: 101, y: 2 }] }, 200, 400)).toBeNull()
    expect(actionPoints({ ...action, points: [{ x: NaN, y: 2 }] }, 200, 400)).toBeNull()
  })
})
