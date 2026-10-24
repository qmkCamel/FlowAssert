import { parseAllDocuments } from 'yaml'
import { stepDigest } from './workbench-tap-facts.js'

function ast(yaml: string): unknown[] {
  if (Buffer.byteLength(yaml) > 64 * 1024) throw new Error('repair-unsafe-diff')
  const docs = parseAllDocuments(yaml)
  if (docs.length !== 2 || docs.some(doc => doc.errors.length)) throw new Error('repair-unsafe-diff')
  return docs.map(doc => doc.toJS({ maxAliasCount: 0 }))
}

/** Semantic allowlist, not a line diff: exactly one static locator scalar may change. */
export function assertLocatorOnlyDiff(beforeYaml: string, afterYaml: string, index: number): void {
  const before = ast(beforeYaml), after = ast(afterYaml)
  if (!Number.isSafeInteger(index) || index < 0 || !Array.isArray(before[1]) || !Array.isArray(after[1])
    || before[1].length !== after[1].length || index >= before[1].length) throw new Error('repair-unsafe-diff')
  const locator = (raw: unknown): { key: string; value: string } => {
    if (!raw || typeof raw !== 'object' || Object.keys(raw).length !== 1 || !('tap' in raw)
      || !raw.tap || typeof raw.tap !== 'object' || Object.keys(raw.tap).length !== 1) throw new Error('repair-unsafe-diff')
    const [key, value] = Object.entries(raw.tap)[0]!
    if (!['id', 'accessibilityId'].includes(key) || typeof value !== 'string' || !value || value.includes('{{') || value.includes('${')) throw new Error('repair-unsafe-diff')
    return { key, value }
  }
  const old = locator(before[1][index]), next = locator(after[1][index])
  if (old.key !== next.key || old.value === next.value) throw new Error('repair-unsafe-diff')
  after[1][index] = before[1][index]
  if (stepDigest(before) !== stepDigest(after)) throw new Error('repair-unsafe-diff')
}
