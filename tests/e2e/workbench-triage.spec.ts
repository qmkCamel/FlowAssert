import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import type { TestRun } from '../../src/workbench-store.js'

test('explicit triage remains local and responsive while preserving the original verdict', async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-triage-ui-'))
  const viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen()
    const store = viewer.workbench.store
    await store.init()
    const now = new Date().toISOString()
    const ids = ['b1e9cf95-27b8-4232-bf7a-a08bb9302e08', 'a0ecc2de-92b5-48fb-9bb5-c68839accdd7']
    for (const [index, id] of ids.entries()) {
      const source = index ? await store.put(id, 'step-1.xml', '<root/>', 'application/xml; charset=utf-8') : undefined
      const run: TestRun = { schemaVersion: 1, id, name: index ? 'Failing case' : 'Other case', yaml: 'fixture', engine: 'test', phase: 'finished', verdict: index ? 'fail' : 'pass',
        startedAt: new Date(Date.now() + index * 1000).toISOString(), endedAt: now, sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock',
        verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: index ? 'fail' : 'pass', cleanup: 'session-retained',
        steps: [], evidence: source ? [source] : [], diagnostics: index ? [{ domain: 'business-assertion', code: 'verifier-fail', phase: 'verify', retryable: false,
          evidenceRefs: [source!.name], observedAt: now, message: 'secret value' }] : [] }
      await store.save(run)
    }
    const original = viewer.triage.start.bind(viewer.triage)
    viewer.triage.start = async input => { await new Promise(resolve => setTimeout(resolve, 650)); return original(input) }
    await page.goto(viewer.url)
    await page.locator('#language-select').selectOption('zh-CN')
    await page.locator('#workbench-toggle').click()
    await page.locator(`#wb-history button[data-run-id="${ids[1]}"]`).click()
    const section = page.locator('.wb-triage')
    const acceptedResponse = page.waitForResponse(response => response.url().endsWith('/api/workbench/triage-jobs') && response.request().method() === 'POST')
    await section.getByRole('button', { name: '生成分诊' }).click()
    const accepted = await (await acceptedResponse).json() as { jobId: string }
    await expect(section).toContainText('正在分析本机证据')
    await expect(page.locator('#wb-refresh')).toBeEnabled()
    await page.locator('#wb-refresh').click()
    await expect(section).toContainText('产品行为待核对', { timeout: 10_000 })
    await expect(section).toContainText('原结果: fail')
    await expect(section).not.toContainText('secret value')
    await section.locator('.wb-triage-route summary').click()
    await expect(section).toContainText('verifier-fail')
    await page.locator('#workbench-panel').evaluate(panel => { const target = panel.querySelector('.wb-triage')!; panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16 })
    await page.screenshot({ path: testInfo.outputPath('triage-desktop.png'), fullPage: true })
    await section.screenshot({ path: testInfo.outputPath('triage-panel-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(section.getByRole('button', { name: '生成分诊' })).toBeVisible()
    await page.locator('#workbench-panel').evaluate(panel => { const target = panel.querySelector('.wb-triage')!; panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16 })
    await page.screenshot({ path: testInfo.outputPath('triage-narrow.png'), fullPage: true })
    await section.screenshot({ path: testInfo.outputPath('triage-panel-narrow.png') })
    await section.locator('.wb-triage-review summary').click()
    await section.getByRole('textbox', { name: '复核者别名' }).fill('qa-reviewer')
    await section.getByRole('textbox', { name: '复核说明' }).fill('请核对业务预期')
    await section.getByLabel('产品行为待核对', { exact: true }).check()
    await section.getByLabel('查看证据 · step-1.xml').check()
    const originalReview = viewer.triage.review.bind(viewer.triage)
    let failReview = true
    viewer.triage.review = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (failReview) { failReview = false; throw new Error('synthetic-save-failure') }
      return originalReview(...args)
    }
    await section.getByRole('button', { name: '保存复核' }).click()
    await expect(section).toContainText('正在保存复核')
    await expect(page.locator('#wb-refresh')).toBeEnabled()
    await page.locator('#wb-refresh').click()
    await expect(section).toContainText('synthetic-save-failure')
    await section.locator('.wb-triage-review summary').click()
    await expect(section.getByRole('textbox', { name: '复核者别名' })).toHaveValue('qa-reviewer')
    await expect(section.getByRole('textbox', { name: '复核说明' })).toHaveValue('请核对业务预期')
    await expect(section.getByLabel('产品行为待核对', { exact: true })).toBeChecked()
    await expect(section.getByLabel('查看证据 · step-1.xml')).toBeChecked()
    await section.getByRole('button', { name: '保存复核' }).click()
    await expect(section).toContainText('1 review(s)')
    const reportId = (await viewer.triage.getJob(accepted.jobId)).reportId!
    expect(await viewer.triage.reviews(reportId)).toMatchObject([{ directions: ['product-behavior'], evidenceRefs: ['step-1.xml'] }])
    page.once('dialog', dialog => void dialog.accept())
    await section.getByRole('button', { name: '停用此报告' }).click()
    await expect(section).toContainText('报告已停用')
    const crossOrigin = await page.request.post(`${viewer.url}/api/workbench/triage-jobs`, { headers: { origin: 'https://not-this-viewer.invalid' },
      data: { requestId: 'e2a73cb8-b3d5-4720-a20a-6e47023c02f9', targetRunId: ids[1] } })
    expect(crossOrigin.ok()).toBe(false)
    expect((await store.readOnlySnapshot(ids[1]!)).run.verdict).toBe('fail')
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
