import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptanceInputSchema, acceptanceRevisionSchema, acceptanceMarkdown, summarizeAcceptance } from '../src/workbench-change-contracts.js'
import { evaluateAcceptanceCell, NativeAcceptanceSources } from '../src/workbench-change-source.js'
import { WorkbenchStore } from '../src/workbench-store.js'

import { acceptanceFixture } from './fixtures/acceptance-fixture.js'

it('strict input and revision schemas reject unknown versions, fields, duplicates, paths and invalid budgets', () => {
  const { input } = acceptanceFixture()
  for (const patch of [{ contractVersion: 3 }, { credential: 'token' }, { repository: '/private/path' }, { commit: 'abc1234' }, { cells: [] }, { cells: [input.cells[0], input.cells[0]] }, { cells: Array.from({ length: 101 }, (_, i) => ({ ...input.cells[0], id: `c${i}` })) }])
    expect(() => acceptanceInputSchema.parse({ ...input, ...patch })).toThrow()
  expect(() => acceptanceRevisionSchema.parse({ contractVersion: 2 })).toThrow()
})
it('v2 accepts new mandatory dimensions but old passes cannot satisfy them or silently downgrade', () => {
  const { input, sources } = acceptanceFixture()
  const next = acceptanceInputSchema.parse({ ...input, contractVersion: 2, cells: input.cells.map(cell => ({ ...cell, required: [...cell.required, 'health', 'performance'] })) })
  const cell = evaluateAcceptanceCell(next, next.cells[0]!, sources)
  expect(cell.status).toBe('incomplete')
  expect(cell.dimensions).toMatchObject({ health: 'not-performed', performance: 'not-performed' })
  expect(summarizeAcceptance(next, [cell])).toMatchObject({ contractVersion: 2, policyVersion: 2, exitCode: 2 })
  expect(() => acceptanceInputSchema.parse({ ...next, contractVersion: 1 })).toThrow()
})
it('an acceptance revision cannot relabel v1 input/summary as v2 or mix their versions', () => {
  const { input, sources } = acceptanceFixture()
  const summary = summarizeAcceptance(input, [evaluateAcceptanceCell(input, input.cells[0]!, sources)])
  const revision = { contractVersion: 1, id: randomUUID(), revision: 1, previousSha256: null, requestKey: randomUUID(), requestDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), createdAt: new Date().toISOString(), input, summary, references: [] }
  expect(acceptanceRevisionSchema.safeParse(revision).success).toBe(true)
  expect(acceptanceRevisionSchema.safeParse({ ...revision, contractVersion: 2 }).success).toBe(false)
  expect(acceptanceRevisionSchema.safeParse({ ...revision, input: { ...input, contractVersion: 2 } }).success).toBe(false)
})
it('clean declared-scope result is consistent and public exports omit all raw private data', () => {
  const { input, sources } = acceptanceFixture(), cell = evaluateAcceptanceCell(input, input.cells[0]!, sources)
  expect(cell).toMatchObject({ status: 'pass', outcome: 'first-pass', reasons: [] })
  const result = summarizeAcceptance(input, [cell]), md = acceptanceMarkdown(result, new Date().toISOString())
  expect(result.exitCode).toBe(0)
  for (const secret of ['private-serial', 'secret-token', 'password', '/private/token', 'secret-session']) {
    expect(JSON.stringify(result)).not.toContain(secret); expect(md).not.toContain(secret)
  }
  expect(md).toContain('未验证制品供应链')
  expect(() => summarizeAcceptance(input, [])).toThrow('coverage')
})
it.each(['commit', 'app', 'build', 'binary', 'platform', 'scenario', 'params', 'os', 'driver', 'backend', 'unreviewed', 'business', 'import', 'recovered', 'unfinished', 'evidence', 'legacy'])('fails closed for %s without overwriting original facts', cause => {
  const { input, run, sources } = acceptanceFixture(), p = run.productContract!.provenance
  if (cause === 'commit') p.project.sourceCommit.value = '1234567'
  if (cause === 'app') p.app.id.value = 'different.app'
  if (cause === 'build') p.app.build.value = '2'
  if (cause === 'binary') p.app.binarySha256.value = 'e'.repeat(64)
  if (cause === 'platform') run.platform = 'android'
  if (cause === 'scenario') run.comparison!.logicalTestKey = 'another'
  if (cause === 'params') run.comparison!.inputDigest = 'e'.repeat(64)
  if (cause === 'os') p.environment.os.value = 'other'
  if (cause === 'driver') p.environment.driver.value = 'other'
  if (cause === 'backend') p.project.backendEnvironment.value = 'other'
  if (cause === 'unreviewed') input.declarationsReviewed = false
  if (cause === 'business') run.productContract!.verification.business.status = 'not-performed'
  if (cause === 'import') run.source = 'import'
  if (cause === 'recovered') run.verdict = 'recovered'
  if (cause === 'unfinished') run.phase = 'running'
  if (cause === 'evidence') sources.get(run.id)!.availability = 'unavailable'
  if (cause === 'legacy') delete run.productContract
  const before = JSON.stringify(run), result = evaluateAcceptanceCell(input, input.cells[0]!, sources)
  expect(result.status).not.toBe('pass'); expect(result.reasons.length).toBeGreaterThan(0)
  expect(JSON.stringify(run)).toBe(before)
})
it('failed dimension wins over incomplete, while clean followup retains explicitly scoped ancestors', () => {
  const { input, run, sources } = acceptanceFixture()
  const parent = structuredClone(run); parent.id = randomUUID(); parent.verdict = 'fail'; parent.productContract!.provenance.project.sourceCommit.value = 'e'.repeat(40)
  sources.set(parent.id, { run: parent, manifestSha256: 'f'.repeat(64), availability: 'verified' })
  run.parentRunId = parent.id
  expect(evaluateAcceptanceCell(input, input.cells[0]!, sources).status).toBe('incomplete')
  input.cells[0]!.historyRunIds = [parent.id]
  const followup = evaluateAcceptanceCell(input, input.cells[0]!, sources)
  expect(followup).toMatchObject({ status: 'pass', outcome: 'followup-pass', history: [{ verdict: 'fail' }] })
  parent.comparison!.inputDigest = 'e'.repeat(64)
  expect(evaluateAcceptanceCell(input, input.cells[0]!, sources).reasons).toContain('history-scope-mismatch')
  run.productContract!.verification.business.status = 'fail'
  sources.get(run.id)!.availability = 'unavailable'
  expect(summarizeAcceptance(input, [evaluateAcceptanceCell(input, input.cells[0]!, sources)])).toMatchObject({ status: 'fail', exitCode: 1 })
})
it('Markdown encodes active markup and does not produce injected table cells or links', () => {
  const { input, sources } = acceptanceFixture(); input.cells[0]!.title = '<img onerror=x>|[link](evil)'
  const md = acceptanceMarkdown(summarizeAcceptance(input, [evaluateAcceptanceCell(input, input.cells[0]!, sources)]), new Date().toISOString())
  expect(md).not.toContain('<img'); expect(md).not.toContain('[link]'); expect(md).toContain('&#124;')
})
it('pure cancellation exits 130 but missing required evidence takes precedence', () => {
  const { input, run, sources } = acceptanceFixture()
  run.verdict = 'cancelled'
  expect(summarizeAcceptance(input, [evaluateAcceptanceCell(input, input.cells[0]!, sources)])).toMatchObject({ status: 'cancelled', exitCode: 130 })
  sources.get(run.id)!.availability = 'unavailable'
  expect(summarizeAcceptance(input, [evaluateAcceptanceCell(input, input.cells[0]!, sources)])).toMatchObject({ status: 'incomplete', exitCode: 2 })
})
it('native sources hold leases, verify bytes and preserve original manifests on failed verification and cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acceptance-source-')), store = new WorkbenchStore(root)
  try {
    await store.init()
    const { input, run } = acceptanceFixture()
    run.steps[0]!.evidence = [await store.put(run.id, 'step-1.xml', '<root/>', 'application/xml'), await store.put(run.id, 'step-1.png', 'mock', 'image/png')]
    await store.save(run)
    const original = await readFile(join(root, run.id, 'manifest.json'))
    const resolver = new NativeAcceptanceSources(store), lease = await resolver.acquire(input)
    expect(store.hasReadLease(run.id)).toBe(true); expect(lease.sources.get(run.id)!.availability).toBe('verified'); lease.release()
    expect(store.hasReadLease(run.id)).toBe(false)
    await writeFile(join(root, run.id, 'step-1.xml'), 'changed')
    const broken = await resolver.acquire(input); expect(broken.sources.get(run.id)!.availability).toBe('unavailable'); broken.release()
    expect(await readFile(join(root, run.id, 'manifest.json'))).toEqual(original)
    await rm(join(root, run.id, 'step-1.png'))
    const missing = await resolver.acquire(input); expect(missing.sources.get(run.id)!.availability).toBe('unavailable'); missing.release()
    const controller = new AbortController(); controller.abort(new Error('cancelled'))
    await expect(resolver.acquire(input, controller.signal)).rejects.toThrow('cancelled')
    expect(store.hasReadLease(run.id)).toBe(false)
  } finally { await store.close(); await rm(root, { recursive: true, force: true }) }
})
