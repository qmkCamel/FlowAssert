import { WorkbenchStore } from '../../src/workbench-store.js'
import { WorkbenchBaselines } from '../../src/workbench-baselines.js'

const [, , root, projectPath, cutpoint] = process.argv
if (!root || !projectPath || !cutpoint) throw new Error('Missing baseline crash fixture input')
const store = new WorkbenchStore(root)
const baselines = new WorkbenchBaselines(store, projectPath, async phase => {
  if (phase === cutpoint) {
    process.stdout.write('CUTPOINT\n')
    await new Promise<void>(() => {})
  }
})
const candidate = await baselines.candidate('exact', { kind: 'project' })
await baselines.approve(candidate.candidateId, candidate.digest, '00000000-0000-4000-8000-000000000099', 'reviewer', true)
