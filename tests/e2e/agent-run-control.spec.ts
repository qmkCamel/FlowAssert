import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { Config, type Config as MirrorConfig } from '../../src/config.js'
import { LocalDeviceRuntime } from '../../src/local-device-runtime.js'

test('Viewer shows Agent-originated execution in the shared history', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-agent-viewer-'))
  const projectPath = join(root, 'project.json')
  await writeFile(join(root, 'fixture.yaml'), 'name: Agent shared history\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
  await writeFile(projectPath, JSON.stringify({ flows: { fixture: 'fixture.yaml' } }))
  const config = Config({ viewerPort: 0, mockStartupDelayMs: 0, agentTestControl: {
    enabled: true, projectPath, allowedFlows: ['fixture'], allowedSuites: [], allowedPlatforms: ['ios'],
    allowedAppIds: ['com.example.mobilemirror.mock'], sharedEvidence: [],
  } } as unknown as MirrorConfig)
  const runtime = new LocalDeviceRuntime(config, { workbenchRoot: join(root, 'runs') })
  try {
    await runtime.listen(); await runtime.service.start({ provider: 'mock' })
    const catalog = await runtime.coordinator.catalog() as { catalogRevision: string }
    const accepted = await runtime.coordinator.start({ requestId: 'viewer-source-proof', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }) as { executionId: string }
    await expect.poll(async () => (await runtime.coordinator.status({ executionId: accepted.executionId }) as { phase: string }).phase).toBe('finished')
    await page.goto(runtime.viewer.url)
    await page.getByRole('button', { name: 'Test workbench' }).click()
    await expect(page.getByText('Started by Agent').first()).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.getByText('Started by Agent').first().scrollIntoViewIfNeeded()
    await expect(page.getByText('Started by Agent').first()).toBeInViewport()
    await page.screenshot({ path: resolve('artifacts/screenshots/mobile-mirror-agent-run-source.png') })
  } finally {
    await runtime.close(); await rm(root, { recursive: true, force: true })
  }
})
