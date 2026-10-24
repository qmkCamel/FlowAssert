import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { resolveMirrorConfig as Config } from '../../src/mcp-config.js'
import { ViewerServer } from '../../src/viewer-server.js'
import type { TestRun } from '../../src/workbench-store.js'

for (const entry of ['legacy', 'analysis']) test(`${entry}: reviews an evidence-linked locator-only draft and creates a separate lineage run`, async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-repair-ui-'))
  const viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' }); await viewer.workbench.store.init()
    const store = viewer.workbench.store
    const baselineId = 'b3011170-6d30-4c07-a9bb-cd1075046d7b', sourceId = '4973bed7-243f-4cde-8cbe-a81cc84fd7ea'
    const yaml = 'name: Repair fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- tap: {accessibilityId: old-action}\n- assertVisible: {text: "1 actions received"}\n- done\n'
    const now = new Date().toISOString()
    for (const [id, verdict, selector] of [[baselineId, 'pass', 'old-action'], [sourceId, 'fail', 'action-card']] as const) {
      const xml = `<AppiumAUT><XCUIElementTypeButton type="XCUIElementTypeButton" name="${selector}" label="Action card" visible="true" x="24" y="178" width="342" height="214"/></AppiumAUT>`
      const evidence = await store.put(id, 'step-2.xml', xml, 'application/xml; charset=utf-8')
      const run: TestRun = { schemaVersion: 1, id, flowId: 'demo', ...(verdict === 'fail' ? { parentRunId: baselineId } : {}), name: 'Repair fixture', yaml, engine: 'fixture', phase: 'finished', verdict, startedAt: now, endedAt: now,
        sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock', verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
        steps: [{ index: 2, kind: 'tap', path: 'root/2', sourceLine: 6, status: verdict === 'pass' ? 'passed' : 'failed', startedAt: now, endedAt: now, evidence: [evidence] }], evidence: [], cleanup: 'session-retained' }
      await store.save(run)
    }
    if (entry === 'legacy') { await page.goto(viewer.url); await page.locator('#workbench-toggle').click(); await page.locator(`#wb-history button[data-run-id="${sourceId}"]`).click() }
    else await page.goto(`${viewer.url}/#/runs/${sourceId}?tab=compare`)
    const section = page.locator(entry === 'legacy' ? '#workbench-panel .wb-repair' : '#analysis-secondary .wb-repair')
    await section.locator('summary').click()
    await section.getByText('Check safe repair candidates').click()
    await expect(section).toContainText('old-action', { timeout: 10000 })
    await expect(section).toContainText('action-card')
    if (entry === 'legacy') {
    await page.locator('#workbench-panel').evaluate(panel => { const target = panel.querySelector('.wb-repair')!; panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 16 })
    await page.screenshot({ path: 'artifacts/physical-validation/repair-candidate-desktop.png' })
    const caseId = '933172b8-712e-4ba8-bbbb-8844630e74bf'
    let phase = 'queued', failDetails = false
    await page.route('**/api/workbench/repairs**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === '/api/workbench/repairs' && request.method() === 'GET') { await route.fulfill({ json: { items: [] } }); return }
      if (path === '/api/workbench/repairs' && request.method() === 'POST') {
        await route.fulfill({ status: 202, json: { caseId, revision: 4, phase } }); return
      }
      if (path.endsWith('/verify')) {
        phase = 'preparing'
        setTimeout(() => { phase = 'finished' }, 2500)
        await route.fulfill({ status: 202, json: { caseId, revision: 5, phase } }); return
      }
      if (failDetails) { await route.fulfill({ status: 503, json: { error: 'Synthetic refresh failure' } }); return }
      await route.fulfill({ json: { case: { id: caseId, route: 'locator-maintenance', sourceSnapshot: { runId: sourceId }, revision: phase === 'queued' ? 4 : 5,
        phase, outcome: phase === 'finished' ? 'inconclusive' : null, updatedAt: now, createdAt: now },
        plan: { digest: 'a'.repeat(64), target: 'mock', requiredChecks: [{ id: 'baseline' }, { id: 'candidate1' }, { id: 'candidate2' }, { id: 'regression' }] },
        candidate: { digest: 'b'.repeat(64), semanticDiff: 'old-action → action-card' }, approvals: [], attempts: [], resets: [],
        verifications: phase === 'finished' ? [{ checkedAt: now, outcome: 'inconclusive', gaps: ['repair-not-reproduced'] }] : [] } })
    })
    const tracked = page.locator('.wb-repair-case')
    await tracked.locator('summary').click()
    await tracked.getByRole('button', { name: 'Create tracked repair' }).click()
    await expect(tracked).toContainText('old-action → action-card')
    await expect(tracked).toContainText('locator-maintenance')
    await tracked.getByRole('button', { name: 'Start Mock software verification' }).click()
    await expect(tracked).toContainText('preparing')
    await page.locator('#wb-history button').first().click()
    await page.locator('#language-select').selectOption('zh-CN')
    await page.locator(`#wb-history button[data-run-id="${sourceId}"]`).click()
    await expect(tracked).toContainText('受控修复任务')
    await expect(tracked).toContainText('preparing')
    const evidenceStep = page.locator('#wb-detail .wb-step').first()
    await expect(evidenceStep.locator('a[href$="step-2.xml"]')).toBeVisible()
    await page.locator('#workbench-panel').evaluate(panel => { const target = panel.querySelector('.wb-repair-case'); target?.scrollIntoView({ block: 'center' }) })
    await page.screenshot({ path: info.outputPath('repair-running-desktop.png') })
    await expect(tracked).toContainText('repair-not-reproduced', { timeout: 10000 })
    failDetails = true
    await tracked.getByRole('button', { name: '刷新详情' }).click()
    await expect(tracked).toContainText('Synthetic refresh failure')
    await expect(tracked).toContainText('old-action → action-card')
    await page.setViewportSize({ width: 390, height: 844 })
    await tracked.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('repair-failed-narrow.png') })
    const screenshots = join(process.cwd(), 'artifacts/repair-case')
    await mkdir(screenshots, { recursive: true })
    for (const name of ['repair-running-desktop.png', 'repair-failed-narrow.png'])
      await copyFile(info.outputPath(name), join(screenshots, name))
    await page.unroute('**/api/workbench/repairs**')
    await page.locator('#language-select').selectOption('en')
    let releaseReply!: () => void
    const replyGate = new Promise<void>(resolve => { releaseReply = resolve })
    let delayed = true
    await page.route('**/api/workbench/repair/confirm', async route => {
      if (!delayed) { await route.continue(); return }
      delayed = false
      const response = await route.fetch()
      await replyGate
      await route.fulfill({ response })
    })
    await section.getByText('Confirm and load new draft').click()
    await page.locator('#wb-yaml').fill('manual draft while confirmation is pending')
    releaseReply()
    await expect(section.getByText('Confirm and load new draft')).toBeEnabled()
    await expect(page.locator('#wb-yaml')).toHaveValue('manual draft while confirmation is pending')
    await page.unroute('**/api/workbench/repair/confirm')
    }
    await section.getByText('Confirm and load new draft').click()
    await expect(page.locator('#wb-yaml')).toHaveValue(/accessibilityId: action-card/)
    await page.locator('#wb-run').click()
    await expect(page.locator('#wb-detail .wb-verdict').first()).toHaveText('Passed', { timeout: 20000 })
    const id = (await page.locator('.wb-run-id').textContent())!.trim()
    const repaired = await viewer.workbench.get(id)
    expect(repaired).toMatchObject({ parentRunId: sourceId, repair: { sourceRunId: sourceId, baselineRunId: baselineId, before: 'accessibilityId:old-action', after: 'accessibilityId:action-card' } })
    expect((await store.get(sourceId)).verdict).toBe('fail')
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})

