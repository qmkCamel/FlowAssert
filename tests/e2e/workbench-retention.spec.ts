import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'

const demo = await readFile(new URL('../../examples/flows/demo.yaml', import.meta.url), 'utf8')
test('previews protected references, moves only an unpinned fixture, and restores it', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-retention-ui-'))
  const viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  async function previewMovable(ids: string[]) {
    // A concurrent report read must protect its evidence. Ask for a fresh plan
    // once that transient lease ends instead of treating any listed ID (which
    // may be protected) as authorization to move it.
    await expect(async () => {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/workbench/retention/plan'
          && response.request().method() === 'POST', { timeout: 2000 }),
        page.locator('#wb-retention-plan').click({ timeout: 1000 }),
      ])
      expect(response.ok()).toBe(true)
      const plan = await response.json() as { candidates: { id: string }[] }
      expect(plan.candidates.map(entry => entry.id).sort()).toEqual([...ids].sort())
      await expect(page.locator('#wb-retention-results').getByLabel('我已核对候选与保护原因')).toBeEnabled({ timeout: 1000 })
    }).toPass({ timeout: 10000 })
  }
  try {
    await viewer.listen(); await page.goto(viewer.url); await viewer.service.start({ provider: 'mock' })
    await page.locator('#workbench-toggle').click(); await page.locator('#wb-yaml').fill(demo)
    await page.locator('#wb-run').click(); await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Passed', { timeout: 20000 })
    const id = (await page.locator('.wb-run-id').textContent())!.trim()
    await page.locator('#wb-retention-days').fill('0')
    await page.route('**/api/workbench/retention', async route => { await new Promise(resolve => setTimeout(resolve, 450)); await route.continue() })
    await page.locator('#wb-retention-scan').click()
    await expect(page.locator('#wb-retention-status')).toContainText('Scanning references')
    await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#wb-retention-status')).toContainText('容量已刷新', { timeout: 10000 })
    await previewMovable([id])
    await expect(page.locator('#wb-retention-results')).toContainText(id)
    await expect(page.locator('#wb-retention-results')).toContainText('移动后实际释放 0 字节')
    await page.locator('#wb-retention-results').screenshot({ path: 'artifacts/physical-validation/retention-preview-desktop.png' })
    await page.locator('#wb-retention-results').getByLabel('我已核对候选与保护原因').check()
    await page.locator('#wb-retention-results').getByText('确认移入隔离区').click()
    await expect(page.locator('#wb-retention-status')).toContainText('已移入隔离区', { timeout: 10000 })
    expect((await viewer.workbench.list()).some(run => run.id === id)).toBe(false)
    await page.locator('#wb-retention-results').getByText('隔离区: 1').click()
    await page.locator('#wb-retention-results').getByText('恢复', { exact: true }).click()
    await expect(page.locator('#wb-retention-status')).toContainText('已恢复', { timeout: 10000 })
    expect((await viewer.workbench.list()).some(run => run.id === id)).toBe(true)

    // A second fixture makes the confirmation a multi-object operation. Restore one,
    // independently authorize irreversible purge of only the other.
    await page.locator('#wb-yaml').fill('name: Retention second fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
    await page.locator('#wb-run').click()
    await expect(page.locator('.wb-run-id')).not.toHaveText(id, { timeout: 10000 })
    await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 20000 })
    const secondId = (await page.locator('.wb-run-id').textContent())!.trim()
    expect(secondId).not.toBe(id)
    await previewMovable([id, secondId])
    await expect(page.locator('#wb-retention-results')).toContainText(secondId)
    await expect(page.locator('#wb-retention-results')).toContainText(id)
    await page.locator('#wb-retention-results').getByLabel('我已核对候选与保护原因').check()
    await page.route('**/api/workbench/retention/confirm', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue() })
    await page.locator('#wb-retention-results').getByText('确认移入隔离区').click()
    await expect(page.locator('#wb-retention-status')).toContainText('正在重验引用并移动')
    await page.locator('#theme-button').click()
    await page.screenshot({ path: 'artifacts/screenshots/governance-retention-progress.png' })
    await expect(page.locator('#wb-retention-status')).toContainText('已移入隔离区: 2', { timeout: 10000 })
    await page.locator('#wb-retention-results').getByText('隔离区: 2').click()
    const restored = page.locator('#wb-retention-results .wb-row').filter({ hasText: id })
    await restored.getByText('恢复', { exact: true }).click()
    await expect(page.locator('#wb-retention-status')).toContainText('已恢复', { timeout: 10000 })
    await page.locator('#wb-retention-results').getByText('隔离区: 1').click()
    const purged = page.locator('#wb-retention-results .wb-row').filter({ hasText: secondId })
    await purged.getByText('彻底清除', { exact: true }).first().click()
    await expect(purged).toContainText('不可恢复')
    await purged.getByLabel(`彻底清除 ${secondId}`).fill(`PURGE ${secondId}`)
    await purged.getByRole('button', { name: '彻底清除' }).click()
    await expect(page.locator('#wb-retention-status')).toContainText('实际释放', { timeout: 10000 })
    expect((await viewer.workbench.list()).map(run => run.id)).toContain(id)
    expect((await viewer.workbench.list()).map(run => run.id)).not.toContain(secondId)
    await expect(page.locator('#wb-retention-results')).not.toContainText(secondId)
    await page.locator('#wb-retention-plan').click()
    await expect(page.locator('#wb-retention-results')).toContainText(id)
    const previousResults = await page.locator('#wb-retention-results').textContent()
    await page.route('**/api/workbench/retention/plan', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic reference scan failure' }) }))
    await page.locator('#wb-retention-plan').click()
    await expect(page.locator('#wb-retention-status')).toContainText('Synthetic reference scan failure')
    await expect(page.locator('#wb-retention-results')).toHaveText(previousResults!)
    await page.screenshot({ path: 'artifacts/screenshots/governance-retention-preserved.png' })
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
