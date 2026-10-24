import { WorkbenchShareJobs } from '../../src/workbench-share-jobs.js'
import { WorkbenchStore } from '../../src/workbench-store.js'

const [root, runId, cutpoint, format] = process.argv.slice(2)
if (!root || !runId || !cutpoint) throw new Error('Missing share kill fixture input')
const store = new WorkbenchStore(root)
await store.init()
const jobs = new WorkbenchShareJobs(store, async point => {
  if (point !== cutpoint) return
  process.stdout.write(`CUTPOINT ${point}\n`)
  await new Promise<void>(() => {})
})
const options = { files: [{ name: 'step-1.png' }] }
const preview = await jobs.submit('share-preview', 'kill-preview', { runId, options, ...(format === 'html' ? {format: 'html' as const} : {}) })
if (cutpoint.startsWith('preview:')) await jobs.waitResult(preview.jobId)
else {
  const result = await jobs.waitResult(preview.jobId) as { reviewToken: string }
  const job = await jobs.submit('share-export', 'kill-export', { runId, options, ...(format === 'html' ? {format: 'html' as const} : {}), reviewToken: result.reviewToken, reviewed: true })
  await jobs.waitResult(job.jobId)
}
