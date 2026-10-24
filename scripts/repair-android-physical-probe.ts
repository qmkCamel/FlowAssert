import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { stringify } from 'yaml'
import { MirrorService } from '../src/mirror-service.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { emptyProject } from '../src/workbench-project.js'
import { repairProjectSchema } from '../src/workbench-repair-project.js'
import { trustedMissingTap } from '../src/workbench-repair-evidence.js'
import { classifyRepairFailure } from '../src/workbench-repair-admission.js'

// Safe, preinstalled synthetic navigation only: no install, account/order writes,
// model calls, global adb cleanup, or human approval impersonation.
const deviceId = process.env.MOBILE_MIRROR_ANDROID_UDID ?? ''
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
const appiumPort = Number(process.env.MOBILE_MIRROR_ANDROID_APPIUM_PORT ?? '4737')
const systemPort = Number(process.env.MOBILE_MIRROR_ANDROID_SYSTEM_PORT ?? '8207')
if (!deviceId || !isAbsolute(executable) || ![appiumPort, systemPort].every(p => Number.isInteger(p) && p > 1024 && p <= 65535) || appiumPort === systemPort)
  throw new Error('Explicit Android identity, absolute executable and distinct valid ports required')
const appId = 'dev.mobilemirror.fixture'
const root = resolve('artifacts/physical-validation', `repair-android-${new Date().toISOString().replaceAll(':', '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const config = resolveMirrorConfig({ appiumRuntimeMode: 'managed', appiumUrl: `http://127.0.0.1:${appiumPort}`,
  appiumExecutablePath: executable, appiumSessionStartupTimeoutMs: 120000, startupTimeoutMs: 30000,
  viewerMediaMode: 'polling', agentScreenContentPolicy: 'image-and-structure', agentAppControlPolicy: 'session-app' })
const caps = { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:udid': deviceId,
  'appium:systemPort': systemPort, 'appium:appPackage': appId, 'appium:appActivity': `${appId}.MainActivity`,
  'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': true,
  'appium:settings[waitForIdleTimeout]': 0, 'appium:settings[enableNotificationListener]': false,
  'appium:newCommandTimeout': 120 }
const mirror = new MirrorService(config, 'http://127.0.0.1')
let workbench = new WorkbenchService(mirror, { root: resolve(root, 'runs') })
const cases: Array<Record<string, unknown>> = []
const report: Record<string, unknown> = { schemaVersion: 1, root, platform: 'android', physicalDevice: true,
  appId, appiumPort, systemPort, cases, limitations: ['No successful old-build anchor: no admitted locator repair.',
    'No build/install/reset adapter or human digest approval: no device-verified repair claim.',
    'Scoped navigation uses a text anchor and registered Android container, not an App root.'] }
