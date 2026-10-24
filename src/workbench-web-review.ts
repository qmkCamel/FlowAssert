import { z } from 'zod'
import type { WorkbenchStore } from './workbench-store.js'
import { isWebRun } from './workbench-web-contracts.js'

export async function reviewWebRun(store: WorkbenchStore, id: string, value: unknown) {
  const review = z.object({ status: z.enum(['pass','fail']), reviewer: z.string().trim().min(2).max(160), observations: z.string().trim().min(20).max(8000),
    hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(100), reviewedImages: z.literal(true) }).strict().parse(value)
  return store.withMutationGate(async () => {
    const run = await store.getRecord(id)
    if (!isWebRun(run) || run.phase !== 'finished' || run.verdict === 'cancelled' || run.recovery) throw new Error('Web run cannot be reviewed as complete')
    if (run.visualReview.status !== 'needs-review') throw new Error('Review is immutable; create a new attempt')
    const path = new URL('../scripts/web-visual-acceptance/verify-product.mjs', import.meta.url).href
    const { inspectProduct } = await import(path)
    const checked = await inspectProduct(run, (file: Parameters<WorkbenchStore['readEvidence']>[1]) => store.readEvidence(id, file))
    if (JSON.stringify([...review.hashes].sort()) !== JSON.stringify(checked.imageHashes)) throw new Error('Review must bind all current screenshot hashes')
    run.visualReview = { status: review.status, reviewer: review.reviewer, observations: review.observations, hashes: review.hashes, at: new Date().toISOString() }
    run.independentCheck = checked.pass ? 'pass' : 'fail'
    run.evidence.push(await store.put(id, 'web-independent-check.json', JSON.stringify(checked), 'application/json'))
    run.evidence.push(await store.put(id, 'web-visual-review.json', JSON.stringify(run.visualReview), 'application/json'))
    run.verdict = review.status === 'fail' || run.steps.some(step=>step.checks.some(check=>!check.pass)) ? 'fail' : checked.pass ? 'pass' : 'inconclusive'
    await store.saveRecord(run); return run
  })
}
