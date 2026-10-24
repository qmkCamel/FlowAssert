import { WorkbenchStore } from '../../src/workbench-store.js'

const root = process.argv[2]
if (!root) throw new Error('Store root required')
const store = new WorkbenchStore(root)
await store.init()
process.stdout.write('READY\n')
process.stdin.once('data', async () => {
  await store.close()
  process.exit(0)
})
