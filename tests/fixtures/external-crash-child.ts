import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkbenchStore } from '../../src/workbench-store.js'
import { WorkbenchExternalAssets } from '../../src/workbench-external-assets.js'
import { externalFixture } from './external-fixture.js'
const [root, phase] = process.argv.slice(2)
if (!root || !phase) throw new Error('Missing test inputs')
const store = new WorkbenchStore(root), service = new WorkbenchExternalAssets(store, { cutpoint: async point => { if (point === phase) process.kill(process.pid, 'SIGKILL') } })
await store.init(); const input = externalFixture(); await writeFile(join(root, 'test-request.json'), JSON.stringify(input))
const accepted = await service.preview(input)
for (let i = 0; i < 300; i++) {
  const job = await service.getJob(accepted.id)
  if (job.phase === 'preview') { await service.confirm(job.id, { previewDigest: job.previewDigest, reviewed: true }); throw new Error('Cutpoint not reached') }
  if (['failed', 'cancelled'].includes(job.phase)) throw new Error(job.error)
  await new Promise(resolve => setTimeout(resolve, 20))
}
throw new Error('Test timeout')
