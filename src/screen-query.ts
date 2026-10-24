import type { ScreenNode, ScreenRect, ScreenStructure } from './types.js'
import { intersection, inRegion, REGIONS, type ScreenRegion } from './screen-query-geometry.js'
export * from './screen-query-geometry.js'
export const QUERY_ROLES = ['application', 'button', 'checkbox', 'image', 'input', 'link', 'list', 'list-item', 'scroll-view', 'switch', 'text', 'unknown'] as const
export const QUERY_MAX_BYTES = 64 * 1024
export type ScreenQuerySpec =
  | { op: 'find'; text?: string; textMatch?: 'exact' | 'contains'; caseSensitive?: boolean; identifier?: string; role?: ScreenNode['role']; region?: ScreenRegion; visibleOnly?: boolean; actionableOnly?: boolean; offset?: number; limit?: number }
  | { op: 'get'; nodeId: string }
  | { op: 'subtree'; nodeId: string; depth?: number; offset?: number; limit?: number }
export interface ScreenQueryResult {
  observationId: string; frameRevision: number; screenEpoch: number; capturedAt: string; captureEndedAt: string; expiresAt: string
  op: 'find' | 'get' | 'subtree'
  actionBinding: { status: 'current' | 'superseded' | 'screen-changed' | 'action-expired'; validUntil: string }
  source: { nodeCount: number; truncated: boolean; truncatedReason?: string }
  nodes: ScreenQueryNode[]; page: ScreenQueryPage
}
export type ScreenQueryInput = ScreenQuerySpec & { observationId: string }
export type ScreenQueryNode = ScreenNode & { fieldsTruncated?: string[]; parentAvailable?: boolean; capturedChildCount?: number }
export interface ScreenQueryPage { offset: number; returned: number; totalMatches: number; nextOffset?: number; limitedBy: ('limit' | 'bytes')[]; depthLimited: boolean }
export class ScreenQueryError extends Error {
  constructor(readonly code: 'mobile_mirror_invalid_arguments' | 'screen_structure_invalid' | 'screen_node_not_found' | 'screen_query_result_too_large') { super(code) }
}
const fail = (): never => { throw new ScreenQueryError('mobile_mirror_invalid_arguments') }
const utf8 = new TextEncoder()
function bounded(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && [...value].length <= 128 && utf8.encode(value).length <= 512 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) }
export function parseQuerySpec(raw: unknown): ScreenQuerySpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
  const a = raw as Record<string, unknown>
  const keys = a.op === 'find' ? ['op', 'text', 'textMatch', 'caseSensitive', 'identifier', 'role', 'region', 'visibleOnly', 'actionableOnly', 'offset', 'limit'] : a.op === 'get' ? ['op', 'nodeId'] : a.op === 'subtree' ? ['op', 'nodeId', 'depth', 'offset', 'limit'] : fail()
  if (Object.keys(a).some(k => !keys.includes(k))) return fail()
  if (a.op !== 'find' && !bounded(a.nodeId)) return fail()
  for (const k of ['text', 'identifier']) if (a[k] !== undefined && !bounded(a[k])) return fail()
  for (const k of ['caseSensitive', 'visibleOnly', 'actionableOnly']) if (a[k] !== undefined && typeof a[k] !== 'boolean') return fail()
  if (a.text === undefined && (a.textMatch !== undefined || a.caseSensitive !== undefined)) return fail()
  for (const [k, allowed] of [['textMatch', ['exact', 'contains']], ['role', QUERY_ROLES], ['region', REGIONS]] as const) if (a[k] !== undefined && !(allowed as readonly unknown[]).includes(a[k])) return fail()
  for (const [k, min, max] of [['offset', 0, 500], ['limit', 1, 100], ['depth', 0, 8]] as const) if (a[k] !== undefined && (typeof a[k] !== 'number' || !Number.isInteger(a[k]) || a[k] < min || a[k] > max)) return fail()
  return { ...a } as ScreenQuerySpec
}
export function parseScreenQuery(raw: unknown): ScreenQueryInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
  const { observationId, ...spec } = raw as Record<string, unknown>
  if (!bounded(observationId)) return fail()
  return { ...parseQuerySpec(spec), observationId }
}
export function structureIndex(nodes: ScreenNode[]) {
  if (nodes.length > 500) throw new ScreenQueryError('screen_structure_invalid')
  const byId = new Map<string, ScreenNode>(), children = new Map<string, ScreenNode[]>(), depths = new Map<string, number>()
  for (const n of nodes) { if (!n.nodeId || byId.has(n.nodeId)) throw new ScreenQueryError('screen_structure_invalid'); byId.set(n.nodeId, n) }
  for (const n of nodes) if (n.parentId && byId.has(n.parentId)) { const list = children.get(n.parentId) ?? []; list.push(n); children.set(n.parentId, list) }
  function depth(n: ScreenNode, visiting: Set<string>): number {
    if (visiting.has(n.nodeId)) throw new ScreenQueryError('screen_structure_invalid')
    if (depths.has(n.nodeId)) return depths.get(n.nodeId)!
    visiting.add(n.nodeId)
    const parent = n.parentId ? byId.get(n.parentId) : undefined
    const d = parent ? depth(parent, visiting) + 1 : 0
    visiting.delete(n.nodeId); depths.set(n.nodeId, d); return d
  }
  for (const n of nodes) depth(n, new Set())
  return { byId, children, depths }
}
export function structureSummary(structure: ScreenStructure) { return { nodeCount: structure.nodes.length, truncated: structure.truncated, ...(structure.truncatedReason ? { truncatedReason: structure.truncatedReason } : {}) } }
export function queryStructure<T extends object = Record<string, never>>(input: { nodes: ScreenNode[]; viewport: ScreenRect }, raw: ScreenQuerySpec, envelope: T = {} as T) {
  const spec = parseQuerySpec(raw), index = structureIndex(input.nodes)
  let depthLimited = false, matches: ScreenNode[] = []
  if (spec.op === 'find') {
    matches = input.nodes.filter(n => {
      const visible = n.visible === true && !!intersection(n.bounds, input.viewport)
      if ((spec.visibleOnly !== false && !visible) || (spec.actionableOnly && (!visible || n.enabled !== true || n.actionable !== true))) return false
      if (spec.role && n.role !== spec.role || spec.identifier !== undefined && n.identifier !== spec.identifier || spec.region && !inRegion(n.bounds, input.viewport, spec.region)) return false
      if (spec.text !== undefined) {
        const needle = spec.caseSensitive ? spec.text : spec.text.toLowerCase()
        return !n.sensitive && [n.name, n.text, n.value].some(v => { if (v === undefined) return false; const text = spec.caseSensitive ? v : v.toLowerCase(); return spec.textMatch === 'exact' ? text === needle : text.includes(needle) })
      }
      return true
    })
  } else {
    const root = index.byId.get(spec.nodeId)
    if (!root) throw new ScreenQueryError('screen_node_not_found')
    function visit(node: ScreenNode, depth: number) { matches.push(node); const children = index.children.get(node.nodeId) ?? []; if (spec.op === 'subtree' && depth < (spec.depth ?? 2)) for (const child of children) visit(child, depth + 1); else if (spec.op === 'subtree' && children.length) depthLimited = true }
    visit(root, 0)
  }
  const offset = spec.op === 'get' ? 0 : spec.offset ?? 0, limit = spec.op === 'get' ? 1 : spec.limit ?? 20
  const nodes: ScreenQueryNode[] = []
  const page: ScreenQueryPage = { offset, returned: 0, totalMatches: matches.length, limitedBy: matches.length - offset > limit ? ['limit'] : [], depthLimited }
  const result = { ...envelope, nodes, page }
  for (const original of matches.slice(offset, offset + limit)) {
    const node: ScreenQueryNode = { ...original, ...(original.bounds ? { bounds: { ...original.bounds } } : {}) }
    if (node.sensitive) { delete node.name; delete node.text; delete node.value }
    if (spec.op === 'get') { node.parentAvailable = !!node.parentId && index.byId.has(node.parentId); node.capturedChildCount = index.children.get(node.nodeId)?.length ?? 0 }
    else {
      delete node.value; node.fieldsTruncated = []
      for (const k of ['name', 'text'] as const) if (node[k] && [...node[k]!].length > 128) { node[k] = [...node[k]!].slice(0, 128).join(''); node.fieldsTruncated.push(k) }
    }
    nodes.push(node); page.returned = nodes.length
    if (offset + nodes.length < matches.length) page.nextOffset = offset + nodes.length; else delete page.nextOffset
    // Reserve enough for adding the bytes flag and changing pagination after removal.
    if (utf8.encode(JSON.stringify(result)).length > QUERY_MAX_BYTES - 32) {
      nodes.pop(); page.returned = nodes.length; page.nextOffset = offset + nodes.length; page.limitedBy.push('bytes')
      if (!nodes.length) throw new ScreenQueryError('screen_query_result_too_large')
      break
    }
  }
  if (utf8.encode(JSON.stringify(result)).length > QUERY_MAX_BYTES) throw new ScreenQueryError('screen_query_result_too_large')
  return result
}
