import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { resolve, relative } from 'node:path'
import { createFixture } from '../../tests/visual-acceptance/fixture.ts'
import { Browser, hash, preflight } from './browser.mjs'
import { acceptance, SCENARIOS } from './results.mjs'

import { runScenario, ALL_SCENARIOS } from './scenarios.mjs'

const exec = promisify(execFile)
const options = process.argv.slice(2)
if (options.some(arg => !['--headless', '--smoke', '--extended'].includes(arg))) throw new Error('Only --headless / --smoke / --extended are supported; arbitrary targets are forbidden')
const root = resolve('artifacts/visual-acceptance', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const abort = new AbortController(), cancel = () => abort.abort(new Error('User cancelled'))
process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
const deadline = setTimeout(() => abort.abort(new Error('Suite budget exceeded')), 20 * 60 * 1000)
let fixture
const results = []
const json = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n')
console.log(`Visual acceptance artifacts: ${root}`)
try {
  const environment = await preflight(root)
  const commit = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const diff = (await exec('git', ['diff', 'HEAD', '--binary'], { maxBuffer: 32 * 1024 * 1024 })).stdout
  const untracked = (await exec('git', ['ls-files', '--others', '--exclude-standard'])).stdout.trim().split('\n').filter(Boolean)
  const untrackedFiles = await Promise.all(untracked.map(async path => ({ path, sha256: hash(await readFile(path)) })))
  await json(`${root}/manifest.json`, { schema: 1, kind: options.includes('--extended') ? 'external-synthetic-eight' : 'external-synthetic-pilot', commit, diffSha256: hash(diff), untrackedFiles, environment, headed: !options.includes('--headless'), budgets: { actions: 30, scenarioMs: 180000, suiteMs: 1200000 }, baseline: 'not-compared', startedAt: new Date().toISOString() })
  fixture = await createFixture(`${root}/fixture`)
  // Deliberate server-boundary probe is kept separate from browser-side side effects.
  const probe = await fetch(`${fixture.origin}/api/runs`, { method: 'POST', body: '{}' })
  await json(`${root}/boundary-probe.json`, { status: probe.status, request: fixture.requests.pop() })
  if (probe.status !== 403) throw new Error('Fixture write boundary did not reject POST')
  await json(`${root}/fixture.json`, { origin: fixture.origin, id: fixture.id, expectedMarker: fixture.expectedMarker, source: 'fresh mock run', noUserArchive: true })
  const variants = options.includes('--smoke') ? ['none'] : ['none', 'fault']
  for (let round = 1; round <= (options.includes('--smoke') ? 1 : 3); round++) {
    for (const scenario of (options.includes('--extended') ? ALL_SCENARIOS : SCENARIOS)) for (const variant of variants.filter(v => v === 'none' || ['VA-01','VA-04','VA-05','VA-07'].includes(scenario))) {
      abort.signal.throwIfAborted()
      const id = `${scenario.toLowerCase()}-${round}-${randomUUID().slice(0, 8)}`
      const directory = `${root}/${id}`; await mkdir(directory)
      const fault = variant === 'none' ? 'none' : { 'VA-01': 'covered-play', 'VA-04': 'shifted-marker', 'VA-05': 'hidden-retry', 'VA-07': 'narrow-overflow' }[scenario]
      fixture.configure(fault, scenario === 'VA-05', scenario)
      const browser = new Browser({ origin: fixture.origin, root: directory, signal: abort.signal, headed: !options.includes('--headless') })
      const result = { id, scenario, round, execution: 'completed', checks: [], evidence: [], visualReview: { status: 'needs-review' }, baseline: 'not-compared', startedAt: new Date().toISOString(), session: browser.session }
      const requestStart = fixture.requests.length
      console.log(`${id}: starting`)
      try {
        const collected = await runScenario(browser, fixture, scenario, async partial => { result.evidence = partial.evidence; result.checks = partial.checks; await json(`${directory}/result.partial.json`, result) })
        result.facts = collected.facts.find(item => item.label === 'initial')?.value ?? collected.facts[0]?.value
        result.observations = collected.facts; result.recovered = collected.facts.find(item => item.label === 'recovered')?.value
        result.checks = collected.checks; result.evidence = collected.evidence
        await json(`${directory}/snapshot.json`, collected.snapshot)
      } catch (error) {
        result.execution = abort.signal.aborted ? 'cancelled' : 'error'; result.error = String(error)
      } finally {
        try { await browser.close() } catch (error) { result.cleanupError = String(error); result.execution = 'error' }
        result.actions = browser.actions; result.finishedAt = new Date().toISOString()
        result.requests = fixture.requests.slice(requestStart)
        result.checks.push({ name: 'read-only-target', pass: result.requests.every(request => request.method === 'GET'), actual: result.requests.filter(request => request.method !== 'GET') })
        result.acceptance = acceptance(result)
        if (result.execution !== 'completed') process.exitCode = 1
        await json(`${directory}/result.json`, result)
        // Fault assignment is a separate calibration key, not reviewer input.
        results.push({ id, scenario, round, variant, fault, acceptance: result.acceptance })
        await json(`${root}/calibration-key.json`, results)
        console.log(`${id}: ${result.execution}; checks=${result.checks.every(check => check.pass) ? 'pass' : 'fail'}; visual=needs-review`)
      }
    }
  }
} catch (error) {
  await json(`${root}/blocked.json`, { execution: abort.signal.aborted ? 'cancelled' : 'blocked', error: String(error) })
  process.exitCode = 1; console.error(String(error))
} finally {
  clearTimeout(deadline)
  if (fixture) { await json(`${root}/requests.json`, fixture.requests); await fixture.close() }
  await writeFile(`${root}/report.md`, `# 外部视觉取证\n\n运行目录：${relative(process.cwd(), root)}\n\n仅合成数据；非真机；无像素基线；未复核不得通过。\n\n${results.map(r => `- ${r.id}: ${r.scenario} / ${r.acceptance}`).join('\n')}\n\n下一步：逐图填写独立 review.json，再运行 gate.mjs。\n`)
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel)
}
