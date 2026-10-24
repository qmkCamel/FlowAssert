import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'

test('beta task card YAML completes pass, fail, new revision and offline report in the real Mock workbench', async ({ page }, info) => {
  test.setTimeout(90000)
  const guide = await readFile('docs/beta-start.md', 'utf8')
  const yaml = /```yaml\n([\s\S]*?)```/.exec(guide)![1]!
  const root = await mkdtemp(join(tmpdir(), 'mirror-beta-onboarding-'))
  const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen()
    // Connection is local Mock only; no phone or host discovery.
    await viewer.service.start({ provider: 'mock' })
    await page.goto(`${viewer.url}/#/cases/new`)
    await page.locator('#journey-demo').click()
    await page.locator('#journey-source summary').click()
    await page.locator('#journey-yaml').fill(yaml)
    await page.locator('#journey-public').check()
    let caseId = '', failedId = ''
    for (const expected of ['Passed', 'Failed', 'Passed']) {
      if (caseId) {
        await viewer.service.stop()
        await viewer.service.start({ provider: 'mock' })
        await page.goto(`${viewer.url}/#/cases/${caseId}/edit`)
        // Hash navigation retains the old page and its session binding; load the restarted device afresh.
        await page.reload()
        await expect(page.locator('#journey-yaml')).not.toHaveValue('')
        if (!(await page.locator('#journey-yaml').isVisible())) await page.locator('#journey-source summary').click()
        await page.locator('#journey-yaml').fill(expected === 'Failed' ? yaml.replace('1 actions received', '2 actions received') : yaml)
        await page.locator('#journey-public').check()
      }
      await page.locator('#journey-save').click()
      await expect(page.locator('#journey-validation')).toContainText('Revision saved')
      caseId = (await (await page.request.get(`${viewer.url}/api/workbench/cases`)).json()).cases[0].caseId
      await page.locator('#journey-validate').click()
      await expect(page.locator('#journey-validation')).toContainText('Static validation passed')
      await page.locator('#journey-consent').check()
      await page.locator('#journey-run').click()
      await expect(page.locator('#analysis-summary')).toContainText(`Recorded verdict: ${expected}`, { timeout: 20000 })
      if (expected === 'Failed') {
        failedId = page.url().split('/runs/')[1]!
        await page.screenshot({ path: 'artifacts/screenshots/beta-workbench-failure.png', fullPage: true })
        await info.attach('real workbench Mock failure', { path: 'artifacts/screenshots/beta-workbench-failure.png', contentType: 'image/png' })
      }
    }
    await page.reload()
    await expect(page.locator('#analysis-summary')).toContainText('Recorded verdict: Passed')
    await page.locator('#journey-analysis > nav a').filter({ hasText: 'Share' }).click()
    const share = page.locator('#analysis-secondary .wb-share')
    await share.locator(':scope > summary').click()
    await share.getByRole('button', { name: 'Preview derived content', exact: true }).click()
    await expect(share.frameLocator('iframe').locator('body')).toContainText('Not revalidated')
    await share.locator('input[type=checkbox]').last().check()
    const downloadPromise = page.waitForEvent('download')
    await share.getByRole('button', { name: 'Download reviewed report', exact: true }).click()
    const html = await readFile((await (await downloadPromise).path())!, 'utf8')
    expect(html).toBe(await share.locator('iframe').getAttribute('srcdoc'))
    await share.locator('iframe').scrollIntoViewIfNeeded()
    await expect.poll(async () => (await sharp(await share.locator('iframe').screenshot()).stats()).channels[0]!.stdev).toBeGreaterThan(10)
    await page.screenshot({ path: 'artifacts/screenshots/beta-workbench-share.png' })
    await info.attach('real workbench Mock report', { path: 'artifacts/screenshots/beta-workbench-share.png', contentType: 'image/png' })
    await page.goto(`${viewer.url}/#/runs/${failedId}`)
    await expect(page.locator('#analysis-summary')).toContainText('Recorded verdict: Failed')
    await page.goto(`${viewer.url}/#/runs`)
    await expect(page.locator('#report-list tbody tr')).toHaveCount(3)
  } finally {
    await viewer.close()
    await rm(root, { recursive: true, force: true })
  }
})
