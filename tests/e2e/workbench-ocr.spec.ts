import { test, expect } from '@playwright/test'
import { mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { LocalDeviceRuntime } from '../../src/local-device-runtime.js'
import { seedAcceptance } from '../fixtures/acceptance-fixture.js'
import { fixtureRecognizer, ocrFixtureProfile } from '../fixtures/ocr-fixture.js'

test('OCR preview isolates screenshot identity, keeps history interactive and preserves prior result on cancel/failure', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'ocr-viewer-'))
  const runtime = new LocalDeviceRuntime(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  const png = await sharp({ create: { width: 390, height: 844, channels: 3, background: 'white' } }).png().toBuffer()
  runtime.application.workbench.ocr.preview = async (image, profile, signal) => {
    await new Promise(resolve => setTimeout(resolve, 700)); signal?.throwIfAborted()
    return fixtureRecognizer().preview(image, profile, signal)
  }
  try {
    await runtime.listen(); await runtime.service.start({ provider: 'mock' }); await seedAcceptance(runtime.application.workbench.store)
    await page.goto(runtime.viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click(); await page.locator('#wb-ocr > summary').click()
    await page.locator('#ocr-image').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png })
    await expect(page.locator('#ocr-canvas')).toBeVisible()
    await page.route('**/api/workbench/ocr/identity', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.fulfill({ json: { identity: ocrFixtureProfile.identity } }) })
    await page.locator('#ocr-identity').click(); await expect(page.locator('#ocr-identity')).toBeDisabled()
    await page.locator('#wb-refresh').click()
    await page.locator('#ocr-config').fill('{"id":"new-input"}')
    await expect(page.locator('#ocr-identity')).toBeEnabled(); await expect(page.locator('#ocr-config')).toHaveValue('{"id":"new-input"}')
    await page.route('**/api/workbench/ocr/profiles', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ json: { profiles: [] } }) })
    await page.locator('#ocr-profiles').click(); await expect(page.locator('#ocr-profiles')).toBeDisabled()
    await page.locator('#language-select').selectOption('en'); await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#ocr-profiles')).toBeEnabled()
    await page.locator('#ocr-config').fill(JSON.stringify(ocrFixtureProfile))
    await page.locator('#ocr-preview').click(); await expect(page.locator('#ocr-status')).toHaveText('正在识别…'); await expect(page.locator('#ocr-preview')).toBeDisabled()
    await page.locator('#wb-refresh').click(); await page.locator('#wb-history button').first().click()
    await page.locator('#language-select').selectOption('en'); await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#ocr-status')).toHaveText('候选识别完成')
    await expect(page.locator('#ocr-result')).toContainText('ocr-exact-match')
    const previous = await page.locator('#ocr-result').textContent()
    await page.locator('#ocr-preview').click(); await expect(page.locator('#ocr-status')).toHaveText('正在识别…'); await expect(page.locator('#ocr-result')).toHaveText(previous!)
    await page.locator('#ocr-cancel').click(); await expect(page.locator('#ocr-status')).toContainText('已取消'); await expect(page.locator('#ocr-result')).toHaveText(previous!)
    await page.route('**/api/workbench/ocr/preview', route => route.fulfill({ status: 503, body: '{}' }))
    await page.locator('#ocr-preview').click(); await expect(page.locator('#ocr-status')).toContainText('识别失败'); await expect(page.locator('#ocr-result')).toHaveText(previous!)
    await page.unroute('**/api/workbench/ocr/preview')
    await page.locator('#ocr-preview').click(); await expect(page.locator('#ocr-status')).toHaveText('正在识别…')
    await page.locator('#ocr-config').fill(JSON.stringify({ ...ocrFixtureProfile, expected: 'Changed' }))
    await expect(page.locator('#ocr-preview')).toBeEnabled(); await expect(page.locator('#ocr-result')).toHaveText(previous!)
    const download = page.waitForEvent('download'); await page.locator('#ocr-save').click(); expect((await download).suggestedFilename()).toBe('ocr-profile-draft.json')
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.locator('#ocr-preview').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('ocr-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#ocr-preview').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('ocr-narrow.png') })
    const artifacts = join(process.cwd(), 'artifacts/local-ocr'); await mkdir(artifacts, { recursive: true })
    for (const name of ['ocr-desktop.png', 'ocr-narrow.png']) await copyFile(info.outputPath(name), join(artifacts, name))
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
})
