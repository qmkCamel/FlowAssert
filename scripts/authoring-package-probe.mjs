import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

// Import only the unpacked candidate. The browser must also receive its packaged viewer/ files.
if (!process.argv[2]) throw new Error('Usage: authoring-package-probe candidate/lib/application.js')
const { LocalDeviceRuntime, Config } = await import(pathToFileURL(resolve(process.argv[2])).href)
const root = await mkdtemp(join(tmpdir(), 'mirror-authoring-package-'))
const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
const browser = await chromium.launch({ headless: true })
try {
  await runtime.listen(); await runtime.commands.execute('mobile_mirror_start', { provider: 'mock' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${runtime.viewer.url}/#/cases/new`)
  await page.locator('#journey-demo').click(); await page.locator('#journey-public').check()
  await page.locator('#journey-save').click()
  await page.waitForFunction(() => document.querySelector('#journey-validation')?.textContent.includes('Revision saved'))
  await page.locator('#journey-validate').click()
  await page.waitForFunction(() => document.querySelector('#journey-validation')?.textContent.includes('Static validation passed'))
  await page.locator('#journey-consent').check(); await page.locator('#journey-run').click()
  await page.waitForURL(/#\/runs\/[a-f0-9-]+/)
  await page.waitForFunction(() => document.querySelector('#analysis-summary')?.textContent.includes('Passed'))
  await page.locator('#analysis-steps button[data-step="2"]').click()
  await page.waitForFunction(() => document.querySelector('#analysis-evidence h2')?.textContent.includes('step 2') && document.querySelector('#analysis-evidence img')?.naturalWidth > 0)
  assert.equal(await page.locator('.stage').isVisible(), false)
  const runs = await runtime.application.workbench.list(), run = await runtime.application.workbench.get(runs[0].id)
  assert.equal(run.verdict, 'pass'); assert(run.authoringOrigin?.revisionId)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/screenshots/journey-packaged-candidate.png' })
  await page.goto(`${runtime.viewer.url}/#/cases`)
  assert.equal(await page.locator('.journey-case').waitFor().then(() => page.locator('.journey-case').count()), 1)
  await page.locator('.journey-case').getByRole('button', { name: 'Archive', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.journey-case'))
  await page.getByLabel('Archived', { exact: true }).check(); await page.locator('.journey-case').waitFor()
  assert.equal((await runtime.application.workbench.get(run.id)).verdict, 'pass')
  assert.deepEqual(errors, [])
  await runtime.close()
  const reopened = new LocalDeviceRuntime(Config({ viewerPort: 0 }), { workbenchRoot: root })
  try {
    assert.equal((await reopened.application.cases.revision(run.authoringOrigin.caseId, run.authoringOrigin.revisionId)).yaml, run.yaml)
    assert.equal((await reopened.application.workbench.get(run.id)).resultProjection.reportedVerdict, 'pass')
  } finally { await reopened.close() }
  process.stdout.write(JSON.stringify({ entry: resolve(process.argv[2]), device: 'mock', packagedViewer: 'save-validate-run-analysis-archive-pass', restart: 'fixed-revision-and-verdict-pass', pageErrors: errors }) + '\n')
} finally {
  await browser.close(); await runtime.close(); await rm(root, { recursive: true, force: true })
}
