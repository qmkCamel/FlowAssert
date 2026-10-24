import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { createFixtureProject } from '../fixtures/business/project.js'
import { startFixtureServer } from '../fixtures/business/server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'

// App installation / USB reverse are explicit setup steps, never hidden in this probe.
const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (!isAbsolute(capsPath) || !isAbsolute(executable)) throw new Error('Explicit absolute capabilities and Appium executable paths required')
const caps = JSON.parse(await readFile(capsPath, 'utf8'))
const platform = String(caps.platformName).toLowerCase()
if (platform !== 'android' && platform !== 'ios') throw new Error('Android or iOS required')
const uiOnly = process.env.FIXTURE_UI_ONLY === '1'
if (!caps['appium:udid'] || caps['appium:app'] || caps['appium:fullReset']) throw new Error('Explicit device, preinstalled fixture, no reset required')
if ((platform === 'android' ? caps['appium:appPackage'] : caps['appium:bundleId']) !== 'dev.mobilemirror.fixture') throw new Error('Only the dedicated fixture app is allowed')
const root = resolve('artifacts/physical-validation', `business-fixture-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const host = process.env.FIXTURE_HOST ?? '127.0.0.1'
if (isIP(host) !== 4 || host === '0.0.0.0') throw new Error('Explicit IPv4 interface address required; wildcard binding forbidden')
const base = `http://${host}:47831`
const deviceBase = process.env.FIXTURE_DEVICE_URL ?? base
const project = await createFixtureProject(resolve(root, 'project'), platform, base, deviceBase)
let server = await startFixtureServer({ database: resolve(root, 'orders.sqlite'), host, port: 47831 })
let viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, defaultProvider: 'appium', agentScreenContentPolicy: 'image-and-structure', appiumRuntimeMode: 'managed', appiumExecutablePath: executable, appiumSessionStartupTimeoutMs: 120_000, startupTimeoutMs: 30_000, viewerMediaMode: 'auto' }), { workbenchRoot: resolve(root, 'runs'), workbenchProjectPath: project })
const report: Record<string, unknown> = { platform, root, appId: 'dev.mobilemirror.fixture', cases: [] }
const runIds: string[] = []
report.mode = uiOnly ? 'native-ui-only' : 'business-and-native-ui'
try {
  await viewer.listen()
  await viewer.service.start({ provider: 'appium', capabilities: { ...caps, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false } })
  for (const suiteName of uiOnly ? [] : ['positive', 'negative']) {
    const suite = await viewer.suites.start(suiteName); await viewer.suites.wait()
    const result = await viewer.suites.get(suite.id)
    const runId = result.cases[0]?.attempts[0]
    if (!runId) throw new Error('Missing run')
    runIds.push(runId)
    const run = await viewer.workbench.get(runId)
    ;(report.cases as unknown[]).push({ suiteId: suite.id, runId, suiteName, exitCode: result.exitCode, verdict: run.verdict, businessVerification: run.businessVerification, cleanup: run.resourceCleanup, error: run.error })
    const expected = suiteName === 'positive' ? 'pass' : 'fail'
    if (run.verdict !== expected || run.businessVerification !== expected || run.resourceCleanup !== 'pass' || result.exitCode !== (expected === 'pass' ? 0 : 1)) throw new Error(`${suiteName} did not match expected business result`)
  }
  {
    // Exercise native responsiveness separately from the business suites. The prior
    // fixture is already deleted; a delayed request must never create new data.
    const capture = async (name: string) => {
      const observation = await viewer.service.observe({ image: true, structure: true })
      if (!observation.image) throw new Error('Missing UI capture')
      await writeFile(resolve(root, `${name}.png`), observation.image.bytes)
      await writeFile(resolve(root, `${name}.json`), JSON.stringify(observation.structure, null, 2))
      return observation
    }
    const prior = await capture('ui-before-slow')
    const helpWasVisible = prior.structure!.nodes.some(node => (node.text ?? node.name ?? '').includes('Prepare an ID'))
    const resultText = prior.structure!.nodes.find(node => node.name === 'fixture.result' || node.identifier === 'fixture.result')?.text
      ?? prior.structure!.nodes.find(node => node.text?.startsWith('Submitted: '))?.text
    if (!resultText) throw new Error('No previous success to preserve')
    await server.close()
    server = await startFixtureServer({ database: resolve(root, 'orders.sqlite'), host, port: 47831, submissionDelayMs: platform === 'ios' ? 15000 : 8000 })
    const tap = async (label: string) => {
      const obs = await viewer.service.observe({ image: false, structure: true })
      const node = obs.structure!.nodes.find(n => n.identifier === label || n.name === label)
      if (!node) throw new Error(`Missing ${label}`)
      await viewer.service.action({ kind: 'tap_node', observationId: obs.observationId, nodeId: node.nodeId })
    }
    await tap('fixture.submit')
    await tap('fixture.help')
    const pending = await capture('ui-slow-help')
    const texts = pending.structure!.nodes.map(n => n.text ?? n.name ?? '').join('\n')
    if (!texts.includes('Submitting') || texts.includes('Prepare an ID') === helpWasVisible) throw new Error('Help/progress not interactive during pending request')
    // A timed-out request or the explicit missing-fixture 404 is a controlled
    // failure. URLSession timing is not a fixed wall-clock guarantee: wait for
    // the actual error, never inspect a still-pending frame as a failed result.
    const deadline = Date.now() + 30_000
    let observedFailure = ''
    for (let sample = 0; Date.now() < deadline; sample++) {
      const failed = await capture(`ui-after-delay-${sample}`)
      const texts = failed.structure!.nodes.map(n => n.text ?? n.name ?? '').join('\n')
      observedFailure = ['Network error', 'Submission failed'].find(value => texts.includes(value)) ?? ''
      if (observedFailure) {
        if (!texts.includes(resultText)) throw new Error('Failure did not preserve the prior result')
        await capture('ui-network-failed')
        break
      }
      await new Promise(done => setTimeout(done, 500))
    }
    if (!observedFailure) throw new Error('Controlled request failure did not settle within the budget')
    report.nativeResponsiveness = { progress: true, helpInteractive: true, helpToggledFrom: helpWasVisible, lastSuccessPreserved: true, observedFailure }
  }
  await viewer.close()
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0 }), { workbenchRoot: resolve(root, 'runs'), workbenchProjectPath: project })
  await viewer.listen()
  const hashes: Record<string, string> = {}
  for (const id of runIds) {
    const run = await viewer.workbench.get(id)
    for (const evidence of [...run.evidence, ...run.steps.flatMap(step => step.evidence)]) {
      const data = await viewer.workbench.store.readEvidence(id, evidence)
      hashes[`${id}/${evidence.name}`] = createHash('sha256').update(data).digest('hex')
    }
  }
  report.hashes = hashes; report.complete = true
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1 }
finally {
  await viewer.close(); await server.close()
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
}
