import { describe, it, expect } from 'vitest'
import { sourceRectangle, parseRectangles } from '../viewer/report-mask-geometry.js'
describe('source-pixel masks', () => {
  it('rounds outward across scaled portrait, landscape, scroll and fractional CSS coordinates', () => {
    expect(sourceRectangle({ x: 110.1, y: 220.1 }, { x: 160.1, y: 250.1 }, { left: 100, top: 200, width: 300, height: 600 }, 1200, 2400)).toEqual({ x: 40, y: 80, width: 201, height: 121 })
    expect(sourceRectangle({ x: 500, y: 100 }, { x: -20, y: -40 }, { left: 0, top: -20, width: 600, height: 300 }, 2400, 1200)).toEqual({ x: 0, y: 0, width: 2000, height: 480 })
    const bounds = { left: 10, top: 10, width: 200, height: 400 }
    // DPR is deliberately absent: client rect and pointer coordinates use the same CSS pixel unit.
    expect(sourceRectangle({ x: 20, y: 20 }, { x: 50, y: 60 }, bounds, 1000, 2000)).toEqual({ x: 50, y: 50, width: 150, height: 200 })
    expect(() => sourceRectangle({ x: 0, y: 0 }, { x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, 1, 1)).toThrow()
  })
  it('validates numeric accessibility alternatives and the 64-mask bound', () => {
    expect(parseRectangles('1,2,3,4;0,0,10,20')).toHaveLength(2)
    for (const value of ['1,2,0,1', '-1,0,1,1', '1,1,1.2,3', 'a,b,c,d', Array(65).fill('0,0,1,1').join(';')]) expect(() => parseRectangles(value)).toThrow()
  })
})
