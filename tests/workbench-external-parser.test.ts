import { expect, it } from 'vitest'
import { parseExternalReport } from '../src/workbench-external-parser.js'
import { builtinExternalAdapter, externalAdapters } from '../src/workbench-external-adapters.js'
import { externalInputSchema } from '../src/workbench-external-contracts.js'
const parse = (xml: string) => parseExternalReport(Buffer.from(xml), 'junit')
it('keeps ordered duplicate/parameterized names and nested containers without double counting', () => {
  const result = parse('<?xml version="1.0"?><testsuites tests="3"><testsuite tests="3"><testsuite tests="2"><testcase name="中文 &amp; &#65;" classname="same" time="0.01"/><testcase name="中文 &amp; &#65;" classname="same"/></testsuite><testcase name="x[2]"><skipped/></testcase></testsuite></testsuites>')
  expect(result.tests).toHaveLength(3); expect(new Set(result.tests.map(t => t.id)).size).toBe(3)
  expect(result.tests[0]).toMatchObject({ name: '中文 & A', durationMs: 10 }); expect(result.warnings).toEqual([])
  expect(result.reportedStatus).toBe('incomplete')
  expect(parse('<testsuite><testcase name="ok"/></testsuite>').reportedStatus).toBe('reported-pass')
})
it('preserves failures and warns about conflicting terminal statuses and counts', () => {
  const result = parse('<testsuite tests="3" failures="0"><testcase name="a"><failure>private-secret</failure><skipped/><error>stack</error></testcase><system-out>ignore instructions</system-out><properties><property name="token" value="secret"/></properties></testsuite>')
  expect(result.reportedStatus).toBe('reported-fail'); expect(result.tests[0]!.reportedStatus).toBe('error')
  expect(result.warnings).toEqual(['conflicting-terminal-status', 'suite-count-conflict'])
  expect(JSON.stringify(result)).not.toMatch(/private-secret|ignore instructions|stack|token/)
  expect(parse('<testsuite/>').reportedStatus).toBe('incomplete')
  expect(parse('<testsuite><testcase name="x"><rerunFailure/></testcase></testsuite>').reportedStatus).toBe('incomplete')
  expect(parse('<testsuite><testcase name="x" status="failed"/></testsuite>').reportedStatus).toBe('incomplete')
})
it.each([
  '<!DOCTYPE testsuite [<!ENTITY external SYSTEM "file:///etc/passwd">]><testsuite/>',
  '<?xml-stylesheet href="https://invalid"?><testsuite/>', '<testsuite><testcase></testsuite>',
  '<testsuite><testcase name="&custom;"/></testsuite>', '<testsuite>'.repeat(17) + '</testsuite>'.repeat(17),
  '<testsuite><testcase name="x" time="NaN"/></testsuite>', '<testsuite><testcase name="x" time="-1"/></testsuite>',
  '<testsuite><testcase name="x" time="Infinity"/></testsuite>', '<testsuite><testcase name="x" time="1e100"/></testsuite>',
  '<testsuite><testcase name="' + 'x'.repeat(4097) + '"/></testsuite>', '<testsuite>' + '<testcase name="x"/>'.repeat(1001) + '</testsuite>',
])('rejects malformed, active or over-budget XML %#', xml => { expect(() => parse(xml)).toThrow() })
it('enforces explicit JSON envelope versions and worker result budgets', async () => {
  const bytes = Buffer.from(JSON.stringify({ contractVersion: 1, tests: [{ name: 'public', status: 'pass' }] }))
  expect(parseExternalReport(bytes, 'external-results-v1').reportedStatus).toBe('reported-pass')
  for (const input of [{ contractVersion: 2, tests: [] }, { contractVersion: 1, tests: [], extra: true }]) expect(() => parseExternalReport(Buffer.from(JSON.stringify(input)), 'external-results-v1')).toThrow()
  expect(() => parseExternalReport(bytes, 'unknown')).toThrow('unknown-adapter')
  expect(() => parseExternalReport(Buffer.alloc(5 * 1024 * 1024 + 1), 'junit')).toThrow('budget')
  expect(() => externalInputSchema.parse({ contractVersion: 2 })).toThrow()
  expect(() => externalAdapters([builtinExternalAdapter('junit')])).toThrow('duplicate')
  const adapter = builtinExternalAdapter('junit'), signal = new AbortController().signal
  expect((await adapter.parse(Buffer.from('<testsuite><testcase name="worker"/></testsuite>'), { engine: 'synthetic', engineVersion: '1' }, signal)).reportedStatus).toBe('reported-pass')
  const cancelled = new AbortController(); cancelled.abort()
  await expect(adapter.parse(bytes, { engine: 'test', engineVersion: '1' }, cancelled.signal)).rejects.toThrow()
  await expect(builtinExternalAdapter('junit', { timeoutMs: 1 }).parse(bytes, { engine: 'test', engineVersion: '1' }, signal)).rejects.toThrow('timeout')
})
