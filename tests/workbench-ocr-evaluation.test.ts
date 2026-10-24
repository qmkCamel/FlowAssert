import { expect, it } from 'vitest'
import { ocrHash } from '../src/workbench-ocr-contracts.js'
import { evaluateOcrDataset, freezeOcrDataset, summarizeOcrEvaluation } from '../src/workbench-ocr-evaluation.js'
import { approveOcrRegistration, requireOcrApproval } from '../src/workbench-ocr-approval.js'
import { ocrFixtureEvaluation, ocrFixtureProfile, fixtureRecognizer } from './fixtures/ocr-fixture.js'

it('reports separate frozen denominators, grouped errors, quantiles and small-sample uncertainty', () => {
  const report = ocrFixtureEvaluation(), summary = summarizeOcrEvaluation(report)
  expect(summary).toMatchObject({ gate: 'candidate-go', defaultProductionEnabled: false, admitted: { cases: 20, errors: 0, rejectionRate: 0, p50Ms: 10, p95Ms: 19 }, safety: { cases: 6, rejectionRate: 1 } })
  expect(summary.admitted.disagreement95[1]).toBeGreaterThan(.1)
  expect(Object.keys(summary.groups)).toEqual(['other', 'title'])
  report.dataset.cases[0]!.source = 'synthetic'; report.datasetDigest = ocrHash(report.dataset)
  expect(summarizeOcrEvaluation(report).reasons).toContain('real-authorized-images-required')
})
it('rejects mutated labels/digests/outputs and detects near-duplicate development leakage', () => {
  const report = ocrFixtureEvaluation()
  report.dataset.cases[0]!.expected = 'fail'
  expect(() => summarizeOcrEvaluation(report)).toThrow('integrity')
  report.datasetDigest = ocrHash(report.dataset)
  expect(summarizeOcrEvaluation(report)).toMatchObject({ gate: 'no-go', admitted: { falsePass: 1 } })
  report.rows[0]!.status = 'fail'
  expect(() => summarizeOcrEvaluation(report)).toThrow('output-mismatch')
  const overlap = ocrFixtureEvaluation()
  overlap.dataset.cases.push({ ...overlap.dataset.cases[0]!, id: 'dev', split: 'development', imageSha256: ocrHash('dev') })
  overlap.rows.push({ ...overlap.rows[0]!, id: 'dev' }); overlap.datasetDigest = ocrHash(overlap.dataset)
  expect(summarizeOcrEvaluation(overlap).reasons).toContain('development-frozen-overlap')
})
it('broken recognition is not a successful safety evaluation; labels and budgets freeze before work', async () => {
  const report = ocrFixtureEvaluation()
  delete report.rows[20]!.output; report.rows[20]!.reason = 'ocr-recognition-unavailable'
  expect(summarizeOcrEvaluation(report).reasons).toContain('recognizer-unavailable')
  const frozen = freezeOcrDataset(report.dataset)
  await expect(evaluateOcrDataset(report.dataset, 'a'.repeat(64), new Map(), fixtureRecognizer())).rejects.toThrow('changed')
  await expect(evaluateOcrDataset(report.dataset, frozen.digest, new Map(), fixtureRecognizer())).rejects.toThrow('integrity-or-budget')
})
it('requires explicit per-profile and project approval; candidates and changed scopes cannot unlock production', () => {
  const registration = { profile: ocrFixtureProfile, evaluation: ocrFixtureEvaluation(), page: { text: 'Hello, harness.' } }, project = ocrHash('project')
  expect(() => requireOcrApproval(registration, project)).toThrow('missing-or-stale')
  expect(() => approveOcrRegistration(registration, project, 'reviewer', false)).toThrow('explicit')
  const approved = approveOcrRegistration(registration, project, 'unit-test-reviewer', true)
  expect(requireOcrApproval(approved, project)).toEqual(approved)
  expect(() => requireOcrApproval(approved, ocrHash('changed'))).toThrow('stale')
  expect(() => requireOcrApproval({ ...approved, page: { text: 'Other' } }, project)).toThrow('stale')
  expect(() => requireOcrApproval(approved, project, { ...ocrFixtureProfile.identity, binarySha256: 'c'.repeat(64) })).toThrow('stale')
  expect(() => requireOcrApproval({ ...approved, profile: { ...approved.profile, revision: 2 } }, project)).toThrow('stale')
  const synthetic = ocrFixtureEvaluation(); synthetic.dataset.cases.forEach(c => { c.source = 'synthetic' }); synthetic.datasetDigest = ocrHash(synthetic.dataset)
  expect(() => approveOcrRegistration({ ...registration, evaluation: synthetic }, project, 'reviewer', true)).toThrow('not-approved')
})
