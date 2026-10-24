import { SaxesParser, type SaxesTagPlain } from 'saxes'
import { screenError } from './screen-errors.js'
import type { ScreenNode, ScreenRect, ScreenStructure } from './types.js'

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024
const MAX_DEPTH = 64
const MAX_NODES = 500
const MAX_FIELD_CODE_POINTS = 512
const MAX_JSON_BYTES = 256 * 1024

export function normalizeScreenSource(
  xml: string,
  platform: 'android' | 'ios' | 'unknown',
): ScreenStructure {
  if (Buffer.byteLength(xml, 'utf8') > MAX_SOURCE_BYTES) throw screenError('screen_observation_too_large')
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw screenError('screen_structure_invalid')

  const normalizedPlatform = platform === 'unknown' && /(?:XCUIElementType|AppiumAUT)/.test(xml) ? 'ios' : platform
  const nodes: ScreenNode[] = []
  const parentStack: Array<string | undefined> = []
  let depth = 0
  let truncatedReason: ScreenStructure['truncatedReason']
  let parseFailure: unknown
  const parser = new SaxesParser({ xmlns: false })

  parser.on('doctype', () => {
    parseFailure = screenError('screen_structure_invalid')
  })
  parser.on('error', (error) => {
    parseFailure = error
  })
  parser.on('opentag', (tag) => {
    depth += 1
    if (parseFailure) return
    if (depth > MAX_DEPTH) {
      truncatedReason ??= 'depth-limit'
      parentStack.push(parentStack.at(-1))
      return
    }
    if (nodes.length >= MAX_NODES) {
      truncatedReason ??= 'node-limit'
      parentStack.push(parentStack.at(-1))
      return
    }

    const node = normalizedPlatform === 'ios'
      ? normalizeIosNode(tag, nodes.length, parentStack.at(-1), markFieldTruncated)
      : normalizeAndroidNode(tag, nodes.length, parentStack.at(-1), markFieldTruncated)
    if (node) {
      nodes.push(node)
      parentStack.push(node.nodeId)
    } else {
      parentStack.push(parentStack.at(-1))
    }
  })
  parser.on('closetag', () => {
    parentStack.pop()
    depth = Math.max(0, depth - 1)
  })

  function markFieldTruncated(): void {
    truncatedReason ??= 'field-limit'
  }

  try {
    parser.write(xml).close()
  } catch (error) {
    parseFailure = error
  }
  if (parseFailure) throw screenError('screen_structure_invalid', parseFailure)

  while (Buffer.byteLength(JSON.stringify({ nodes, truncated: true, truncatedReason: 'json-limit' }), 'utf8') > MAX_JSON_BYTES) {
    nodes.pop()
    truncatedReason = 'json-limit'
    if (nodes.length === 0) throw screenError('screen_observation_too_large')
  }
  return {
    nodes,
    truncated: truncatedReason !== undefined,
    ...(truncatedReason ? { truncatedReason } : {}),
  }
}

function normalizeAndroidNode(
  tag: SaxesTagPlain,
  index: number,
  parentId: string | undefined,
  onFieldTruncated: () => void,
): ScreenNode | null {
  const attributes = attributesOf(tag)
  const platformRole = field(attributes.class ?? tag.name, onFieldTruncated)
  if (tag.name.toLowerCase() === 'hierarchy' && !attributes.class) return null
  const clickable = booleanValue(attributes.clickable)
  const bounds = androidBounds(attributes.bounds)
  const sensitive = booleanValue(attributes.password) === true || isSensitivePlatformRole(platformRole)
  return compactNode({
    nodeId: `n${index}`,
    parentId,
    role: roleFromPlatform(platformRole),
    platformRole,
    identifier: field(attributes['resource-id'], onFieldTruncated),
    name: sensitive ? undefined : field(attributes['content-desc'], onFieldTruncated),
    text: sensitive ? undefined : field(attributes.text, onFieldTruncated),
    value: sensitive ? undefined : field(attributes.value, onFieldTruncated),
    sensitive: sensitive || undefined,
    bounds,
    visible: booleanValue(attributes.displayed ?? attributes.visible),
    enabled: booleanValue(attributes.enabled),
    actionable: clickable,
    focused: booleanValue(attributes.focused),
    selected: booleanValue(attributes.selected),
    checked: booleanValue(attributes.checked),
  })
}

