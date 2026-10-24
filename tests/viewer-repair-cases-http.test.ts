import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { ViewerServer } from '../src/viewer-server.js'
import type { ProviderScreenSource } from '../src/types.js'
import { encloseMockPage, mockPageScope } from './fixtures/trusted-page-mock.js'

class DriftProvider extends MockProvider {
  missing = false
  override async screenSource(): Promise<ProviderScreenSource> {
    const source = await super.screenSource()
    if (source.kind === 'normalized') {
      encloseMockPage(source.structure)
      const node = source.structure.nodes.find(item => item.identifier === 'action-card')!
      node.name = 'Navigation'
      if (this.missing) node.identifier = 'new-action-card'
    }
    return source
  }
}

it('uses exact local approvals and a 202 Mock-only repair loop without rewriting the original failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repair-http-real-'))
  const config = resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 })
  const provider = new DriftProvider(0)
  const mirror = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => provider })
  const projectPath = join(root, 'project.json')
  const base = await readFile(new URL('../examples/flows/demo.yaml', import.meta.url), 'utf8')
  const yaml = base.replace('1 actions received', 'Hello, harness.')
  await writeFile(join(root, 'demo.yaml'), yaml)
  await writeFile(join(root, 'regression.yaml'), yaml.replace('- tap:\n    accessibilityId: action-card\n', ''))
  await writeFile(projectPath, JSON.stringify({ flows: { demo: 'demo.yaml', regression: 'regression.yaml' },
    provenance: { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1', resetContractVersion: 'reset-v1' },
    repair: { enabled: true, projectId: 'sample', permissions: ['plan', 'verify', 'cancel'], allowedFlows: ['demo'],
      allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'], regressionFlows: ['regression'],
      navigation: [{ flow: 'demo', stepPath: 'root/3', postconditionPath: 'root/4',
        page: mockPageScope, allowedTarget: { role: 'button', text: 'Navigation' } }] } }))
  const viewer = new ViewerServer(config, { service: mirror, assistant: null, disposeServiceOnClose: true,
    workbenchRoot: join(root, 'runs'), workbenchProjectPath: projectPath })
  try {
    await viewer.listen(); await mirror.start({ provider: 'mock' })
    const baseline = await viewer.workbench.start(yaml, undefined, undefined, { flowId: 'demo' }); await viewer.workbench.wait()
    provider.missing = true
    const failure = await viewer.workbench.start(yaml, undefined, undefined, { flowId: 'demo' }); await viewer.workbench.wait()
    const post = async (path: string, body: unknown) => fetch(`${viewer.url}${path}`, { method: 'POST',
      headers: { origin: viewer.url, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const create = await post('/api/workbench/repairs', { requestId: randomUUID(), sourceRunId: failure.id,
      baselineRunId: baseline.id, flowId: 'demo' })
    expect(create.status).toBe(202)
    const accepted = await create.json() as { caseId: string; revision: number }
    let detail = await fetch(`${viewer.url}/api/workbench/repairs/${accepted.caseId}`,
      { headers: { origin: viewer.url } }).then(response => response.json())
    expect(detail.case).toMatchObject({ id: accepted.caseId, phase: 'awaiting-approval' })
    for (const level of ['scope', 'execution']) {
      const challenge = await post(`/api/workbench/repairs/${accepted.caseId}/challenge`,
        { expectedRevision: detail.case.revision, level })
      expect(challenge.status).toBe(200)
      const token = await challenge.json()
      const approved = await post(`/api/workbench/repairs/${accepted.caseId}/approve`,
        { expectedRevision: detail.case.revision, nonce: token.nonce })
      expect(approved.status).toBe(200)
      expect((await post(`/api/workbench/repairs/${accepted.caseId}/approve`,
        { expectedRevision: detail.case.revision, nonce: token.nonce })).status).toBe(409)
      detail = await fetch(`${viewer.url}/api/workbench/repairs/${accepted.caseId}`,
        { headers: { origin: viewer.url } }).then(response => response.json())
    }
    const verifying = await post(`/api/workbench/repairs/${accepted.caseId}/verify`,
      { expectedRevision: detail.case.revision })
    expect(verifying.status).toBe(202)
    await expect.poll(async () => {
      detail = await fetch(`${viewer.url}/api/workbench/repairs/${accepted.caseId}`,
        { headers: { origin: viewer.url } }).then(response => response.json())
      return detail.case.phase
    }, { timeout: 30000, interval: 100 }).toBe('finished')
    expect(detail.case.outcome).toBe('software-verified')
    expect(detail.verifications[0].grade).toBe('software')
    expect((await viewer.workbench.get(failure.id)).verdict).toBe('fail')
    const proposed = { contractVersion: 1, repository: 'Fixture repository', commit: 'a'.repeat(40),
      declarationsReviewed: true, cells: [{ id: 'repair-demo', title: 'Repair demo', platform: 'ios',
        appId: 'com.example.mobilemirror.mock', binarySha256: detail.plan.baselineBuild, build: 'fixture',
        logicalTestKey: 'demo', inputDigest: detail.plan.paramsDigest,
        environment: { os: 'fixture', provider: 'mock', driver: 'fixture', viewport: 'fixture', backendEnvironment: 'test' },
        required: ['ui', 'cleanup', 'evidence'], historyRunIds: [] }] }
    expect((await post(`/api/workbench/repairs/${accepted.caseId}/acceptance-candidate`,
      { expectedRevision: detail.case.revision, confirm: 'yes', input: proposed })).status).toBe(400)
    const candidate = await post(`/api/workbench/repairs/${accepted.caseId}/acceptance-candidate`,
      { expectedRevision: detail.case.revision, confirm: `ACCEPT REPAIR ${accepted.caseId} R${detail.case.revision}`,
        input: proposed })
    expect(candidate.status).toBe(200)
    expect(await candidate.json()).toMatchObject({ grade: 'software', published: false,
      limitation: 'software-only-not-device-verified', input: { declarationsReviewed: false,
        cells: [{ historyRunIds: [failure.id] }] } })
    expect((await viewer.application.acceptanceRecords.list()).items).toEqual([])
    expect((await post(`/api/workbench/repairs/${accepted.caseId}/retire`,
      { expectedRevision: detail.case.revision })).status).toBe(200)
    expect((await viewer.workbench.get(failure.id)).verdict).toBe('fail')
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
}, 60_000)
