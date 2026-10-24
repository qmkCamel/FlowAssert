import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'

// Opt-in: copy a user-approved completed archive; never acquire its live store
// or execute its YAML. Screenshots remain in ignored local artifacts.
test('reads and plays a real completed archive without device actions', async ({ page }) => {
  const source = process.env.MIRROR_PLAYBACK_ARCHIVE
  test.skip(!source, 'Set MIRROR_PLAYBACK_ARCHIVE to an approved completed run directory')
  test.setTimeout(60_000)
  const root = await mkdtemp(join(tmpdir(), 'mirror-playback-archive-')), id = basename(source!)
  const manifestBefore = await readFile(join(source!, 'manifest.json'))
  await cp(source!, join(root, id), { recursive: true })
  const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  const writes: string[] = []
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()) })
  try {
    await viewer.listen()
    await page.goto(`${viewer.url}/#/runs/${id}?step=1&tab=evidence`)
    await expect(page.locator('#analysis-evidence img')).toBeVisible()
    await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#playback-status')).toHaveText('已暂停')
    await page.locator('#playback-speed').selectOption('2'); await page.locator('#playback-toggle').click()
    await expect(page).toHaveURL(/step=2&tab=evidence/)
    await page.locator('#screenshot-playback').scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'artifacts/screenshots/playback-real-archive-playing.png', fullPage: true })
    await expect(page.locator('#playback-status')).toHaveText('回放结束', { timeout: 45_000 })
    await page.screenshot({ path: 'artifacts/screenshots/playback-real-archive-ended.png', fullPage: true })
    // Deterministic read failure on the same real evidence, without touching disk.
    await page.route('**/artifacts/*', route => route.fulfill({ status: 503, body: 'Read failure fixture' }))
    await page.locator('#playback-toggle').click()
    await expect(page.locator('#playback-status')).toContainText('截图不可用')
    await page.screenshot({ path: 'artifacts/screenshots/playback-real-archive-unavailable.png', fullPage: true })
    await page.unroute('**/artifacts/*'); await page.locator('#playback-retry').click()
    await expect(page.locator('#playback-status')).toHaveText('已暂停')
    await page.screenshot({ path: 'artifacts/screenshots/playback-real-archive-recovered.png', fullPage: true })
    expect(writes).toEqual([])
    expect(await readFile(join(source!, 'manifest.json'))).toEqual(manifestBefore)
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
