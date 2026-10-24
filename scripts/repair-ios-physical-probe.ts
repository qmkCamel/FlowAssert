import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import { stringify } from 'yaml'
import { MirrorService } from '../src/mirror-service.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { emptyProject } from '../src/workbench-project.js'
import { repairProjectSchema } from '../src/workbench-repair-project.js'
import { trustedMissingTap } from '../src/workbench-repair-evidence.js'
import { classifyRepairFailure } from '../src/workbench-repair-admission.js'
import { sanitizeWdaSummary } from '../src/wda-errors.js'
import { ManagedAppiumRuntime } from '../src/managed-appium-runtime.js'
import { NodeStreamingHostProcessRunner, type StreamingHostProcess } from '../src/streaming-host-process.js'

// Dedicated synthetic navigation only. Never install the AUT, reset personal
// data, approve a repair, share with a model, submit orders, or kill external WDA.
const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
const appiumPort = Number(process.env.MOBILE_MIRROR_IOS_APPIUM_PORT ?? '4738')
const wdaPort = Number(process.env.MOBILE_MIRROR_IOS_WDA_PORT ?? '8118')
const mjpegPort = Number(process.env.MOBILE_MIRROR_IOS_MJPEG_PORT ?? '9118')
if (!isAbsolute(capsPath) || !isAbsolute(executable) || ![appiumPort, wdaPort, mjpegPort].every(p => Number.isInteger(p) && p > 1024 && p <= 65535)
  || new Set([appiumPort, wdaPort, mjpegPort]).size !== 3) throw new Error('Explicit capabilities/executable and distinct valid ports required')
const appId = 'dev.mobilemirror.fixture', applicationName = 'MirrorFixture'
const supplied = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
if (String(supplied.platformName).toLowerCase() !== 'ios' || supplied['appium:automationName'] !== 'XCUITest'
  || supplied['appium:bundleId'] !== appId || typeof supplied['appium:udid'] !== 'string' || !supplied['appium:udid']
  || supplied['appium:app'] || supplied.app || supplied['appium:fullReset'] || supplied['appium:allowProvisioningDeviceRegistration'])
  throw new Error('Explicit physical iPhone with preinstalled Fixture required; no install/reset/provisioning')
const caps: Record<string, unknown> = { platformName: 'iOS', 'appium:automationName': 'XCUITest',
  'appium:deviceName': 'iPhone', 'appium:udid': supplied['appium:udid'], 'appium:bundleId': appId,
  'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false,
  'appium:allowProvisioningDeviceRegistration': false, 'appium:allowProvisioningUpdates': false,
  'appium:usePreinstalledWDA': true, 'appium:useNewWDA': false,
  'appium:wdaLocalPort': wdaPort, 'appium:wdaRemotePort': 8100,
  'appium:mjpegServerPort': mjpegPort, 'appium:newCommandTimeout': 120 }
for (const key of ['appium:xcodeOrgId', 'appium:xcodeSigningId', 'appium:updatedWDABundleId'])
  if (typeof supplied[key] === 'string') caps[key] = supplied[key]
const root = resolve('artifacts/physical-validation', `repair-ios-${new Date().toISOString().replaceAll(':', '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const wdaProducts = process.env.MOBILE_MIRROR_IOS_WDA_PRODUCTS
if (wdaProducts) {
  if (!isAbsolute(wdaProducts)) throw new Error('Cached signed WDA products need an explicit absolute path')
  // XCUITest updates the per-device xctestrun, so copy rather than mutate the
  // shared installed toolchain. test-without-building never rebuilds the AUT.
  const isolatedProducts = resolve(root, 'wda-products')
  await cp(wdaProducts, isolatedProducts, { recursive: true, errorOnExist: true, force: false })
  const template = process.env.MOBILE_MIRROR_IOS_WDA_XCTESTRUN
  const platformVersion = process.env.MOBILE_MIRROR_IOS_PLATFORM_VERSION
  if (template || platformVersion) {
    if (!template || basename(template) !== template || !template.endsWith('.xctestrun')
      || !platformVersion || !/^\d+\.\d+(?:\.\d+)?$/.test(platformVersion)) throw new Error('Explicit cached xctestrun name and observed iOS version required')
    // Real-device driver 10.19.1 does not populate SDK discovery. Its fallback
    // lookup is per-device OS version; this is a configuration copy, not a
    // relabelled/rebuilt binary. Preserve the original SDK template separately.
    // Appium normalizes physical-device OS versions to major.minor before
    // forwarding them to WDA's xctestrun lookup.
    const normalizedVersion = platformVersion.split('.').slice(0, 2).join('.')
    await copyFile(resolve(isolatedProducts, template), resolve(isolatedProducts, `${supplied['appium:udid']}_${normalizedVersion}.xctestrun`))
    caps['appium:platformVersion'] = platformVersion
  }
  // Select the documented xcodebuild startup path rather than preinstalled WDA.
  delete caps['appium:usePreinstalledWDA']
  caps['appium:useXctestrunFile'] = true
  caps['appium:bootstrapPath'] = isolatedProducts
  caps['appium:derivedDataPath'] = resolve(root, 'wda-derived-data')
  caps['appium:wdaStartupRetries'] = 1
  caps['appium:wdaLaunchTimeout'] = 60000
}
const config = resolveMirrorConfig({ appiumRuntimeMode: 'managed', appiumUrl: `http://127.0.0.1:${appiumPort}`,
  appiumExecutablePath: executable, appiumSessionStartupTimeoutMs: 120000, startupTimeoutMs: 30000,
  viewerMediaMode: 'polling', agentScreenContentPolicy: 'image-and-structure', agentAppControlPolicy: 'session-app' })
