import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'

let root: string, viewer: ViewerServer
const demo = await readFile(new URL('../../examples/flows/demo.yaml', import.meta.url), 'utf8')
const sanitizedArchivePath = fileURLToPath(new URL('../fixtures/workbench-runs/sampleapp-ios-history-title-missing.mobile-mirror-run.json', import.meta.url))
test.beforeEach(async ({ page }) => {
  root = await mkdtemp(join(tmpdir(), 'mirror-workbench-ui-'))
  viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await page.goto(viewer.url)
  await viewer.service.start({ provider: 'mock' })
  await page.locator('#workbench-toggle').click()
  await page.locator('#wb-yaml').fill(demo)
})
test.afterEach(async () => { await viewer?.close(); await rm(root, { recursive: true, force: true }) })

test('labels the generic app template as requiring configuration', async ({ page }) => {
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#wb-sample').selectOption('sampleapp')
  await expect(page.locator('#wb-sample option:checked')).toHaveText('示例 App · 需配置')
  await expect(page.locator('#wb-yaml')).toHaveValue(/appId: com\.example\.sampleapp/)
  await expect(page.locator('#wb-history button')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/screenshots/privacy-generic-sample.png', fullPage: true })
})

test('runs YAML with live preview, opens evidence, and restores history after restart', async ({ page }) => {
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 20000 })
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.locator('#wb-history button')).toHaveCount(1)
  await page.locator('.wb-provenance summary').click()
  await expect(page.locator('.wb-provenance')).toContainText('应用版本: mock-1 · 实际观测')
  await expect(page.locator('.wb-provenance')).toContainText('源码提交: unknown · 未知')
  await page.locator('.wb-step').nth(3).locator('summary').click()
  await expect(page.locator('.wb-step').nth(3).locator('.wb-timing')).toContainText('步骤执行')
  const img = page.locator('.wb-step').nth(3).locator('img')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.locator('#workbench-panel').evaluate((el) => {
    const detail = el.querySelector('#wb-detail')!
    el.scrollTop += detail.getBoundingClientRect().top - el.getBoundingClientRect().top - 20
    window.scrollTo(0, 0)
  })
  await expect.poll(() => page.locator('#workbench-panel').evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-evidence.png' })
  const oldId = await page.locator('.wb-run-id').textContent()
  await viewer.close()
  viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await page.goto(viewer.url); await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
  await expect(page.locator('.wb-run-id')).toHaveText(oldId!)
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 20000 })
})

