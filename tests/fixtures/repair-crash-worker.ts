import { randomUUID } from 'node:crypto'
import { encloseMockPage, mockPageScope } from './trusted-page-mock.js'
import { readFile } from 'node:fs/promises'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { WorkbenchService } from '../../src/workbench-service.js'
import { WorkbenchSuites } from '../../src/workbench-suites.js'
import { WorkbenchRepairCoordinator } from '../../src/workbench-repair-coordinator.js'
import { emptyProject } from '../../src/workbench-project.js'
import { repairProjectSchema } from '../../src/workbench-repair-project.js'
import type { ProviderScreenSource } from '../../src/types.js'

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

async function main() {
  const root = process.argv[2], point = process.argv[3]
  if (!root || !point) throw new Error('Crash worker needs root and cutpoint')
  const provider = new DriftProvider(0)
  const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1',
    { providerFactory: () => provider })
  await mirror.start({ provider: 'mock' })
  const workbench = new WorkbenchService(mirror, { root })
  const yaml = (await readFile(new URL('../../examples/flows/demo.yaml', import.meta.url), 'utf8'))
    .replace('1 actions received', 'Hello, harness.')
  const project = emptyProject()
  project.flows = { demo: yaml, regression: yaml.replace('- tap:\n    accessibilityId: action-card\n', '') }
  project.provenance = { required: [], backendEnvironment: 'test-backend', testDataVersion: 'fixture-v1', resetContractVersion: 'reset-v1' }
  project.repair = repairProjectSchema.parse({ enabled: true, projectId: 'sample', permissions: ['plan', 'verify'],
    allowedFlows: ['demo'], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'],
    regressionFlows: ['regression'], navigation: [{ flow: 'demo', stepPath: 'root/3', postconditionPath: 'root/4',
      page: mockPageScope, allowedTarget: { role: 'button', text: 'Navigation' } }] })
  const baseline = await workbench.start(yaml, undefined, undefined, { project, flowId: 'demo' }); await workbench.wait()
  provider.missing = true
  const failure = await workbench.start(yaml, undefined, undefined, { project, flowId: 'demo' }); await workbench.wait()
  const suites = new WorkbenchSuites(workbench)
  const coordinator = new WorkbenchRepairCoordinator(workbench, suites, async () => project, async reached => {
    if (reached !== point) return
    process.stdout.write(`CUTPOINT ${point}\n`)
    await new Promise<void>(() => {})
  })
  const created = await coordinator.create({ requestId: randomUUID(), sourceRunId: failure.id,
    baselineRunId: baseline.id, flowId: 'demo' }, 'owner')
  const scope = await coordinator.approvalChallenge(created.id, 'owner', created.revision, 'scope')
  const scoped = await coordinator.approve(created.id, 'owner', created.revision, scope.nonce)
  const execution = await coordinator.approvalChallenge(created.id, 'owner', scoped.revision, 'execution')
  const queued = await coordinator.approve(created.id, 'owner', scoped.revision, execution.nonce)
  await coordinator.verifyMock(queued.id, 'owner', queued.revision)
  throw new Error('Repair completed without reaching requested crash point')
}

void main().catch(error => { process.stderr.write(`${String(error?.stack ?? error)}\n`); process.exitCode = 1 })
