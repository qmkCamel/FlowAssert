/** Capture real runner output, then import without a device session. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'
import { builtinExternalAdapter } from '../src/workbench-external-adapters.js'
const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const appiumUrl = process.env.MOBILE_MIRROR_APPIUM_URL ?? ''
if (!isAbsolute(capsPath) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(appiumUrl)) throw new Error('Explicit private capabilities and loopback Appium URL required')
const root = resolve('artifacts/physical-validation', `appium-junit-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const report: Record<string, unknown> = { complete: false, producer: `node:test ${process.version} + W3C HTTP client`, license: 'MIT (project probe); Node.js license applies to reporter', collectedAt: new Date().toISOString() }
let runtime: LocalDeviceRuntime | undefined
try {
  const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
  if (String(caps.platformName).toLowerCase() !== 'android' || caps['appium:appPackage'] !== 'dev.mobilemirror.fixture' || typeof caps['appium:udid'] !== 'string' || !caps['appium:udid'] || caps['appium:app'] || caps['appium:fullReset']) throw new Error('This report/acceptance capture requires the explicit preinstalled Android Fixture')
  const execute = promisify(execFile)
  const paths = await execute('adb', ['-s', caps['appium:udid'], 'shell', 'pm', 'path', 'dev.mobilemirror.fixture'], { timeout: 10_000 })
  const apk = paths.stdout.trim().match(/^package:(\/data\/app\/[^\n]+\/base\.apk)$/)?.[1]
  if (!apk) throw new Error('One installed Fixture base APK required')
  await execute('adb', ['-s', caps['appium:udid'], 'pull', apk, resolve(root, 'installed-fixture.apk')], { timeout: 30_000 })
  const binarySha256 = createHash('sha256').update(await readFile(resolve(root, 'installed-fixture.apk'))).digest('hex')
  const metadata = await execute('adb', ['-s', caps['appium:udid'], 'shell', 'dumpsys', 'package', 'dev.mobilemirror.fixture'], { timeout: 10_000 })
  const build = metadata.stdout.match(/versionCode=(\d+)/)?.[1]
  if (!build) throw new Error('Installed Fixture build missing')
  const os = (await execute('adb', ['-s', caps['appium:udid'], 'shell', 'getprop', 'ro.build.version.release'], { timeout: 10_000 })).stdout.trim()
  if (!/^[\d.]+$/.test(os)) throw new Error('Android OS release missing')
  const commit = (await execute('git', ['rev-parse', 'HEAD'])).stdout.trim()
  const inputDigest = createHash('sha256').update(await readFile(resolve('scripts/appium-junit-physical-child.ts'))).digest('hex')
  report.declaration = { platform: 'android', appId: 'dev.mobilemirror.fixture', binarySha256, build, commit, source: 'captured-before-run; declaration-not-supply-chain-proof' }
  const args = ['--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=junit', resolve('scripts/appium-junit-physical-child.ts')]
  const child = spawn(process.execPath, args, { env: { ...process.env, MOBILE_MIRROR_JUNIT_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) }); child.stderr.on('data', chunk => { stderr += String(chunk) })
  const exitCode = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('exit', done) })
  await writeFile(resolve(root, 'runner.xml'), stdout, { mode: 0o600 }); await writeFile(resolve(root, 'runner-stderr.log'), stderr, { mode: 0o600 })
  assert.equal(exitCode, 1, 'Exactly the deliberately false assertion should fail')
  assert(stdout.includes('testsuites') && stdout.includes('missing-title') && stdout.includes('skipped'))
  report.command = 'node --import tsx --test --test-concurrency=1 --test-reporter=junit scripts/appium-junit-physical-child.ts (explicit private environment)'
  report.runnerExitCode = exitCode
  report.sourceSha256 = createHash('sha256').update(stdout).digest('hex')
  runtime = new LocalDeviceRuntime(resolveMirrorConfig({ viewerPort: 0 }), { workbenchRoot: resolve(root, 'imports') })
  const image = await readFile(resolve(root, 'fixture.png'))
  const parsed = await builtinExternalAdapter('junit').parse(Buffer.from(stdout), { engine: 'node-test-appium-http', engineVersion: process.versions.node }, AbortSignal.timeout(10_000))
  const job = await runtime.application.externalAssets.preview({ contractVersion: 1, requestKey: randomUUID(), adapter: 'junit', engine: 'node-test-appium-http', engineVersion: process.versions.node,
    declaration: { platform: 'android', appId: 'dev.mobilemirror.fixture', binarySha256, build, commit },
    bindings: parsed.tests.map(test => ({ testId: test.id, logicalTestKey: 'appium-source', inputDigest })),
    report: Buffer.from(stdout).toString('base64'), attachments: [{ label: 'fixture.png', contentType: 'image/png', bytes: image.toString('base64'), testId: parsed.tests[0]!.id }] })
  let preview = await runtime.application.externalAssets.getJob(job.id)
  const deadline = Date.now() + 20_000
  while (!['preview', 'failed', 'cancelled'].includes(preview.phase) && Date.now() < deadline) { await new Promise(done => setTimeout(done, 50)); preview = await runtime.application.externalAssets.getJob(job.id) }
  assert.equal(preview.phase, 'preview')
  await runtime.application.externalAssets.confirm(job.id, { previewDigest: preview.previewDigest, reviewed: true })
  const imported = await runtime.application.externalAssets.get(job.assetId)
  assert.equal(imported.availability, 'verified'); assert.notEqual(imported.asset.parsed.reportedStatus, 'reported-pass')
  const statuses = imported.asset.parsed.tests.map(test => test.reportedStatus)
  assert(statuses.includes('pass') && statuses.includes('fail') && statuses.includes('skipped'))
  const downloaded = await runtime.application.externalAssets.download(job.assetId, imported.asset.attachments[0]!.id)
  assert.deepEqual(downloaded.bytes, image)
  report.import = { assetId: job.assetId, sourceSha256: imported.asset.sourceDigest, statuses, warnings: imported.asset.parsed.warnings, attachmentRoundtrip: true, noDeviceConnectedDuringImport: runtime.service.state().lifecycle === 'idle' }
  const acceptance = runtime.application.acceptanceRecords
  const linked = await acceptance.preview({ contractVersion: 1, repository: 'mobile-mirror-validation', commit, declarationsReviewed: true,
    cells: [{ id: 'appium-source', title: 'Real Appium runner source checks', platform: 'android', appId: 'dev.mobilemirror.fixture', binarySha256, build,
      logicalTestKey: 'appium-source', inputDigest, environment: { os: `android-${os}`, provider: 'appium', driver: 'unknown', viewport: 'unknown', backendEnvironment: 'not-provided' },
      required: ['ui', 'business', 'cleanup', 'evidence'], externalResults: imported.asset.parsed.tests.map(test => ({ assetId: job.assetId, testId: test.id })) }] })
  assert.notEqual(linked.summary.status, 'pass', 'External report must never satisfy native business acceptance')
  assert(linked.summary.cells[0]!.externalResults!.every(result => result.availability === 'verified'))
  const accepted = await acceptance.publish({ id: randomUUID(), expectedRevision: 0, previewId: linked.previewId, previewDigest: linked.previewDigest, requestKey: randomUUID(), reviewed: true })
  let published = await acceptance.getJob(accepted.jobId)
  const publishDeadline = Date.now() + 20_000
  while (!['finished', 'failed', 'cancelled'].includes(published.phase) && Date.now() < publishDeadline) { await new Promise(done => setTimeout(done, 50)); published = await acceptance.getJob(accepted.jobId) }
  assert.equal(published.phase, 'finished')
  report.acceptance = { id: accepted.id, status: linked.summary.status, externalResults: linked.summary.cells[0]!.externalResults, nativePassNotInferred: true }
  report.complete = true
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1 }
finally { await runtime?.close(); await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }); process.stdout.write(`${JSON.stringify({ root, ...report }, null, 2)}\n`) }
