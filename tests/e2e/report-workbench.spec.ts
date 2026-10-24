import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'

let root: string, viewer: ViewerServer, id: string
test.use({ viewport: { width: 1280, height: 800 }, trace: 'on' })
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'report-workbench-'))
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await viewer.service.start({ provider: 'mock' })
  const yaml = await readFile(new URL('../../examples/flows/demo.yaml', import.meta.url), 'utf8')
  const run = await viewer.workbench.start(yaml); await viewer.workbench.wait(); id = run.id
})
test.afterEach(async () => { await viewer.close(); await rm(root, { recursive: true, force: true }) })
async function open(page: Page, step = 1) {
  await page.goto(`${viewer.url}/#/runs/${id}?step=${step}&tab=evidence`)
  await expect(page.locator('#analysis-evidence .report-image-viewport img')).toBeVisible()
}
async function capture(page: Page, name: string, fullPage = false) {
  const path = `artifacts/screenshots/${name}.png`
  await page.screenshot({ path, fullPage }); await test.info().attach(name, { path, contentType: 'image/png' })
}
test('first-screen playback, semantic steps, bounded filmstrip and keyboard seeking', async ({ page }) => {
  const writes: string[] = [], errors: string[] = []
  page.on('request', req => { if (req.method() !== 'GET') writes.push(req.url()) }); page.on('pageerror', error => errors.push(error.message))
  await open(page)
  await expect(page.locator('#analysis-steps button[data-step="3"]')).toContainText('action-card')
  const box = await page.locator('#playback-toggle').boundingBox(); expect(box!.y + box!.height).toBeLessThan(800)
  await capture(page, 'workbench-overview')
  await page.locator('#analysis-steps button[data-step="1"]').focus(); await page.keyboard.press('ArrowDown')
  await expect(page).toHaveURL(/step=2&tab=evidence/); await expect(page.locator('#analysis-steps button[data-step="2"]')).toBeFocused()
  await page.locator('#replay-seek').focus(); await page.keyboard.press('End'); await expect(page).toHaveURL(/step=5&tab=evidence/)
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  await page.locator('.replay-filmstrip summary').click(); await expect(page.locator('.replay-frames img')).toHaveCount(5)
  await page.locator('.replay-frames button[data-step="3"]').click(); await expect(page).toHaveURL(/step=3&tab=evidence/)
  await expect(page.locator('.replay-frames button[aria-current=true]')).toHaveAttribute('data-step', '3')
  await capture(page, 'workbench-timeline', true)
  await page.locator('.replay-filmstrip summary').click()
  await page.locator('.action-comparison summary').click()
  await expect(page.locator('.action-image-plane img')).toHaveCount(2)
  await expect(page.locator('.action-image-plane svg')).toHaveCount(1)
  await expect(page.locator('.action-comparison')).toContainText('Dispatch: settled')
  await capture(page, 'workbench-action-comparison', true)
  expect(writes).toEqual([]); expect(errors).toEqual([])
})
test('failure marker, missing before evidence recovery, and no fabricated old-record overlay', async ({ page }) => {
  const run = await viewer.workbench.get(id)
  await page.route(`**/api/runs/${id}`, route => route.fulfill({ json: { ...run, steps: run.steps.map(step => step.index === 3 ? { ...step, status: 'failed', error: 'Expected fixture state not found' } : step) } }))
  await open(page)
  await page.locator('.replay-markers button').click(); await expect(page).toHaveURL(/step=3&tab=evidence/)
  await page.locator('#playback-toggle').click(); await expect(page.locator('#playback-status')).toHaveText('Paused at failed step')
  await capture(page, 'workbench-failure')
  await page.route('**/artifacts/*-before.png', route => route.fulfill({ status: 503, body: 'fixture unavailable' }))
  await page.locator('.action-comparison summary').click(); await expect(page.getByRole('button', { name: 'Retry comparison', exact: true })).toBeVisible()
  await expect(page.locator('.action-image-plane svg')).toHaveCount(0)
  await expect(page.locator('#analysis-evidence .report-image-viewport img')).toBeVisible()
  await capture(page, 'workbench-missing-before')
  await page.unroute('**/artifacts/*-before.png'); await page.getByRole('button', { name: 'Retry comparison', exact: true }).click()
  await expect(page.locator('.action-image-plane img')).toHaveCount(2); await capture(page, 'workbench-recovered')
  await page.locator('#playback-previous').click(); await page.locator('.action-comparison summary').click()
  await expect(page.locator('.action-comparison')).toContainText('was not recorded')
  await expect(page.locator('.action-image-plane svg')).toHaveCount(0)
})
test('slow action evidence cancels on navigation and narrow Chinese controls remain usable', async ({ page }) => {
  await open(page, 3)
  let release!: () => void
  await page.route('**/artifacts/*-before.png', async route => { await new Promise<void>(resolve => { release = resolve }); await route.continue().catch(() => {}) })
  await page.locator('.action-comparison summary').click(); await expect(page.locator('.action-comparison')).toContainText('Loading action evidence')
  await page.waitForTimeout(650); await page.locator('#playback-next').click(); await expect(page).toHaveURL(/step=4&tab=evidence/)
  release(); await expect(page.locator('#analysis-evidence .report-image-viewport img')).toHaveAttribute('alt', 'Archived step 4 screenshot')
  await page.locator('#language-select').selectOption('zh-CN'); await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('#analysis-steps h2')).toHaveText('归档步骤')
  await expect(page.locator('#playback-toggle')).toBeEnabled()
  await page.locator('#playback-toggle').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#playback-status')).toHaveText('正在回放')
  await page.keyboard.press('Enter'); await capture(page, 'workbench-narrow', true)
  await page.evaluate(() => { document.body.style.zoom = '2' })
  await page.locator('#playback-previous').click(); await expect(page).toHaveURL(/step=3&tab=evidence/)
  await capture(page, 'workbench-narrow-zoom', true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('old comparison cannot cancel a slow new step load', async ({ page }) => {
  await open(page, 3)
  await page.locator('.action-comparison summary').click()
  await expect(page.locator('.action-image-plane img')).toHaveCount(2)
  const run = await viewer.workbench.get(id)
  const image = run.steps.find(step => step.index === 2)!.evidence.find(file => file.contentType === 'image/png')!
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/artifacts/${encodeURIComponent(image.name)}`, async route => {
    await pending; await route.continue().catch(() => {})
  })
  try {
    await page.locator('#playback-previous').click()
    await expect(page).toHaveURL(/step=2&tab=evidence/)
    await expect(page.locator('.evidence-pending')).toContainText('step 2')
    await expect(page.locator('.action-comparison')).toHaveCount(0)
    await expect(page.locator('#analysis-evidence .report-image-viewport img')).toBeVisible()
    await expect(page.locator('#analysis-evidence .report-image-viewport img')).toHaveAttribute('alt', 'Archived step 3 screenshot')
    await expect(page.locator('#playback-next')).toBeEnabled()
    await capture(page, 'workbench-new-step-loading', true)
  } finally { release() }
  await expect(page.locator('#analysis-evidence .report-image-viewport img')).toHaveAttribute('alt', 'Archived step 2 screenshot')
  await expect(page.locator('.evidence-pending')).toHaveCount(0)
  await page.locator('.action-comparison summary').click()
  await expect(page.locator('.action-comparison')).toContainText('was not recorded')
  await expect(page.locator('.action-image-plane svg')).toHaveCount(0)
  await capture(page, 'workbench-new-step-ready', true)
})
