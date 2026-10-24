import { LocalDeviceMatrix } from '../../src/device-matrix.js'
import { WorkbenchStore } from '../../src/workbench-store.js'
const [root, project, registry] = process.argv.slice(2)
const matrix = new LocalDeviceMatrix(new WorkbenchStore(root!), project, registry)
const state = await matrix.start('smoke', 'START smoke')
while (true) {
  const current = await matrix.status(state.id)
  if (current.cells.some(c => c.attempts.some(a => a.phase === 'running'))) { process.send?.(current); break }
  await new Promise(resolve => setTimeout(resolve, 20))
}
await matrix.wait()
await matrix.close()
