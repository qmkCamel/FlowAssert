import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'

let root: string, viewer: ViewerServer, id: string
test.use({ trace: 'on' })
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mirror-playback-'))
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await viewer.service.start({ provider: 'mock' })
  const run = await viewer.workbench.start('name: Screenshot playback\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n- assertVisible: {text: "Hello, harness."}\n')
  await viewer.workbench.wait(); id = run.id
})
test.afterEach(async () => { await viewer.close(); await rm(root, { recursive: true, force: true }) })
async function open(page: Page) {
  await page.goto(`${viewer.url}/#/runs/${id}?step=1&tab=evidence`)
  await expect(page.locator('#analysis-evidence img')).toBeVisible()
  await expect(page.locator('#playback-status')).toHaveText('Paused')
}
async function capture(page: Page, name: string) {
  await page.locator('#screenshot-playback').scrollIntoViewIfNeeded()
  const path = `artifacts/screenshots/${name}.png`
  await page.screenshot({ path, fullPage: true }); await test.info().attach(name, { path, contentType: 'image/png' })
}
test('plays a screenshot-only archive with stable focus and URL, speed and explicit replay', async ({ page }) => {
  const writes: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await open(page); const historyLength = await page.evaluate(() => history.length)
  const firstUrl = await page.locator('#analysis-evidence img').getAttribute('src')
  await page.locator('#playback-speed').selectOption('2'); await page.locator('#playback-toggle').focus(); await page.keyboard.press('Enter')
  await expect(page.locator('#playback-status')).toHaveText('Playing'); await capture(page, 'playback-playing')
  await expect(page).toHaveURL(/step=2&tab=evidence/)
  await expect(page.locator('#playback-toggle')).toBeFocused()
  await expect(page.locator('#playback-status')).toHaveText('Playback ended', { timeout: 8000 })
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  expect(await page.evaluate(async url => { try { await fetch(url!); return true } catch { return false } }, firstUrl)).toBe(false)
  await expect(page.locator('#analysis-evidence img')).toHaveAttribute('alt', 'Archived step 4 screenshot')
  await capture(page, 'playback-ended')
  await page.locator('#playback-toggle').click(); await expect(page).toHaveURL(/step=1&tab=evidence/)
  await page.locator('#playback-toggle').click(); await expect(page.locator('#playback-status')).toHaveText('Paused')
  const finalUrl = await page.locator('#analysis-evidence img').getAttribute('src')
  await page.locator('.journey-nav a[data-page=runs]').click()
  expect(await page.evaluate(async url => { try { await fetch(url!); return true } catch { return false } }, finalUrl)).toBe(false)
  expect(writes).toEqual([]); expect(errors).toEqual([])
})
test('pauses on step failure, resumes, and does not treat a run-level failure as a step failure', async ({ page }) => {
  const run = await viewer.workbench.get(id)
  await page.route(`**/api/runs/${id}`, route => route.fulfill({ json: { ...run, verdict: 'fail', steps: run.steps.map(step => step.index === 2 ? { ...step, status: 'failed', error: 'Fixture failed expectation' } : step) } }))
  await open(page); await page.locator('#playback-speed').selectOption('2'); await page.locator('#playback-toggle').click()
  await expect(page.locator('#playback-status')).toHaveText('Paused at failed step')
  await expect(page.locator('#analysis-evidence img')).toHaveAttribute('alt', 'Archived step 2 screenshot')
  await capture(page, 'playback-failure-paused')
  await page.locator('#playback-toggle').click(); await expect(page.locator('#playback-status')).toHaveText('Playback ended')
  await page.unroute(`**/api/runs/${id}`)
  await page.route(`**/api/runs/${id}`, route => route.fulfill({ json: { ...run, verdict: 'fail' } }))
  // A different frozen report fixture requires a document reload, not an in-report seek.
  await page.reload()
  await open(page); await page.locator('#playback-speed').selectOption('2'); await page.locator('#playback-toggle').click()
  await expect(page.locator('#playback-status')).toHaveText('Playback ended')
})
for (const kind of ['missing', 'integrity', 'decode'] as const) test(`${kind} evidence pauses and recovers without rewriting verdict`, async ({ page }) => {
  if (kind === 'missing') {
    const run = await viewer.workbench.get(id)
    await page.route(`**/api/runs/${id}`, route => route.fulfill({ json: { ...run, steps: run.steps.map(step => step.index === 2 ? { ...step, evidence: step.evidence.filter(file => file.contentType !== 'image/png') } : step) } }))
  } else await page.route(`**/api/runs/${id}/artifacts/step-2.png`, route => route.fulfill({ status: kind === 'integrity' ? 409 : 200, contentType: 'image/png', body: 'not a PNG' }))
  await open(page); await page.locator('#playback-speed').selectOption('2'); await page.locator('#playback-toggle').click()
  await expect(page.locator('#playback-status')).toContainText('Screenshot unavailable')
  await expect(page.locator('#analysis-evidence img')).toHaveAttribute('alt', 'Archived step 1 screenshot')
  await expect(page.locator('#analysis-summary')).toContainText('Passed')
  await capture(page, `playback-evidence-unavailable-${kind}`)
  if (kind !== 'missing') {
    await page.unroute(`**/api/runs/${id}/artifacts/step-2.png`)
    await page.locator('#playback-retry').click(); await expect(page.locator('#playback-status')).toHaveText('Paused')
    await expect(page.locator('#analysis-evidence img')).toHaveAttribute('alt', 'Archived step 2 screenshot')
    await capture(page, `playback-recovered-${kind}`)
  } else {
    await page.locator('#playback-next').click(); await expect(page.locator('#analysis-evidence img')).toHaveAttribute('alt', 'Archived step 3 screenshot')
  }
})
test('slow loads are cancellable, not prefetched, and late responses never overwrite manual selection', async ({ page }) => {
  let release!: () => void, requests = 0
  await page.route(`**/api/runs/${id}/artifacts/step-2.png`, async route => { requests++; await new Promise<void>(resolve => { release = resolve }); await route.continue().catch(() => {}) })
  await open(page); expect(requests).toBe(0)
  await page.locator('#playback-speed').selectOption('2'); await page.locator('#playback-toggle').click()
  await expect(page.locator('#playback-status')).toContainText('Loading screenshot'); await page.waitForTimeout(650)
  await page.locator('#playback-toggle').click(); await expect(page.locator('#playback-status')).toHaveText('Paused')
  await page.locator('#playback-next').click(); await expect(page.locator('#analysis-evidence img')).toHaveAttribute('alt', 'Archived step 3 screenshot')
  release(); await page.waitForTimeout(850)
  await expect(page.locator('#analysis-evidence img')).toHaveAttribute('alt', 'Archived step 3 screenshot')
  expect(requests).toBe(1)
})
test('manual search, tab, history and background transitions stop playback; Chinese narrow keyboard controls remain usable', async ({ page }) => {
  await open(page); await page.locator('#playback-toggle').click(); await page.locator('#analysis-step-search').fill('Check')
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  await page.locator('#playback-toggle').click(); await expect(page.locator('#analysis-step-search')).toHaveValue('')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  await page.locator('#playback-toggle').click(); await page.locator('#journey-analysis > nav a').filter({ hasText: 'Overview' }).click()
  await expect(page.locator('#screenshot-playback')).toBeHidden(); await page.goBack()
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  await page.locator('#language-select').selectOption('zh-CN')
  await expect(page.locator('#playback-toggle')).toHaveText('播放')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#playback-toggle').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#playback-toggle')).toHaveText('暂停')
  await page.keyboard.press('Enter'); await expect(page.locator('#playback-toggle')).toHaveText('播放')
  await capture(page, 'playback-narrow')
  await page.evaluate(() => { document.body.style.zoom = '2' })
  await page.locator('#playback-next').click(); await expect(page).toHaveURL(/step=2&tab=evidence/)
  await capture(page, 'playback-narrow-zoom-200')
})

