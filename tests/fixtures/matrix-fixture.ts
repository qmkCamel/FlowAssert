import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { WorkbenchStore } from '../../src/workbench-store.js'
import { LocalDeviceMatrix } from '../../src/device-matrix.js'
import { matrixRegistrySchema } from '../../src/device-matrix-contracts.js'

async function freePort() { const s = createServer(); await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve)); const port = (s.address() as { port: number }).port; await new Promise<void>(resolve => s.close(() => resolve())); return port }
export async function matrixFixture(wait = 0) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'matrix-'))), projectPath = join(root, 'project.json'), registryPath = join(root, 'registry.json')
  const flow = `name: Matrix fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n${wait ? `- wait: ${wait}\n` : ''}- assertVisible: {text: "Hello, harness."}\n- done\n`
  await writeFile(join(root, 'flow.yaml'), flow); await writeFile(projectPath, JSON.stringify({ flows: { example: 'flow.yaml', reset: 'flow.yaml' } }))
  const slots = []
  for (const id of ['one', 'two']) slots.push({ id, configId: id, platform: 'ios', udid: `mock-${randomUUID()}`, provider: 'mock', config: { mockStartupDelayMs: 0 }, capabilities: {}, ports: { driver: await freePort(), mjpeg: await freePort() } })
  const registry = matrixRegistrySchema.parse({ contractVersion: 1, slots, plans: { smoke: { cells: slots.flatMap(s => [1, 2].map(i => ({ id: `${s.id}-${i}`, slotId: s.id, flow: 'example', fixture: { parallelSafe: true, namespace: s.id, resourceKeys: [], reset: 'reset' } }))) } } })
  await writeFile(registryPath, JSON.stringify(registry))
  const store = new WorkbenchStore(join(root, 'runs')), matrix = new LocalDeviceMatrix(store, projectPath, registryPath)
  return { root, registry, store, matrix, projectPath, registryPath, close: async () => { await matrix.close(); await store.close(); await rm(root, { recursive: true, force: true }) } }
}
