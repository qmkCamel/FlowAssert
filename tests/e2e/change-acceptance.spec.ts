import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { seedAcceptance } from '../fixtures/acceptance-fixture.js'

test('change acceptance previews, publishes, downloads, preserves failures and stays locally interactive', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'change-acceptance-ui-'))
  const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' })
    const { input } = await seedAcceptance(viewer.workbench.store)
    await page.goto(viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
    await page.locator('#wb-change-acceptance > summary').click()
    await page.locator('#change-repository').fill(input.repository); await page.locator('#change-commit').fill(input.commit)
    await page.locator('#change-scope').fill(JSON.stringify(input.cells)); await page.locator('#change-reviewed').check()
    let slow = true, broken = false
    await page.route('**/api/workbench/acceptance-records/preview', async route => {
      if (slow) await new Promise(resolve => setTimeout(resolve, 900))
      if (broken) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"preview-unavailable"}' }); return }
      await route.continue()
    })
    await page.locator('#change-preview').click()
    await expect(page.locator('#change-status')).toContainText('正在处理')
    await expect(page.locator('#change-preview')).toBeDisabled()
    await expect(page.locator('#wb-refresh')).toBeEnabled(); await page.locator('#wb-refresh').click()
    await page.locator('#wb-history button').first().click()
    await page.locator('#language-select').selectOption('en'); await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#change-result')).toContainText('预览验收: pass')
    await page.locator('#change-publish').click()
    await expect(page.locator('#change-result')).toContainText('当前核查: pass')
    await expect(page.locator('#change-status')).toHaveText('完成')
    const checkedAt = await page.locator('#change-result').textContent()
    await page.locator('#language-select').selectOption('en'); await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#change-result')).toHaveText(checkedAt!)
    const download = page.waitForEvent('download'); await page.locator('#change-json').click()
    const artifact = await download, bytes = await readFile((await artifact.path())!, 'utf8')
    expect(JSON.parse(bytes).current.status).toBe('pass'); expect(bytes).not.toContain('private-serial'); expect(bytes).not.toContain('secret-token')
    await expect(page.locator('#change-status')).toHaveText('完成')
    const mdDownload = page.waitForEvent('download'); await page.locator('#change-markdown').click()
    expect(await readFile((await (await mdDownload).path())!, 'utf8')).toContain('未验证制品供应链')
    await expect(page.locator('#change-status')).toHaveText('完成')
    broken = true
    await page.locator('#change-preview').click()
    await expect(page.locator('#change-status')).toContainText('正在处理')
    await expect(page.locator('#change-result')).toContainText('当前核查: pass')
    await expect(page.locator('#change-status')).toContainText('preview-unavailable')
    await expect(page.locator('#change-result')).toContainText('当前核查: pass')
    broken = false
    await page.locator('#change-preview').click(); await expect(page.locator('#change-status')).toContainText('正在处理')
    await page.locator('#change-cancel').click(); await expect(page.locator('#change-status')).toHaveText('cancelled')
    await page.waitForTimeout(1100); await expect(page.locator('#change-status')).toHaveText('cancelled')
    slow = false
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.locator('#change-result').evaluate(el => el.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: info.outputPath('change-acceptance-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#change-result').evaluate(el => el.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: info.outputPath('change-acceptance-narrow.png') })
    const denied = await page.request.post(`${viewer.url}/api/workbench/acceptance-records/preview`, { headers: { origin: 'https://untrusted.invalid' }, data: input })
    expect(denied.ok()).toBe(false)
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
