import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { createFixtureProject } from '../fixtures/business/project.js'
import { startFixtureServer } from '../fixtures/business/server.js'
import type { AgentTestControlConfig } from '../src/config.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { TestRunCoordinator } from '../src/test-run-control.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (!isAbsolute(capsPath) || !isAbsolute(executable)) throw new Error('Explicit absolute capabilities and Appium executable paths required')
const capabilities = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platformName = String(capabilities.platformName).toLowerCase()
if (platformName !== 'android' && platformName !== 'ios') throw new Error('Android or iOS required')
const platform = platformName as 'android' | 'ios'
if (!capabilities['appium:udid'] || capabilities['appium:app'] || capabilities['appium:fullReset']) throw new Error('Explicit device, preinstalled fixture and no reset are required')
if ((platform === 'android' ? capabilities['appium:appPackage'] : capabilities['appium:bundleId']) !== 'dev.mobilemirror.fixture') throw new Error('Only the dedicated fixture app is allowed')

const root = resolve('artifacts/physical-validation', `agent-control-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const runsRoot = resolve(root, 'runs')
await mkdir(root, { recursive: true, mode: 0o700 })
const server = await startFixtureServer({ database: resolve(root, 'orders.sqlite'), host: process.env.FIXTURE_HOST ?? '127.0.0.1', port: 47831 })
const projectPath = await createFixtureProject(resolve(root, 'project'), platform, 'http://127.0.0.1:47831', process.env.FIXTURE_DEVICE_URL ?? 'http://127.0.0.1:47831')
const policy: AgentTestControlConfig = {
  enabled: true, projectPath, allowedFlows: ['order'], allowedSuites: ['positive', 'negative'], allowedPlatforms: [platform],
  allowedAppIds: ['dev.mobilemirror.fixture'], sharedEvidence: ['flow', 'plan', 'extension', 'executor-log', 'xml', 'image'],
}
const config = resolveMirrorConfig({
  viewerPort: 0, defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: executable,
  appiumSessionStartupTimeoutMs: 120_000, startupTimeoutMs: 30_000, agentScreenContentPolicy: 'image-and-structure',
  agentTestControl: policy,
})
let runtime: LocalDeviceRuntime | undefined
const report: Record<string, unknown> = { platform, root, cases: [] }
const executions: string[] = []
try {
  runtime = new LocalDeviceRuntime(config, { workbenchRoot: runsRoot })
  await runtime.listen()
  await runtime.service.start({ provider: 'appium', capabilities: {
    ...capabilities,
    'appium:noReset': true,
    'appium:fullReset': false,
    'appium:autoLaunch': true,
    'appium:forceAppLaunch': true,
  } })
  const catalog = await runtime.coordinator.catalog() as { catalogRevision: string }
  const run = async (requestId: string, kind: 'flow' | 'suite', id: string, verdict: string) => {
    const accepted = await runtime!.coordinator.start({ requestId, target: { kind, id }, catalogRevision: catalog.catalogRevision }) as { executionId: string }
    executions.push(accepted.executionId)
    const status = await waitForFinished(runtime!.coordinator, accepted.executionId)
    if (status.verdict !== verdict) throw new Error(`${kind} ${id} expected ${verdict}, received ${String(status.verdict)}`)
    ;(report.cases as unknown[]).push({ requestId, executionId: accepted.executionId, target: `${kind}:${id}`, verdict: status.verdict, runId: status.runId, suiteId: status.suiteId })
  }
  await run(`${platform}-flow`, 'flow', 'order', 'pass')
  await run(`${platform}-positive`, 'suite', 'positive', 'pass')
  await run(`${platform}-negative`, 'suite', 'negative', 'fail')
  const cancel = await runtime.coordinator.start({ requestId: `${platform}-cancel`, target: { kind: 'flow', id: 'order' }, catalogRevision: catalog.catalogRevision }) as { executionId: string }
  executions.push(cancel.executionId)
  await runtime.coordinator.cancel(cancel.executionId)
  const cancelled = await waitForFinished(runtime.coordinator, cancel.executionId)
  if (cancelled.verdict !== 'cancelled') throw new Error(`Cancelled flow reported ${String(cancelled.verdict)}`)
  ;(report.cases as unknown[]).push({ requestId: `${platform}-cancel`, executionId: cancel.executionId, target: 'flow:order', verdict: cancelled.verdict })

  await runtime.close(); runtime = undefined
  const offlineMirror = new MirrorService(resolveMirrorConfig({ viewerPort: 0 }), 'http://127.0.0.1')
  const restarted = new TestRunCoordinator(offlineMirror, policy, { root: runsRoot })
  const hashes: Record<string, string> = {}
  try {
    for (const executionId of executions) {
      const status = await restarted.status({ executionId }) as { phase: string }
      if (status.phase !== 'finished') throw new Error('Restarted coordinator lost a finished execution')
      const evidence = await restarted.evidence({ executionId }) as { items: Array<{ artifactId: string; sha256: string }> }
      for (const item of evidence.items) hashes[`${executionId}/${item.artifactId}`] = item.sha256
    }
  } finally { await restarted.close(); await offlineMirror.dispose() }
  report.restartVerified = true
  report.evidenceDigest = createHash('sha256').update(JSON.stringify(hashes, Object.keys(hashes).sort())).digest('hex')
  report.complete = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  await runtime?.close().catch(() => undefined)
  await server.close()
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

async function waitForFinished(coordinator: TestRunCoordinator, executionId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const status = await coordinator.status({ executionId }) as Record<string, unknown>
    if (status.phase === 'finished') return status
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Agent execution timed out')
}
