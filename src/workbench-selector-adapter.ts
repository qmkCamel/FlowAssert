import type { ScreenNode, ScreenStructure } from './types.js'
import type { SemanticTarget } from './workbench-readiness.js'

/** Exact normalized identities; a suggestion is not a cross-run stability guarantee. */
export function readinessCandidate(structure: ScreenStructure, selectedNodeId: string): SemanticTarget | undefined {
  const node = structure.nodes.find(item => item.nodeId === selectedNodeId)
  if (structure.truncated || !node || node.sensitive || /secure|password/i.test(node.platformRole ?? '') || node.visible !== true || !node.bounds || node.bounds.width <= 0 || node.bounds.height <= 0) return
  const choices: SemanticTarget[] = []
  if (safe(node.identifier)) choices.push({ testId: node.identifier })
  if (safe(node.name)) choices.push({ role: node.role, name: node.name })
  if (safe(node.text)) choices.push({ role: node.role, text: node.text })
  return choices.find(target => structure.nodes.filter(item => Object.entries(target).every(([key, value]) => item[key === 'testId' ? 'identifier' : key as 'role' | 'name' | 'text'] === value)).length === 1)
}

export type SelectorPlatform = 'android' | 'ios'
export type DraftSelector = { id?: string; accessibilityId?: string; text?: string; type?: string }
export interface SelectorCandidate {
  kind: 'id' | 'accessibilityId' | 'text' | 'type-and-text' | 'type'
  selector: DraftSelector
  matchCount: number
  risk: ('ambiguous' | 'volatile-text' | 'class-only' | 'fallback-id' | 'truncated-source' | 'current-only')[]
}

const safe = (value: unknown): value is string => typeof value === 'string' && value.length > 0 &&
  [...value].length <= 128 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)

/** Mirrors the supported, read-only AppClaw selector fields without exposing nodeId or source XML. */
export function selectorFields(node: ScreenNode, platform: SelectorPlatform): DraftSelector {
  if (node.sensitive || node.visible === false || !node.bounds || node.bounds.width <= 0 || node.bounds.height <= 0) return {}
  const id = safe(node.identifier) ? node.identifier : undefined
  const accessibilityId = platform === 'ios'
    ? id ?? (safe(node.name) ? node.name : undefined)
    : safe(node.name) ? node.name : id?.split('/').at(-1)
  const text = platform === 'ios'
    ? [node.text, node.name, node.value].find(safe)
    : [node.text, node.name].find(safe)
  const platformType = node.platformRole
  const type = safe(platformType) && (platform === 'android'
    ? /^[A-Za-z][A-Za-z0-9_.]+$/.test(platformType)
    : /^XCUIElementType[A-Za-z0-9]+$/.test(platformType))
    ? platform === 'android' ? platformType.split('.').at(-1) : platformType.slice('XCUIElementType'.length)
    : undefined
  return { ...(id ? { id } : {}), ...(accessibilityId ? { accessibilityId } : {}), ...(text ? { text } : {}), ...(type ? { type } : {}) }
}

export function selectorCandidates(structure: ScreenStructure, selectedNodeId: string, platform: SelectorPlatform): SelectorCandidate[] {
  const selected = structure.nodes.find(node => node.nodeId === selectedNodeId)
  if (!selected || selected.sensitive) return []
  const fields = selectorFields(selected, platform)
  const all = structure.nodes.map(node => selectorFields(node, platform))
  const raw: { kind: SelectorCandidate['kind']; selector: DraftSelector; extra?: SelectorCandidate['risk'][number] }[] = []
  if (fields.id) raw.push({ kind: 'id', selector: { id: fields.id } })
  if (fields.accessibilityId) raw.push({ kind: 'accessibilityId', selector: { accessibilityId: fields.accessibilityId }, ...(platform === 'android' && !selected.name ? { extra: 'fallback-id' as const } : {}) })
  if (fields.text) raw.push({ kind: 'text', selector: { text: fields.text }, extra: 'volatile-text' })
  if (fields.type && fields.text) raw.push({ kind: 'type-and-text', selector: { type: fields.type, text: fields.text }, extra: 'volatile-text' })
  if (fields.type) raw.push({ kind: 'type', selector: { type: fields.type }, extra: 'class-only' })
  return raw.map(entry => {
    const matchCount = all.filter(candidate => Object.entries(entry.selector).every(([key, value]) =>
      candidate[key as keyof DraftSelector]?.toLocaleLowerCase() === value?.toLocaleLowerCase())).length
    return { kind: entry.kind, selector: entry.selector, matchCount, risk: [
      ...(matchCount > 1 ? ['ambiguous' as const] : []), ...(entry.extra ? [entry.extra] : []),
      ...(structure.truncated ? ['truncated-source' as const] : []), 'current-only' as const,
    ] }
  }).filter(entry => entry.matchCount > 0)
}
