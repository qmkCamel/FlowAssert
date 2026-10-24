import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { sha256, type TestRun } from '../src/workbench-store.js'
import { triageDirectionSchema, type TriageDirection } from '../src/workbench-triage-contracts.js'
import { analyzeTriage, type TriageComparisonContext } from '../src/workbench-triage-rules.js'

const group = z.enum(['product-behavior', 'locator-change', 'environment', 'evidence-gap', 'unknown', 'mixed'])
const caseSchema = z.object({
  id: z.string().min(1).max(120), group, app: z.string().min(1), page: z.string().min(1), family: z.string().min(1),
  origin: z.enum(['real', 'recorded', 'synthetic']),
  run: z.object({ id: z.string().uuid(), phase: z.literal('finished'), steps: z.array(z.unknown()), evidence: z.array(z.unknown()) }).passthrough(),
  comparison: z.unknown().optional(), locatorEvidence: z.array(z.string()).optional(),
  gold: z.object({ directions: z.array(triageDirectionSchema).max(4), factCodes: z.array(z.string()),
    requiredEvidence: z.array(z.string()), forbiddenDirections: z.array(triageDirectionSchema), limitations: z.array(z.string()) }).strict(),
}).strict()
const corpusSchema = z.object({ schemaVersion: z.literal(1), split: z.enum(['development', 'holdout']), cases: z.array(caseSchema) }).strict()

interface Count { cases: number; tp: number; fp: number; fn: number; abstain: number; partial: number; exact: number; evidenceLocated: number }
const empty = (): Count => ({ cases: 0, tp: 0, fp: 0, fn: 0, abstain: 0, partial: 0, exact: 0, evidenceLocated: 0 })
const rate = (numerator: number, denominator: number): number | null => denominator ? numerator / denominator : null
export interface TriageEvaluation {
  schemaVersion: 1; split: 'development' | 'holdout'; corpusSha256: string; rulesVersion: 1; cases: number
  precision: number | null; recall: number | null; abstain: number; partial: number; exact: number; evidenceLocated: number
  groups: Record<string, Count & { precision: number | null; recall: number | null }>
  confusion: Record<string, Record<string, number>>; groupConfusion: Record<string, Record<string, Record<string, number>>>
  failures: { id: string; group: string; expected: TriageDirection[]; predicted: TriageDirection[]; missingEvidence: string[]; forbidden: TriageDirection[] }[]
  safetyViolations: number
}