test('source repair handoff and slow independent checks keep history, evidence and language interactive', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-code-repair-ui-'))
  const viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' }); await viewer.workbench.store.init()
    const id = 'b3011170-6d30-4c07-a9bb-cd1075046d7b', caseId = '933172b8-712e-4ba8-bbbb-8844630e74bf'
    const now = new Date().toISOString()
    const evidence = await viewer.workbench.store.put(id, 'step-1.xml', '<AppiumAUT/>', 'application/xml; charset=utf-8')
    const run: TestRun = { schemaVersion: 1, id, flowId: 'demo', name: 'Code fixture',
      yaml: 'name: Code fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: missing}\n',
      engine: 'fixture', phase: 'finished', verdict: 'fail', startedAt: now, endedAt: now,
      sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock',
      verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed',
      businessVerification: 'not-performed', cleanup: 'session-retained', evidence: [],
      steps: [{ index: 1, kind: 'assertVisible', status: 'failed', startedAt: now, endedAt: now,
        evidence: [evidence] }] }
    await viewer.workbench.store.save(run)
    let phase = 'queued', failDetails = false
    await page.route('**/api/workbench/repairs**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/workbench/repairs' && route.request().method() === 'GET') {
        await route.fulfill({ json: { items: [] } }); return
      }
      if (path === '/api/workbench/repairs' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON()
        expect(body).toMatchObject({ route: 'product-code', repositoryId: 'fixture', sourceRunId: id })
        await route.fulfill({ status: 202, json: { caseId, revision: 6, phase } }); return
      }
      if (path.endsWith('/verify')) {
        phase = 'checking'; setTimeout(() => { phase = 'finished' }, 2200)
        await route.fulfill({ status: 202, json: { caseId, revision: 7, phase } }); return
      }
      if (failDetails) { await route.fulfill({ status: 503, json: { error: 'Synthetic source refresh failure' } }); return }
      await route.fulfill({ json: { case: { id: caseId, route: 'product-code', sourceSnapshot: { runId: id },
        revision: phase === 'queued' ? 6 : 7, phase, outcome: phase === 'finished' ? 'software-verified' : null,
        createdAt: now, updatedAt: now },
      plan: { digest: 'a'.repeat(64), target: 'mock', requiredChecks: [{ id: 'software' }, { id: 'original' },
        { id: 'candidate1' }, { id: 'candidate2' }, { id: 'regression1' }] }, candidate: null,
      hostRequest: { id: 'handoff-fixture', generationWorkspace: '/tmp/repair-code-fixture/generation',
        permittedPaths: ['src'], expiresAt: now },
      patchSubmission: { patchDigest: 'b'.repeat(64), patch: 'diff --git a/src/app.ts b/src/app.ts\n-old\n+fixed\n' },
      approvals: [], attempts: [], resets: [], sourceChecks: [],
      verifications: phase === 'finished' ? [{ checkedAt: now, grade: 'software', outcome: 'software-verified', gaps: [] }] : [] } })
    })
    await page.goto(viewer.url); await page.locator('#workbench-toggle').click()
    await page.locator(`#wb-history button[data-run-id="${id}"]`).click()
    page.once('dialog', dialog => dialog.accept('fixture'))
    const tracked = page.locator('.wb-repair-case')
    await tracked.locator('summary').first().click()
    await tracked.getByRole('button', { name: 'Create source repair case' }).click()
    await expect(tracked).toContainText('product-code')
    await tracked.locator('.wb-repair-patch summary').click()
    await expect(tracked).toContainText('+fixed')
    await tracked.getByRole('button', { name: 'Start independent source checks' }).click()
    await expect(tracked).toContainText('checking')
    await page.locator('#language-select').selectOption('zh-CN')
    await expect(page.locator('#wb-detail .wb-step a[href$="step-1.xml"]')).toBeVisible()
    await page.locator('#workbench-panel').evaluate(panel => panel.querySelector('.wb-repair-case')?.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: info.outputPath('repair-code-running-desktop.png') })
    await expect(tracked).toContainText('software-verified', { timeout: 10000 })
    failDetails = true
    await tracked.getByRole('button', { name: '刷新详情' }).click()
    await expect(tracked).toContainText('Synthetic source refresh failure')
    await expect(tracked).toContainText('+fixed')
    await page.setViewportSize({ width: 390, height: 844 })
    await tracked.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('repair-code-failed-narrow.png') })
    const screenshots = join(process.cwd(), 'artifacts/repair-case')
    await mkdir(screenshots, { recursive: true })
    for (const name of ['repair-code-running-desktop.png', 'repair-code-failed-narrow.png'])
      await copyFile(info.outputPath(name), join(screenshots, name))
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})

