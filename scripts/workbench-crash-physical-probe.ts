/** Kill only our isolated host process while a real physical run is in prepare. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { processIdentity } from '../src/device-owner-claim.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const appiumUrl = process.env.MOBILE_MIRROR_APPIUM_URL ?? ''
if (!isAbsolute(capsPath) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(appiumUrl)) {
  throw new Error('Explicit absolute capabilities path and loopback Appium URL required')
}
const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platform = String(caps.platformName).toLowerCase()
const appId = platform === 'android' ? caps['appium:appPackage'] : caps['appium:bundleId']
if (!['android', 'ios'].includes(platform) || appId !== 'dev.mobilemirror.fixture' ||
  typeof caps['appium:udid'] !== 'string' || !caps['appium:udid'] || caps['appium:app'] || caps['appium:fullReset']) {
  throw new Error('Only an explicit physical device with preinstalled Fixture is allowed')
}
const root = resolve('artifacts/physical-validation', `host-crash-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const object = { type: 'object', properties: {}, required: [] }
await writeFile(resolve(root, 'project.json'), JSON.stringify({ extensions: {
  hold: { module: 'hold.mjs', role: 'prepare', input: object, output: object, timeoutMs: 60_000, cleanup: 'clean' },
  clean: { module: 'clean.mjs', role: 'cleanup', input: object, output: object, timeoutMs: 10_000 },
} }), { mode: 0o600 })
await writeFile(resolve(root, 'hold.mjs'), 'export default async (_,ctx)=>{await ctx.registerCleanup({});await new Promise(r=>setTimeout(r,45000));return {}}', { mode: 0o600 })
await writeFile(resolve(root, 'clean.mjs'), 'export default async()=>({})', { mode: 0o600 })

const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/workbench-crash-physical-child.ts'), capsPath, root, appiumUrl], {
  cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'], env: process.env,
})
let diagnostics = ''
child.stderr.on('data', chunk => { diagnostics = `${diagnostics}${String(chunk)}`.slice(-16_384) })
const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
  child.once('exit', (code, signal) => done({ code, signal }))
})
const report: Record<string, unknown> = { platform, complete: false }
const normalizedDeviceId = (caps['appium:udid'] as string).normalize('NFKC').trim().toLowerCase()
const key = createHash('sha256').update(`${platform}\0${normalizedDeviceId}`).digest('hex')
const claimPath = resolve(homedir(), '.local/share/mobile-mirror/device-claims', `${key}.json`)
type OwnedClaim = { pid: number; nonce: string; generation: string; state: string }
let ownedClaim: OwnedClaim | undefined
let sessionId: string | undefined
try {
  const deadline = Date.now() + 180_000
  let runId = ''
  while (Date.now() < deadline) {
    try {
      sessionId = (JSON.parse(await readFile(resolve(root, 'session.json'), 'utf8')) as { sessionId: string }).sessionId
      runId = await readFile(resolve(root, 'run-id'), 'utf8')
      const tokens = JSON.parse(await readFile(resolve(root, 'runs', runId, 'private/resources.json'), 'utf8')) as unknown[]
      if (tokens.length === 1) break
    } catch { /* The real WDA startup and prepare registration are still in progress. */ }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Physical host exited before prepare registration')
    await new Promise(done => setTimeout(done, 100))
  }
  if (!runId || Date.now() >= deadline) throw new Error('Physical prepare registration timed out')
  ownedClaim = JSON.parse(await readFile(claimPath, 'utf8')) as OwnedClaim
  if (ownedClaim.pid !== child.pid || ownedClaim.state !== 'active') throw new Error('Probe does not own the active physical device claim')
  child.kill('SIGKILL')
  const outcome = await exited
  if (outcome.signal !== 'SIGKILL') throw new Error('Only the isolated physical host should be killed')

  // Reopen the same run store without connecting a device or executing a flow.
  const mirror = new MirrorService(resolveMirrorConfig({ defaultProvider: 'appium', appiumRuntimeMode: 'external', appiumUrl }), 'http://127.0.0.1')
  const workbench = new WorkbenchService(mirror, { root: resolve(root, 'runs'), projectPath: resolve(root, 'project.json') })
  try {
    const recovered = await workbench.get(runId)
    const runIds = (await readdir(resolve(root, 'runs'))).filter(value => /^[0-9a-f-]{36}$/.test(value))
    const matched = recovered.verdict === 'inconclusive' && recovered.resourceCleanup === 'pending' &&
      recovered.steps.length === 0 && runIds.length === 1 && runIds[0] === runId &&
      mirror.state().lifecycle === 'idle' && mirror.runOwner === null
    report.recovery = { verdict: recovered.verdict, resourceCleanup: recovered.resourceCleanup,
      steps: recovered.steps.length, runCount: runIds.length, storeOwnerReclaimed: Boolean(workbench.store.ownerGeneration),
      deviceReconnectOnRead: false, matched }
    if (!matched) throw new Error('Host crash recovery, owner or no-replay invariant mismatch')
    let conflictCode: string | undefined
    try { await mirror.start({ provider: 'appium', capabilities: caps }) }
    catch (error) { conflictCode = (error as { code?: string }).code }
    report.staleOwnerBlocksReconnect = conflictCode === 'mobile_mirror_owner_conflict'
    if (!report.staleOwnerBlocksReconnect) throw new Error('Restart did not block the unresolved physical owner')
    report.complete = true
  } finally { await workbench.close(); await mirror.dispose() }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  report.childDiagnostics = diagnostics ? 'retained privately' : 'none'
  process.exitCode = 1
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await exited
  if (sessionId) {
    const response = await fetch(`${appiumUrl}/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE', signal: AbortSignal.timeout(30_000) }).catch(() => null)
    report.externalSessionCleanup = response?.status ?? 'unavailable'
    const absent = await fetch(`${appiumUrl}/session/${encodeURIComponent(sessionId)}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    report.externalSessionAbsent = absent?.status === 404
    if ((response?.ok || response?.status === 404) && absent?.status === 404 && ownedClaim && child.pid && await processIdentity(child.pid) === null) {
      const current = JSON.parse(await readFile(claimPath, 'utf8')) as OwnedClaim
      if (current.pid === ownedClaim.pid && current.nonce === ownedClaim.nonce && current.generation === ownedClaim.generation) {
        await rename(claimPath, resolve(root, 'diagnosed-stale-device-claim.json'))
        report.diagnosedClaimArchived = true
      }
    }
    if (!report.externalSessionAbsent || (ownedClaim && !report.diagnosedClaimArchived)) { report.complete = false; process.exitCode = 1 }
  } else { report.externalSessionCleanup = 'session id unavailable'; report.complete = false; process.exitCode = 1 }
  await writeFile(resolve(root, 'child-diagnostics.log'), diagnostics, { mode: 0o600 })
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ root, ...report }, null, 2)}\n`)
}
