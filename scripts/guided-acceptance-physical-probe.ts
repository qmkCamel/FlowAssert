/** Explicit preinstalled Fixture: readiness, assistant capabilities, immutable diagnosis. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { isIP } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { chromium, expect } from '@playwright/test'
import { stringify } from 'yaml'
import { createFixtureProject } from '../fixtures/business/project.js'
import { startFixtureServer } from '../fixtures/business/server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (!isAbsolute(capsPath) || !isAbsolute(executable)) throw new Error('Explicit absolute capabilities and Appium executable required')
const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platform = String(caps.platformName).toLowerCase()
if (!['android', 'ios'].includes(platform) || !caps['appium:udid'] || caps['appium:app'] || caps['appium:fullReset'] ||
  (platform === 'android' ? caps['appium:appPackage'] : caps['appium:bundleId']) !== 'dev.mobilemirror.fixture') throw new Error('Explicit preinstalled Fixture without reset required')
const root = resolve('artifacts/physical-validation', `guided-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const database = resolve(root, 'orders.sqlite')
// A physical iPhone needs an explicitly authorized LAN address. Never widen the
// default or bind all interfaces; both host hooks and phone use the same origin.
const host = process.env.FIXTURE_HOST ?? '127.0.0.1'
if (isIP(host) !== 4 || host === '0.0.0.0') throw new Error('Explicit IPv4 interface address required; wildcard binding forbidden')
const base = `http://${host}:47831`
const deviceBase = process.env.FIXTURE_DEVICE_URL ?? base
const projectPath = await createFixtureProject(resolve(root, 'project'), platform as 'android' | 'ios', base, deviceBase)
const server = await startFixtureServer({ database, host, port: 47831 })
const existing = await readFile(resolve(root, 'project/order.yaml'), 'utf8')
// XCUITest exposes SwiftUI accessibilityIdentifier separately from the label;
// Android's synthetic Fixture exposes these IDs as accessible names.
const target = (id: string) => platform === 'ios' ? { testId: id } : { name: id }
// XCTest's before/after active-element reads consume real command time. Include
// those focus/dispatch checks in one explicit bounded budget, not mutation retries.
const inputBudget = platform === 'ios' ? { timeoutMs: 30_000 } : {}
const yaml = existing.slice(0, existing.indexOf('---\n') + 4) + stringify([
  'launchApp',
  { assertReady: { target: { text: 'Mirror Fixture · Test Order' } } },
  { fillReady: { target: target('fixture.endpoint'), text: deviceBase, mode: 'replace', ...inputBudget } },
  { fillReady: { target: target('fixture.id'), text: '{{ outputs.seed.id }}', mode: 'replace', ...inputBudget } },
  { tapReady: { target: target('fixture.submit') } },
  { waitFor: { target: { text: 'Order submitted' }, state: 'visible' } },
  { assertReady: { target: { text: 'Order submitted' } } },
])
await writeFile(resolve(root, 'ready-order.yaml'), yaml, { mode: 0o600 })
const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: executable,
  appiumSessionStartupTimeoutMs: 120_000, startupTimeoutMs: 30_000 }), { workbenchRoot: resolve(root, 'runs'), workbenchProjectPath: projectPath })
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const report: Record<string, unknown> = { platform, complete: false }
try {
  await viewer.listen()
  await viewer.service.start({ provider: 'appium', capabilities: { ...caps, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false } })
  const failed = await viewer.workbench.start(yaml, undefined, undefined, { params: { expectedAmount: 999 } })
  await viewer.workbench.wait()
  const negative = await viewer.workbench.get(failed.id)
  assert.equal(negative.verdict, 'fail'); assert.equal(negative.businessVerification, 'fail'); assert.equal(negative.resourceCleanup, 'pass')
  const manifest = resolve(root, 'runs', failed.id, 'manifest.json')
  const before = await readFile(manifest)
  const child = await viewer.workbench.start(yaml, failed.id, undefined, { params: { expectedAmount: 1200 } })
  await viewer.workbench.wait()
  const positive = await viewer.workbench.get(child.id)
  assert.equal(positive.verdict, 'pass'); assert.equal(positive.businessVerification, 'pass'); assert.equal(positive.resourceCleanup, 'pass')
  const plan = await viewer.application.investigation.inspect(failed.id, child.id)
  assert(plan.plan.checks.some(check => check.id === 'verify-business'))
  assert.equal(plan.followup?.observation, 'followup-clean-not-causal-proof')
  assert.equal(plan.followup?.paramsChanged, true)
  assert.deepEqual(await readFile(manifest), before)
  await writeFile(resolve(root, 'investigation.json'), JSON.stringify(plan, null, 2), { mode: 0o600 })
  browser = await chromium.launch({ headless: true, ...(!existsSync(chromium.executablePath()) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  await page.goto(viewer.url); await page.locator('#language-select').selectOption('en'); await page.locator('#workbench-toggle').click()
  await page.locator('#wb-acceptance > summary').click()
  await page.locator('#acceptance-platform').selectOption(platform)
  await page.locator('#acceptance-app').fill('dev.mobilemirror.fixture')
  await page.locator('#acceptance-expected').fill('Mirror Fixture · Test Order')
  page.once('dialog', dialog => dialog.accept())
  await page.locator('#acceptance-template').click()
  await page.route('**/api/workbench/drafts/validate', async route => { await new Promise(done => setTimeout(done, 700)); await route.continue() })
  await page.locator('#acceptance-validate').click()
  await expect(page.locator('#acceptance-status')).toContainText('Validating')
  await expect(page.locator('#acceptance-validate')).toBeDisabled()
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#language-select').selectOption('en')
  await expect(page.locator('#acceptance-validation')).toContainText('Structure validated')
  report.assistantInteraction = { correctPlatformAndApp: true, localProgress: true, duplicateSubmissionBlocked: true, languageResponsiveDuringValidation: true }
  await page.locator('#wb-acceptance details > summary').click()
  await page.locator('#acceptance-fixtures').click()
  await expect(page.locator('#acceptance-fixture-result')).toContainText('verify')
  await page.locator('#acceptance-fixture-result').evaluate(element => element.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: resolve(root, 'assistant.png') })
  await page.locator(`#wb-history button[data-run-id="${failed.id}"]`).click()
  const section = page.locator('#wb-investigation')
  await section.locator('[data-investigation=generate]').click()
  await expect(section).toContainText('correlation')
  await section.locator('[data-investigation=followup]').selectOption(child.id)
  await section.locator('[data-investigation=compare]').click()
  await expect(section).toContainText('does not prove causality')
  await section.evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: resolve(root, 'investigation-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await section.evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: resolve(root, 'investigation-narrow.png') })
  assert.deepEqual(await readFile(manifest), before)
  report.runs = { negative: failed.id, positive: child.id, childLinked: true, originalManifestUnchanged: true }
  report.readiness = ['assertReady', 'fillReady', 'tapReady', 'waitFor']
  report.diagnosis = { businessCheck: true, followup: plan.followup?.observation }
  report.complete = true
} catch (error) { report.error = error instanceof Error ? error.message : String(error); process.exitCode = 1 }
finally {
  await browser?.close(); await viewer.close(); await server.close()
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    const fixtures = db.prepare('SELECT count(*) AS count FROM fixtures').get()!.count
    const orders = db.prepare('SELECT count(*) AS count FROM orders').get()!.count
    report.residualData = { fixtures, orders }
    if (fixtures !== 0 || orders !== 0) { report.complete = false; process.exitCode = 1 }
  } finally { db.close() }
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ root, ...report }, null, 2)}\n`)
}
