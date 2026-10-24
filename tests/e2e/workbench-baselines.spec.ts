import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import { sha256 } from '../../src/workbench-store.js'

test('reviewed baseline approval keeps history controls interactive and survives a Viewer restart', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-baseline-ui-'))
  const projectPath = join(root, 'project.json')
  const reference = await sharp({ create: { width: 64, height: 48, channels: 4, background: '#1379c5' } }).png().toBuffer()
  await writeFile(join(root, 'reference.png'), reference)
  await writeFile(projectPath, JSON.stringify({ visualProfiles: { screen: { rulesVersion: 1, revision: 1, platform: 'ios', appId: 'com.example.mobilemirror.mock', build: 'mock-1', theme: 'any',
    approvedBy: 'fixture', approvedAt: new Date().toISOString(), reference: 'reference.png', referenceSha256: sha256(reference), masks: [], channelDelta: 0, maxDifferentRatio: 0 } } }))
  const config = Config({ viewerPort: 0, mockStartupDelayMs: 0 })
  let viewer = new ViewerServer(config, { workbenchRoot: join(root, 'runs'), workbenchProjectPath: projectPath })
  try {
    await viewer.listen(); await page.goto(viewer.url)
    await page.locator('#workbench-toggle').click()
    await page.locator('#wb-baseline-load').click()
    await expect(page.locator('#wb-baseline-profile')).toHaveValue('screen')
    await page.route('**/api/workbench/baselines/candidate', async route => {
      await new Promise(resolve => setTimeout(resolve, 650))
      await route.continue()
    })
    await page.locator('#wb-baseline-preview').click()
    await expect(page.locator('#wb-baseline-status')).toContainText('Checking baseline source')
    await page.locator('#wb-sample').selectOption('sampleapp')
    await expect(page.locator('#wb-sample')).toHaveValue('sampleapp')
    await expect(page.locator('#wb-baseline-results img')).toBeVisible()
    await expect.poll(() => page.locator('#wb-baseline-results img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(64)
    await page.locator('.wb-baselines').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-baseline-preview.png' })
    await page.locator('#wb-baseline-results input[type=text]').fill('local-reviewer')
    await page.locator('#wb-baseline-results input[type=checkbox]').check()
    await page.locator('#wb-baseline-results button').click()
    await expect(page.locator('#wb-baseline-status')).toContainText('Baseline approved: screen r1')
    const rejected = await page.request.post(`${viewer.url}/api/workbench/baselines/candidate`, { headers: { origin: 'https://untrusted.invalid' }, data: { profileId: 'screen', sourceKind: 'project' } })
    expect(rejected.ok()).toBe(false)
    await page.locator('.wb-baselines').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-baseline-approval.png' })
    await viewer.close()
    viewer = new ViewerServer(config, { workbenchRoot: join(root, 'runs'), workbenchProjectPath: projectPath })
    await viewer.listen(); await page.goto(viewer.url); await page.locator('#workbench-toggle').click(); await page.locator('#wb-baseline-load').click()
    await expect(page.locator('#wb-baseline-profile option')).toContainText('screen · ios · r1')
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
