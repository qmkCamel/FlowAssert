import { WorkbenchRetention } from '../../src/workbench-retention.js'
import { WorkbenchStore } from '../../src/workbench-store.js'

const [root, action, target, cutpoint] = process.argv.slice(2)
if (!root || !action || !target || !cutpoint) throw new Error('Missing retention kill fixture input')
const store = new WorkbenchStore(root)
await store.init()
const retention = new WorkbenchRetention(store, () => null, async point => {
  if (point !== cutpoint) return
  process.stdout.write(`CUTPOINT ${point}\n`)
  await new Promise<void>(() => {})
})
if (action === 'move') await retention.confirm(await retention.plan(30))
else if (action === 'restore') await retention.restore(target)
else if (action === 'purge') await retention.purge(target, `PURGE ${target}`)
else throw new Error('Unknown retention kill fixture action')