let appiumProcess: StreamingHostProcess | undefined
const runner = new NodeStreamingHostProcessRunner()
const runtime = new ManagedAppiumRuntime(config, { processRunner: { spawn(command, args, options) {
  appiumProcess = runner.spawn(command, args, options)
  return appiumProcess
} } })
const mirror = new MirrorService(config, 'http://127.0.0.1', { appiumRuntime: runtime })
let workbench = new WorkbenchService(mirror, { root: resolve(root, 'runs') })
const cases: Array<Record<string, unknown>> = []
const report: Record<string, unknown> = { schemaVersion: 1, platform: 'ios', physicalDevice: true, appId,
  appiumPort, wdaPort, mjpegPort, root, wdaMode: wdaProducts ? 'cached-signed-xctestrun' : 'preinstalled', cases, limitations: ['No old-build anchor, no admitted locator repair.',
    'No candidate build/install identity or trusted reset/namespace: no device-verified repair.',
    'Application container scope must not be mistaken for a uniquely identified current page.'] }
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
  const matches = obs.structure?.nodes.filter(n => n.identifier === id) ?? []
  if (matches.length !== 1) throw new Error(`Fixture setup target ${id} not unique (${matches.length})`)
  await mirror.action({ kind: 'tap_node', observationId: obs.observationId, nodeId: matches[0]!.nodeId })
}
type Scenario = { name: string; fixture: string; selector: string; outcome: string; verdict: string; writes: number;
  scope?: 'title' | 'application' | 'wrong-semantic'; assertion?: string }
