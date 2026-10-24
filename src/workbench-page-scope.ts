import { z } from 'zod'
import type { ScreenNode, ScreenStructure } from './types.js'

const boundedText = z.string().min(1).max(128)
/** Legacy registrations remain readable, but cannot authorize navigation. */
export const trustedPageScopeSchema = z.union([
  z.object({ version: z.literal(2), anchor: z.object({
    role: z.enum(['text', 'button', 'image', 'unknown']),
    identifier: boundedText.optional(), name: boundedText.optional(), text: boundedText.optional(),
  }).strict().refine(anchor => Boolean(anchor.identifier || anchor.name || anchor.text), 'Exact page anchor required'),
  container: z.object({ ancestorLevels: z.number().int().min(1).max(8), platformRole: boundedText,
    identifier: boundedText.optional() }).strict() }).strict(),
  z.object({ role: z.literal('application'), name: boundedText }).strict(),
])
export type TrustedPageScope = z.infer<typeof trustedPageScopeSchema>

const usable = (node: ScreenNode) => node.visible === true && !node.sensitive && Boolean(node.bounds
  && [node.bounds.x, node.bounds.y, node.bounds.width, node.bounds.height].every(Number.isFinite)
  && node.bounds.width > 0 && node.bounds.height > 0)
const contains = (outer: ScreenNode, inner: ScreenNode) => Boolean(outer.bounds && inner.bounds
  && inner.bounds.x >= outer.bounds.x && inner.bounds.y >= outer.bounds.y
  && inner.bounds.x + inner.bounds.width <= outer.bounds.x + outer.bounds.width
  && inner.bounds.y + inner.bounds.height <= outer.bounds.y + outer.bounds.height)

/** One resolver for recorded evidence, admission and fresh dispatch. Never use an App root as a page. */
export function trustedPageContainer(tree: ScreenStructure, scope: TrustedPageScope): ScreenNode | undefined {
  if (!('version' in scope) || tree.truncated || !tree.nodes.length) return
  const byId = new Map(tree.nodes.map(node => [node.nodeId, node]))
  if (byId.size !== tree.nodes.length) return
  const matches = tree.nodes.filter(node => node.role === scope.anchor.role
    && Object.entries(scope.anchor).every(([key, value]) => node[key as keyof ScreenNode] === value))
  // A hidden duplicate is still an ambiguous identity, not a second page grant.
  if (matches.length !== 1 || !usable(matches[0]!)) return
  let container = matches[0]!
  const seen = new Set([container.nodeId])
  for (let level = 0; level < scope.container.ancestorLevels; level++) {
    const parent = container.parentId && byId.get(container.parentId)
    if (!parent || seen.has(parent.nodeId)) return
    seen.add(parent.nodeId); container = parent
  }
  if (!usable(container) || !contains(container, matches[0]!) || !container.parentId || container.role === 'application'
    || /(?:Application|Window|^hierarchy$)/i.test(container.platformRole ?? '')
    || container.platformRole !== scope.container.platformRole
    || (scope.container.identifier !== undefined && container.identifier !== scope.container.identifier)) return
  let parentId = container.parentId
  while (parentId) {
    const parent = byId.get(parentId)
    if (!parent || seen.has(parentId)) return
    seen.add(parentId); parentId = parent.parentId ?? ''
  }
  return container
}

export function withinTrustedPage(tree: ScreenStructure, scope: TrustedPageScope, target: ScreenNode): boolean {
  const container = trustedPageContainer(tree, scope)
  if (!container || !usable(target) || !contains(container, target)) return false
  if ('version' in scope && Object.entries(scope.anchor).every(([key, value]) => target[key as keyof ScreenNode] === value)) return false
  const byId = new Map(tree.nodes.map(node => [node.nodeId, node])), seen = new Set([target.nodeId])
  let parent = target.parentId
  while (parent && !seen.has(parent)) {
    if (parent === container.nodeId) return true
    seen.add(parent); parent = byId.get(parent)?.parentId
  }
  return false
}