test('slow build and exact-artifact installation preserve evidence and navigation', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-install-repair-ui-'))
  const viewer = new ViewerServer(Config({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' }); await viewer.workbench.store.init()
    const id = 'b3011170-6d30-4c07-a9bb-cd1075046d7b', caseId = '933172b8-712e-4ba8-bbbb-8844630e74bf'
    const now = new Date().toISOString(), artifactDigest = 'b'.repeat(64)
    const evidence = await viewer.workbench.store.put(id, 'step-1.xml', '<AppiumAUT/>', 'application/xml; charset=utf-8')
    await viewer.workbench.store.save({ schemaVersion: 1, id, flowId: 'demo', name: 'Install fixture',
      yaml: 'name: Install fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: missing}\n',
      engine: 'fixture', phase: 'finished', verdict: 'fail', startedAt: now, endedAt: now,
      sessionId: 'fixture', deviceName: 'fixture', platform: 'ios', provider: 'mock',
      verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
      cleanup: 'session-retained', evidence: [], steps: [{ index: 1, kind: 'assertVisible', status: 'failed',
        startedAt: now, endedAt: now, evidence: [evidence] }] } as TestRun)
    let phase = 'building', revision = 8, installIntent: any = null
    await page.route('**/api/workbench/repairs**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (path === '/api/workbench/repairs' && request.method() === 'GET') {
        await route.fulfill({ json: { items: [{ id: caseId, sourceSnapshot: { runId: id } }] } }); return
      }
      if (path.endsWith('/challenge')) {
        expect(request.postDataJSON()).toMatchObject({ level: 'installation', expectedRevision: revision })
        await route.fulfill({ json: { nonce: caseId, planDigest: 'a'.repeat(64), artifactDigest,
          appId: 'com.example.mobilemirror.mock', targetDeviceBinding: 'c'.repeat(64) } }); return
      }
      if (path.endsWith('/approve')) {
        phase = 'installing'; revision++
        await route.fulfill({ json: { id: caseId, revision, phase } }); return
      }
      if (path.endsWith('/install')) {
        installIntent = { requestedAt: now, status: 'prepared' }
        revision++
        setTimeout(() => { phase = 'blocked'; installIntent = { requestedAt: now, status: 'completed', identityState: 'verified' } }, 2200)
        await route.fulfill({ status: 202, json: { caseId, revision, phase } }); return
      }
      await route.fulfill({ json: { case: { id: caseId, route: 'product-code', sourceSnapshot: { runId: id },
        revision, phase, ...(phase === 'awaiting-approval' ? { resumePhase: 'installing' } : {}),
        outcome: phase === 'blocked' ? 'inconclusive' : null,
        reason: phase === 'blocked' ? 'repair-dependency-unresolved' : null,
        createdAt: now, updatedAt: now },
      plan: { digest: 'a'.repeat(64), target: 'mock', targetDeviceBinding: 'c'.repeat(64),
        requiredChecks: [{ id: 'software' }, { id: 'candidate1' }] },
      buildArtifact: phase === 'building' ? null : { kind: 'ios-app', appId: 'com.example.mobilemirror.mock', platform: 'ios',
        buildMarker: 'fixture-marker', artifactDigest, sourceTreeDigest: 'd'.repeat(64),
        toolchainDigest: 'e'.repeat(64), artifactPath: '/fixture/Fixture.app', builtAt: now },
      installIntent, approvals: [], attempts: [], resets: [],
      verifications: [{ checkedAt: now, grade: 'software', outcome: 'software-verified', gaps: [] }] } })
    })
    await page.goto(viewer.url); await page.locator('#workbench-toggle').click()
    await page.locator(`#wb-history button[data-run-id="${id}"]`).click()
    const tracked = page.locator('.wb-repair-case')
    await expect(tracked).toContainText('building')
    await expect(tracked.getByRole('button', { name: 'Review and approve exact artifact installation' })).toHaveCount(0)
    await page.locator('#language-select').selectOption('zh-CN')
    await page.locator('#wb-history button').first().click()
    await page.locator(`#wb-history button[data-run-id="${id}"]`).click()
    await expect(page.locator('#wb-detail .wb-step a[href$="step-1.xml"]')).toBeVisible()
    await page.locator('#workbench-panel').evaluate(panel => panel.querySelector('.wb-repair-case')?.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: info.outputPath('repair-build-running-desktop.png') })
    await page.locator('#language-select').selectOption('en')
    phase = 'awaiting-approval'; revision++
    await page.locator(`#wb-history button[data-run-id="${id}"]`).click()
    await expect(tracked).toContainText('Artifact digest')
    page.once('dialog', dialog => dialog.accept())
    await tracked.getByRole('button', { name: 'Review and approve exact artifact installation' }).click()
    await expect(tracked).toContainText('installing')
    await tracked.getByRole('button', { name: 'Install the exact artifact' }).click()
    await expect(tracked).toContainText('prepared')
    await page.locator('#language-select').selectOption('zh-CN')
    await page.locator('#wb-history button').first().click()
    await page.locator(`#wb-history button[data-run-id="${id}"]`).click()
    await expect(page.locator('#wb-detail .wb-step a[href$="step-1.xml"]')).toBeVisible()
    await page.locator('#workbench-panel').evaluate(panel => panel.querySelector('.wb-repair-case')?.scrollIntoView({ block: 'center' }))
    await page.screenshot({ path: info.outputPath('repair-install-running-desktop.png') })
    await expect(tracked).toContainText('repair-dependency-unresolved', { timeout: 10000 })
    await page.setViewportSize({ width: 390, height: 844 })
    await tracked.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('repair-install-blocked-narrow.png') })
    const screenshots = join(process.cwd(), 'artifacts/repair-case')
    await mkdir(screenshots, { recursive: true })
    for (const name of ['repair-build-running-desktop.png', 'repair-install-running-desktop.png', 'repair-install-blocked-narrow.png'])
      await copyFile(info.outputPath(name), join(screenshots, name))
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
