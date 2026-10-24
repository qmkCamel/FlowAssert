import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { sha256 } from '../../src/workbench-store.js'

test('shows independent visual and UI verdicts from one mock session', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-visual-ui-'))
  const provider = new MockProvider(0)
  const mirror = new MirrorService(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => provider })
  await mirror.start({ provider: 'mock' })
  const reference = Buffer.from((await provider.snapshot()).bytes)
  await writeFile(join(root, 'reference.png'), reference)
  const projectPath = join(root, 'project.json')
  await writeFile(projectPath, JSON.stringify({ visualProfiles: { home: { rulesVersion: 1, revision: 1, platform: 'ios', appId: 'com.example.mobilemirror.mock', build: 'mock-1', theme: 'any', approvedBy: 'fixture-reviewer', approvedAt: new Date().toISOString(), reference: 'reference.png', referenceSha256: sha256(reference), channelDelta: 0, maxDifferentRatio: 0 } } }))
  const viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { service: mirror, assistant: null, workbenchRoot: join(root, 'runs'), workbenchProjectPath: projectPath })
  try {
    await viewer.listen(); await page.goto(viewer.url)
    await page.locator('#workbench-toggle').click()
    await page.locator('#wb-yaml').fill('name: Visual demo\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- assertVisual: {profile: home}\n- done\n')
    await page.locator('#wb-run').click()
    await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Passed', { timeout: 20000 })
    await expect(page.locator('#wb-detail')).toContainText('Visual verdict: Passed')
    await expect(page.locator('.wb-step').filter({ hasText: 'assertVisual' })).toContainText('home r1')
    await page.locator('#workbench-panel').evaluate(panel => { const target = [...panel.querySelectorAll('.wb-step')].find(step => step.textContent?.includes('assertVisual'))!; panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16 })
    await page.screenshot({ path: 'artifacts/physical-validation/visual-verdict-desktop.png' })
    const runId = (await page.locator('.wb-run-id').textContent())!.trim()
    const run = await viewer.workbench.get(runId)
    expect(run.productContract?.verification).toMatchObject({ ui: { status: 'pass' }, visual: { required: true, status: 'pass' } })
    expect(run.steps.find(step => step.kind === 'assertVisual')?.evidence.map(file => file.name)).toContain('visual-reference-2.png')
    expect((await readFile(join(root, 'reference.png'))).equals(reference)).toBe(true)
  } finally { await viewer.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) }
})