function normalizeIosNode(
  tag: SaxesTagPlain,
  index: number,
  parentId: string | undefined,
  onFieldTruncated: () => void,
): ScreenNode | null {
  const attributes = attributesOf(tag)
  if (tag.name.toLowerCase() === 'appiumaut') return null
  const platformRole = field(attributes.type ?? tag.name, onFieldTruncated)
  const accessible = booleanValue(attributes.accessible)
  const sensitive = isSensitivePlatformRole(platformRole)
  return compactNode({
    nodeId: `n${index}`,
    parentId,
    role: roleFromPlatform(platformRole),
    platformRole,
    identifier: field(attributes.name, onFieldTruncated),
    name: sensitive ? undefined : field(attributes.label ?? attributes.name, onFieldTruncated),
    text: sensitive ? undefined : field(attributes.label, onFieldTruncated),
    value: sensitive ? undefined : field(attributes.value, onFieldTruncated),
    sensitive: sensitive || undefined,
    bounds: iosBounds(attributes),
    visible: booleanValue(attributes.visible),
    enabled: booleanValue(attributes.enabled),
    actionable: accessible,
    focused: booleanValue(attributes.focused),
    selected: booleanValue(attributes.selected),
    checked: booleanValue(attributes.checked),
  })
}

function attributesOf(tag: SaxesTagPlain): Record<string, string> {
  const output: Record<string, string> = {}
  for (const [key, value] of Object.entries(tag.attributes)) {
    output[key] = value
  }
  return output
}

function compactNode(node: Record<string, unknown>): ScreenNode {
  return Object.fromEntries(Object.entries(node).filter(([, value]) => value !== undefined && value !== '')) as unknown as ScreenNode
}

function field(value: string | undefined, onTruncated: () => void): string | undefined {
  if (!value) return undefined
  const codePoints = [...value]
  if (codePoints.length <= MAX_FIELD_CODE_POINTS) return value
  onTruncated()
  return codePoints.slice(0, MAX_FIELD_CODE_POINTS).join('')
}

function booleanValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (value.toLowerCase() === 'true' || value === '1') return true
  if (value.toLowerCase() === 'false' || value === '0') return false
  return undefined
}

function androidBounds(value: string | undefined): ScreenRect | undefined {
  const match = value?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/)
  if (!match) return undefined
  const [x1, y1, x2, y2] = match.slice(1).map(Number)
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2! < x1! || y2! < y1!) return undefined
  return { x: x1!, y: y1!, width: x2! - x1!, height: y2! - y1! }
}

function iosBounds(attributes: Record<string, string>): ScreenRect | undefined {
  const values = [attributes.x, attributes.y, attributes.width, attributes.height].map(Number)
  if (values.some((value) => !Number.isFinite(value)) || values[2]! < 0 || values[3]! < 0) return undefined
  return { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! }
}

function roleFromPlatform(platformRole: string | undefined): ScreenNode['role'] {
  const value = platformRole?.toLowerCase() ?? ''
  if (value.includes('application')) return 'application'
  if (value.includes('button')) return 'button'
  if (value.includes('checkbox')) return 'checkbox'
  if (value.includes('switch')) return 'switch'
  if (value.includes('image')) return 'image'
  if (value === 'xcuielementtypetextview' || value === 'xcuielementtypetexteditor' || value.includes('textfield') || value.includes('searchfield') || value.includes('edittext') || value.includes('autocompletetextview')
    || value.includes('securetext') || value.includes('secure-text')) return 'input'
  if (value.includes('link')) return 'link'
  if (value.includes('scroll')) return 'scroll-view'
  if (value.includes('list') || value.includes('table')) return 'list'
  if (value.includes('cell') || value.includes('item')) return 'list-item'
  if (value.includes('text') || value.includes('label')) return 'text'
  return 'unknown'
}

function isSensitivePlatformRole(platformRole: string | undefined): boolean {
  const value = platformRole?.toLowerCase() ?? ''
  return value.includes('password') || value.includes('securetext') || value.includes('secure-text')
}
