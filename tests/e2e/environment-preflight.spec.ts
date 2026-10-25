import { expect, test } from '@playwright/test'
import { Config, type Config as MirrorConfig } from '../../src/config.js'
import { ViewerServer } from '../../src/viewer-server.js'

test('scoped preflight stays interactive, preserves results and rejects stale replies', async ({ page }) => {
  const viewer = new ViewerServer(Config({ viewerPort: 0 } as MirrorConfig), { workbenchRoot: test.info().outputPath('workbench') })
  await viewer.listen()
  try {
    await page.goto(viewer.url)
    await page.locator('#environment-preflight summary').click()
    await expect(page.locator('#preflight-test-row')).toBeHidden()
    await page.locator('#preflight-check').click()
    await expect(page.locator('#preflight-result')).toContainText('viewer / runtime / none: ready')
    await expect(page.locator('#preflight-result')).not.toContainText('dsh')
    const previous = await page.locator('#preflight-result').textContent() ?? ''
    let mode: 'slow' | 'failure' | 'late' = 'slow'
    await page.route('**/api/environment-preflight', async route => {
      const captured = mode
      const response = captured === 'failure' ? null : await route.fetch()
      await new Promise(resolve => setTimeout(resolve, 1100))
      if (captured === 'failure') await route.fulfill({ status: 500, body: '{}' })
      else await route.fulfill({ response: response! }).catch(() => undefined)
    })
    await page.locator('#preflight-check').click()
    await expect(page.locator('#preflight-progress')).toBeVisible()
    await expect(page.locator('#preflight-check')).toBeDisabled()
    await expect(page.locator('#preflight-result')).toHaveText(previous)
    await page.locator('#theme-button').click()
    await expect(page.locator('body')).toHaveClass(/light-stage/)
    await expect(page.locator('#preflight-progress')).toBeVisible()
    await page.screenshot({ path: 'artifacts/screenshots/preflight-progress-desktop.png', fullPage: true })
    await expect(page.locator('#preflight-progress')).toBeHidden()
    const successful = await page.locator('#preflight-result').textContent() ?? ''
    expect(successful).not.toBe(previous)
    mode = 'failure'
    await page.locator('#preflight-check').click()
    await expect(page.locator('#preflight-error')).toBeVisible()
    await expect(page.locator('#preflight-result')).toHaveText(successful)
    mode = 'late'
    await page.locator('#preflight-check').click()
    await expect(page.locator('#preflight-progress')).toBeVisible()
    await page.locator('#preflight-operation').selectOption('mock')
    await expect(page.locator('#preflight-test-row')).toBeHidden()
    await expect(page.locator('#preflight-progress')).toBeHidden()
    await expect(page.locator('#preflight-stale')).toBeVisible()
    await page.waitForTimeout(1300)
    await expect(page.locator('#preflight-result')).toHaveText(successful)
    await page.locator('#preflight-check').click()
    await page.locator('#preflight-cancel').click()
    await expect(page.locator('#preflight-check')).toBeEnabled()
    await page.unroute('**/api/environment-preflight')
    await page.locator('#preflight-check').click()
    await expect(page.locator('#preflight-result')).toContainText('viewer / mock / none: ready')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'artifacts/screenshots/preflight-completed-narrow.png', fullPage: true })
  } finally { await viewer.close() }
})

test('preflight HTTP rejects authority/path injection and cross-origin requests', async ({ request }) => {
  const viewer = new ViewerServer(Config({ viewerPort: 0 } as MirrorConfig), { workbenchRoot: test.info().outputPath('workbench') }); await viewer.listen()
  try {
    for (const context of [{ entry: 'dsh' }, { executable: '/bin/echo' }, { operation: 'report', platform: 'ios' }]) {
      expect((await request.post(`${viewer.url}/api/environment-preflight`, { headers: { origin: viewer.url }, data: { context } })).ok()).toBe(false)
    }
    expect((await request.post(`${viewer.url}/api/environment-preflight`, { headers: { origin: 'https://untrusted.invalid' }, data: { context: {} } })).ok()).toBe(false)
    const response = await request.post(`${viewer.url}/api/environment-preflight`, { headers: { origin: viewer.url }, data: { context: { operation: 'report' } } })
    expect(response.ok()).toBe(true); expect((await response.json()).overall).toBe('ready')
  } finally { await viewer.close() }
})