const save = () => writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2))
async function capture(name: string) {
  const obs = await mirror.observe({ image: true, structure: true })
  if (!obs.image || !obs.structure || obs.structure.truncated) throw new Error('Complete image/structure required')
  await writeFile(resolve(root, `${name}.png`), obs.image.bytes)
  await writeFile(resolve(root, `${name}.json`), JSON.stringify(obs.structure, null, 2))
  return obs
}
async function tap(id: string) {
  const obs = await mirror.observe({ image: false, structure: true })
  const matches = obs.structure?.nodes.filter(n => n.identifier === id || n.name === id) ?? []
  if (matches.length !== 1) throw new Error(`Setup target ${id} is not unique (${matches.length})`)
  await mirror.action({ kind: 'tap_node', observationId: obs.observationId, nodeId: matches[0]!.nodeId })
}
try {
  console.log(JSON.stringify({ root, stage: 'connecting', appiumPort, systemPort }))
  await mirror.start({ provider: 'appium', capabilities: caps })
  report.runtime = mirror.state().appiumRuntime
  report.provenance = mirror.runProvenance()
  const rival = new MirrorService(config, 'http://127.0.0.1')
  try {
    await rival.start({ provider: 'appium', capabilities: caps })
    throw new Error('Second owner unexpectedly acquired the Android device')
  } catch (error) {
    report.sameDeviceOwnerRejected = (error as { code?: string }).code === 'mobile_mirror_owner_conflict'
    if (!report.sameDeviceOwnerRejected) throw error
  } finally { await rival.dispose() }
  await mirror.manageApp({ operation: 'activate', appId })
  const initial = await capture('initial')
  if (initial.structure!.nodes.some(n => n.name === 'recovery.reset')) await tap('recovery.reset')
  else if (!initial.structure!.nodes.some(n => n.name === 'recovery.case.id-drift')) await tap('fixture.recovery')
  const scenarios = [
    { name: 'normal-1', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1 },
    { name: 'normal-2', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1 },
    { name: 'missing-old', fixture: 'id-drift', selector: 'recovery.search.old', outcome: 'target-not-found', verdict: 'fail', writes: 0 },
    { name: 'similar', fixture: 'similar', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1 },
    { name: 'ambiguous', fixture: 'ambiguous', selector: 'recovery.search.v2', outcome: 'ambiguous-target', verdict: 'fail', writes: 0 },
    { name: 'disabled', fixture: 'blocked', selector: 'recovery.search.v2', outcome: 'blocked', verdict: 'inconclusive', writes: 0 },
    { name: 'no-node', fixture: 'no-node', selector: 'recovery.search.v2', outcome: 'target-not-found', verdict: 'fail', writes: 0 },
    { name: 'wrong-page-scope', fixture: 'wrong-page', selector: 'recovery.search.v2', outcome: 'blocked', verdict: 'inconclusive', writes: 0, scoped: true },
    { name: 'approved-page-scope', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1, scoped: true },
    { name: 'original-assertion-fails', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'fail', writes: 1, assertion: 'recovery.nonexistent' },
  ]
  for (const scenario of scenarios) {
    await tap(`recovery.case.${scenario.fixture}`)
    const before = await capture(`${scenario.name}-before`)
    report.androidApplicationScopeAvailable = before.structure!.nodes.some(n => n.role === 'application' && n.visible === true && n.name)
    const yaml = `${stringify({ name: `Repair Android ${scenario.name}`, platform: 'android', appId })}---\n${stringify([
      { tap: { accessibilityId: scenario.selector } }, { assertVisible: { accessibilityId: scenario.assertion ?? 'recovery.result' } },
    ])}`
    const project = { ...emptyProject(), flows: { navigation: yaml }, repair: repairProjectSchema.parse({
      projectId: 'physical-repair-navigation', enabled: true, allowedFlows: ['navigation'], allowedPlatforms: ['android'], allowedAppIds: [appId],
      navigation: [{ flow: 'navigation', stepPath: 'root/1', postconditionPath: 'root/2', ...(scenario.scoped ? {
        // Android Material Button exposes uppercase text in the actual XML.
        page: { version: 2, anchor: { role: 'text', name: 'recovery.page', text: 'Recovery navigation fixture' },
          container: { ancestorLevels: 1, platformRole: 'android.widget.LinearLayout' } }, allowedTarget: { role: 'button', text: 'SEARCH' },
      } : {}) }],
    }) }
    const started = await workbench.start(yaml, undefined, undefined, { project, flowId: 'navigation' })
    await workbench.wait()
    const run = await workbench.get(started.id), step = run.steps.find(s => s.kind === 'tap')
    const writes = run.dispatches?.filter(d => d.state !== 'not-dispatched').length ?? 0
    const trustedMissing = step ? Boolean(await trustedMissingTap(workbench.store, run, step)) : false
    const classification = await classifyRepairFailure(workbench.store, run)
    const matched = run.verdict === scenario.verdict && step?.tapFact?.outcome === scenario.outcome
      && writes === scenario.writes && trustedMissing === (scenario.outcome === 'target-not-found')
    cases.push({ scenario: scenario.name, runId: run.id, verdict: run.verdict, outcome: step?.tapFact?.outcome,
      dispatch: step?.tapFact?.dispatch, writes, trustedMissing, classification: classification.kind, matched,
      originalAssertion: scenario.assertion ?? 'recovery.result', error: run.error })
    await save(); console.log(JSON.stringify(cases.at(-1)))
    // A durable blocked/not-dispatched fact proves no side effect even when the
    // product correctly reports inconclusive; never continue after an unknown write.
    if (run.dispatches?.some(d => d.state === 'unknown' || d.state === 'dispatched')
      || (run.verdict === 'inconclusive' && !(step?.tapFact?.dispatch === 'not-dispatched' && writes === 0)))
      throw new Error('Unknown device effect: stop, never replay')
    await capture(`${scenario.name}-after`)
    await tap('recovery.reset')
  }
  await workbench.close()
  workbench = new WorkbenchService(mirror, { root: resolve(root, 'runs') })
  let verifiedFiles = 0
  for (const item of cases) {
    const run = await workbench.get(String(item.runId))
    if (run.verdict !== item.verdict) throw new Error('Restart changed verdict')
    for (const file of [...run.evidence, ...run.steps.flatMap(s => s.evidence)]) { await workbench.store.readEvidence(run.id, file); verifiedFiles++ }
  }
  report.restartVerified = true; report.verifiedFiles = verifiedFiles
  report.complete = cases.length === scenarios.length && cases.every(c => c.matched)
  if (!report.complete) process.exitCode = 1
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1 }
finally {
  await workbench.close()
  try { await mirror.dispose(); report.ownedSessionCleanup = 'complete' }
  catch (error) { report.ownedSessionCleanup = 'failed'; report.cleanupError = String(error); process.exitCode = 1 }
  await save()
  console.log(JSON.stringify({ root, complete: report.complete, cases: cases.length, error: report.error, cleanup: report.ownedSessionCleanup }))
}