test('imports a sanitized failed run and opens its failure evidence without device control', async ({ page }) => {
  await viewer.service.stop()
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#wb-import-file').setInputFiles(sanitizedArchivePath)
  await expect(page.locator('#wb-history button')).toHaveCount(1)
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('失败')
  await expect(page.locator('#wb-detail .wb-note').first()).toContainText('归档导入')
  await page.locator('.wb-provenance summary').click()
  await expect(page.locator('.wb-provenance')).toContainText('历史记录未包含版本化来源数据')
  await expect(page.locator('.wb-step')).toHaveCount(2)
  const failed = page.locator('.wb-step').filter({ hasText: '12. assert' })
  await expect(failed).toHaveAttribute('open', '')
  await expect(failed).toContainText('本轮唯一标题')
  const screenshot = failed.locator('img')
  await expect(screenshot).toBeVisible()
  await expect.poll(() => screenshot.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(1)
  const source = failed.locator('a').filter({ hasText: '页面结构' })
  const response = await page.request.get(new URL((await source.getAttribute('href'))!, viewer.url).href)
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain('sample-history-item-sanitized')
  await page.setViewportSize({ width: 1440, height: 1100 })
  await failed.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-imported-failure.png' })
  const importedId = (await viewer.workbench.list())[0]!.id
  await page.goto(`${viewer.url}/#/runs/${importedId}?tab=evidence`)
  await expect(page.locator('#analysis-summary')).toContainText('失败')
  await expect(page.locator('#analysis-evidence h2')).toContainText('12')
  await expect(page.locator('#analysis-evidence img')).toBeVisible()
  await expect(page.locator('.stage')).toBeHidden()
})

test('previews a derived share while controls remain usable, then imports it as not revalidated', async ({ page }) => {
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 20000 })
  const originalRunId = (await (await page.request.get(`${viewer.url}/api/runs`)).json()).runs[0].id as string
  const section = page.locator('.wb-share')
  await section.locator(':scope > summary').click()
  await section.locator('label').filter({ hasText: 'step-1.png' }).locator('input[type=checkbox]').check()
  await page.route('**/api/workbench/share/jobs', async route => {
    await new Promise(resolve => setTimeout(resolve, 600))
    await route.continue()
  })
  await section.getByText('预览派生内容').click()
  await expect(section).toContainText('正在生成派生内容')
  await page.locator('#language-select').selectOption('en')
  await expect(page.locator('#workbench-panel')).toBeVisible()
  await expect(section).toContainText('Preview ready', { timeout: 10000 })
  await expect(section.locator('img')).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await section.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'artifacts/physical-validation/safe-share-narrow.png' })
  await expect(section.getByText('Cancel conversion')).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 1100 })
  const failedPreview = async (route: import('@playwright/test').Route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary conversion failure' }) })
  await page.route('**/api/workbench/share/jobs', failedPreview)
  await section.getByText('Preview derived content').click()
  await expect(section).toContainText('temporary conversion failure')
  await expect(section.locator('img')).toHaveCount(1)
  await page.unroute('**/api/workbench/share/jobs', failedPreview)
  await page.locator('#workbench-panel').evaluate(panel => { const target = panel.querySelector('.wb-share')!; panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16 })
  await page.screenshot({ path: 'artifacts/physical-validation/safe-share-desktop.png' })
  await section.getByLabel('I reviewed every preview and the shared content').check()
  const downloadEvent = page.waitForEvent('download')
  await section.getByText('Confirm and download v2').click()
  const download = await downloadEvent
  const archive = JSON.parse(await readFile(await download.path()!, 'utf8'))
  expect(archive).toMatchObject({ format: 'mobile-mirror-run', version: 2, sharing: { reportedVerdict: 'pass', verification: 'not-revalidated' } })
  const legacySelection = { runId: originalRunId, files: [{ name: 'step-1.png' }] }
  const legacyPreviewResponse = await page.request.post(`${viewer.url}/api/workbench/share/preview`, { headers: { origin: viewer.url }, data: legacySelection })
  expect(legacyPreviewResponse.status()).toBe(200)
  const legacyPreview = await legacyPreviewResponse.json()
  expect(legacyPreview.files).toHaveLength(1)
  const legacyExportResponse = await page.request.post(`${viewer.url}/api/workbench/share/export`, { headers: { origin: viewer.url }, data: { ...legacySelection, previewDigest: legacyPreview.digest, reviewed: true } })
  expect(legacyExportResponse.status()).toBe(200)
  expect(await legacyExportResponse.json()).toMatchObject({ format: 'mobile-mirror-run', version: 2, sharing: { verification: 'not-revalidated' } })
  const imported = await page.request.post(`${viewer.url}/api/runs/import`, { headers: { origin: viewer.url }, data: { archive, localEvidence: true } })
  expect(imported.status()).toBe(201)
  const run = await imported.json()
  expect(run).toMatchObject({ verdict: 'inconclusive', share: { reportedVerdict: 'pass', verification: 'not-revalidated' } })
  await page.goto(`${viewer.url}/#/runs/${run.id}?tab=summary`)
  await expect(page.locator('#analysis-summary')).toContainText('Derived evidence not revalidated')
  await expect(page.locator('#analysis-summary')).toContainText('Passed')
  await expect(page.getByRole('button', { name: 'Replay original snapshot (new run)' })).toHaveCount(0)
})

