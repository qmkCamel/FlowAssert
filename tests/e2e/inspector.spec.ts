import { test, expect, type Page } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
let viewer: ViewerServer, service: MirrorService
async function setup(page: Page) {
  const config = resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0, frameIntervalMs: 250 })
  service = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => new MockProvider(0) })
  viewer = new ViewerServer(config, { service, assistant: null, disposeServiceOnClose: true })
  await viewer.listen(); await service.start({ provider: 'mock' }); await page.goto(viewer.url)
  await page.locator('#language-select').selectOption('en')
  await expect(page.locator('#inspect-button')).toBeEnabled()
}
test.afterEach(async () => { await viewer?.close() })
test('creates and validates a separate read-only YAML draft without changing device or Agent observation', async ({ page }) => {
  await setup(page)
  const observed = await service.observe({ image: false, structure: true })
  const before = service.queryScreen({ observationId: observed.observationId, op: 'find' })
  const action = service.state().lastAction
  await page.locator('#inspect-button').click()
  await page.locator('#inspection-tree [data-node-id=n2]').click()
  await page.locator('#inspection-selector-options button').first().click()
  await expect(page.locator('#inspection-add-assert')).toBeEnabled()
  await page.locator('#inspection-add-assert').click()
  await expect(page.locator('#inspection-draft')).toHaveValue(/assertVisible/)
  await expect(page.locator('#inspection-draft')).toHaveValue(/action-card/)
  await expect(page.locator('#inspection-ready-target')).toContainText('testId')
  await page.locator('#inspection-add-ready-assert').click()
  await expect(page.locator('#inspection-draft')).toHaveValue(/assertReady/)
  expect(service.state().lastAction).toEqual(action)
  expect(service.queryScreen({ observationId: observed.observationId, op: 'find' })).toEqual(before)
  await page.route('**/api/workbench/drafts/validate', async route => {
    const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 700)); await route.fulfill({ response }).catch(() => {})
  })
  await page.locator('#inspection-validate').click()
  await expect(page.locator('#inspection-draft-status')).toContainText('Validating')
  await page.locator('#theme-button').click()
  await page.locator('#inspection-draft').fill(`${await page.locator('#inspection-draft').inputValue()}\n# edited during validation`)
  await page.waitForTimeout(850)
  await expect(page.locator('#inspection-draft-status')).not.toContainText('Draft valid')
  await page.unroute('**/api/workbench/drafts/validate')
  await page.locator('#inspection-validate').click()
  await expect(page.locator('#inspection-draft-status')).toContainText('Draft valid')
  await page.screenshot({ path: 'artifacts/physical-validation/authoring-draft-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 900 })
  await expect(page.locator('#inspection-draft')).toBeVisible()
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, wide: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => ({ tag: el.tagName, id: el.id, className: typeof el.className === 'string' ? el.className : '', right: el.getBoundingClientRect().right })) }))
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width)
  await page.screenshot({ path: 'artifacts/physical-validation/authoring-draft-narrow.png', fullPage: true })
  const download = page.waitForEvent('download')
  await page.locator('#inspection-download').click()
  expect((await download).suggestedFilename()).toBe('mobile-mirror-draft.yaml')
  expect(service.state().lastAction).toEqual(action)
})
test('frozen inspection, tree, selection, search, retry and independent controls', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1100 }); await setup(page)
  let requests = 0
  page.on('request', request => { if (request.url().includes('/api/inspection/capture')) requests++ })
  await page.locator('#inspect-button').click()
  await expect(page.locator('#inspection-status')).toHaveText('Frozen inspection')
  const rows = page.locator('#inspection-tree [role=treeitem]')
  await expect(rows.first()).toBeVisible(); await rows.nth(1).click()
  await expect(page.locator('#inspection-details')).toContainText('nodeId')
  await expect(page.locator('.inspection-box.selected')).toBeVisible()
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-inspector-final.png', fullPage: true })
  const selected = await page.locator('[aria-selected=true]').getAttribute('data-node-id')
  await page.locator('#theme-button').click(); await page.locator('#language-select').selectOption('zh-CN')
  await expect(page.locator('[aria-selected=true]')).toHaveAttribute('data-node-id', selected!)
  await page.locator('#zoom-in-button').click()
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-inspector-zoom.png', fullPage: true })
  expect(requests).toBe(1)
  await page.route('**/api/inspection/capture', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"screen_capture_failed"}' }))
  await page.locator('#inspection-refresh').click(); await expect(page.locator('#inspection-status')).toContainText('获取失败')
  await expect(page.locator('[aria-selected=true]')).toHaveAttribute('data-node-id', selected!)
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-inspector-refresh-failed.png', fullPage: true })
  await page.unroute('**/api/inspection/capture'); await page.locator('#inspection-refresh').click()
  await expect(page.locator('#inspection-status')).toHaveText('冻结检查截图')
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-inspector-recovered.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 1000 })
  await expect(page.locator('#inspection-tree')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mirror-inspector-narrow.png', fullPage: true })
  await page.keyboard.press('Escape'); await expect(page.locator('#inspector')).toBeHidden(); await expect(page.locator('#inspect-button')).toBeFocused()
  await expect(page.locator('.inspection-box')).toHaveCount(0)
})
test('slow capture can cancel and Stop; late responses cannot restore inspection', async ({ page }) => {
  await setup(page)
  await page.route('**/api/inspection/capture', async route => { const response = await route.fetch(); await new Promise(r => setTimeout(r, 800)); await route.fulfill({ response }).catch(() => {}) })
  await page.locator('#inspect-button').click(); await expect(page.locator('#inspection-status')).toContainText('Capturing')
  await page.locator('#theme-button').click(); await page.locator('#zoom-in-button').click(); await page.locator('#inspection-cancel').click()
  await page.waitForTimeout(950); await expect(page.locator('#inspection-image')).not.toHaveAttribute('src')
  await page.locator('#inspection-refresh').click(); await page.locator('#stop-button').click()
  await expect(page.locator('#inspector')).toBeHidden(); await page.waitForTimeout(950); await expect(page.locator('#inspector')).toBeHidden()
})
test('contain overlay stays within one CSS pixel across zoom, scrolling and DPR; epoch is historical and TTL clears', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
  const page = await context.newPage(); await page.clock.install(); await setup(page)
  await page.locator('#inspect-button').click(); await expect(page.locator('#inspection-status')).toHaveText('Frozen inspection')
  await page.locator('#inspection-tree [role=treeitem]').nth(1).click()
  await page.locator('#inspection-selector-options button').first().click()
  await page.locator('#inspection-add-assert').click()
  const draftBeforeExpiry = await page.locator('#inspection-draft').inputValue()
  for (const mode of ['fit', 'out', 'in', 'in']) {
    await page.locator(`#zoom-${mode}-button`).click()
    const error = await page.evaluate(() => {
      const surface = document.querySelector('#inspection-surface') as HTMLElement, image = document.querySelector('#inspection-image') as HTMLImageElement, box = document.querySelector('.inspection-box.selected') as HTMLElement
      const s = Math.min(surface.clientWidth / image.naturalWidth, surface.clientHeight / image.naturalHeight)
      const actual = box.getBoundingClientRect(), origin = surface.getBoundingClientRect()
      return Math.max(Math.abs(actual.x - origin.x - ((surface.clientWidth - image.naturalWidth * s) / 2 + 28 * s)), Math.abs(actual.width - 260 * s))
    })
    expect(error).toBeLessThanOrEqual(1)
  }
  await service.action({ kind: 'tap', x: 1, y: 1 }); await expect(page.locator('#inspection-status')).toContainText('historical')
  await expect(page.locator('#inspection-add-assert')).toBeDisabled()
  await page.clock.fastForward(61000)
  await expect(page.locator('#inspection-status')).toContainText('expired'); await expect(page.locator('#inspection-image')).not.toHaveAttribute('src'); await expect(page.locator('#inspection-tree [role=treeitem]')).toHaveCount(0)
  await expect(page.locator('#inspection-draft')).toHaveValue(draftBeforeExpiry)
  await context.close()
})
test('XSS is text, keyboard navigates, mismatch disables overlay and state failure blocks capture', async ({ page }) => {
  await setup(page)
  await page.route('**/api/inspection/capture', async route => {
    const response = await route.fetch(), data = await response.json()
    data.structure.nodes[1].text = '<img src=x onerror="window.INSPECTOR_XSS=true">'
    data.viewport.width *= 2
    await route.fulfill({ response, json: data })
  })
  await page.locator('#inspect-button').click(); await expect(page.locator('#inspection-status')).toHaveText('Frozen inspection')
  await expect(page.locator('#inspection-geometry-warning')).toContainText('disabled')
  await page.locator('#inspection-tree [role=treeitem]').first().focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(page.locator('#inspection-details')).toContainText('<img src=x')
  expect(await page.evaluate(() => (window as unknown as { INSPECTOR_XSS: boolean }).INSPECTOR_XSS)).toBeUndefined()
  await expect(page.locator('.inspection-box')).toHaveCount(0)
  await page.locator('#inspection-search').fill('onerror'); await expect(page.locator('#inspection-tree [role=treeitem]')).toHaveCount(1)
  await page.route('**/api/state', route => route.abort())
  await expect(page.locator('#inspection-status')).toContainText('unconfirmed'); await expect(page.locator('#inspection-refresh')).toBeDisabled()
  await expect(page.locator('#inspection-image')).toHaveAttribute('src', /^blob:/)
  await page.unroute('**/api/state'); await expect(page.locator('#inspection-refresh')).toBeEnabled()
})
for (const platform of ['Android', 'iOS']) test(`fake ${platform} Appium capture maps normalized nodes without device actions`, async ({ page }) => {
  const { createServer } = await import('node:http')
  const mock = new MockProvider(0); await mock.start({ provider: 'mock' }, new AbortController().signal)
  const image = await mock.snapshot(), geometry = await mock.screenGeometry(); await mock.stop()
  const requests: string[] = []
  const upstream = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    let value: unknown = null
    if (req.url === '/status') value = { ready: true }
    else if (req.url === '/session' && req.method === 'POST') value = { sessionId: 'protocol-fixture', capabilities: { platformName: platform } }
    else if (req.url?.endsWith('/window/rect')) value = geometry.viewport
    else if (req.url?.endsWith('/orientation')) value = 'PORTRAIT'
    else if (req.url?.endsWith('/screenshot')) value = Buffer.from(image.bytes).toString('base64')
    else if (req.url?.endsWith('/source')) value = platform === 'Android' ? '<hierarchy><node class="android.widget.Button" text="Protocol button" resource-id="fixture.button" enabled="true" displayed="true" bounds="[28,112][288,152]"/></hierarchy>' : '<AppiumAUT><XCUIElementTypeButton name="Protocol button" label="Protocol button" visible="true" enabled="true" x="28" y="112" width="260" height="40"/></AppiumAUT>'
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ value }))
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  try {
    const config = resolveMirrorConfig({ viewerPort: 0, appiumUrl: `http://127.0.0.1:${(upstream.address() as {port:number}).port}`, viewerMediaMode: 'polling' })
    service = new MirrorService(config, 'http://127.0.0.1'); viewer = new ViewerServer(config, { service, assistant: null, disposeServiceOnClose: true })
    await viewer.listen(); await service.start({ provider: 'appium', capabilities: { platformName: platform } }); await page.goto(viewer.url)
    await page.locator('#language-select').selectOption('en'); await page.locator('#inspect-button').click()
    await expect(page.locator('#inspection-status')).toHaveText('Frozen inspection')
    await page.locator('#inspection-tree [role=treeitem]').first().click(); await expect(page.locator('#inspection-details')).toContainText('Protocol button')
    await expect(page.locator('.inspection-box.selected')).toBeVisible()
    expect(requests.some(r => r.endsWith('/actions'))).toBe(false)
    expect(requests.filter(r => r.endsWith('/source'))).toHaveLength(1)
    expect(service.state()).not.toHaveProperty('inspectionContext')
    await viewer.close()
  } finally { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())) }
})
