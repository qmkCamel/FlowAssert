import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { LocalDeviceRuntime } from '../src/local-device-runtime.js'
import { registerTools } from '../src/tools.js'
import { MOBILE_MIRROR_TOOL_NAMES, REPAIR_TOOL_NAMES } from '../src/tool-contracts.js'
import { repairToolsVisible } from '../src/repair-tool-visibility.js'

const close: Array<() => Promise<void>> = []
afterEach(async () => { for (const action of close.splice(0).reverse()) await action() })

it('keeps default 20 tools and exposes exactly five without an approval tool only under both opt-ins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repair-tools-')); close.push(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'project.json')
  const policy = { enabled: true, projectId: 'sample', permissions: ['plan', 'verify', 'cancel'],
    allowedFlows: ['demo'], allowedPlatforms: ['ios'], allowedAppIds: ['com.example.mobilemirror.mock'] }
  await writeFile(path, JSON.stringify({ repair: policy }))
  const basic = resolveMirrorConfig({ viewerPort: 0, agentTestControl: { projectPath: path } })
  expect(repairToolsVisible(basic)).toBe(false)
  const optIn = resolveMirrorConfig({ viewerPort: 0, repairToolsEnabled: true, agentTestControl: { projectPath: path } })
  expect(repairToolsVisible(optIn)).toBe(true)
  const registered: Array<{ name: string; parameters: Record<string, unknown>;
    execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown> }> = []
  const runtime = new LocalDeviceRuntime(optIn, { workbenchRoot: join(root, 'runs') }); close.push(() => runtime.close())
  registerTools({ tools: { register: tool => { registered.push(tool as typeof registered[number]) } } }, runtime.commands,
    optIn, { defineTool: value => value })
  expect(registered.map(tool => tool.name)).toEqual([...MOBILE_MIRROR_TOOL_NAMES, ...REPAIR_TOOL_NAMES])
  expect(registered).toHaveLength(25)
  expect(registered.some(tool => tool.name.includes('approve'))).toBe(false)
  const submission = registered.find(tool => tool.name === 'mobile_mirror_repair_submit')!
  expect(submission.parameters).toMatchObject({ submission: { required: true, properties: {
    requestId: { required: true }, generation: { required: true },
    patchDigest: { required: true }, host: { required: true, properties: { kind: { required: true } } },
  } } })
  await expect(registered.find(tool => tool.name === 'mobile_mirror_repair_submit')!.execute({ caseId: '11111111-1111-4111-8111-111111111111',
    requestDigest: 'a'.repeat(64), patch: 'fake' }, { signal: new AbortController().signal }))
    .rejects.toThrow('repair-capability-unavailable')
  await writeFile(path, JSON.stringify({ repair: { ...policy, enabled: false } }))
  expect(repairToolsVisible(optIn)).toBe(false)
})
