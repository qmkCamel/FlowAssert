import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'

let root: string, viewer: ViewerServer
test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'mirror-journey-ui-'))
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await viewer.service.start({ provider: 'mock' }); await page.goto(`${viewer.url}/#/cases/new`)
})
test.afterEach(async () => { await viewer.close(); await rm(root, { recursive: true, force: true }) })

test('creates a public revision, validates, executes and navigates historical evidence without live media', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.locator('#journey-demo').click()
  await expect(page.locator('#journey-yaml')).toHaveValue(/Hello, harness/)
  await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: 'artifacts/screenshots/journey-authoring-desktop.png', fullPage: true })
  await page.locator('#journey-public').check(); await page.locator('#journey-save').click()
  await expect(page.locator('#journey-validation')).toContainText('Revision saved')
  await page.locator('#journey-validate').click(); await expect(page.locator('#journey-validation')).toContainText('Static validation passed')
  await page.locator('#journey-consent').check(); await page.locator('#journey-run').click()
  await expect(page).toHaveURL(/#\/runs\/[a-f0-9-]+/)
  await expect(page.locator('#analysis-summary')).toContainText('Passed', { timeout: 20000 })
  await expect(page.locator('.stage')).toBeHidden()
  await page.locator('#analysis-steps button[data-step="2"]').click()
  await expect(page.locator('#analysis-evidence img')).toBeVisible()
  await expect(page.locator('#analysis-context mark')).toHaveText(/assertVisible/)
  await expect.poll(() => page.locator('#analysis-evidence img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
  await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/screenshots/journey-analysis-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: 'artifacts/screenshots/journey-analysis-narrow.png' })
  await expect(page.locator('#analysis-evidence')).toBeVisible(); await expect(page.locator('#analysis-steps')).toBeVisible()
  expect((await page.locator('#analysis-steps').boundingBox())!.y).toBeGreaterThan((await page.locator('#analysis-evidence').boundingBox())!.y)
  await page.locator('.journey-nav a[data-page=cases]').click(); await expect(page.locator('.journey-case')).toHaveCount(1)
  const caseId = (await (await page.request.get(`${viewer.url}/api/workbench/cases`)).json()).cases[0].caseId
  await page.locator('.journey-case').getByRole('button',{name:'View run history',exact:true}).click()
  await expect(page.locator('#report-case')).toHaveValue(caseId); await expect(page.locator('#report-list tbody tr')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('refreshes an initially unreadable report when its real record arrives, then stops completed polling', async ({ page }) => {
  const yaml = 'name: Late materialized report\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n'
  const run = await viewer.workbench.start(yaml); await viewer.workbench.wait()
  const manifest = await viewer.workbench.store.readOnlySnapshot(run.id)
  const real = await viewer.workbench.get(run.id)
  let reads = 0, release: (() => void) | undefined
  await page.route(`${viewer.url}/api/runs/${run.id}`, async route => {
    reads++
    if (reads === 1) {
      await route.fulfill({ json: { ...real, name: 'Interrupted / unreadable run', startedAt: new Date().toISOString(),
        phase: 'finished', verdict: 'inconclusive', steps: [], evidence: [],
        resultProjection: { ...real.resultProjection, verdict: 'inconclusive', reportedVerdict: 'inconclusive' } } })
      return
    }
    if (reads === 2) await new Promise<void>(resolve => { release = resolve })
    await route.continue()
  })
  try {
    await page.goto(`${viewer.url}/#/runs/${run.id}`)
    await expect(page.locator('#analysis-summary')).toContainText('Inconclusive')
    await expect.poll(() => Boolean(release), { timeout: 6000 }).toBe(true)
    await expect(page.locator('#analysis-read-progress')).toContainText('Loading run')
    await page.waitForTimeout(650)
    await page.locator('#analysis-step-search').fill('Check')
    await expect(page.locator('#analysis-step-search')).toHaveValue('Check')
    await expect(page.locator('#analysis-summary')).toContainText('Inconclusive')
    await page.screenshot({ path: 'artifacts/screenshots/report-late-materialization-loading.png' })
    release!()
    await expect(page.locator('#analysis-summary')).toContainText('Passed')
    await expect(page.locator('#analysis-evidence img')).toBeVisible()
    await expect(page.locator('#analysis-step-search')).toHaveValue('Check')
    await expect(page.locator('#analysis-read-progress')).toBeHidden()
    await page.screenshot({ path: 'artifacts/screenshots/report-late-materialization-completed.png' })
    const completedReads = reads
    await page.waitForTimeout(2200)
    expect(reads).toBe(completedReads)
    expect((await viewer.workbench.store.readOnlySnapshot(run.id)).manifestSha256).toBe(manifest.manifestSha256)
  } finally { release?.() }
})

test('slow stale validation preserves edited text and navigation; failed export retains the preview', async ({ page }) => {
  await page.locator('#journey-demo').click()
  await page.locator('#journey-source summary').click()
  await page.route('**/api/workbench/authoring/validate', async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.continue() })
  await page.locator('#journey-validate').click(); await expect(page.locator('#journey-validation')).toContainText('Validating')
  await page.locator('#journey-yaml').fill((await page.locator('#journey-yaml').inputValue()) + '# edited\n')
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#journey-runs')).toBeVisible()
  await page.goBack()
  await expect(page.locator('#journey-yaml')).toHaveValue(/# edited/)
  await expect(page.locator('#journey-run')).toBeDisabled()
  await page.locator('#journey-public').check(); await page.locator('#journey-export').click(); await expect(page.locator('#journey-validation')).toContainText('Preview ready')
  await page.route('**/api/workbench/authoring/export', async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"export unavailable"}' }) })
  await page.locator('#journey-export').click(); await expect(page.locator('#journey-validation')).toContainText('Preparing export')
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#journey-runs')).toBeVisible(); await page.goBack()
  await expect(page.locator('#journey-edit')).toContainText('export unavailable'); await expect(page.locator('#journey-edit')).toContainText('flows/acceptance.yaml')
})

test('authors an assertion without YAML, explains failure, and keeps case revisions after archiving', async ({ page }) => {
  await page.locator('#journey-name').fill('Missing expectation')
  await page.locator('#journey-selector').fill('This element does not exist')
  await page.locator('#journey-add-step').click()
  await expect(page.locator('#journey-yaml')).toHaveValue(/assertVisible/)
  await page.locator('#journey-public').check()
  await page.route('**/api/workbench/cases', async route => { if (route.request().method() === 'POST') await new Promise(resolve => setTimeout(resolve, 650)); await route.continue() })
  await page.locator('#journey-save').click(); await expect(page.locator('#journey-validation')).toContainText('Saving revision')
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#journey-runs')).toBeVisible(); await page.goBack()
  await expect(page.locator('#journey-validation')).toContainText('Revision saved')
  await page.locator('#journey-validate').click(); await expect(page.locator('#journey-validation')).toContainText('Static validation passed')
  await page.locator('#journey-consent').check(); await page.locator('#journey-run').click()
  // A transient unreadable report can say Cleanup: Failed while the run is
  // still materializing. Wait for the recorded verdict, not any failure label.
  await expect(page.locator('#analysis-summary').getByText('Recorded verdict: Failed', { exact: true })).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#analysis-summary')).toContainText('Earliest recorded failure: 1')
  const runId = (await (await page.request.get(`${viewer.url}/api/runs`)).json()).runs[0].id
  const original = await (await page.request.get(`${viewer.url}/api/runs/${runId}`)).json()
  await page.locator('.journey-nav a[data-page=cases]').click(); await page.locator('.journey-case').getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.locator('.journey-case')).toHaveCount(0)
  await page.getByLabel('Archived', { exact: true }).check(); await expect(page.locator('.journey-case')).toHaveCount(1)
  await page.locator('.journey-case').getByRole('button', { name: 'Restore', exact: true }).click(); await expect(page.locator('.journey-case')).toHaveCount(0)
  expect((await (await page.request.get(`${viewer.url}/api/runs/${runId}`)).json()).verdict).toBe(original.verdict)
})

test('two windows preserve a losing draft, expose save-copy, and confirm destructive replacement', async ({ page, context }) => {
  await page.locator('#journey-demo').click(); await page.locator('#journey-public').check(); await page.locator('#journey-save').click(); await expect(page.locator('#journey-validation')).toContainText('Revision saved')
  const record = (await (await page.request.get(`${viewer.url}/api/workbench/cases`)).json()).cases[0]
  const second = await context.newPage(); await second.goto(`${viewer.url}/#/cases/${record.caseId}/edit`)
  await expect(second.locator('#journey-yaml')).toHaveValue(/Hello, harness/)
  await page.locator('#journey-source summary').click(); await second.locator('#journey-source summary').click()
  await page.locator('#journey-yaml').fill((await page.locator('#journey-yaml').inputValue()) + '# first editor\n'); await page.locator('#journey-save').click(); await expect(page.locator('#journey-validation')).toContainText('Revision saved')
  await second.locator('#journey-yaml').fill((await second.locator('#journey-yaml').inputValue()) + '# losing editor\n'); await second.locator('#journey-public').check(); await second.locator('#journey-save').click()
  await expect(second.locator('#journey-edit')).toContainText('Another editor saved first'); await expect(second.locator('#journey-yaml')).toHaveValue(/losing editor/)
  await second.locator('#journey-demo').click(); await expect(second.locator('dialog')).toBeVisible(); await second.locator('dialog').getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(second.locator('#journey-yaml')).toHaveValue(/losing editor/)
  await second.locator('#journey-save-copy').click(); await expect(second.locator('#journey-validation')).toContainText('Revision saved')
  expect((await (await page.request.get(`${viewer.url}/api/workbench/cases`)).json()).cases).toHaveLength(2)
  await second.close()
})

test('analysis rejects bad routes and unavailable evidence, isolates late image loads and remains keyboard accessible', async ({ page }) => {
  const yaml = 'name: Evidence switching\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n'
  const run = await viewer.application.workbench.start(yaml); await viewer.application.workbench.wait()
  await page.goto(`${viewer.url}/#/runs/${run.id}?step=1&tab=evidence`)
  await expect(page.locator('#analysis-evidence img')).toBeVisible()
  await page.route(`**/api/runs/${run.id}/artifacts/step-1.png`, async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.continue() })
  await page.locator('#analysis-steps button[data-step="2"]').click(); await expect(page.locator('#analysis-evidence h2')).toContainText('step 2')
  await page.locator('#analysis-steps button[data-step="1"]').click()
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#journey-runs')).toBeVisible()
  await page.goto(`${viewer.url}/#/runs/${run.id}?step=2&tab=evidence`)
  await expect(page.locator('#analysis-evidence h2')).toContainText('step 2')
  await page.route(`**/api/runs/${run.id}/artifacts/step-2.png`, route => route.fulfill({ status: 400, body: 'integrity failed' }))
  await page.reload(); await expect(page.locator('#analysis-evidence')).toContainText('Historical image missing or integrity failed')
  await expect(page.locator('.stage')).toBeHidden(); await expect(page.locator('#analysis-summary')).toContainText('Passed')
  await page.goto(`${viewer.url}/#/runs/${run.id}?step=999&tab=evidence`); await expect(page.locator('#journey-analysis')).toContainText('Step not found')
  await page.goto(`${viewer.url}/#/runs/not-a-uuid`); await expect(page.locator('#journey-missing')).toBeVisible()
  await page.goto(`${viewer.url}/#/runs/${run.id}?step=2&tab=details`); await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#language-select').selectOption('zh-CN')
  await expect(page.locator('.journey-nav')).toContainText('用例')
  await page.locator('body').evaluate(element => { element.style.zoom = '2' })
  await page.locator('#journey-analysis > nav details summary').click(); await page.locator('#journey-analysis > nav a, #journey-analysis > nav details a').filter({ hasText: '详情' }).focus(); await page.keyboard.press('Enter'); await expect(page.locator('#analysis-context')).toBeVisible()
  await page.screenshot({ path: 'artifacts/screenshots/journey-analysis-zoom-zh.png', fullPage: true })
})

