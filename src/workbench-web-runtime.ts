import { fork, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { sha256 } from './content-hash.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { WebTestRun } from './workbench-web-contracts.js'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
export async function webBuildIdentity(): Promise<string> {
  const files: string[] = []
  for (const dir of [join(packageRoot, 'viewer'), dirname(fileURLToPath(import.meta.url)), join(packageRoot, 'scripts/web-visual-acceptance')]) {
    for (const name of (await readdir(dir)).sort()) if (/\.(?:ts|js|mjs|json|css|html)$/.test(name)) files.push(`${dir}/${name}`)
  }
  return sha256((await Promise.all(files.map(async path => `${relative(packageRoot, path)}:${sha256(await readFile(path))}`))).join('\n'))
}
export async function assertWebIsolation(aRoot: string, bRoot: string, aOrigin?: string, bOrigin?: string) {
  const [a,b] = await Promise.all([realpath(aRoot),realpath(bRoot)])
  if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep)) throw new Error('Web A/B roots overlap')
  if (aOrigin && bOrigin && new URL(aOrigin).origin === new URL(bOrigin).origin) throw new Error('Web A/B origins overlap')
}
function childClient(child: ChildProcess) {
  const waiting = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  child.on('message', (message: any) => { const item = waiting.get(message?.requestId); if (!item) return; waiting.delete(message.requestId); clearTimeout(item.timer); if (message.error) item.reject(new Error(message.error)); else item.resolve(message.value) })
  child.once('exit', () => { for (const item of waiting.values()) { clearTimeout(item.timer); item.reject(new Error('Owned B process exited')) }; waiting.clear() })
  return (command: string, fields = {}): Promise<any> => new Promise((resolve, reject) => {
    const requestId = randomUUID(), timer = setTimeout(() => { waiting.delete(requestId); reject(new Error('Synthetic B command timeout')) }, 30_000)
    waiting.set(requestId, { resolve, reject, timer }); child.send({ requestId, command, ...fields }, error => { if (error) { clearTimeout(timer); waiting.delete(requestId); reject(error) } })
  })
}
/** Fixed CLI only, no page-provided code or arbitrary target. Called by the shared run admission owner. */
export async function executeWebRun(store: WorkbenchStore, run: WebTestRun, signal: AbortSignal, aOrigin: string) {
  const runtimePath = new URL('../scripts/web-visual-acceptance/browser.mjs', import.meta.url).href
  const scenarioPath = new URL('../scripts/web-visual-acceptance/scenarios.mjs', import.meta.url).href
  const { Browser, cleanEnv, preflight } = await import(runtimePath)
  const { runScenario } = await import(scenarioPath)
  const directory = join(store.root, run.id, 'private'); await mkdir(directory, { recursive: true, mode: 0o700 })
  let child: ChildProcess | undefined, call: ReturnType<typeof childClient> | undefined
  let browser: any
  const persist = () => store.saveRecord(run)
  try {
    run.environment = await preflight(directory); signal.throwIfAborted()
    const bRoot = await mkdtemp(join(tmpdir(), 'mirror-web-target-')); run.resources.bRoot = bRoot
    await assertWebIsolation(store.root, bRoot); run.resources.buildSha256 = await webBuildIdentity(); await persist()
    const source = import.meta.url.endsWith('.ts'), entry = new URL(source ? './web-fixture-child.ts' : './web-fixture-child.js', import.meta.url)
    child = fork(entry, [], { execArgv: source ? ['--import', 'tsx'] : [], env: { ...cleanEnv(), MOBILE_MIRROR_WEB_TESTS: '0', MOBILE_MIRROR_WEB_CHILD: '1' }, stdio: ['ignore','ignore','ignore','ipc'] })
    if (child.pid) run.resources.bPid = child.pid
    await persist(); call = childClient(child)
    const target = await call('start', { root: bRoot }); signal.throwIfAborted()
    await assertWebIsolation(store.root, bRoot, aOrigin, target.origin)
    if (target.pid !== child.pid || target.buildSha256 !== run.resources.buildSha256) throw new Error('B build / process identity mismatch')
    run.resources.bOrigin = target.origin; run.resources.targetRunId = target.id; await persist()
    for (const [index, scenario] of run.input.scenarios.entries()) {
      signal.throwIfAborted(); await call('configure', { fault: run.input.calibration, scenario })
      const step: WebTestRun['steps'][number] = { index: index + 1, kind: scenario, status: 'running', startedAt: new Date().toISOString(), evidence: [], checks: [] }
      run.steps.push(step); await persist()
      const rawRoot = join(directory, scenario); await mkdir(rawRoot)
      browser = new Browser({ origin: target.origin, root: rawRoot, signal, headed: true })
      step.session = browser.session; run.resources.sessions.push(browser.session); await persist()
      const captured = new Set<string>()
      const checkpoint = async (result: any) => {
        for (const file of result.evidence) if (!captured.has(file.path)) {
          const bytes = await readFile(resolve(rawRoot, file.path)); if (sha256(bytes) !== file.sha256) throw new Error('Captured image changed')
          step.evidence.push(await store.put(run.id, `${scenario.toLowerCase()}-${file.path.split('/').at(-1)}`, bytes, 'image/png')); captured.add(file.path)
        }
        step.checks = result.checks; step.facts = result.facts; await persist()
      }
      try {
        const result = await runScenario(browser, { ...target, restoreEvidence: () => call!('restoreEvidence'), holdSlow: () => call!('holdSlow'), releaseSlow: () => call!('releaseSlow') }, scenario, checkpoint)
        signal.throwIfAborted(); await checkpoint(result)
        step.evidence.push(await store.put(run.id, `${scenario.toLowerCase()}-page.json`, JSON.stringify(result.snapshot), 'application/json'))
        step.evidence.push(await store.put(run.id, `${scenario.toLowerCase()}-facts.json`, JSON.stringify(result.facts), 'application/json'))
        step.execution = 'completed'; step.status = step.checks.every(item => item.pass) ? 'passed' : 'failed'
      } catch (error) { step.error = String(error); step.execution = signal.aborted ? 'cancelled' : 'error'; step.status = 'failed'; if (signal.aborted) throw error }
      finally {
        try { await browser.close() } catch (error) { run.cleanup = 'failed'; throw error } finally { step.actions = browser.actions; browser = undefined; step.endedAt = new Date().toISOString(); await persist() }
        try { step.evidence.push(await store.put(run.id, `${scenario.toLowerCase()}-commands.txt`, await readFile(join(rawRoot, 'steps.jsonl')), 'text/plain')); await persist() } catch (error) { step.error = `Command evidence unavailable: ${String(error)}`; step.status = 'failed' }
      }
    }
  } finally {
    run.phase = signal.aborted ? 'cancelling' : 'finalizing'; await persist()
    if (browser) { try { await browser.close() } catch { run.cleanup = 'failed' } }
    if (call && child?.connected) { try { run.evidence.push(await store.put(run.id, 'web-requests.json', JSON.stringify(await call('requests')), 'application/json')) } catch { run.cleanup = 'failed' } }
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>(done => child!.once('exit', () => done()))
      child.kill('SIGTERM')
      const kill = setTimeout(() => child!.kill('SIGKILL'), 10_000)
      await stopped; clearTimeout(kill)
    }
    if (run.cleanup !== 'failed') run.cleanup = 'complete'
    await persist()
  }
}
