import { test, expect } from '@playwright/test'
import { mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LocalDeviceRuntime } from '../../src/local-device-runtime.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { matrixFixture } from '../fixtures/matrix-fixture.js'

test('dual Mock matrix keeps history and other slot interactive, isolates late media, and preserves results on failure', async ({ page }, info) => {
  const f = await matrixFixture(3)
  const runtime = new LocalDeviceRuntime(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0, agentTestControl: { enabled: true, projectPath: f.projectPath, allowedFlows: ['example', 'reset'], allowedSuites: [], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: [] } }), { workbenchRoot: f.store.root, matrixRegistryPath: f.registryPath })
  try {
    await runtime.listen(); await page.goto(runtime.viewer.url)
    await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click(); await page.locator('#wb-matrix > summary').click()
    await page.locator('#matrix-load').click(); await expect(page.locator('#matrix-plan option')).toHaveCount(1)
    await page.locator('#matrix-validate').click(); await expect(page.locator('#matrix-status')).toHaveText('操作已完成')
    await page.locator('#matrix-consent').check(); await page.locator('#matrix-start').click()
    await expect(page.locator('#matrix-summary')).toContainText('running', { timeout: 20000 }); await expect(page.locator('#matrix-start')).toBeDisabled()
    await page.route('**/preview?slot=one', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.fulfill({ json: { matrixId: 'old', slotId: 'one', contentType: 'image/png', base64: 'OLD' } }) })
    await page.locator('#matrix-slot').selectOption('one'); await page.locator('#matrix-media').click()
    await page.locator('#matrix-slot').selectOption('two'); await page.locator('#matrix-refresh').click(); await page.locator('#wb-refresh').click()
    await expect(page.locator('#matrix-media')).toBeEnabled(); await expect(page.locator('#matrix-image')).not.toHaveAttribute('src', /OLD/)
    await page.locator('#matrix-media').click(); await expect(page.locator('#matrix-image')).toHaveAttribute('src', /^data:image/)
    await page.locator('#matrix-slot').selectOption('one'); await page.locator('#matrix-cancel-slot').click()
    await page.locator('#matrix-slot').selectOption('two'); await expect(page.locator('#matrix-cancel-slot')).toBeEnabled()
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.locator('#matrix-summary').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('matrix-running-desktop.png') })
    await expect(page.locator('#matrix-summary')).toContainText('finished', { timeout: 25000 })
    await expect(page.locator('#matrix-results')).toContainText('pass'); await expect(page.locator('#matrix-results')).toContainText('cancelled')
    const previous = await page.locator('#matrix-results').textContent()
    await page.route('**/api/workbench/matrices', route => route.fulfill({ status: 503, body: '{}' }))
    await page.locator('#matrix-refresh').click(); await expect(page.locator('#matrix-status')).toContainText('操作失败'); await expect(page.locator('#matrix-results')).toHaveText(previous!)
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#matrix-results').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('matrix-narrow.png') })
    const artifacts = join(process.cwd(), 'artifacts/local-device-matrix'); await mkdir(artifacts, { recursive: true })
    for (const name of ['matrix-running-desktop.png', 'matrix-narrow.png']) await copyFile(info.outputPath(name), join(artifacts, name))
  } finally { await runtime.close(); await f.close() }
})