test('Inspector handoff is explicit, retains both drafts on cancel, and expires with the screen binding', async ({ page }) => {
  await page.locator('#journey-demo').click()
  await page.locator('.journey-nav a[data-page=devices]').click(); await page.locator('#inspect-button').click()
  await page.locator('#inspection-tree [data-node-id=n2]').click(); await page.locator('#inspection-selector-options button').first().click(); await page.locator('#inspection-add-assert').click()
  const draft = await page.locator('#inspection-draft').inputValue(), action = viewer.service.state().lastAction
  await page.locator('#inspection-handoff').click(); await page.locator('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('#inspection-draft')).toHaveValue(draft)
  await page.locator('#inspection-handoff').click(); await page.locator('dialog').getByRole('button', { name: 'Append to current case', exact: true }).click()
  await expect(page.locator('#journey-edit')).toBeVisible(); await expect(page.locator('#journey-yaml')).toHaveValue(/Hello, harness[\s\S]*action-card/)
  await expect(page.locator('#journey-run')).toBeDisabled(); expect(viewer.service.state().lastAction).toEqual(action)
  await page.locator('.journey-nav a[data-page=devices]').click(); await viewer.service.stop(); await expect(page.locator('#inspection-handoff')).toBeDisabled()
})

test('optional authoring video uses the existing recorder and remains visible in historical analysis', async ({ page }) => {
  await page.locator('#journey-demo').click(); await page.locator('#journey-source summary').click()
  await page.locator('#journey-yaml').fill((await page.locator('#journey-yaml').inputValue()).replace('- assertVisible', '- wait: 2\n- assertVisible'))
  await page.locator('#journey-validate').click(); await expect(page.locator('#journey-validation')).toContainText('Static validation passed')
  await page.locator('#journey-video').check(); await page.locator('#journey-consent').check(); await page.locator('#journey-run').click()
  await expect(page).toHaveURL(/#\/runs\//)
  await expect.poll(async () => { const run = (await viewer.workbench.list())[0]; return run ? (await viewer.workbench.get(run.id)).video?.status : null }, { timeout: 20000 }).toBe('complete')
  await expect(page.locator('#analysis-evidence')).toContainText('Video (on demand')
  await page.locator('#analysis-evidence summary').filter({ hasText: 'Video (on demand' }).click(); await expect(page.locator('#analysis-evidence video')).toBeVisible()
})

test('analysis comparison and investigation keep navigation live during slow work and never auto-pick a baseline', async ({ page }) => {
  const yaml = 'name: Compare journey\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n'
  const first = await viewer.workbench.start(yaml); await viewer.workbench.wait(); const second = await viewer.workbench.start(yaml); await viewer.workbench.wait()
  await page.goto(`${viewer.url}/#/runs/${second.id}?tab=compare`)
  const panel = page.locator('#analysis-secondary .wb-comparison'), selector = panel.locator('select')
  await expect(selector.locator('option')).toHaveCount(2); await expect(selector).toHaveValue('')
  await selector.selectOption(first.id)
  await page.route('**/api/workbench/comparisons', async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.continue() })
  await panel.getByRole('button', { name: 'Start comparison', exact: true }).click()
  await expect(panel).toContainText('Generating comparison report')
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#journey-runs')).toBeVisible(); await page.goBack()
  await expect(panel).toContainText('completed', { timeout: 20000 })
  await page.route('**/api/workbench/investigation?*', async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.continue() })
  await page.getByRole('button', { name: 'Read plan / follow-up comparison' }).click(); await expect(page.locator('#analysis-secondary')).toContainText('Rechecking evidence')
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#journey-runs')).toBeVisible(); await page.goBack()
  await expect(page.locator('#analysis-secondary')).toContainText('Plan facts and limitations')
  expect((await viewer.workbench.get(second.id)).verdict).toBe('pass')
  // Transport fault fixture: accepted replacement job is cancelled; prior real report survives.
  const replacementId = '5892eb34-1b48-4a1e-957b-49079201c711'
  const replacement = { id: replacementId, targetRunId: second.id, baselineRunId: first.id, state: 'running', progress: 'fixture', steps: [] }
  await page.route('**/api/workbench/comparisons', async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.fulfill({ json: replacement }) })
  await page.route(`**/api/workbench/comparisons/${replacementId}`, route => route.fulfill({ json: replacement }))
  await page.route(`**/api/workbench/comparisons/${replacementId}/cancel`, async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.fulfill({ json: { ...replacement, state: 'cancelled' } }) })
  await panel.getByRole('button', { name: 'Start comparison', exact: true }).click()
  await expect(panel.locator('.wb-retained-comparison')).toContainText('Previous usable report')
  await panel.getByRole('button', { name: 'Cancel comparison', exact: true }).click()
  await page.locator('.journey-nav a[data-page=runs]').click(); await expect(page.locator('#journey-runs')).toBeVisible(); await page.goBack()
  await expect(panel).toContainText('cancelled'); await expect(panel.locator('.wb-retained-comparison')).toContainText(first.id)
})