const scenarios: Scenario[] = [
  { name: 'normal-1', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1 },
  { name: 'normal-2', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1 },
  { name: 'missing-old', fixture: 'id-drift', selector: 'recovery.search.old', outcome: 'target-not-found', verdict: 'fail', writes: 0 },
  { name: 'similar', fixture: 'similar', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1 },
  { name: 'ambiguous', fixture: 'ambiguous', selector: 'recovery.search.v2', outcome: 'ambiguous-target', verdict: 'fail', writes: 0 },
  { name: 'disabled', fixture: 'blocked', selector: 'recovery.search.v2', outcome: 'blocked', verdict: 'inconclusive', writes: 0 },
  { name: 'no-node', fixture: 'no-node', selector: 'recovery.search.v2', outcome: 'target-not-found', verdict: 'fail', writes: 0 },
  // v2 fixes the positive path; legacy App-only grants are now deliberately refused.
  { name: 'page-title-scope', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'pass', writes: 1, scope: 'title' },
  { name: 'legacy-application-scope', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'blocked', verdict: 'inconclusive', writes: 0, scope: 'application' },
  { name: 'wrong-page-application-scope', fixture: 'wrong-page', selector: 'recovery.search.v2', outcome: 'blocked', verdict: 'inconclusive', writes: 0, scope: 'application' },
  { name: 'wrong-page-title-scope', fixture: 'wrong-page', selector: 'recovery.search.v2', outcome: 'blocked', verdict: 'inconclusive', writes: 0, scope: 'title' },
  { name: 'wrong-semantic', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'blocked', verdict: 'inconclusive', writes: 0, scope: 'wrong-semantic' },
  { name: 'original-assertion-fails', fixture: 'id-drift', selector: 'recovery.search.v2', outcome: 'passed', verdict: 'fail', writes: 1, assertion: 'recovery.nonexistent' },
]
try {
  console.log(JSON.stringify({ root, stage: 'connecting', appiumPort, wdaPort }))
  await mirror.start({ provider: 'appium', capabilities: caps })
  report.runtime = mirror.state().appiumRuntime; report.provenance = mirror.runProvenance()
  const rival = new MirrorService(config, 'http://127.0.0.1')
  try { await rival.start({ provider: 'appium', capabilities: caps }); throw new Error('Second owner unexpectedly acquired the iPhone') }
  catch (error) {
    report.sameDeviceOwnerRejected = (error as { code?: string }).code === 'mobile_mirror_owner_conflict'
    if (!report.sameDeviceOwnerRejected) throw error
  } finally { await rival.dispose() }
  await mirror.manageApp({ operation: 'activate', appId })
  const initial = await capture('initial')
  if (initial.structure!.nodes.some(n => n.identifier === 'recovery.reset')) await tap('recovery.reset')
  else if (!initial.structure!.nodes.some(n => n.identifier === 'recovery.case.id-drift')) await tap('fixture.recovery')
  for (const scenario of scenarios) {
    await tap(`recovery.case.${scenario.fixture}`)
    const before = await capture(`${scenario.name}-before`)
    const yaml = `${stringify({ name: `Repair iOS ${scenario.name}`, platform: 'ios', appId })}---\n${stringify([
      { tap: { accessibilityId: scenario.selector } }, { assertVisible: { accessibilityId: scenario.assertion ?? 'recovery.result' } },
    ])}`
    const project = { ...emptyProject(), flows: { navigation: yaml }, repair: repairProjectSchema.parse({
      projectId: 'physical-repair-ios-navigation', enabled: true, allowedFlows: ['navigation'], allowedPlatforms: ['ios'], allowedAppIds: [appId],
      navigation: [{ flow: 'navigation', stepPath: 'root/1', postconditionPath: 'root/2', ...(scenario.scope ? {
        page: scenario.scope === 'application' ? { role: 'application', name: applicationName }
          : { version: 2, anchor: { role: 'text', identifier: 'recovery.page', text: 'Recovery navigation fixture' },
            container: { ancestorLevels: 1, platformRole: 'XCUIElementTypeOther' } },
        allowedTarget: { role: 'button', text: scenario.scope === 'wrong-semantic' ? 'Delete account' : 'Search' },
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
      expected: { verdict: scenario.verdict, outcome: scenario.outcome, writes: scenario.writes },
      page: before.structure!.nodes.find(n => n.identifier === 'recovery.page')?.text,
      applications: before.structure!.nodes.filter(n => n.role === 'application').map(n => ({ name: n.name, visible: n.visible })),
      error: run.error })
    await save(); console.log(JSON.stringify(cases.at(-1)))
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
  report.executedAll = cases.length === scenarios.length
  report.matched = cases.filter(c => c.matched).length
  report.complete = report.executedAll && cases.every(c => c.matched)
  if (!report.complete) process.exitCode = 1
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.cause instanceof Error) {
    report.startupDiagnostic = sanitizeWdaSummary(error.cause.message, Object.values(supplied))
    const expected = error.cause.message.match(/expected: '([^']+)'/)
    if (expected) {
      report.expectedXctestrun = sanitizeWdaSummary(basename(expected[1]!), Object.values(supplied))
      report.expectedXctestrunDirectory = expected[1]!.replaceAll(String(supplied['appium:udid']), '<device>')
    }
  }
  process.exitCode = 1
}
finally {
  try { await workbench.close() }
  catch (error) { report.workbenchCleanupError = String(error); process.exitCode = 1 }
  try { await mirror.dispose(); report.ownedSessionCleanup = 'complete' }
  catch (error) { report.ownedSessionCleanup = 'failed'; report.cleanupError = String(error); process.exitCode = 1 }
  if (appiumProcess) await writeFile(resolve(root, 'private-appium-startup.log'), `${appiumProcess.stdout}\n${appiumProcess.stderr}`, { mode: 0o600 })
  await save()
  console.log(JSON.stringify({ root, complete: report.complete, matched: report.matched, cases: cases.length, error: report.error, cleanup: report.ownedSessionCleanup }))
}
