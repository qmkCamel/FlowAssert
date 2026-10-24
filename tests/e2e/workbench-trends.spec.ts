import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ViewerServer } from '../../src/viewer-server.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'

test('trend analysis is local, cancellable, read-only and leaves navigation interactive', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-trend-e2e-'))
  const config = resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 })
  const service = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => new MockProvider(0) })
  const viewer = new ViewerServer(config, { service, assistant: null, disposeServiceOnClose: true, workbenchRoot: root })
  try {
    await viewer.listen(); await page.goto(viewer.url)
    await page.locator('#language-select').selectOption('en')
    await page.locator('#workbench-toggle').click()
    await page.route('**/api/workbench/trends/rebuild', async route => {
      const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 700)); await route.fulfill({ response }).catch(() => {})
    })
    await page.locator('#wb-trend-load').click()
    await expect(page.locator('#wb-trend-status')).toContainText('Analyzing local archives')
    await page.locator('#theme-button').click()
    await page.locator('#wb-trend-cancel').click()
    await page.waitForTimeout(850)
    await expect(page.locator('#wb-trend-status')).not.toContainText('Analysis complete')
    await page.unroute('**/api/workbench/trends/rebuild')
    await page.locator('#wb-trend-load').click()
    await expect(page.locator('#wb-trend-status')).toContainText('Analysis complete')
    await expect(page.locator('#wb-trend-results')).toContainText('0 planned cases')
    await page.screenshot({ path: 'artifacts/physical-validation/trends-desktop.png', fullPage: true })
    await page.locator('.wb-trend-compare summary').click()
    await page.locator('#wb-trend-previous-from').fill('2026-09-20')
    await page.locator('#wb-trend-previous-to').fill('2026-09-21')
    await page.locator('#wb-trend-current-from').fill('2026-09-21')
    await page.locator('#wb-trend-current-to').fill('2026-09-22')
    await page.locator('#wb-trend-budget-ms').fill('100')
    await page.locator('#wb-trend-budget-ratio').fill('0.1')
    await page.route('**/api/workbench/trends/compare', async route => { await new Promise(resolve => setTimeout(resolve, 650)); await route.continue() })
    await page.locator('#wb-trend-compare').click()
    await expect(page.locator('#wb-trend-compare-status')).toContainText('Checking both history windows')
    await page.locator('#theme-button').click()
    await expect(page.locator('#wb-trend-compare-status')).toContainText('Comparison complete')
    await expect(page.locator('#wb-trend-compare-results')).toContainText('planned cases: 0 → 0')
    await page.locator('.wb-trend-compare').screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-trend-compare.png' })
    await page.setViewportSize({ width: 390, height: 900 })
    await expect(page.locator('#wb-trend-results')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'artifacts/physical-validation/trends-narrow.png', fullPage: true })
    const response = await page.request.get(`${viewer.url}/api/workbench/trends`)
    expect(response.ok()).toBe(true)
    expect((await response.json()).coverage).toMatchObject({ planned: 0, imported: 0 })
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
