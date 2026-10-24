import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'

test('investigation plans remain responsive, preserve results and explicitly compare a child', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-investigation-ui-'))
  const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' })
    const yaml = 'name: Investigation\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertReady: {target: {testId: missing}, timeoutMs: 100}\n- done\n'
    const original = await viewer.workbench.start(yaml); await viewer.workbench.wait()
    const child = await viewer.workbench.start(yaml.replace('testId: missing', 'testId: public-input'), original.id); await viewer.workbench.wait()
    const before = await readFile(join(root, original.id, 'manifest.json'))
    await page.goto(viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
    await page.locator(`#wb-history button[data-run-id="${original.id}"]`).click()
    let fail = false
    await page.route('**/api/workbench/investigation', async route => {
      await new Promise(resolve => setTimeout(resolve, 650))
      if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic-unavailable"}' })
      else await route.continue()
    })
    const section = page.locator('#wb-investigation')
    await expect(section).toHaveAttribute('data-run-id', original.id)
    await section.locator('[data-investigation=generate]').click()
    await expect(section).toContainText('正在核验本机材料'); await page.locator('#wb-refresh').click()
    await expect(section).toContainText('最早已记录失败')
    await expect(section).toContainText('对比失败与成功证据中的目标身份')
    fail = true; await section.locator('[data-investigation=generate]').click()
    await expect(section).toContainText('synthetic-unavailable'); await expect(section).toContainText('最早已记录失败')
    fail = false
    await section.locator('[data-investigation=followup]').selectOption(child.id)
    await section.locator('[data-investigation=compare]').click()
    await expect(section).toContainText('复验本次通过，不证明修复因果')
    await expect(section.locator('.wb-followup')).toContainText('fail')
    await expect(section.locator('.wb-followup')).toContainText('pass')
    await page.setViewportSize({ width: 1440, height: 1100 })
    await section.locator('h3').evaluate(target => target.scrollIntoView({ block: 'start' }))
    await expect(section.locator('h3')).toBeInViewport()
    await page.screenshot({ path: info.outputPath('investigation-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await section.locator('h3').evaluate(target => target.scrollIntoView({ block: 'start' }))
    await expect(section.locator('h3')).toBeInViewport()
    await page.screenshot({ path: info.outputPath('investigation-narrow.png') })
    await section.locator('[data-investigation=generate]').click()
    await expect(section).toContainText('正在核验')
    await page.locator(`#wb-history button[data-run-id="${child.id}"]`).click()
    await expect(section).toHaveAttribute('data-run-id', child.id)
    await page.waitForTimeout(800)
    await expect(section).not.toContainText('最早已记录失败')
    await expect(section).not.toContainText('原运行: fail')
    expect(await readFile(join(root, original.id, 'manifest.json'))).toEqual(before)
    const wrong = await page.request.post(`${viewer.url}/api/workbench/investigation`, { data: { runId: child.id, followupRunId: original.id }, headers: { origin: viewer.url } }); expect(wrong.ok()).toBe(false)
    const cross = await page.request.post(`${viewer.url}/api/workbench/investigation`, { data: { runId: original.id }, headers: { origin: 'https://other.invalid' } }); expect(cross.ok()).toBe(false)
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
