import { parseAllDocuments } from 'yaml'
import { factDigest, sourceStepSchema, stepDigest, tapFactSchema } from './workbench-tap-facts.js'
import type { EvidenceFile, RunStep, TestRun } from './workbench-domain.js'
import type { WorkbenchStore } from './workbench-store.js'

/** Runtime block paths are not YAML indices. Legacy fallback is for manual proposals only. */
export function sourceTapIndex(run: TestRun, step: RunStep, allowLegacy = false): number | undefined {
  const parsed = sourceStepSchema.safeParse(step.sourceStep)
  if (!parsed.success) return allowLegacy && !step.sourceStep && /^root\/[1-9]\d*$/.test(step.path ?? '') ? Number(step.path!.split('/')[1]) - 1 : undefined
  const source = parsed.data
  if (!source.topLevel || !source.static || source.documentSha256 !== factDigest(run.yaml) || !/^root\/[1-9]\d*$/.test(source.path)) return undefined
  try {
    const docs = parseAllDocuments(run.yaml), index = Number(source.path.split('/')[1]) - 1
    if (docs.length !== 2 || docs.some(doc => doc.errors.length)) return undefined
    const steps: unknown = docs[1]!.toJS({ maxAliasCount: 0 })
    if (!Array.isArray(steps) || index >= steps.length || stepDigest(steps[index]) !== source.stepSha256) return undefined
    return index
  } catch { return undefined }
}

/** No error text is consulted. This classifies evidence, not permission to repair. */
export async function trustedMissingTap(store: WorkbenchStore, run: TestRun, step: RunStep): Promise<EvidenceFile | undefined> {
  if (run.source === 'import' || run.phase !== 'finished' || run.verdict !== 'fail' || step.kind !== 'tap'
    || step.status !== 'failed' || step.checkpointError || sourceTapIndex(run, step) === undefined) return undefined
  const parsed = tapFactSchema.safeParse(step.tapFact)
  if (!parsed.success) return undefined
  const fact = parsed.data
  if (fact.runId !== run.id || fact.stepIndex !== step.index || fact.sessionId !== run.sessionId
    || stepDigest(fact.source) !== stepDigest(step.sourceStep) || fact.outcome !== 'target-not-found'
    || fact.dispatch !== 'not-dispatched' || !run.dispatches || fact.dispatchEnd > run.dispatches.length
    || run.dispatches.some(d => d.state === 'unknown' || d.state === 'dispatched'
      || (d.path === step.path && d.state !== 'not-dispatched'))
    || run.dispatches.some(d => d.sessionId !== fact.sessionId || d.sessionGeneration !== fact.sessionGeneration)) return undefined
  const evidence = (name: string) => step.evidence.find(file => file.name === name && !file.recovered && !file.incomplete && file.lineage?.integrity === 'verified' && file.lineage.kind === 'original')
  const observation = evidence(fact.observationFile), resolution = evidence(fact.resolutionFile), receipt = evidence(`step-${step.index}-tap-fact.json`)
  if (!observation || !resolution || !receipt || observation.sha256 !== fact.resolution.observationSha256) return undefined
  try {
    if (stepDigest(JSON.parse((await store.readEvidence(run.id, receipt)).toString())) !== stepDigest(fact)
      || stepDigest(JSON.parse((await store.readEvidence(run.id, resolution)).toString())) !== stepDigest(fact.resolution)) return undefined
    await store.readEvidence(run.id, observation)
    const steps = parseAllDocuments(run.yaml)[1]!.toJS({ maxAliasCount: 0 }) as { tap?: unknown }[]
    if (stepDigest(steps[sourceTapIndex(run, step)!]?.tap) !== fact.resolution.selectorSha256) return undefined
  } catch { return undefined }
  return observation
}