test('compares two archived runs without taking device control and retains the report after restart', async ({ page }) => {
  await page.locator('#language-select').selectOption('zh-CN')
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 20000 })
  await viewer.service.stop()
  await viewer.service.start({ provider: 'mock' })
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-history button')).toHaveCount(2, { timeout: 20000 })
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过', { timeout: 20000 })
  const compare = page.locator('.wb-comparison')
  await expect(compare.locator('select')).toHaveValue(/.+/)
  let releaseComparison!: () => void
  const submission = new Promise<void>(resolve => { releaseComparison = resolve })
  await page.route('**/api/workbench/comparisons', async route => { await submission; await route.continue() })
  await compare.locator('button').click()
  try {
    await expect(compare.getByRole('status')).toContainText('正在生成比较报告')
    await expect(compare.getByRole('button', { name: '开始比较', exact: true })).toBeDisabled()
    await page.locator('#theme-button').click()
    await expect(page.locator('body')).toHaveClass(/light-stage/)
    await expect(compare.getByRole('button', { name: '开始比较', exact: true })).toBeDisabled()
    await expect(page.locator('#wb-history button')).toHaveCount(2)
  } finally { releaseComparison() }
  await expect(compare).toContainText(/比较报告 · (completed|partial)/, { timeout: 20000 })
  await page.unroute('**/api/workbench/comparisons')
  await expect(compare).toContainText('确定性事实摘要，不是 AI 根因判断')
  await expect(compare).toContainText('证据覆盖')
  await expect(compare.locator('.wb-comparison-step')).toHaveCount(6)
  await expect(compare.getByText('下载 JSON 报告')).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 1200 })
  await compare.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-run-comparison.png' })
  const targetId = await page.locator('.wb-run-id').textContent()
  const reportId = await compare.getByText('下载 JSON 报告').getAttribute('href')
  const comparisonId=reportId!.split('/').at(-2)!
  let releaseFailure!: () => void
  const failure = new Promise<void>(resolve => { releaseFailure = resolve })
  await page.route('**/api/workbench/comparisons', async route => { await failure; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'comparison submission failed' }) }) })
  await compare.getByRole('button', { name: '开始比较', exact: true }).click()
  try {
    await expect(compare.getByRole('status')).toBeVisible()
    await expect(compare.getByText('下载 JSON 报告')).toHaveAttribute('href', reportId!)
    await page.locator('#theme-button').click()
    await expect(page.locator('body')).not.toHaveClass(/light-stage/)
  } finally { releaseFailure() }
  await expect(compare.getByRole('status')).toHaveCount(0)
  await expect(compare.getByText('下载 JSON 报告')).toHaveAttribute('href', reportId!)
  await expect(page.locator('#wb-error')).toContainText('comparison submission failed')
  await page.screenshot({ path: 'artifacts/screenshots/lifecycle-comparison-retained.png' })
  await page.unroute('**/api/workbench/comparisons')
  // Control response timing to verify pending cancellation across poll/theme rerenders.
  // Actual Worker/lease shutdown is covered by comparison-lifecycle.test.ts.
  const savedComparison = await viewer.comparisons.get(comparisonId)
  await page.route('**/api/workbench/comparisons', route => route.fulfill({ json: { ...savedComparison, state: 'running' } }))
  let releaseCancel!: () => void
  const cancelling = new Promise<void>(resolve => { releaseCancel = resolve })
  await page.route(`**/api/workbench/comparisons/${comparisonId}`, route => route.fulfill({ json: { ...savedComparison, state: 'running' } }))
  await page.route(`**/api/workbench/comparisons/${comparisonId}/cancel`, async route => { await cancelling; await route.fulfill({ json: { ...savedComparison, state: 'cancelled' } }) })
  await compare.getByRole('button', { name: '开始比较', exact: true }).click()
  await compare.getByRole('button', { name: '取消比较', exact: true }).click()
  try {
    await expect(compare.getByRole('status')).toContainText('正在取消比较')
    await page.locator('#theme-button').click()
    await expect(page.locator('body')).toHaveClass(/light-stage/)
    await expect(compare.getByRole('button', { name: '取消比较', exact: true })).toBeDisabled()
    await expect(compare.getByRole('button', { name: '开始比较', exact: true })).toBeDisabled()
    await page.screenshot({ path: 'artifacts/screenshots/lifecycle-comparison-cancelling.png' })
  } finally { releaseCancel() }
  await expect(compare).toContainText('比较报告 · cancelled')
  await page.unroute('**/api/workbench/comparisons')
  await page.unroute(`**/api/workbench/comparisons/${comparisonId}`)
  await page.unroute(`**/api/workbench/comparisons/${comparisonId}/cancel`)
  const contextBefore=await fetch(`${viewer.url}/api/workbench/comparisons/${comparisonId}/diagnostic-context`,{headers:{origin:viewer.url}}).then(response=>response.json())
  expect(JSON.stringify(contextBefore)).not.toContain(root);expect(contextBefore).toMatchObject({schemaVersion:1,comparison:{id:comparisonId},drillDown:{reportRef:`comparison:${comparisonId}`}})
  const evidenceRef=contextBefore.drillDown.evidenceRefs[0]
  const detail=await fetch(`${viewer.url}/api/workbench/comparisons/${comparisonId}/evidence/${encodeURIComponent(evidenceRef)}`,{headers:{origin:viewer.url}}).then(response=>response.json())
  expect(detail).toMatchObject({id:evidenceRef,artifactUrl:expect.stringMatching(/^\/api\/runs\//)});expect(detail).not.toHaveProperty('sourceName')
  expect((await fetch(`${viewer.url}${detail.artifactUrl}`,{headers:{origin:viewer.url}})).status).toBe(200)
  expect((await fetch(`${viewer.url}/api/workbench/comparisons/${comparisonId}/evidence/evidence%3Aunknown`,{headers:{origin:viewer.url}})).status).toBe(400)
  const rejected = await fetch(`${viewer.url}/api/workbench/comparisons`, { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify({ baselineRunId: targetId, targetRunId: targetId }) })
  expect(rejected.status).toBe(400)
  await viewer.close()
  viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen()
  const report = await fetch(`${viewer.url}${reportId}`, { headers: { origin: viewer.url } })
  expect(report.status).toBe(200)
  expect(await report.json()).toMatchObject({ targetRunId: targetId, state: 'completed' })
  const contextAfter=await fetch(`${viewer.url}/api/workbench/comparisons/${comparisonId}/diagnostic-context`,{headers:{origin:viewer.url}}).then(response=>response.json())
  expect(contextAfter).toEqual(contextBefore)
})

test('a stale comparison poll cannot restore running after cancellation completes', async ({ page }) => {
  const state = await page.evaluate(async () => {
    const modulePath = '/workbench-comparisons.js'
    const { createComparisonPanel } = await import(modulePath)
    const root = document.createElement('div'), run = { id: 'target', comparison: {} }
    const report = { id: 'comparison', targetRunId: run.id, state: 'running', progress: 'comparing', steps: [] }
    let release!: (value: unknown) => void
    const api = async (path: string) => {
      if (path.includes('comparison-candidates')) return { candidates: [{ id: 'baseline', name: 'baseline', startedAt: '2026-01-01' }] }
      if (path.endsWith('/cancel')) return { ...report, state: 'cancelled' }
      if (path.endsWith('/comparison')) return new Promise(resolve => { release = resolve })
      return report
    }
    const node = (tag: string, text?: string, className?: string) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el }
    const rerender = () => { root.replaceChildren(); panel.render(root, run) }
    const panel = createComparisonPanel({ t: (key: string) => key, node, api, selectedRunId: () => run.id, history: () => [], currentRun: () => run, rerender, showError: () => {} })
    rerender(); await Promise.resolve()
    const start = root.querySelector('button.check-button') as HTMLButtonElement
    await start.onclick!(new PointerEvent('click'))
    const poll = panel.poll()
    const cancel = root.querySelector('button.text-button') as HTMLButtonElement
    await cancel.onclick!(new PointerEvent('click'))
    release(report); await poll
    return panel.current().state
  })
  expect(state).toBe('cancelled')
})

