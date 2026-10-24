import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { evaluateTriageCorpus, evaluationMarkdown } from '../scripts/triage-evaluate.js'
import type { TestRun } from '../src/workbench-store.js'

const id = '192d4ccb-6118-4633-9457-fac1a2df0f5a'
const time = '2026-09-26T00:00:00.000Z'
function run(): TestRun {
  return { schemaVersion: 1, id, name: 'Offline evaluation', yaml: 'fixture', engine: 'test', phase: 'finished', verdict: 'fail',
    startedAt: time, endedAt: time, sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock',
    verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
    cleanup: 'session-retained', steps: [], evidence: [], diagnostics: [{ domain: 'device-driver', code: 'tool-call-failed',
      phase: 'execute', retryable: true, evidenceRefs: [], observedAt: time, message: 'private timeout text' }] }
}
const sample = (expected: string[] = ['environment']) => ({ id: 'case-1', group: 'environment', app: 'fixture', page: 'home', family: 'generic-error',
  origin: 'synthetic', run: run(), gold: { directions: expected, factCodes: ['tool-call-failed'], requiredEvidence: [],
    forbiddenDirections: ['product-behavior', 'locator-change'], limitations: ['no-baseline'] } })

describe('offline triage evaluation', () => {
  it('writes repeatable JSON and Markdown through the offline command', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'triage-eval-'))
    try {
      const input = join(dir, 'corpus.json'), json = join(dir, 'report.json'), markdown = join(dir, 'report.md')
      await writeFile(input, JSON.stringify({ schemaVersion: 1, split: 'development', cases: [sample()] }))
      await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/triage-evaluate.ts', '--input', input, '--json', json, '--markdown', markdown],
        { cwd: process.cwd() })
      expect(JSON.parse(await readFile(json, 'utf8'))).toMatchObject({ precision: null, recall: 0, cases: 1 })
      expect(await readFile(markdown, 'utf8')).toContain('precision: N/A')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('reports N/A precision and zero recall for an all-unknown classifier', () => {
    const result = evaluateTriageCorpus({ schemaVersion: 1, split: 'development', cases: [sample()] })
    expect(result).toMatchObject({ cases: 1, precision: null, recall: 0, abstain: 1, exact: 0, safetyViolations: 0 })
    expect(result.confusion.environment?.unknown).toBe(1)
    expect(evaluationMarkdown(result)).toContain('precision: N/A; recall: 0.0%')
    expect(JSON.stringify(result)).not.toContain('private timeout text')
  })

  it('rejects duplicate IDs and template families crossing groups', () => {
    expect(() => evaluateTriageCorpus({ schemaVersion: 1, split: 'holdout', cases: [sample(), sample()] })).toThrow('Duplicate')
    expect(() => evaluateTriageCorpus({ schemaVersion: 1, split: 'holdout', cases: [sample(),
      { ...sample(), id: 'case-2', group: 'unknown' }] })).toThrow('template family')
  })
})
