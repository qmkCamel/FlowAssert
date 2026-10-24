import type { ScreenStructure } from '../../src/types.js'
export const mockPageScope = { version: 2 as const,
  anchor: { role: 'text' as const, identifier: 'mock-page', text: 'Hello, harness.' },
  container: { ancestorLevels: 1, platformRole: 'XCUIElementTypeOther', identifier: 'mock-page-container' } }
export function encloseMockPage(tree: ScreenStructure) {
  const title = tree.nodes.find(n => n.role === 'text')!, target = tree.nodes.find(n => n.identifier === 'action-card')!
  title.identifier = 'mock-page'; title.parentId = target.parentId = 'page-container'
  tree.nodes.push({ nodeId: 'page-container', parentId: tree.nodes.find(n => n.role === 'application')!.nodeId,
    role: 'unknown', platformRole: 'XCUIElementTypeOther', identifier: 'mock-page-container',
    visible: true, enabled: true, bounds: { x: 0, y: 100, width: 390, height: 400 } })
}