test('slow failing source retains the PNG, shows timing and keeps unrelated controls interactive', async ({ page }) => {
  await viewer.close()
  let release!: () => void, entered = false
  class SlowSource extends MockProvider {
    override async screenSource(): ReturnType<MockProvider['screenSource']> {
      entered = true
      await new Promise<void>((resolve) => { release = resolve })
      throw new Error('Source interrupted fixture')
    }
  }
  const config = Config({ viewerPort: 0, mockStartupDelayMs: 0 })
  const service = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => new SlowSource(0) })
  viewer = new ViewerServer(config, { service, assistant: null, disposeServiceOnClose: true, workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' }); await page.goto(viewer.url)
    await page.locator('#language-select').selectOption('zh-CN'); await page.locator('#workbench-toggle').click()
    await page.locator('#wb-yaml').fill(demo); await page.locator('#wb-run').click()
    await expect.poll(() => entered).toBe(true)
    await expect(page.locator('.wb-activity')).toContainText('取源树')
    await page.locator('#theme-button').click(); await expect(page.locator('body')).toHaveClass(/light-stage/)
    await page.locator('#wb-refresh').click(); await expect(page.locator('#device-frame')).toBeVisible()
    await page.locator('#wb-cancel').click()
    release()
    await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('已取消')
    await expect(page.locator('.wb-step summary').first()).toContainText('取证未完成')
    // The retained image is lazy-loaded; bring it into view before asserting decoded visibility.
    await page.locator('.wb-step img').scrollIntoViewIfNeeded()
    await expect(page.locator('.wb-step img')).toBeVisible()
    await expect.poll(() => page.locator('.wb-step img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await expect(page.locator('.wb-step .wb-error')).toContainText('取证未完成')
    await expect(page.locator('.wb-step .wb-timing')).toContainText('取源树')
    await expect(page.locator('.wb-step')).toHaveCount(1)
    await expect(page.locator('#wb-run')).toBeEnabled()
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.locator('.wb-step').first().scrollIntoViewIfNeeded()
    await page.locator('#workbench-panel').evaluate((el) => {
      el.scrollTop += el.querySelector('.wb-step')!.getBoundingClientRect().top - el.getBoundingClientRect().top - 20
    })
    await expect(page.locator('.wb-step summary').first()).toBeInViewport()
    await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-partial-evidence.png' })
  } finally { release?.() }
})

test('long flow keeps theme and history interactive, and cancellation stops subsequent actions', async ({ page }) => {
  await page.locator('#wb-yaml').fill(demo.replace('- tap:', '- wait: 30\n- tap:'))
  await page.locator('#wb-run').click()
  await expect(page.locator('.wb-step summary').filter({ hasText: 'wait' })).toBeVisible({ timeout: 15000 })
  await expect(page.locator('#wb-cancel')).toBeEnabled()
  await page.locator('#theme-button').click()
  await expect(page.locator('body')).toHaveClass(/light-stage/)
  await page.locator('#wb-refresh').click()
  await expect(page.locator('#device-frame')).toBeVisible()
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-workbench-running.png', fullPage: true })
  await page.locator('#wb-cancel').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Cancelled', { timeout: 10000 })
  await expect(page.locator('.wb-step summary').filter({ hasText: 'tap' })).toHaveCount(0)
  expect(viewer.service.runOwner).toBeNull()
})

test('reports validation and assertion failure while retaining the previous successful history', async ({ page }) => {
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Passed', { timeout: 20000 })
  await expect(page.locator('#wb-run')).toBeEnabled()
  await page.locator('#wb-yaml').fill(demo.replace('- launchApp', '- runScript: x.js'))
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-error')).toBeVisible()
  await expect(page.locator('#wb-history button')).toHaveCount(1)
  await page.locator('#wb-yaml').fill(demo.replace('1 actions received', 'impossible'))
  await page.locator('#wb-run').click()
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Failed', { timeout: 20000 })
  await expect(page.locator('#wb-history button')).toHaveCount(2)
  await page.locator('.wb-step[open]').scrollIntoViewIfNeeded()
  await expect(page.locator('.wb-step[open] img')).toBeVisible()
})

test('rejects cross-origin runs and unreviewed evidence collection', async () => {
  const response = await fetch(`${viewer.url}/api/runs`, { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify({ yaml: demo, localEvidence: true }) })
  expect(response.status).toBe(400)
  const withoutConsent = await fetch(`${viewer.url}/api/runs`, { method: 'POST', headers: { origin: viewer.url, 'content-type': 'application/json' }, body: JSON.stringify({ yaml: demo }) })
  expect(withoutConsent.status).toBe(400)
  expect(viewer.service.runOwner).toBeNull()
})

test('slow text input keeps progress and unrelated controls available', async ({ page }) => {
  await viewer.close()
  let entered=false
  class SlowInput extends MockProvider {
    override async inputText(...args: Parameters<MockProvider['inputText']>) { entered=true;return super.inputText(...args) }
  }
  const config=Config({viewerPort:0,mockStartupDelayMs:0})
  const service=new MirrorService(config,'http://127.0.0.1',{providerFactory:()=>new SlowInput(0,{operationDelayMs:1500})})
  viewer=new ViewerServer(config,{service,assistant:null,workbenchRoot:root});await viewer.listen();await service.start({provider:'mock'});await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('zh-CN');await page.locator('#workbench-toggle').click()
  await page.locator('#wb-yaml').fill('name: 输入进度\nplatform: ios\nappId: local.mobile-mirror.demo\n---\n- type: {into: {id: public-input}, text: public-evidence}\n- assertVisible: {id: public-input, value: public-evidence}\n- done')
  await page.locator('#wb-run').click();await expect.poll(()=>entered).toBe(true)
  await expect(page.locator('#wb-cancel')).toBeEnabled()
  await page.locator('#theme-button').click();await expect(page.locator('body')).toHaveClass(/light-stage/)
  await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('通过',{timeout:20000})
  await page.setViewportSize({width:1440,height:1100})
  await page.screenshot({path:'artifacts/screenshots/mobile-mirror-workbench-text-input.png'})
})


test('suite progress, business verification and evidence stay usable during slow prepare',async({page})=>{
  await viewer.close()
  const projectPath=join(root,'project.json')
  await writeFile(join(root,'flow.yaml'),`name: Suite evidence
platform: ios
appId: com.example.mobilemirror.mock
prepare:
  - ref: seed
verify:
  - ref: verify
---
- if:
    condition: {platform: ios}
    then:
      - assertVisible: {text: "Hello, harness."}
`)
  await writeFile(join(root,'seed.mjs'),`export default async()=>{await new Promise(r=>setTimeout(r,2000));return {}}`)
  await writeFile(join(root,'verify.mjs'),`export default()=>({verdict:'pass',expected:1,actual:1,source:'controlled-test',artifactRefs:[]})`)
  const empty={type:'object',properties:{}}
  const verificationOutput={type:'object',properties:{verdict:{type:'string'},expected:{type:'number'},actual:{type:'number'},source:{type:'string'},artifactRefs:{type:'array',items:{type:'string'}}}}
  await writeFile(projectPath,JSON.stringify({
    flows:{demo:'flow.yaml'},
    extensions:{seed:{role:'prepare',module:'seed.mjs',input:empty,output:empty},verify:{role:'verify',module:'verify.mjs',input:empty,output:verificationOutput}},
    suites:{smoke:{name:'Smoke suite',cases:[{id:'smoke',flow:'demo'}]}}
  }))
  viewer=new ViewerServer(Config({viewerPort:0,mockStartupDelayMs:0}),{workbenchRoot:root,workbenchProjectPath:projectPath})
  await viewer.listen();await viewer.service.start({provider:'mock'});await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('zh-CN');await page.locator('#workbench-toggle').click()
  await expect(page.locator('#wb-suite')).toHaveValue('smoke')
  await page.locator('#wb-suite-run').click()
  await expect(page.locator('#wb-detail .wb-stage')).toContainText('准备数据')
  await page.locator('#theme-button').click();await expect(page.locator('body')).toHaveClass(/light-stage/)
  await expect(page.locator('#device-frame')).toBeVisible()
  await expect(page.locator('#wb-suites')).toContainText('exit 0',{timeout:20000})
  await expect(page.locator('#wb-detail .wb-scope').filter({ hasText: '业务验证' })).toContainText('业务验证: 通过')
  await expect(page.locator('#wb-detail')).toContainText('root/1/then')
  const suiteRunId = await page.evaluate(async () => (await (await fetch('/api/suites')).json()).runs[0].id)
  const rejectedRelease = await page.evaluate(async id => (await fetch(`/api/suites/${id}/release-evidence`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'RELEASE' }),
  })).status, suiteRunId)
  expect(rejectedRelease).toBeGreaterThanOrEqual(400)
  const frozen = await page.evaluate(async id => await (await fetch(`/api/suites/${id}/release-evidence`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: `RELEASE SUITE ${id}` }),
  })).json(), suiteRunId)
  expect(frozen.cases[0].frozenAttempts).toHaveLength(1)
  expect(frozen.cases[0].frozenAttempts[0].projection.evidenceAvailability).toBe('verified')
  const retention = await page.evaluate(async () => await (await fetch('/api/workbench/retention')).json())
  expect(retention.runs.find((item: { id: string; protectedBy: string[] }) => item.id === frozen.cases[0].attempts[0])?.protectedBy).not.toContain('suite')
  await page.locator('.wb-step').last().locator('summary').click()
  await expect(page.locator('.wb-step').last().locator('img')).toBeVisible()
  await page.setViewportSize({width:1440,height:1200})
  await page.locator('#wb-detail').scrollIntoViewIfNeeded()
  await page.screenshot({path:'artifacts/screenshots/mobile-mirror-orchestration-suite.png'})
})