/** Offline only: gold data never enters the production classifier or packaged runtime. */
export function evaluateTriageCorpus(input: unknown): TriageEvaluation {
  const corpus = corpusSchema.parse(input)
  const seen = new Set<string>(), families = new Map<string, string>()
  const overall = empty(), groups: Record<string, Count> = {}, confusion: Record<string, Record<string, number>> = {}
  const groupConfusion: TriageEvaluation['groupConfusion'] = {}
  const failures: TriageEvaluation['failures'] = []
  let safetyViolations = 0
  for (const sample of corpus.cases) {
    if (seen.has(sample.id)) throw new Error(`Duplicate evaluation case: ${sample.id}`)
    seen.add(sample.id)
    const familyKey = `${sample.app}\0${sample.page}\0${sample.family}`
    const previous = families.get(familyKey)
    if (previous && previous !== sample.group) throw new Error(`A template family spans evaluation groups: ${sample.id}`)
    families.set(familyKey, sample.group)
    const result = analyzeTriage(sample.run as unknown as TestRun, sample.comparison as TriageComparisonContext | undefined, sample.locatorEvidence ?? [])
    const predicted = result.routes.filter(route => route.basis !== 'undetermined').map(route => route.direction)
    const expected = sample.gold.directions
    const missingEvidence = sample.gold.requiredEvidence.filter(ref => !result.facts.some(fact => fact.evidenceRefs.includes(ref)))
    const forbidden = predicted.filter(direction => sample.gold.forbiddenDirections.includes(direction))
    safetyViolations += forbidden.length
    const current = groups[sample.group] ??= empty()
    for (const bucket of [overall, current]) {
      bucket.cases++
      bucket.tp += predicted.filter(direction => expected.includes(direction)).length
      bucket.fp += predicted.filter(direction => !expected.includes(direction)).length
      bucket.fn += expected.filter(direction => !predicted.includes(direction)).length
      bucket.abstain += Number(result.disposition === 'unknown')
      bucket.partial += Number(result.state === 'partial')
      bucket.exact += Number(predicted.length === expected.length && predicted.every(direction => expected.includes(direction)))
      bucket.evidenceLocated += Number(missingEvidence.length === 0)
    }
    for (const actual of expected.length ? expected : ['unknown']) {
      const row = confusion[actual] ??= {}
      const groupRow = (groupConfusion[sample.group] ??= {})[actual] ??= {}
      for (const prediction of predicted.length ? predicted : ['unknown']) {
        row[prediction] = (row[prediction] ?? 0) + 1
        groupRow[prediction] = (groupRow[prediction] ?? 0) + 1
      }
    }
    if (forbidden.length || missingEvidence.length || predicted.length !== expected.length || predicted.some(direction => !expected.includes(direction)))
      failures.push({ id: sample.id, group: sample.group, expected, predicted, missingEvidence, forbidden })
  }
  return { schemaVersion: 1, split: corpus.split, corpusSha256: sha256(JSON.stringify(corpus)), rulesVersion: 1, cases: overall.cases,
    precision: rate(overall.tp, overall.tp + overall.fp), recall: rate(overall.tp, overall.tp + overall.fn),
    abstain: overall.abstain, partial: overall.partial, exact: overall.exact, evidenceLocated: overall.evidenceLocated,
    groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) =>
      [name, { ...count, precision: rate(count.tp, count.tp + count.fp), recall: rate(count.tp, count.tp + count.fn) }])),
    confusion, groupConfusion, failures, safetyViolations }
}

export function evaluationMarkdown(report: TriageEvaluation): string {
  const percent = (value: number | null) => value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`
  const rows = Object.entries(report.groups).map(([name, count]) =>
    `| ${name} | ${count.cases} | ${percent(count.precision)} | ${percent(count.recall)} | ${count.abstain} | ${count.partial} | ${count.exact} | ${count.evidenceLocated} |`)
  return [`# Triage evaluation (${report.split})`, '', `Corpus SHA-256: ${report.corpusSha256}`, `Rules version: ${report.rulesVersion}`, '',
    `Cases: ${report.cases}; precision: ${percent(report.precision)}; recall: ${percent(report.recall)}; safety violations: ${report.safetyViolations}.`,
    '', '| Group | Cases | Precision | Recall | Abstain | Partial | Exact | Evidence located |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows, '', '## Group confusion', '', ...Object.entries(report.groupConfusion).flatMap(([name, actuals]) =>
      Object.entries(actuals).flatMap(([actual, predicted]) => Object.entries(predicted).map(([prediction, count]) =>
        `- ${name}: ${actual} → ${prediction} = ${count}`))), '',
    `Failed cases: ${report.failures.map(item => item.id).join(', ') || 'none'}.`, ''].join('\n')
}

async function main(args: string[]): Promise<void> {
  const options = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!key || !['--input', '--json', '--markdown'].includes(key) || !value || value.startsWith('--') || options.has(key))
      throw new Error('Usage: triage-evaluate --input corpus.json [--json report.json] [--markdown report.md]')
    options.set(key, value)
  }
  const inputPath = options.get('--input')
  if (!inputPath) throw new Error('Missing --input corpus.json')
  const report = evaluateTriageCorpus(JSON.parse(await readFile(inputPath, 'utf8')))
  if (options.get('--json')) await writeFile(options.get('--json')!, `${JSON.stringify(report, null, 2)}\n`)
  if (options.get('--markdown')) await writeFile(options.get('--markdown')!, evaluationMarkdown(report))
  if (!options.get('--json') && !options.get('--markdown')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Evaluation failed'}\n`); process.exitCode = 2 })
