import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveMirrorConfig } from '../../src/mcp-config.js'
import { MirrorService } from '../../src/mirror-service.js'
import { MockProvider } from '../../src/providers/mock-provider.js'
import { WorkbenchService } from '../../src/workbench-service.js'
import { WorkbenchAcceptance } from '../../src/workbench-acceptance.js'
import { WorkbenchAuthoring } from '../../src/workbench-authoring.js'
import type { ProviderAppManagementRequest } from '../../src/types.js'

const [, , root, boundary] = process.argv
if (!root || !boundary) throw new Error('Missing authoring process fixture arguments')
class CountedMock extends MockProvider {
  override async manageApp(input: ProviderAppManagementRequest, signal?: AbortSignal) {
    appendFileSync(join(root!, 'mock-writes.log'), 'write\n')
    return super.manageApp(input, signal)
  }
}
const config = resolveMirrorConfig({ mockStartupDelayMs: 0 })
const mirror = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => new CountedMock(0) })
await mirror.start({ provider: 'mock' })
const workbench = new WorkbenchService(mirror, { root: join(root, 'runs') }), acceptance = new WorkbenchAcceptance(workbench.store)
const authoring = new WorkbenchAuthoring(workbench, acceptance, { writeHook(point, journal) {
  const key = journal.phase === 'running' && journal.referencePublications ? `referenced:${point}` : `${journal.phase}:${point}`
  if (key === boundary) process.kill(process.pid, 'SIGKILL')
} })
const validation = await authoring.validate({ yaml: 'name: Crash fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n- done\n',
  params: {}, target: { platform: 'ios', appId: 'com.example.mobilemirror.mock', sessionId: mirror.state().sessionId } })
if (!validation.valid) throw new Error('Fixture must compile')
const request = { requestId: 'crash-fixture', receipt: validation.receipt.token, inputDigest: validation.receipt.inputDigest, localEvidence: true }
writeFileSync(join(root, 'request.json'), JSON.stringify(request))
await authoring.run(request)
await new Promise<void>(() => {})
