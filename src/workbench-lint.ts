import { LineCounter, isMap, isSeq, parseAllDocuments, type Node } from 'yaml'
import { ZodError } from 'zod'

export interface WorkbenchLintIssue { severity: 'advice'; code: 'text-selector' | 'class-selector' | 'fixed-wait' | 'coordinate-selector'; line: number; message: string }
export interface WorkbenchLintBlocker { severity: 'error'; code: 'yaml-syntax' | 'yaml-structure'; line: number; message: string }

/** YAML errors are blocking and intentionally separate from maintenance advice. */
export function lintWorkbenchSyntax(source: string): WorkbenchLintBlocker[] {
  if (Buffer.byteLength(source) > 64 * 1024) return [{ severity: 'error', code: 'yaml-structure', line: 1, message: 'Flow exceeds 64 KiB' }]
  const counter = new LineCounter()
  const docs = parseAllDocuments(source, { lineCounter: counter })
  const errors = docs.flatMap(doc => doc.errors).slice(0, 20)
  if (errors.length) return errors.map(error => ({ severity: 'error', code: 'yaml-syntax', line: counter.linePos(error.pos[0]).line,
    message: error.message.split('\n')[0]!.slice(0, 240) }))
  if (docs.length !== 2) return [{ severity: 'error', code: 'yaml-structure', line: 1, message: 'Use a YAML header, --- and steps' }]
  if (!isMap(docs[0]!.contents) || !isSeq(docs[1]!.contents)) return [{ severity: 'error', code: 'yaml-structure', line: 1, message: 'Use a mapping header and a sequence of steps' }]
  return []
}

/** Position a plan error on the original source, never on reserialized YAML. */
export function validationErrorLine(source: string, error: unknown): number | null {
  if (error && typeof error === 'object' && 'line' in error && typeof error.line === 'number' && error.line > 0) return error.line
  if (!(error instanceof ZodError)) return null
  const path = error.issues[0]?.path
  if (!path?.length) return null
  const counter = new LineCounter()
  const docs = parseAllDocuments(source, { lineCounter: counter })
  let node: Node | null | undefined = docs[0]?.contents as Node | null | undefined
  for (const segment of path) {
    if (isMap(node)) node = node.items.find(item => String((item.key as Node | null)?.toJSON()) === String(segment))?.value as Node | null | undefined
    else if (isSeq(node) && typeof segment === 'number') node = node.items[segment] as Node | null | undefined
    else return null
  }
  return node?.range ? counter.linePos(node.range[0]).line : null
}

/** Maintenance advice only. The existing parser/plan remains the sole execution gate. */
export function lintWorkbenchFlow(source: string): WorkbenchLintIssue[] {
  if (Buffer.byteLength(source) > 64 * 1024) return []
  const counter = new LineCounter()
  const docs = parseAllDocuments(source, { lineCounter: counter })
  if (docs.length !== 2 || docs.some(doc => doc.errors.length)) return []
  const issues: WorkbenchLintIssue[] = []
  const position = (node: Node | null | undefined) => node?.range ? counter.linePos(node.range[0]).line : 0
  function visit(node: Node | null | undefined): void {
    if (!node) return
    if (isSeq(node)) { for (const item of node.items) visit(item as Node); return }
    if (!isMap(node)) return
    for (const pair of node.items) {
      const key = String((pair.key as Node | null)?.toJSON())
      const value = pair.value as Node | null
      if (key === 'wait' && value) {
        const amount = value.toJSON()
        if (typeof amount === 'number' && amount > 3) issues.push({ severity: 'advice', code: 'fixed-wait', line: position(value), message: 'A long fixed wait may be slower or flaky; prefer a structured condition' })
      }
      if (['tap', 'assertVisible', 'assertNotVisible', 'assert', 'type'].includes(key) && value && isMap(value)) {
        const target = key === 'assert' || key === 'type'
          ? value.items.find(item => String((item.key as Node | null)?.toJSON()) === (key === 'assert' ? 'target' : 'into'))?.value as Node | null
          : value
        if (target && isMap(target)) {
          const keys = new Set(target.items.map(item => String((item.key as Node | null)?.toJSON())))
          const line = position(target)
          if (keys.size === 1 && keys.has('text')) issues.push({ severity: 'advice', code: 'text-selector', line, message: 'Text-only selector can change with copy or localization; review stability' })
          if (keys.size === 1 && keys.has('type')) issues.push({ severity: 'advice', code: 'class-selector', line, message: 'Class-only selector can match multiple controls; review uniqueness' })
          if (keys.has('x') || keys.has('y')) issues.push({ severity: 'advice', code: 'coordinate-selector', line, message: 'Coordinate selectors are layout-sensitive; prefer a stable semantic selector' })
        }
      }
      visit(value)
    }
  }
  visit(docs[1]!.contents as Node | null)
  return issues.slice(0, 100)
}
