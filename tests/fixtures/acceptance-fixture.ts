import { randomUUID } from 'node:crypto'
import { acceptanceInputSchema, type AcceptanceInput } from '../../src/workbench-change-contracts.js'
import type { AcceptanceSource } from '../../src/workbench-change-source.js'
import { createRunProvenance, createRunVerification } from '../../src/workbench-contracts.js'
import type { TestRun } from '../../src/workbench-domain.js'
import type { WorkbenchStore } from '../../src/workbench-store.js'
export function acceptanceFixture() {
  const at = new Date().toISOString(), id = randomUUID()
  const input: AcceptanceInput = acceptanceInputSchema.parse({ contractVersion: 1, repository: 'example', commit: 'a'.repeat(40), declarationsReviewed: true,
    cells: [{ id: 'checkout', title: '订单', platform: 'ios', appId: 'app.test', binarySha256: 'b'.repeat(64), build: '1', logicalTestKey: 'order', inputDigest: 'c'.repeat(64),
      environment: { os: 'ios', provider: 'mock', driver: 'fixture', viewport: '400x800', backendEnvironment: 'test' }, required: ['ui', 'business', 'cleanup', 'evidence'], runId: id }] })
  const provenance = createRunProvenance({ capturedAt: at, platform: 'ios', runtime: 'test', observed: { appId: 'app.test', appBuild: '1', appBinarySha256: 'b'.repeat(64), os: 'ios', provider: 'mock', driver: 'fixture', viewport: '400x800' }, declared: { sourceCommit: input.commit, backendEnvironment: 'test', required: [] } })
  const verification = createRunVerification(true)
  for (const dimension of Object.values(verification)) if (typeof dimension === 'object') dimension.status = 'pass'
  verification.visual.status = 'not-performed'
  const run: TestRun = { schemaVersion: 1, id, name: 'private token', yaml: 'secret-token', engine: 'test', phase: 'finished', verdict: 'pass', startedAt: at, endedAt: at,
    sessionId: 'secret-session', deviceName: 'private-serial', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'pass',
    cleanup: 'session-retained', resourceCleanup: 'pass', params: { credential: 'password' }, error: '/private/token', evidence: [], steps: [{ index: 1, kind: 'assert', startedAt: at, status: 'passed', evidence: [] }],
    productContract: { contractVersion: 1, summaryRulesVersion: 1, provenance, verification },
    comparison: { contractVersion: 1, logicalTestKey: 'order', inputDigest: 'c'.repeat(64), inputKeyId: 'test', planDigest: 'd'.repeat(64), implementationDigest: 'unknown', executionContext: { platform: 'ios', provider: 'mock', deviceName: 'private', os: 'ios', runtime: 'test', viewport: '400x800' }, appContext: { appId: 'app.test', version: '1', build: '1' } } }
  const sources = new Map<string, AcceptanceSource>([[id, { run, manifestSha256: 'd'.repeat(64), availability: 'verified' }]])
  return { input, run, sources }
}

export async function seedAcceptance(store: WorkbenchStore) {
  await store.init()
  const fixture = acceptanceFixture()
  fixture.run.steps[0]!.evidence = [await store.put(fixture.run.id, 'step-1.xml', '<root/>', 'application/xml'), await store.put(fixture.run.id, 'step-1.png', 'mock-image', 'image/png')]
  await store.save(fixture.run)
  return fixture
}
