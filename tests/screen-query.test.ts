import { expect, test } from 'vitest'
import { parseQuerySpec, parseScreenQuery, queryStructure, structureIndex, containMapping, intersection, inRegion, parentDistances } from '../src/screen-query.js'
import type { ScreenNode } from '../src/types.js'
const viewport = { x: 10, y: 20, width: 300, height: 600 }
const node = (nodeId: string, extra: Partial<ScreenNode> = {}): ScreenNode => ({ nodeId, role: 'button', name: 'Login', visible: true, enabled: true, actionable: true, bounds: { x: 10, y: 20, width: 80, height: 40 }, ...extra })
const input = { nodes: [node('root', { role: 'application' }), node('a', { parentId: 'root', identifier: 'LOGIN' }), node('b', { parentId: 'a', name: 'login', role: 'text' }), node('secret', { sensitive: true, name: 'SECRET', text: 'SECRET', value: 'SECRET' }), { nodeId: 'unknown', role: 'button' as const }], viewport }
for (const args of [{ op: 'get', nodeId: 'a', limit: 1 }, { op: 'find', nodeId: 'a' }, { op: 'find', textMatch: 'exact' }, { op: 'find', caseSensitive: false }, { op: 'find', text: '' }, { op: 'find', text: '\nsecret' }, { op: 'find', text: '界'.repeat(129) }, { op: 'find', offset: 501 }, { op: 'find', limit: 0 }, { op: 'subtree', nodeId: 'a', depth: 9 }, { op: 'find', region: 'middle' }, { op: 'find', role: 'native' }, { op: 'find', limit: NaN }]) {
  test(`rejects conflicting or unbounded query ${JSON.stringify(args)}`, () => expect(() => parseQuerySpec(args)).toThrow('mobile_mirror_invalid_arguments'))
}
test('strict matching, full-field matching before projection, secure redaction and unknown visibility', () => {
  expect(queryStructure(input, { op: 'find', text: 'login', role: 'button' }).nodes.map(n => n.nodeId)).toEqual(['a'])
  expect(queryStructure(input, { op: 'find', identifier: 'login' }).nodes).toEqual([])
  expect(queryStructure(input, { op: 'find', identifier: 'LOGIN' }).nodes.map(n => n.nodeId)).toEqual(['a'])
  expect(queryStructure(input, { op: 'find', text: 'SECRET' }).nodes).toEqual([])
  expect(JSON.stringify(queryStructure(input, { op: 'get', nodeId: 'secret' }))).not.toContain('SECRET')
  expect(queryStructure(input, { op: 'find', visibleOnly: false }).nodes).toHaveLength(5)
  const n = node('long', { name: 'a'.repeat(128) + 'needle' })
  expect(queryStructure({ nodes: [n], viewport }, { op: 'find', text: 'needle' }).nodes[0]?.fieldsTruncated).toEqual(['name'])
  expect((parseScreenQuery({ observationId: 'id', op: 'find', text: ' ' }) as { text: string }).text).toBe(' ')
})
test('subtree preorder, depth and missing parents; rejects cycles and duplicate identities', () => {
  const page = queryStructure(input, { op: 'subtree', nodeId: 'root', depth: 1 })
  expect(page.nodes.map(n => n.nodeId)).toEqual(['root', 'a']); expect(page.page.depthLimited).toBe(true)
  expect(queryStructure(input, { op: 'get', nodeId: 'a' }).nodes[0]).toMatchObject({ parentAvailable: true, capturedChildCount: 1 })
  expect(queryStructure({ nodes: [node('orphan', { parentId: 'missing' })], viewport }, { op: 'get', nodeId: 'orphan' }).nodes[0]?.parentAvailable).toBe(false)
  expect(() => structureIndex([node('a'), node('a')])).toThrow('screen_structure_invalid')
  expect(() => structureIndex([node('a', { parentId: 'b' }), node('b', { parentId: 'a' })])).toThrow('screen_structure_invalid')
  expect(() => queryStructure(input, { op: 'get', nodeId: 'missing' })).toThrow('screen_node_not_found')
})
test('byte-budget pagination retains complete nodes and never skips, including empty offsets', () => {
  const nodes = Array.from({ length: 250 }, (_, i) => node(String(i), { identifier: '界'.repeat(512), platformRole: '界'.repeat(512), name: '界'.repeat(512), text: '界'.repeat(512) }))
  let offset: number | undefined = 0; const seen: string[] = []
  while (offset !== undefined) {
    const r: ReturnType<typeof queryStructure> = queryStructure({ nodes, viewport }, { op: 'find', limit: 100, offset }, { observationId: 'original', metadata: 'x'.repeat(700) })
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(65536); if (r.page.nextOffset !== undefined) expect(r.page.limitedBy).toContain('bytes')
    seen.push(...r.nodes.map(n => n.nodeId)); offset = r.page.nextOffset
  }
  expect(seen).toEqual(nodes.map(n => n.nodeId))
  expect(queryStructure(input, { op: 'find', offset: 500 }).page).toMatchObject({ returned: 0 }); expect(queryStructure(input, { op: 'find', offset: 500 }).page.nextOffset).toBeUndefined()
})
test('contain geometry is reversible across origin, letterbox, zoom and clipping', () => {
  for (const zoom of [.5, 1, 2]) {
    const mapping = containMapping(viewport, { width: 600, height: 1200 }, { width: 500 * zoom, height: 600 * zoom })!
    const rect = mapping.rect({ x: 10, y: 20, width: 30, height: 60 })!
    expect(rect).toEqual({ x: 100 * zoom, y: 0, width: 30 * zoom, height: 60 * zoom })
    expect(mapping.point(rect.x + rect.width / 2, rect.y + rect.height / 2)).toEqual({ x: 25, y: 50 }); expect(mapping.point(0, 0)).toBeNull()
  }
  expect(containMapping(viewport, { width: 600, height: 600 }, { width: 500, height: 600 })).toBeNull()
  expect(intersection({ x: 0, y: 0, width: 30, height: 40 }, viewport)).toEqual({ x: 10, y: 20, width: 20, height: 20 })
  expect(inRegion({ x: 100, y: 20, width: 20, height: 20 }, viewport, 'left')).toBe(false)
  expect(parentDistances({ x: 0, y: 0, width: 20, height: 20 }, viewport)?.left).toBe(-10)
})
test('records bounded warm-query performance without a brittle timing threshold', () => {
  const nodes = Array.from({ length: 500 }, (_, i) => node(String(i))), times: number[] = []
  for (let i = 0; i < 110; i++) { const start = performance.now(); queryStructure({ nodes, viewport }, { op: 'find', text: 'Login', limit: 100 }); if (i >= 10) times.push(performance.now() - start) }
  times.sort((a,b) => a-b)
  console.info(JSON.stringify({ nodes: 500, warmQueries: 100, p95Ms: times[94], bytes: Buffer.byteLength(JSON.stringify(queryStructure({ nodes, viewport }, { op: 'find', limit: 100 }))) }))
})
