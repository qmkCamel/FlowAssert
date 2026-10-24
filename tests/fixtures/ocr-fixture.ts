import { ocrProfileSchema, decideOcr, ocrHash, type OcrOutput } from '../../src/workbench-ocr-contracts.js'
import { ocrDatasetSchema, type OcrEvaluation, ocrSafetyTags } from '../../src/workbench-ocr-evaluation.js'
import { cropOcrImage, type WorkbenchOcr } from '../../src/workbench-ocr.js'

export const ocrFixtureProfile = ocrProfileSchema.parse({ contractVersion: 1, id: 'title', revision: 1,
  appId: 'com.example.mobilemirror.mock', platform: 'ios', builds: ['mock-1'], pageKey: 'home',
  width: 390, height: 844, orientation: 'portrait', region: { x: 0, y: 0, width: 200, height: 100 },
  identity: { sourceSha256: 'a'.repeat(64), binarySha256: 'b'.repeat(64), capabilities: { contractVersion: 1, helperVersion: '1', osVersion: 'fixture', arch: 'arm64', revisions: [{ revision: 3, languages: ['en-US'] }] } },
  requestRevision: 3, languages: ['en-US'], expected: 'Hello', blockers: ['Blocked'], normalization: { nfc: true, trim: true }, minimumConfidence: .9 })
export function ocrFixtureOutput(text = 'Hello'): OcrOutput {
  return { contractVersion: 1, helperVersion: '1', osVersion: 'fixture', arch: 'arm64', requestRevision: 3, languages: ['en-US'],
    boxes: text ? [{ text, confidence: .99, box: { x: .1, y: .1, width: .7, height: .5 } }] : [] }
}
/** Fabricated gate input solely for unit tests of the approval algorithm; never a quality artifact. */
export function ocrFixtureEvaluation(): OcrEvaluation {
  const profiles = [ocrFixtureProfile, { ...ocrFixtureProfile, id: 'other', pageKey: 'other' }]
  const cases = Array.from({ length: 26 }, (_, i) => ({ id: `case${i}`, profileId: i % 2 ? 'title' : 'other', split: 'frozen', group: i < 20 ? 'admitted' : 'safety', source: 'authorized-real', authorization: 'UNIT TEST ONLY - NOT REAL DATA', imageSha256: ocrHash(i), nearDuplicateGroup: `group${i}`, expected: i >= 20 ? 'inconclusive' : i < 10 ? 'pass' : 'fail', tags: i < 20 ? ['light', 'dark', 'similar-glyph', 'blocker'] : [ocrSafetyTags[i - 20]] }))
  const dataset = ocrDatasetSchema.parse({ contractVersion: 1, frozenAt: '2026-01-01T00:00:00.000Z', profiles, cases })
  return { contractVersion: 1, dataset, datasetDigest: ocrHash(dataset), completedAt: '2026-01-02T00:00:00.000Z', rows: dataset.cases.map((c, i) => {
    const output = ocrFixtureOutput(i >= 20 ? '' : i < 10 ? 'Hello' : 'Wrong')
    return { id: c.id, output, ...decideOcr(profiles.find(p => p.id === c.profileId)!, output), durationMs: i + 1 }
  }) }
}
export function fixtureRecognizer(text = 'Hello'): Pick<WorkbenchOcr, 'preview'> {
  return { async preview(image, value, signal = new AbortController().signal) {
    const profile = ocrProfileSchema.parse(value), source = await cropOcrImage(image, profile, signal), output = ocrFixtureOutput(text)
    return { contractVersion: 1, candidate: true, productionEnabled: false, decision: decideOcr(profile, output), output,
      identity: profile.identity, profileDigest: ocrHash(profile), region: profile.region, durationMs: 1, completedAt: new Date().toISOString(), ...source }
  } }
}
