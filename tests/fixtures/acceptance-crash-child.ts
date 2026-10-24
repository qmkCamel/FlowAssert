import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { WorkbenchStore } from '../../src/workbench-store.js'
import { WorkbenchChangeAcceptance } from '../../src/workbench-change-acceptance.js'
import { seedAcceptance } from './acceptance-fixture.js'

const [root, phase] = process.argv.slice(2)
if (!root || !phase) throw new Error('Test root and phase required')
const store = new WorkbenchStore(root)
const service = new WorkbenchChangeAcceptance(store, { cutpoint: async point => {
  if (point === phase) process.kill(process.pid, 'SIGKILL')
} })
const { input } = await seedAcceptance(store)
const preview = await service.preview(input)
const request = { id: randomUUID(), expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true }
await writeFile(join(root, 'test-request.json'), JSON.stringify(request))
await service.publish(request)
for (let i = 0; i < 300; i++) {
  await new Promise(resolve => setTimeout(resolve, 20))
  const job = await service.getJob(request.requestKey)
  if (['finished', 'failed', 'cancelled'].includes(job.phase)) throw new Error(`Cutpoint not reached: ${job.phase} ${job.error ?? ''}`)
}
throw new Error('Cutpoint timeout')
