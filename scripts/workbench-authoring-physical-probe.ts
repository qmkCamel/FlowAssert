/** Explicit physical Fixture acceptance for Inspector → case → analysis → revised run. */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { ViewerServer } from '../src/viewer-server.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH ?? ''
const executable = process.env.MOBILE_MIRROR_APPIUM_EXECUTABLE ?? ''
if (!isAbsolute(capsPath) || !isAbsolute(executable)) throw new Error('Explicit absolute capabilities and Appium executable required')
const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platform = String(caps.platformName).toLowerCase()
const appId = platform === 'android' ? caps['appium:appPackage'] : caps['appium:bundleId']
if (!['android', 'ios'].includes(platform) || appId !== 'dev.mobilemirror.fixture' ||
  typeof caps['appium:udid'] !== 'string' || !caps['appium:udid'] || caps['appium:app'] || caps['appium:fullReset']) {
  throw new Error('Only an explicit physical device with the preinstalled Fixture is allowed')
}

const root = resolve('artifacts/physical-validation', `authoring-${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
await mkdir(root, { recursive: true, mode: 0o700 })
const viewer = new ViewerServer(resolveMirrorConfig({
  viewerPort: 0, defaultProvider: 'appium', appiumRuntimeMode: 'managed', appiumExecutablePath: executable,
  appiumSessionStartupTimeoutMs: 120_000, startupTimeoutMs: 30_000, viewerMediaMode: 'auto',
}), { workbenchRoot: resolve(root, 'runs') })
const bundled = chromium.executablePath()
const browser = await chromium.launch({ headless: true,
  ...(!existsSync(bundled) ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}),
})
const report: Record<string, unknown> = { platform, appId, complete: false }

try {
  await viewer.listen()
  await viewer.service.start({ provider: 'appium', capabilities: {
    ...caps, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false,
    'appium:allowProvisioningDeviceRegistration': false,
  } })
  const sessionId = viewer.service.state().sessionId
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${viewer.url}/#/devices`)
  await page.locator('#language-select').selectOption('en')
  const beforeAction = viewer.service.state().lastAction
  await page.locator('#inspect-button').click()
  await expect(page.locator('#inspection-status')).toHaveText('Frozen inspection', { timeout: 20_000 })
  await page.locator('#inspection-search').fill('Mirror Fixture · Test Order')
  const title = page.locator('#inspection-tree [role=treeitem]').filter({ hasText: 'Mirror Fixture · Test Order' }).first()
  await expect(title).toBeVisible()
  await title.click()
  await page.locator('#inspection-selector-options button').first().click()
  await expect(page.locator('#inspection-add-assert')).toBeEnabled()
  await page.locator('#inspection-add-assert').click()
  const inspectorDraft = await page.locator('#inspection-draft').inputValue()
  if (!inspectorDraft.includes('assertVisible') || !inspectorDraft.includes('dev.mobilemirror.fixture') ||
    JSON.stringify(viewer.service.state().lastAction) !== JSON.stringify(beforeAction)) {
    throw new Error('Inspector draft was not a read-only Fixture assertion')
  }
  await page.screenshot({ path: resolve(root, 'inspector.png') })
  await page.locator('#inspection-handoff').click()
  await page.locator('dialog').getByRole('button', { name: 'Create new case', exact: true }).click()
  await expect(page.locator('#journey-edit')).toBeVisible()
  await expect(page.locator('#journey-yaml')).toHaveValue(/assertVisible/)

  // Deliberately add a missing target to exercise a real failed run and the
  // immutable analysis path; it is removed only by an explicit new revision.
  const negative = '- assertVisible: {text: "MOBILE-MIRROR-INTENTIONAL-FAILURE"}\n'
  await page.locator('#journey-source').evaluate(element => { (element as HTMLDetailsElement).open = true })
  await page.locator('#journey-yaml').fill(`${inspectorDraft.trimEnd()}\n${negative}`)
  await page.locator('#journey-name').fill(`${platform} Inspector acceptance`)
  await page.locator('#journey-public').check()
  const saveResponse = page.waitForResponse(response => response.url().endsWith('/api/workbench/cases') && response.request().method() === 'POST')
  await page.locator('#journey-save').click()
  const caseId = (await (await saveResponse).json()).caseId as string
  await expect(page.locator('#journey-validation')).toContainText('Revision saved')
  await page.locator('#journey-validate').click()
  await expect(page.locator('#journey-validation')).toContainText('Static validation passed')
  await page.locator('#journey-consent').check()
  await page.locator('#journey-run').click()
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#language-select').selectOption('en')
  await expect(page.locator('#analysis-summary')).toContainText('Failed', { timeout: 120_000 })
  const failedId = page.url().match(/#\/runs\/([a-f0-9-]+)/)?.[1]
  if (!failedId) throw new Error('Failed run deep link was not selected')
  await expect(page.locator('#analysis-evidence img')).toBeVisible()
  await page.screenshot({ path: resolve(root, 'failed-analysis.png'), fullPage: true })

  await page.goto(`${viewer.url}/#/cases/${caseId}/edit`)
  await expect(page.locator('#journey-yaml')).toHaveValue(/MOBILE-MIRROR-INTENTIONAL-FAILURE/)
  await page.locator('#journey-source').evaluate(element => { (element as HTMLDetailsElement).open = true })
  const previous = await page.locator('#journey-yaml').inputValue()
  await page.locator('#journey-yaml').fill(previous.replace(negative, ''))
  await page.locator('#journey-save').click()
  await expect(page.locator('#journey-validation')).toContainText('Revision saved')
  await page.locator('#journey-validate').click()
  await expect(page.locator('#journey-validation')).toContainText('Static validation passed')
  await page.locator('#journey-consent').check()
  await page.locator('#journey-run').click()
  await expect(page.locator('#analysis-summary')).toContainText('Passed', { timeout: 120_000 })
  const passedId = page.url().match(/#\/runs\/([a-f0-9-]+)/)?.[1]
  if (!passedId || passedId === failedId) throw new Error('Revised run did not get a new identity')
  await page.screenshot({ path: resolve(root, 'passed-analysis.png'), fullPage: true })

  const failed = await viewer.workbench.get(failedId)
  const passed = await viewer.workbench.get(passedId)
  let verifiedArtifacts = 0
  for (const run of [failed, passed]) {
    for (const file of [...run.evidence, ...run.steps.flatMap(step => step.evidence)]) {
      const bytes = await viewer.workbench.store.readEvidence(run.id, file)
      if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Evidence hash mismatch')
      verifiedArtifacts++
    }
  }
  if (failed.verdict !== 'fail' || passed.verdict !== 'pass' ||
    failed.sessionId !== sessionId || passed.sessionId !== sessionId) throw new Error('Physical authoring verdict/session mismatch')
  report.complete = true
  report.caseId = caseId
  report.failedRunId = failedId
  report.passedRunId = passedId
  report.verdicts = [failed.verdict, passed.verdict]
  report.verifiedArtifacts = verifiedArtifacts
  report.inspectorReadOnly = true
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  await viewer.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ ...report, root }, null, 2)}\n`)
}
