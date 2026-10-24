import { SaxesParser } from 'saxes'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { externalLimits, externalParsedSchema, externalResult, type ExternalParsed } from './workbench-external-contracts.js'

const field = (v = '') => { if (v.length > externalLimits.field) throw new Error('external-field-budget'); return v }
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const time = (value?: string) => { if (value === undefined) return undefined; const seconds = Number(value); if (!value.trim() || !Number.isFinite(seconds) || seconds < 0 || seconds * 1000 > Number.MAX_SAFE_INTEGER) throw new Error('external-invalid-time'); return seconds * 1000 }
export function parseExternalReport(bytes: Uint8Array, adapter: string): ExternalParsed {
  if (!bytes.length || bytes.length > externalLimits.report) throw new Error('external-report-budget')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (adapter === 'external-results-v1') {
    const result = z.object({ contractVersion: z.literal(1), generatedAt: z.string().datetime().optional(), tests: z.array(z.object({ name: z.string().max(4096), classname: z.string().max(4096).default(''), status: z.enum(['pass', 'fail', 'error', 'skipped', 'unknown']), durationMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).strict()).max(1000) }).strict().parse(JSON.parse(text))
    const tests = result.tests.map((test, i) => ({ id: sha256(JSON.stringify([i, test.classname, test.name])), path: `tests/${i}`, name: test.name, classname: test.classname, reportedStatus: test.status, ...(test.durationMs === undefined ? {} : { durationMs: test.durationMs }) }))
    const warnings = tests.length ? [] : ['zero-tests']
    return externalParsedSchema.parse({ tests, warnings, reportedStatus: externalResult(tests, warnings), ...(result.generatedAt ? { generatedAt: result.generatedAt } : {}) })
  }
  if (adapter !== 'junit') throw new Error('external-unknown-adapter')
  const tests: ExternalParsed['tests'] = [], warnings = new Set<string>(), stack: Array<{ name: string; path: string; count: number; start: number; claims: Record<string, string>; text: number }> = []
  let current: (ExternalParsed['tests'][number] & { terminals: string[] }) | undefined, nodes = 0
  const parser = new SaxesParser({ xmlns: false })
  parser.on('doctype', () => { throw new Error('external-doctype-forbidden') })
  parser.on('xmldecl', value => { if (value.encoding && !/^utf-?8$/i.test(value.encoding)) throw new Error('external-encoding-unsupported') })
  parser.on('processinginstruction', () => { throw new Error('external-instruction-forbidden') })
  parser.on('error', () => { throw new Error('external-invalid-xml') })
  parser.on('opentag', tag => {
    if (++nodes > 100_000 || stack.length >= 16 || Object.keys(tag.attributes).length > 128) throw new Error('external-xml-budget')
    const name = tag.name, parent = stack.at(-1), attrs = tag.attributes as Record<string, string>
    for (const value of Object.values(attrs)) field(value)
    if (!parent && !['testsuite', 'testsuites'].includes(name)) throw new Error('external-invalid-root')
    const path = `${parent?.path ?? ''}/${name}:${parent ? parent.count++ : 0}`
    const valid = !parent || name === 'testsuite' && ['testsuite', 'testsuites'].includes(parent.name)
      || name === 'testcase' && parent.name === 'testsuite'
      || ['failure', 'error', 'skipped'].includes(name) && parent.name === 'testcase'
      || ['properties', 'system-out', 'system-err'].includes(name) && ['testcase', 'testsuite', 'testsuites'].includes(parent.name)
      || name === 'property' && parent.name === 'properties'
    if (!valid) warnings.add('unknown-result-extension')
    if (name === 'testcase' && (!valid || current)) throw new Error('external-invalid-testcase')
    stack.push({ name, path, count: 0, start: tests.length, claims: attrs, text: 0 })
    if (['testsuite', 'testsuites', 'testcase'].includes(name)) time(attrs.time)
    if (name === 'testcase') {
      if (attrs.status || attrs.result || attrs.assertions) warnings.add('unknown-result-extension')
      if (tests.length >= 1000) throw new Error('external-test-budget')
      if (!attrs.name) warnings.add('missing-test-name')
      current = { id: sha256(JSON.stringify([path, attrs.classname ?? '', attrs.name ?? '', tests.length])), path, name: field(attrs.name), classname: field(attrs.classname), reportedStatus: 'pass', terminals: [], ...(attrs.time === undefined ? {} : { durationMs: time(attrs.time)! }) }
    } else if (current && ['failure', 'error', 'skipped'].includes(name)) current.terminals.push(name)
  })
  const checkText = (value: string) => { const node = stack.at(-1); if (node && (node.text += value.length) > externalLimits.field) throw new Error('external-field-budget') }
  parser.on('text', checkText); parser.on('cdata', checkText)
  parser.on('closetag', () => {
    const node = stack.pop()!
    if (node.name === 'testcase') {
      if (!current) throw new Error('external-invalid-testcase')
      const { terminals, ...test } = current
      if (terminals.length > 1) warnings.add('conflicting-terminal-status')
      test.reportedStatus = terminals.includes('error') ? 'error' : terminals.includes('failure') ? 'fail' : terminals.includes('skipped') ? 'skipped' : 'pass'
      tests.push(test); current = undefined
    }
    if (['testsuite', 'testsuites'].includes(node.name)) {
      const children = tests.slice(node.start), counts: Record<string, number> = { tests: children.length, failures: children.filter(t => t.reportedStatus === 'fail').length, errors: children.filter(t => t.reportedStatus === 'error').length, skipped: children.filter(t => t.reportedStatus === 'skipped').length }
      for (const [key, count] of Object.entries(counts)) if (node.claims[key] !== undefined && (!/^\d+$/.test(node.claims[key]!) || Number(node.claims[key]) !== count)) warnings.add('suite-count-conflict')
    }
  })
  parser.write(text).close()
  if (!tests.length) warnings.add('zero-tests')
  return externalParsedSchema.parse({ tests, warnings: [...warnings].sort(), reportedStatus: externalResult(tests, [...warnings]) })
}
