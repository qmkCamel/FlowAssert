/** Owned physical Fixture faults; Android alias retained for existing callers. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import { stringify } from 'yaml'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { ManagedAppiumRuntime } from '../src/managed-appium-runtime.js'
import { NodeStreamingHostProcessRunner, type StreamingHostProcess } from '../src/streaming-host-process.js'

const execute = promisify(execFile)
const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const appium = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
const mode = process.env.MOBILE_MIRROR_DEVICE_FAULT ?? 'rotation-driver'
if (!isAbsolute(capsPath) || !isAbsolute(appium) || !['rotation-driver', 'disconnect', 'appium-process', 'lock'].includes(mode)) throw new Error('Explicit capabilities/executable and supported fault required')
const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platform = String(caps.platformName).toLowerCase()
if (!['android', 'ios'].includes(platform) || (platform === 'ios' ? caps['appium:bundleId'] : caps['appium:appPackage']) !== 'dev.mobilemirror.fixture' ||
  typeof caps['appium:udid'] !== 'string' || !caps['appium:udid'] || caps['appium:app'] || caps['appium:fullReset']) {
  throw new Error('Only an explicitly selected physical device with the preinstalled Fixture is allowed')
}
const device = caps['appium:udid'] as string
const safeCaps = { ...caps, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false }
const config = resolveMirrorConfig({ defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: appium,
  appiumSessionStartupTimeoutMs: 120_000, startupTimeoutMs: 5_000, viewerMediaMode: 'polling', agentScreenContentPolicy: 'image-and-structure' })
const root = resolve('artifacts/physical-validation', `device-fault-${platform}-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
let ownedProcess: StreamingHostProcess | undefined
const runner = new NodeStreamingHostProcessRunner()
const newMirror = () => new MirrorService(config, 'http://127.0.0.1', { appiumRuntime: new ManagedAppiumRuntime(config, {
  processRunner: { spawn(command, args, options) { ownedProcess = runner.spawn(command, args, options); return ownedProcess } },
}) })
let mirror = newMirror()
let workbench = new WorkbenchService(mirror, { root: resolve(root, 'runs') })
const report: Record<string, unknown> = { platform, mode, complete: false }
const flow = (steps: unknown[]) => `${stringify({ name: 'Physical device fault', platform, appId: 'dev.mobilemirror.fixture' })}---\n${stringify(steps, { aliasDuplicateObjects: false })}`
const title = { assertVisible: { text: 'Mirror Fixture · Test Order' } }
async function baseline() {
  const accepted = await workbench.start(flow(['launchApp', title]))
  await workbench.wait()
  const run = await workbench.get(accepted.id)
  if (run.verdict !== 'pass' || mirror.runOwner !== null) throw new Error('Fixture baseline/owner is not ready')
  return run.id
}
async function capture(name: string) {
  const value = await mirror.observe({ image: true, structure: true })
  if (!value.image || !value.structure?.nodes.length) throw new Error('Physical observation is incomplete')
  await writeFile(resolve(root, `${name}.png`), value.image.bytes, { mode: 0o600 })
  await writeFile(resolve(root, `${name}.json`), JSON.stringify({ orientation: value.orientation, viewport: value.viewport, structure: value.structure }), { mode: 0o600 })
  return value
}
async function until(check: () => Promise<boolean>, timeoutMs: number, label: string) {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`${label} timed out`)
    await new Promise(done => setTimeout(done, 200))
  }
}
async function orientation(value: 'PORTRAIT' | 'LANDSCAPE') {
  const response = await fetch(`${config.appiumUrl}/session/${encodeURIComponent(mirror.state().sessionId!)}/orientation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orientation: value }), signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    await writeFile(resolve(root, `orientation-${value}-error.json`), await response.text(), { mode: 0o600 })
    throw new Error(`Owned rotation injection failed (${response.status})`)
  }
}
async function deviceCommand(name: string, args: Record<string, unknown> = {}) {
  const response = await fetch(`${config.appiumUrl}/session/${encodeURIComponent(mirror.state().sessionId!)}/appium/device/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Owned device command failed (${response.status})`)
  return (await response.json() as { value: unknown }).value
}
async function stopOwnedHelper() {
  if (platform === 'android') {
    await execute('adb', ['-s', device, 'shell', 'am', 'force-stop', 'io.appium.uiautomator2.server'], { timeout: 10_000 })
    return
  }
  // The active device claim and session were created here. Resolve exactly one
  // signed WDA Runner on that device; never kill a process by a broad name match.
  if (!mirror.state().sessionId || typeof caps['appium:updatedWDABundleId'] !== 'string') throw new Error('Explicit signed WDA and owned session required')
  const path = resolve(root, 'wda-processes.json')
  const env = { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' }
  await execute('xcrun', ['devicectl', 'device', 'info', 'processes', '--device', device, '--json-output', path, '--quiet'], { env, timeout: 15_000 })
  const payload = JSON.parse(await readFile(path, 'utf8')) as { result: { runningProcesses: { executable: string; processIdentifier: number }[] } }
  const matches = payload.result.runningProcesses.filter(p => new URL(p.executable).pathname.endsWith('/WebDriverAgentRunner-Runner.app/WebDriverAgentRunner-Runner'))
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]!.processIdentifier)) throw new Error('Ambiguous or missing owned WDA Runner; refusing termination')
  await execute('xcrun', ['devicectl', 'device', 'process', 'terminate', '--device', device, '--pid', String(matches[0]!.processIdentifier), '--kill', '--quiet'], { env, timeout: 15_000 })
}
try {
  await mirror.start({ provider: 'appium', capabilities: safeCaps })
  report.baselineRunId = await baseline()
  const before = await capture('before')
  if (mode === 'rotation-driver') {
    try {
      await orientation('LANDSCAPE')
      const landscape = await capture('landscape')
      if (landscape.orientation !== 'landscape' || landscape.viewport.width <= landscape.viewport.height) throw new Error('Fresh landscape geometry was not observed')
      let rejected = false
      try { await mirror.action({ kind: 'tap', x: 1, y: 1, observationId: before.observationId, coordinateSpace: 'viewport' }) }
      catch { rejected = true }
      if (!rejected) throw new Error('Pre-rotation observation unexpectedly admitted a tap')
      report.rotation = { orientation: landscape.orientation, viewport: landscape.viewport, staleObservationRejected: true }
    } catch (error) {
      if (platform !== 'ios' || !(error instanceof Error) || !/^Owned rotation injection failed \(500\)$/.test(error.message)) throw error
      // XCTest can reject orientation in a portrait-only app. Retain that
      // platform limitation and still advance the independent WDA fault task.
      report.rotation = { supported: false, error: error instanceof Error ? error.message : String(error), freshGeometryPassed: false }
    } finally { await orientation('PORTRAIT') }
    await capture('portrait-restored')
    const accepted = await workbench.start(flow([title, { wait: 3 }, title, { tap: { accessibilityId: 'fixture.help' } }]))
    await until(async () => (await workbench.status(accepted.id)).steps.some(step => step.kind === 'wait' && step.status === 'running'), 15_000, 'Pre-fault wait')
    await stopOwnedHelper()
    await workbench.wait()
    const failed = await workbench.get(accepted.id)
    const laterTap = failed.steps.some(step => step.kind === 'tap')
    report.driverTermination = { runId: failed.id, verdict: failed.verdict, laterTap, ownerReleased: mirror.runOwner === null, retainedFiles: failed.steps.flatMap(step => step.evidence).length }
    if (failed.verdict !== 'inconclusive' || laterTap || mirror.runOwner !== null) throw new Error('Driver failure did not fence later dispatch or release the run owner')
  } else if (mode === 'appium-process') {
    const key = createHash('sha256').update(`${platform}\0${device.normalize('NFKC').trim().toLowerCase()}`).digest('hex')
    const claimPath = resolve(homedir(), '.local/share/mobile-mirror/device-claims', `${key}.json`)
    type Claim = { pid: number; nonce: string; generation: string; state: string }
    const claimed = JSON.parse(await readFile(claimPath, 'utf8')) as Claim
    if (claimed.pid !== process.pid || claimed.state !== 'active' || !ownedProcess || !mirror.state().appiumRuntime.owned) throw new Error('Owned physical runtime/claim required')
    const accepted = await workbench.start(flow([title, { wait: 3 }, title, { tap: { accessibilityId: 'fixture.help' } }]))
    await until(async () => (await workbench.status(accepted.id)).steps.some(step => step.kind === 'wait' && step.status === 'running'), 15_000, 'Pre-server-fault wait')
    // Stop only the concrete process handle created for this probe, never pgrep/killall.
    await ownedProcess.stop(); await ownedProcess.exited
    await workbench.wait()
    const failed = await workbench.get(accepted.id)
    const laterTap = failed.steps.some(step => step.kind === 'tap')
    report.appiumTermination = { runId: failed.id, verdict: failed.verdict, laterTap, ownerReleased: mirror.runOwner === null, retainedFiles: failed.steps.flatMap(step => step.evidence).length }
    if (failed.verdict !== 'inconclusive' || laterTap || mirror.runOwner !== null) throw new Error('Server failure did not fence dispatch/release run owner')
    await workbench.close()
    try { await mirror.stop() } catch { report.productStop = 'uncertain-session-deletion' }
    await mirror.dispose()
    // Operator diagnosis is explicit and separate from product recovery. Only
    // after our managed server is gone can this probe archive its own claim.
    let reachable = true
    try { await fetch(`${config.appiumUrl}/status`, { signal: AbortSignal.timeout(2_000) }) } catch { reachable = false }
    if (reachable) throw new Error('Unexpected listener: refuse owner diagnosis')
    const current = await readFile(claimPath, 'utf8').then(value => JSON.parse(value) as Claim).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (current) {
      if (current.pid !== claimed.pid || current.nonce !== claimed.nonce || current.generation !== claimed.generation) throw new Error('Owner changed: refuse diagnosis')
      const disconnected = newMirror()
      try {
        let conflict: string | undefined
        try { await disconnected.start({ provider: 'appium', capabilities: safeCaps }) } catch (error) { conflict = (error as { code?: string }).code }
        if (conflict !== 'mobile_mirror_owner_conflict') throw new Error('Unresolved physical owner was not fenced')
        report.unresolvedOwnerFenced = true
      } finally { await disconnected.dispose() }
      await stopOwnedHelper()
      await rename(claimPath, resolve(root, 'operator-diagnosed-claim.json'))
      report.operatorClaimArchived = true
    } else report.claimReleasedByProduct = true
    mirror = newMirror()
    workbench = new WorkbenchService(mirror, { root: resolve(root, 'runs') })
  } else if (mode === 'lock') {
    await deviceCommand('lock', { seconds: 0 })
    if (await deviceCommand('is_locked') !== true) throw new Error('Physical lock state not confirmed')
    // Capture the fault state before the assertion. A transient lock followed
    // by biometric/operator unlock is not a successful fault injection.
    await capture('locked')
    const lockedBeforeRun = await deviceCommand('is_locked') === true
    if (!lockedBeforeRun) throw new Error('Physical lock did not persist until assertion admission')
    const accepted = await workbench.start(flow([title]))
    await workbench.wait()
    const failed = await workbench.get(accepted.id)
    const noMutatingSteps = failed.steps.every(step => ['assert', 'done'].includes(step.kind))
    const lockedAfterRun = await deviceCommand('is_locked') === true
    report.lock = { lockedConfirmed: true, lockedBeforeRun, lockedAfterRun, verdict: failed.verdict, steps: failed.steps.length, noMutatingSteps, ownerReleased: mirror.runOwner === null }
    if (!lockedAfterRun) throw new Error('Physical lock did not persist across the assertion; fault injection inconclusive')
    if (!['fail', 'inconclusive'].includes(failed.verdict ?? '') || !noMutatingSteps || mirror.runOwner !== null) throw new Error('Locked fixture was incorrectly accepted')
    process.stdout.write(`${JSON.stringify({ stage: 'locked-failure-captured-manual-unlock', root })}\n`)
    // No guessed passcode or driver unlock: user restores their protected phone.
    await until(async () => await deviceCommand('is_locked') === false, 180_000, 'Manual device unlock')
  } else {
    const actionBefore = mirror.state().lastAction
    process.stdout.write(`${JSON.stringify({ stage: 'ready-for-usb-disconnect', root })}\n`)
    const connected = async () => {
      if (platform === 'ios') {
        // CoreDevice may stay wirelessly paired; inspect the actual USB tree.
        const usb = (await execute('ioreg', ['-p', 'IOUSB', '-l', '-w', '0'], { timeout: 2_000 })).stdout
        return usb.toLowerCase().replaceAll('-', '').includes(device.toLowerCase().replaceAll('-', ''))
      }
      try { return (await execute('adb', ['-s', device, 'get-state'], { timeout: 1_000 })).stdout.trim() === 'device' } catch { return false }
    }
    if (!await connected()) throw new Error('Physical USB presence must be confirmed before removal')
    await until(async () => !await connected(), 180_000, 'Physical USB removal')
    let rejected = false
    try { await mirror.observe({ image: true, structure: true }) } catch { rejected = true }
    if (!rejected) throw new Error('Disconnected physical session unexpectedly returned an observation')
    report.disconnect = { deviceAbsent: true, oldObservationRejected: true, lastActionUnchanged: mirror.state().lastAction === actionBefore }
    if (mirror.state().lastAction !== actionBefore) throw new Error('An unexpected action was dispatched during the USB fault')
    process.stdout.write(`${JSON.stringify({ stage: 'usb-failure-captured-reconnect-device', root })}\n`)
    await until(connected, 180_000, 'Physical USB reconnection')
  }
  await mirror.stop()
  await mirror.start({ provider: 'appium', capabilities: safeCaps })
  report.recoveryRunId = await baseline()
  const recovered = await capture('recovered')
  report.recovery = { freshImage: true, nodes: recovered.structure!.nodes.length, ownerReleased: mirror.runOwner === null }
  report.complete = true
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1 }
finally {
  await workbench.close().catch(() => undefined)
  await mirror.stop().catch(error => { report.stopError = String(error); report.complete = false; process.exitCode = 1 })
  await mirror.dispose().catch(error => { report.cleanupError = String(error); report.complete = false; process.exitCode = 1 })
  report.sessionStopped = mirror.state().lifecycle === 'idle'
  if (!report.sessionStopped || mirror.state().appiumRuntime.owned) { report.complete = false; process.exitCode = 1 }
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ root, ...report }, null, 2)}\n`)
}
