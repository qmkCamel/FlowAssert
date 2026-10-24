import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { ViewerServer } from '../../src/viewer-server.js'
import { resolveMirrorConfig } from '../../src/mcp-config.js'

let root: string, viewer: ViewerServer, id: string
test.use({ trace: 'on' })
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'playback-layout-'))
  viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  await viewer.listen(); await viewer.service.start({ provider: 'mock' })
  const run = await viewer.workbench.start('name: Playback layout fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n- assertVisible: {text: "Hello, harness."}\n')
  await viewer.workbench.wait(); id = run.id
})
test.afterEach(async () => { await viewer.close(); await rm(root, { recursive: true, force: true }) })
async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    return { canvas: box('.report-image-viewport'), toolbar: box('.replay-stage > .playback-toolbar'), scrollY }
  })
}
async function capture(page: Page, name: string) {
  const path = `artifacts/screenshots/${name}.png`
  await page.screenshot({ path, fullPage: true }); await test.info().attach(name, { path, contentType: 'image/png' })
}

async function startSampling(page: Page) {
  await page.evaluate(() => {
    const samples: Record<string, number>[] = []
    let frame = 0
    const sample = () => {
      const row: Record<string, number> = { scrollY }
      for (const [name, selector] of Object.entries({ canvas: '.report-image-viewport', toolbar: '.replay-stage > .playback-toolbar', timeline: '#screenshot-playback' })) {
        const rect = document.querySelector(selector)!.getBoundingClientRect()
        for (const key of ['x', 'y', 'width', 'height'] as const) row[`${name}.${key}`] = rect[key]
      }
      const image = document.querySelector<HTMLImageElement>('.report-image-viewport img')
      row.blank = !image?.complete || !image.naturalWidth ? 1 : 0
      samples.push(row)
      frame = requestAnimationFrame(sample)
    }
    ;(window as typeof window & { stopLayoutSampling?: () => typeof samples }).stopLayoutSampling = () => { cancelAnimationFrame(frame); return samples }
    sample()
  })
}
async function assertStableSamples(page: Page, name: string) {
  const samples = await page.evaluate(() => (window as typeof window & { stopLayoutSampling: () => Record<string, number>[] }).stopLayoutSampling())
  expect(samples.length).toBeGreaterThan(30)
  const ranges = Object.fromEntries(Object.keys(samples[0]!).map(key => {
    const values = samples.map(row => row[key]!)
    return [key, Math.max(...values) - Math.min(...values)]
  }))
  await mkdir('artifacts/playback-layout', { recursive: true })
  const path = `artifacts/playback-layout/${name}.json`
  await writeFile(path, JSON.stringify({ ranges, samples }, null, 2))
  await test.info().attach(name, { path, contentType: 'application/json' })
  expect(samples.every(row => row.blank === 0)).toBe(true)
  for (const [key, delta] of Object.entries(ranges)) expect.soft(delta, `${name}: ${key}`).toBeLessThanOrEqual(1)
}

test('loading a frame preserves canvas geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${viewer.url}/#/runs/${id}?step=1&tab=evidence`)
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route(`**/artifacts/step-2.png`, async route => { await pending; await route.continue().catch(() => {}) })
  const before = await geometry(page)
  try {
    await page.locator('#playback-next').click()
    await expect(page.locator('.evidence-pending')).toContainText('step 2')
    await page.waitForTimeout(650)
    const loading = await geometry(page)
    await capture(page, 'playback-layout-loading')
    release()
    await expect(page.locator('.report-image-viewport img')).toHaveAttribute('alt', 'Archived step 2 screenshot')
    const ready = await geometry(page)
    await test.info().attach('layout-measurements', { body: JSON.stringify({ before, loading, ready }, null, 2), contentType: 'application/json' })
    expect(loading).toEqual(before)
    expect(ready).toEqual(before)
  } finally { release() }
})

for (const mode of ['desktop', 'narrow', 'zoom'] as const) test(`${mode}: every animation frame is stable through loading, long captions, failure and retry`, async ({ page }) => {
  await page.setViewportSize({ width: mode === 'desktop' ? 1280 : 390, height: 900 })
  const run = await viewer.workbench.get(id)
  await page.route(`**/api/runs/${id}`, route => route.fulfill({ json: { ...run, steps: run.steps.map(step => step.index === 2 ? { ...step, target: `text="${'A long caption 很长的动作说明 '.repeat(8)}"` } : step) } }))
  await page.goto(`${viewer.url}/#/runs/${id}?step=1&tab=evidence`)
  if (mode !== 'desktop') await page.locator('#language-select').selectOption('zh-CN')
  await expect(page.locator('#playback-status')).toHaveText(mode === 'desktop' ? 'Paused' : '已暂停')
  if (mode === 'zoom') await page.evaluate(() => { document.body.style.zoom = '2' })
  await page.locator('#playback-speed').selectOption('2')
  await page.locator('#playback-toggle').focus()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/artifacts/step-2.png', async route => { await pending; await route.fulfill({ status: 409, body: 'Fixture integrity failure' }) })
  await startSampling(page)
  try {
    // Keyboard activation avoids Playwright scrolling offscreen controls for us.
    await page.keyboard.press('Enter')
    await expect(page.locator('.evidence-pending')).toContainText(mode === 'desktop' ? 'step 2' : '步骤 2')
    await page.waitForTimeout(650)
    await capture(page, `playback-stable-${mode}-loading`)
    release()
    await expect(page.locator('#playback-retry')).toBeVisible()
    await capture(page, `playback-stable-${mode}-failure`)
    await page.unroute('**/artifacts/step-2.png')
    await page.locator('#playback-retry').evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.locator('.report-image-viewport img')).toHaveAttribute('alt', mode === 'desktop' ? 'Archived step 2 screenshot' : '归档步骤 2 截图')
    await expect(page.locator('.replay-action-caption')).toContainText('很长的动作说明')
    await capture(page, `playback-stable-${mode}-recovered`)
    await page.locator('#playback-toggle').evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.locator('#playback-status')).toHaveText(mode === 'desktop' ? 'Playback ended' : '回放结束', { timeout: 8000 })
    await assertStableSamples(page, `layout-${mode}`)
    await capture(page, `playback-stable-${mode}-ended`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { release() }
})

test('missing screenshot retains the canvas without hiding registered hierarchy', async ({ page }) => {
  const run = await viewer.workbench.get(id)
  await page.route(`**/api/runs/${id}`, route => route.fulfill({ json: { ...run, steps: run.steps.map(step => step.index === 2 ? { ...step, evidence: step.evidence.filter(file => file.contentType !== 'image/png') } : step) } }))
  await page.goto(`${viewer.url}/#/runs/${id}?step=1&tab=evidence`)
  await expect(page.locator('#playback-status')).toHaveText('Paused')
  const before = await geometry(page)
  await page.locator('#playback-next').click()
  await expect(page.locator('#playback-status')).toContainText('Screenshot unavailable')
  expect(await geometry(page)).toEqual(before)
  await expect(page.locator('.report-image-viewport img')).toHaveAttribute('alt', 'Archived step 1 screenshot')
  await expect(page.locator('#analysis-context summary').filter({ hasText: 'Read registered hierarchy' })).toHaveCount(1)
  await expect(page.locator('.evidence-pending')).toContainText('Step 2: no usable screenshot recorded')
  await capture(page, 'playback-stable-missing')
})
