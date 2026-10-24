/** Fault-injection probe for an explicitly selected physical Fixture device. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { stringify } from 'yaml'
import { androidAppiumDefaultsFromConfig, iosWdaDefaultsFromConfig } from '../src/config.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { AppiumProvider } from '../src/providers/appium-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchStore, type TestRun } from '../src/workbench-store.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (!isAbsolute(capsPath) || !isAbsolute(executable)) throw new Error('Explicit absolute capabilities and Appium executable required')
const supplied = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platform = String(supplied.platformName).toLowerCase()
const appId = platform === 'ios' ? supplied['appium:bundleId'] : supplied['appium:appPackage']
if (!['ios', 'android'].includes(platform) || appId !== 'dev.mobilemirror.fixture' ||
  typeof supplied['appium:udid'] !== 'string' || !supplied['appium:udid'] ||
  supplied['appium:app'] || supplied['appium:fullReset']) throw new Error('Only an explicit physical device with preinstalled Fixture is allowed')
const caps = { ...supplied, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false }
const root = resolve('artifacts/physical-validation', `reliability-workbench-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const yaml = `${stringify({ name: 'Physical evidence fault', platform, appId })}---\n${stringify(['launchApp', { assertVisible: { text: 'Mirror Fixture · Test Order' } }])}`

class FaultingProvider extends AppiumProvider {
  mode: 'none' | 'source' | 'image' | 'hold-image' = 'none'
  captureEntered = false
  override async snapshot(...args: Parameters<AppiumProvider['snapshot']>): ReturnType<AppiumProvider['snapshot']> {
    if (this.mode === 'image') throw new Error('Injected physical screenshot failure')
    if (this.mode === 'hold-image') {
      this.captureEntered = true
      const signal = args[0]
      await new Promise<void>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('Injected capture gate expired')), 10_000)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
      })
    }
    return super.snapshot(...args)
  }
  override async screenSource(...args: Parameters<AppiumProvider['screenSource']>): ReturnType<AppiumProvider['screenSource']> {
    if (this.mode === 'source') throw new Error('Injected physical XML failure')
    return super.screenSource(...args)
  }
}
class FaultingStore extends WorkbenchStore {
  mode: 'none' | 'disk' | 'manifest' = 'none'
  override async put(...args: Parameters<WorkbenchStore['put']>): ReturnType<WorkbenchStore['put']> {
    if (this.mode === 'disk' && args[1].endsWith('.png')) throw new Error('Injected physical disk-full PNG failure')
    return super.put(...args)
  }
  override async save(run: TestRun): Promise<void> {
    if (this.mode === 'manifest' && run.steps.some(step => step.evidence.length)) throw new Error('Injected physical manifest write failure')
    return super.save(run)
  }
}

const config = resolveMirrorConfig({
  defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: executable,
  appiumSessionStartupTimeoutMs: 120_000, startupTimeoutMs: 30_000,
  agentAppControlPolicy: 'session-app',
})
const provider = new FaultingProvider(config.appiumUrl, iosWdaDefaultsFromConfig(config), androidAppiumDefaultsFromConfig(config))
const store = new FaultingStore(resolve(root, 'runs'))
const mirror = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => provider })
let workbench = new WorkbenchService(mirror, { store })
const cases: Record<string, unknown>[] = []
const report: Record<string, unknown> = { root, platform, cases }
async function saveReport() { await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }) }
async function runCase(name: string, providerMode: FaultingProvider['mode'], storeMode: FaultingStore['mode'], expectedFiles: string[], expectedVerdict: string) {
  provider.mode = providerMode
  store.mode = storeMode
  const started = await workbench.start(yaml)
  await workbench.wait()
  const run = await workbench.get(started.id)
  const first = run.steps[0]
  const files = first?.evidence.map(file => file.name).sort() ?? []
  const verified: string[] = []
  for (const file of first?.evidence ?? []) { await store.readEvidence(run.id, file); verified.push(file.name) }
  const laterStep = run.steps.some(step => step.index > 1)
  const matched = run.verdict === expectedVerdict && JSON.stringify(files) === JSON.stringify(expectedFiles.sort()) &&
    (name === 'baseline' ? run.steps.some(step => step.kind === 'assert' && step.status === 'passed') : !laterStep) &&
    mirror.runOwner === null && run.sessionId === mirror.state().sessionId
  const item = { name, runId: run.id, verdict: run.verdict, expectedVerdict, files, verified, steps: run.steps.map(s => ({ index: s.index, kind: s.kind, status: s.status, checkpointError: s.checkpointError })), laterStep, ownerReleased: mirror.runOwner === null, sameSession: run.sessionId === mirror.state().sessionId, matched, error: run.error }
  cases.push(item); await saveReport()
  if (!matched) throw new Error(`${name}: physical invariant mismatch`)
  return run
}

try {
  console.log(JSON.stringify({ root, stage: 'connecting' }))
  await mirror.start({ provider: 'appium', capabilities: caps })
  // Reopen only the explicitly selected synthetic Fixture from its initial UI.
  // Launch alone can preserve a previous probe's Recovery Lab; do not clear data.
  await mirror.manageApp({ operation: 'terminate', appId })
  // A successful checkpoint first proves that the signed session and Fixture are usable.
  await runCase('baseline', 'none', 'none', ['step-1.png', 'step-1.xml'], 'pass')
  await runCase('xml-failure', 'source', 'none', ['step-1.png'], 'inconclusive')
  await runCase('png-failure', 'image', 'none', ['step-1.xml'], 'inconclusive')
  await runCase('disk-full', 'none', 'disk', ['step-1.xml'], 'inconclusive')
  provider.mode = 'hold-image'; provider.captureEntered = false
  const capturing = await workbench.start(yaml)
  const captureDeadline = Date.now() + 10_000
  while (!provider.captureEntered) {
    if (Date.now() > captureDeadline) throw new Error('Evidence capture did not start')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await workbench.cancel(capturing.id); await workbench.wait()
  const captureRun = await workbench.get(capturing.id)
  const captureMatched = captureRun.verdict === 'cancelled' && !captureRun.steps.some(step => step.index > 1) && mirror.runOwner === null
  cases.push({ name: 'evidence-cancel', runId: captureRun.id, verdict: captureRun.verdict, steps: captureRun.steps.map(step => ({ index: step.index, kind: step.kind, checkpointError: step.checkpointError })), ownerReleased: mirror.runOwner === null, matched: captureMatched })
  await saveReport()
  if (!captureMatched) throw new Error('Evidence cancellation invariant mismatch')
  provider.mode = 'none'
  const manifest = await runCase('manifest-failure', 'none', 'manifest', ['step-1.png', 'step-1.xml'], 'inconclusive')
  store.mode = 'none'
  await workbench.close()
  workbench = new WorkbenchService(mirror, { root: store.root })
  const recovered = await workbench.get(manifest.id)
  const recoveredFiles = recovered.steps[0]?.evidence ?? []
  for (const file of recoveredFiles) await workbench.store.readEvidence(recovered.id, file)
  report.restartRecovery = { verdict: recovered.verdict, recoveredFiles: recoveredFiles.map(file => ({ name: file.name, recovered: file.recovered })) }
  await workbench.close()
  const object = { type: 'object', properties: {}, required: [] }
  const extension = (module: string, role: string, cleanup?: string) => ({ module, role, input: object, output: object, timeoutMs: 30_000, ...(cleanup ? { cleanup } : {}) })
  await writeFile(resolve(root, 'project.json'), JSON.stringify({ extensions: {
    slow: extension('slow.mjs', 'prepare', 'clean'), seed: extension('seed.mjs', 'prepare', 'fail'),
    seedSlowClean: extension('seed.mjs', 'prepare', 'slowClean'),
    clean: extension('clean.mjs', 'cleanup'), fail: extension('fail.mjs', 'cleanup'), slowClean: extension('slow-clean.mjs', 'cleanup'),
  } }))
  await writeFile(resolve(root, 'slow.mjs'), 'export default async (_,ctx)=>{await ctx.registerCleanup({});await new Promise(r=>setTimeout(r,20000));return {}}')
  await writeFile(resolve(root, 'seed.mjs'), 'export default async (_,ctx)=>{await ctx.registerCleanup({});return {}}')
  await writeFile(resolve(root, 'clean.mjs'), 'export default async()=>({})')
  await writeFile(resolve(root, 'fail.mjs'), 'export default async()=>{throw new Error("Injected physical cleanup failure")}')
  await writeFile(resolve(root, 'slow-clean.mjs'), 'export default async()=>{await new Promise(r=>setTimeout(r,3000));return {}}')
  workbench = new WorkbenchService(mirror, { root: store.root, projectPath: resolve(root, 'project.json') })
  const withPrepare = (ref: string) => `${stringify({ name: `Physical ${ref}`, platform, appId, prepare: [{ ref }] })}---\n${stringify(['launchApp', { assertVisible: { text: 'Mirror Fixture · Test Order' } }])}`
  const preparing = await workbench.start(withPrepare('slow'))
  const deadline = Date.now() + 10_000
  let registered = false
  while (!registered) {
    try { registered = JSON.parse(await readFile(resolve(store.root, preparing.id, 'private/resources.json'), 'utf8')).length === 1 }
    catch { /* preparation has not registered its token yet */ }
    if (Date.now() > deadline) throw new Error('Prepare resource was not registered')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await workbench.cancel(preparing.id); await workbench.wait()
  const cancelled = await workbench.get(preparing.id)
  const prepareMatched = cancelled.verdict === 'cancelled' && cancelled.steps.length === 0 && cancelled.resourceCleanup === 'pass' && mirror.runOwner === null
  cases.push({ name: 'prepare-cancel', runId: cancelled.id, verdict: cancelled.verdict, registered, steps: cancelled.steps.length, resourceCleanup: cancelled.resourceCleanup, ownerReleased: mirror.runOwner === null, matched: prepareMatched })
  await saveReport()
  if (!prepareMatched) throw new Error('Prepare cancellation invariant mismatch')
  const cleanupStarted = await workbench.start(withPrepare('seed'))
  await workbench.wait()
  const cleanupRun = await workbench.get(cleanupStarted.id)
  const cleanupMatched = cleanupRun.verdict === 'inconclusive' && cleanupRun.resourceCleanup === 'failed' && cleanupRun.steps.some(step => step.kind === 'assert' && step.status === 'passed') && mirror.runOwner === null
  cases.push({ name: 'cleanup-failure', runId: cleanupRun.id, verdict: cleanupRun.verdict, steps: cleanupRun.steps.map(step => ({ kind: step.kind, status: step.status })), resourceCleanup: cleanupRun.resourceCleanup, ownerReleased: mirror.runOwner === null, matched: cleanupMatched })
  await saveReport()
  if (!cleanupMatched) throw new Error('Cleanup failure invariant mismatch')
  const cleaning = await workbench.start(withPrepare('seedSlowClean'))
  const cleanupDeadline = Date.now() + 30_000
  while ((await workbench.status(cleaning.id)).stage !== 'cleanup') {
    if (Date.now() > cleanupDeadline) throw new Error('Cleanup stage did not start')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await workbench.cancel(cleaning.id); await workbench.wait()
  const cleanupCancelled = await workbench.get(cleaning.id)
  const cleanupCancelMatched = cleanupCancelled.verdict === 'cancelled' && cleanupCancelled.resourceCleanup === 'pass' && mirror.runOwner === null
  cases.push({ name: 'cleanup-cancel', runId: cleanupCancelled.id, verdict: cleanupCancelled.verdict, resourceCleanup: cleanupCancelled.resourceCleanup, ownerReleased: mirror.runOwner === null, matched: cleanupCancelMatched })
  await saveReport()
  if (!cleanupCancelMatched) throw new Error('Cleanup cancellation invariant mismatch')
  report.complete = recovered.verdict === 'inconclusive' && recoveredFiles.length === 2 && recoveredFiles.every(file => file.recovered) && cases.every(c => c.matched)
  if (!report.complete) process.exitCode = 1
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1 }
finally { await workbench.close(); await mirror.dispose(); await saveReport(); console.log(JSON.stringify({ root, complete: report.complete, error: report.error, cases: cases.length })) }
