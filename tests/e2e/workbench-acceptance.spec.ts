import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'

test('first acceptance preserves drafts, validates revisions, runs and exports a project', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-acceptance-'))
  const viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' })
    await page.goto(viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
    await page.locator('#wb-acceptance > summary').click()
    await page.locator('#acceptance-app').fill('com.example.mobilemirror.mock')
    await page.locator('#acceptance-expected').fill('Hello, harness.')
    page.once('dialog', dialog => void dialog.accept())
    await page.locator('#acceptance-template').click()
    await expect(page.locator('#wb-yaml')).toHaveValue(/Hello, harness/)
    let delay = false, fail = false
    await page.route('**/api/workbench/drafts/validate', async route => {
      if (delay) await new Promise(resolve => setTimeout(resolve, 700))
      if (fail) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"validation unavailable"}' }); return }
      await route.continue()
    })
    await page.locator('#acceptance-validate').click()
    await expect(page.locator('#acceptance-validation')).toContainText('结构校验通过')
    await expect(page.locator('#acceptance-validation')).toContainText('业务验证未配置')
    delay = true
    await page.locator('#acceptance-validate').click()
    await expect(page.locator('#acceptance-status')).toContainText('正在校验')
    await expect(page.locator('#wb-refresh')).toBeEnabled(); await page.locator('#wb-refresh').click()
    await page.locator('#wb-yaml').fill('invalid draft')
    await expect(page.locator('#acceptance-status')).toContainText('草稿已变化')
    await expect(page.locator('#acceptance-validation')).toContainText('以下保留上次结果')
    await page.waitForTimeout(800)
    await expect(page.locator('#acceptance-status')).toContainText('草稿已变化')
    const demo = await readFile(new URL('../../examples/flows/demo.yaml', import.meta.url), 'utf8')
    await page.locator('#wb-yaml').fill(demo)
    fail = true; await page.locator('#acceptance-validate').click()
    await expect(page.locator('#acceptance-status')).toContainText('validation unavailable')
    await expect(page.locator('#acceptance-validation')).toContainText('结构校验通过')
    fail = false; delay = false
    await page.locator('#acceptance-validate').click(); await expect(page.locator('#acceptance-status')).toHaveText('')
    await page.locator('#acceptance-run').click(); await expect(page.locator('#wb-run')).toBeFocused()
    await page.locator('#wb-run').click(); await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 20000 })
    await page.locator('#acceptance-reviewed').check()
    const download = page.waitForEvent('download'); await page.locator('#acceptance-export').click()
    expect((await download).suggestedFilename()).toBe('mobile-acceptance.tar')
    await expect(page.locator('#acceptance-status')).toContainText('项目已下载')
    const fixture = page.waitForEvent('download'); await page.locator('#acceptance-fixture-download').click()
    expect((await fixture).suggestedFilename()).toBe('mobile-business-template.tar')
    const before = await page.locator('#wb-yaml').inputValue()
    page.once('dialog', dialog => void dialog.dismiss())
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mobile-mirror:inspector-draft', { detail: { yaml: 'replacement' } })))
    await expect(page.locator('#wb-yaml')).toHaveValue(before)
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.locator('#wb-acceptance > summary').evaluate(target => target.scrollIntoView({ block: 'start' }))
    await expect(page.locator('#wb-acceptance > summary')).toBeInViewport()
    await page.screenshot({ path: info.outputPath('acceptance-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#wb-acceptance > summary').evaluate(target => target.scrollIntoView({ block: 'start' }))
    await expect(page.locator('#wb-acceptance > summary')).toBeInViewport()
    await page.screenshot({ path: info.outputPath('acceptance-narrow.png') })
    const response = await page.request.post(`${viewer.url}/api/workbench/acceptance/export`, { headers: { origin: 'https://elsewhere.invalid' }, data: { yaml: demo, reviewed: true } })
    expect(response.ok()).toBe(false)
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
