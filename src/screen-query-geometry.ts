import type { ScreenNode, ScreenRect, ScreenSize } from './types.js'
export const REGIONS = ['top', 'bottom', 'left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'center'] as const
export type ScreenRegion = typeof REGIONS[number]
export function positiveRect(r?: ScreenRect): r is ScreenRect {
  return !!r && [r.x, r.y, r.width, r.height, r.x + r.width, r.y + r.height].every(Number.isFinite) && r.width > 0 && r.height > 0
}
export function intersection(a: ScreenRect | undefined, b: ScreenRect): ScreenRect | null {
  if (!positiveRect(a) || !positiveRect(b)) return null
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : null
}
export function inRegion(bounds: ScreenRect | undefined, viewport: ScreenRect, region: ScreenRegion): boolean {
  const r = intersection(bounds, viewport)
  if (!r) return false
  const u = (r.x + r.width / 2 - viewport.x) / viewport.width, v = (r.y + r.height / 2 - viewport.y) / viewport.height
  const left = u < 1 / 3, right = u >= 2 / 3, top = v < 1 / 3, bottom = v >= 2 / 3
  return ({ left, right, top, bottom, topLeft: top && left, topRight: top && right, bottomLeft: bottom && left, bottomRight: bottom && right, center: !left && !right && !top && !bottom })[region]
}
export function containMapping(viewport: ScreenRect, image: ScreenSize, box: ScreenSize) {
  if (!positiveRect(viewport) || ![image.width, image.height, box.width, box.height].every(n => Number.isFinite(n) && n > 0)
    || Math.abs((image.width / image.height) / (viewport.width / viewport.height) - 1) > .01) return null
  const scale = Math.min(box.width / image.width, box.height / image.height)
  const x = (box.width - image.width * scale) / 2, y = (box.height - image.height * scale) / 2
  const sx = image.width * scale / viewport.width, sy = image.height * scale / viewport.height
  return {
    rect(bounds: ScreenRect) {
      const r = intersection(bounds, viewport)
      return r ? { x: x + (r.x - viewport.x) * sx, y: y + (r.y - viewport.y) * sy, width: r.width * sx, height: r.height * sy } : null
    },
    point(px: number, py: number) {
      const vx = (px - x) / sx + viewport.x, vy = (py - y) / sy + viewport.y
      return vx >= viewport.x && vy >= viewport.y && vx < viewport.x + viewport.width && vy < viewport.y + viewport.height ? { x: vx, y: vy } : null
    },
  }
}
export function parentDistances(child?: ScreenRect, parent?: ScreenRect) {
  return positiveRect(child) && positiveRect(parent) ? { left: child.x - parent.x, top: child.y - parent.y, right: parent.x + parent.width - child.x - child.width, bottom: parent.y + parent.height - child.y - child.height } : null
}
export function hitCandidates(nodes: ScreenNode[], viewport: ScreenRect, point: { x: number; y: number }, depths: Map<string, number>): ScreenNode[] {
  return nodes.map((node, order) => ({ node, order, rect: intersection(node.bounds, viewport) }))
    .filter(({ node, rect }) => node.visible === true && rect && point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height)
    .sort((a, b) => (depths.get(b.node.nodeId) ?? 0) - (depths.get(a.node.nodeId) ?? 0) || a.rect!.width * a.rect!.height - b.rect!.width * b.rect!.height || a.order - b.order).map(x => x.node)
}
