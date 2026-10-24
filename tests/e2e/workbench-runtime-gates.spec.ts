import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { healthBindingDigest, type HealthBinding } from '../../src/health-contracts.js'

const header = 'name: Runtime UI\nplatform: ios\nappId: com.example.mobilemirror.mock\n'
class PublicFixture extends MockProvider {
  override async screenSource() {
    const source = await super.screenSource()
    if (source.kind === 'normalized') source.structure.nodes = source.structure.nodes.filter(node => !node.sensitive)
    return source
  }
}
async function setup(provider = new PublicFixture(0)) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-runtime-ui-'))
  const config = resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 })
  const service = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => provider })
  await service.start({ provider: 'mock' })
  const viewer = new ViewerServer(config, { service, workbenchRoot: root, assistant: null })
  await viewer.listen()
  return { viewer, close: async () => { await viewer.close(); await service.dispose(); await rm(root, { recursive: true, force: true }) } }
}
test('temporal measurement stays locally responsive for >=800 ms, refreshes domain completion, and retains the previous result on rejected input', async ({ page }) => {
  const { viewer, close } = await setup()
  try {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.goto(viewer.url); await page.locator('#workbench-toggle').click()
    const yaml = header + '---\n- measure:\n    id: stable\n    maxElapsedMs: 10000\n    steps:\n      - assertStable:\n          predicate: { assertVisible: { text: "Hello, harness." } }\n          durationMs: 1800\n          pollMs: 200\n          maxSampleGapMs: 1000'
    await page.locator('#wb-yaml').fill(yaml); await page.locator('#wb-run').click()
    await expect(page.locator('.wb-stage')).toHaveText('Sampling the stability window')
    await expect(page.locator('#wb-run')).toBeDisabled()
    await page.locator('#theme-button').click(); await expect(page.locator('body')).toHaveClass(/light-stage/)
    await page.locator('#wb-refresh').click(); await expect(page.locator('#wb-detail')).toContainText('Runtime UI')
    expect((await viewer.workbench.status(viewer.workbench.activeId!)).phase).toBe('running')
    await page.locator('#workbench-panel').evaluate(panel => { panel.scrollTop += panel.querySelector('#wb-detail')!.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20; window.scrollTo(0, 0) })
    await page.screenshot({ path: 'artifacts/screenshots/runtime-gates-sampling.png' })
    await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Passed', { timeout: 20000 })
    await expect(page.locator('.wb-measurement')).toContainText('automation-observed-e2e')
    await expect(page.locator('.wb-runtime-dimensions')).toContainText('Performance: Passed')
    await expect(page.locator('#wb-run')).toBeEnabled()
    const id = (await page.locator('.wb-run-id').textContent())!, run = await viewer.workbench.get(id)
    expect(Date.parse(run.endedAt!)).toBeGreaterThan(Date.parse(run.startedAt) + 800)
    await page.locator('#workbench-panel').evaluate(panel => { panel.scrollTop += panel.querySelector('#wb-detail')!.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20; window.scrollTo(0, 0) })
    await page.screenshot({ path: 'artifacts/screenshots/runtime-gates-completed.png' })
    await page.locator('#wb-yaml').fill(header + '---\n- measure: { id: invalid, maxElapsedMs: 50, steps: [] }')
    await page.locator('#wb-run').click()
    await expect(page.locator('#wb-run')).toBeEnabled()
    await expect(page.locator('.wb-run-id')).toHaveText(id)
    await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Passed')
  } finally { await close() }
})

test('health drain never publishes green early; cancellation drains while history/theme remain usable', async ({ page }) => {
  let closed = false
  class SyntheticHealth extends PublicFixture {
    healthCapability() { return { schemaVersion: 1 as const, platform: 'mock' as const, source: 'synthetic-health', sourceVersion: '1', signals: { crash: { supported: true, reason: 'synthetic-only' } },
      completeness: { processIdentity: true, windowCursors: true, detectableLoss: true, monotonicMapping: true, drainAcknowledgement: true } } }
    async startHealth(binding: HealthBinding) {
      let start = 0
      return {
        ready: async () => { start = performance.now() },
        stopAndDrain: async () => {
          const end = performance.now()
          await new Promise(resolve => setTimeout(resolve, 1200))
          return { schemaVersion: 1 as const, bindingDigest: healthBindingDigest(binding), startMs: start, endMs: end, startCursor: '1', endCursor: '2', ready: true, drained: true, dropped: 0, rawBytes: 0, gaps: [], events: [],
            maxQueueDepth: 0, clockMapping: 'verified' as const, processes: [{ generation: 'p1', fromMs: start, toMs: end }] }
        },
        close: async () => { closed = true },
      }
    }
  }
  const { viewer, close } = await setup(new SyntheticHealth(0))
  try {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.goto(viewer.url); await page.locator('#workbench-toggle').click()
    await page.locator('#wb-yaml').fill(header + 'runtimeGates: { health: { signals: [crash], tailMs: 5000 } }\n---\n- assertVisible: { text: "Hello, harness." }')
    await page.locator('#wb-run').click()
    await expect(page.locator('.wb-stage')).toHaveText('Observing health tail', { timeout: 15000 })
    const id = viewer.workbench.activeId!
    await page.locator('#wb-cancel').click()
    await expect(page.locator('.wb-stage')).toContainText('Draining health collection')
    await page.locator('#theme-button').click(); await page.locator('#wb-refresh').click()
    expect(closed).toBe(false)
    expect((await viewer.workbench.status(id)).phase).not.toBe('finished')
    await page.locator('#workbench-panel').evaluate(panel => { panel.scrollTop += panel.querySelector('#wb-detail')!.getBoundingClientRect().top - panel.getBoundingClientRect().top - 20; window.scrollTo(0, 0) })
    await page.screenshot({ path: 'artifacts/screenshots/runtime-gates-draining.png' })
    await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Cancelled', { timeout: 15000 })
    expect(closed).toBe(true)
    expect((await viewer.workbench.get(id)).health?.status).toBe('inconclusive')
    await expect(page.locator('#wb-run')).toBeEnabled()
  } finally { await close() }
})