test('switching runs invalidates late evidence and video playback is mutually exclusive', async ({ page }) => {
  const original = await viewer.workbench.get(id), secondId = '11111111-1111-4111-a111-111111111111'
  await page.route(`**/api/runs/${id}`, route => route.fulfill({ json: { ...original, video: { startedAt: original.startedAt, file: { name: 'fixture.webm' } } } }))
  await page.route(`**/api/runs/${secondId}`, route => route.fulfill({ json: { ...original, id: secondId, name: 'Other archived run', steps: original.steps.map(step => ({ ...step, evidence: [] })) } }))
  await open(page)
  await page.locator('#analysis-evidence summary').filter({ hasText: 'Video (on demand' }).click()
  await expect(page.locator('#analysis-evidence video')).toHaveCount(1)
  await page.locator('#playback-toggle').click()
  expect(await page.locator('#analysis-evidence video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
  await page.locator('#analysis-evidence video').evaluate(video => video.dispatchEvent(new Event('play')))
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  let release!: () => void
  await page.route(`**/api/runs/${id}/artifacts/step-2.png`, async route => { await new Promise<void>(resolve => { release = resolve }); await route.continue().catch(() => {}) })
  await page.locator('#playback-speed').selectOption('2'); await page.locator('#playback-toggle').click()
  await expect(page.locator('#playback-status')).toContainText('Loading screenshot')
  await page.evaluate(run => { location.hash = `#/runs/${run}?step=1&tab=evidence` }, secondId)
  await expect(page.locator('#analysis-summary')).toContainText('Other archived run')
  release(); await page.waitForTimeout(850)
  await expect(page.locator('#analysis-evidence img')).toHaveCount(0)
  await expect(page.locator('#playback-toggle')).toBeDisabled()
})
