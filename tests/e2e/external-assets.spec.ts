import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config, type Config as MirrorConfig } from '../../src/config.js'
import { LocalDeviceRuntime } from '../../src/local-device-runtime.js'
import { seedAcceptance } from '../fixtures/acceptance-fixture.js'
test('external import keeps history responsive, requires per-asset authorization and preserves results on failure/cancellation', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'external-ui-')), projectPath = join(root, 'project.json')
  await writeFile(projectPath, '{"flows":{}}')
  const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0, mockStartupDelayMs: 0, agentTestControl: { enabled: true, projectPath, allowedFlows: [], allowedSuites: [], allowedPlatforms: ['ios'], allowedAppIds: [], sharedEvidence: [] } } as unknown as MirrorConfig), { workbenchRoot: join(root, 'runs') })
  try {
    await runtime.listen(); await runtime.service.start({ provider: 'mock' }); await seedAcceptance(runtime.application.workbench.store)
    await page.goto(runtime.viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click(); await page.locator('#wb-external > summary').click()
    await page.locator('#external-report').setInputFiles({ name: 'report.xml', mimeType: 'application/xml', buffer: Buffer.from('<testsuite><testcase name="&lt;script&gt;untrusted&lt;/script&gt;"/><system-out>PRIVATE-OUTPUT</system-out></testsuite>') })
    await page.locator('#external-attachments').setInputFiles({ name: 'diagnostic.txt', mimeType: 'text/plain', buffer: Buffer.from('LOCAL ATTACHMENT ONLY') })
    await page.locator('#external-engine').fill('synthetic'); await page.locator('#external-version').fill('1')
    let fail = false
    await page.route('**/api/workbench/external-assets/preview', async route => { await new Promise(resolve => setTimeout(resolve, 800)); if (fail) await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); else await route.continue() })
    await page.locator('#external-preview').click(); await expect(page.locator('#external-status')).toContainText('正在处理')
    await expect(page.locator('#external-preview')).toBeDisabled(); await page.locator('#wb-refresh').click(); await page.locator('#wb-history button').first().click()
    await page.locator('#language-select').selectOption('en'); await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#external-detail')).toContainText('reported-pass')
    await expect(page.locator('#external-confirm')).toBeDisabled(); await page.locator('#external-reviewed').check(); await page.locator('#external-confirm').click()
    await expect(page.locator('#external-detail')).toContainText('/ verified'); await expect(page.locator('#external-status')).toHaveText('完成')
    const assets = await runtime.application.externalAssets.list(), id = assets.items[0]!.id
    await expect(runtime.coordinator.externalResult(id)).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    page.once('dialog', dialog => dialog.accept()); await page.locator('#external-grant').click(); await expect(page.locator('#external-status')).toHaveText('完成')
    expect(await runtime.coordinator.externalResult(id)).toMatchObject({ reportedStatus: 'reported-pass' })
    expect(JSON.stringify(await runtime.coordinator.externalResult(id))).not.toMatch(/PRIVATE-OUTPUT|untrusted|ATTACHMENT/)
    await page.locator('#external-revoke').click(); await expect(page.locator('#external-status')).toHaveText('完成')
    await expect(runtime.coordinator.externalResult(id)).rejects.toMatchObject({ code: 'mobile_mirror_not_found' })
    const downloaded = page.waitForEvent('download'); await page.locator('#external-detail a').click()
    expect(await readFile((await (await downloaded).path())!, 'utf8')).toBe('LOCAL ATTACHMENT ONLY')
    fail = true; await page.locator('#external-preview').click(); await expect(page.locator('#external-detail')).toContainText('/ verified')
    await expect(page.locator('#external-status')).toContainText('external-http-503'); await expect(page.locator('#external-detail')).toContainText('/ verified')
    fail = false; await page.locator('#external-preview').click(); await expect(page.locator('#external-status')).toContainText('正在处理'); await page.locator('#external-cancel').click()
    await expect(page.locator('#external-status')).toContainText('已取消'); await page.waitForTimeout(1000); await expect(page.locator('#external-detail')).toContainText('/ verified')
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.locator('#external-detail').evaluate(el => el.scrollIntoView({ block: 'center' })); await page.screenshot({ path: info.outputPath('external-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#external-detail').evaluate(el => el.scrollIntoView({ block: 'center' })); await page.screenshot({ path: info.outputPath('external-narrow.png') })
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
})
