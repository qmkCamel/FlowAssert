import { isMap, isSeq, parseAllDocuments } from 'yaml'
import { normalizeScreenSource } from './screen-source-normalizer.js'
import { selectorFields } from './workbench-selector-adapter.js'
import { sha256, type WorkbenchStore } from './workbench-store.js'
import type { EvidenceFile, RunStep, TestRun } from './workbench-domain.js'
import { sourceTapIndex } from './workbench-repair-evidence.js'
import { assertLocatorOnlyDiff } from './workbench-repair-diff.js'

export interface RepairProposal {
  status: 'candidate'; sourceRunId: string; baselineRunId: string; sourcePlanDigest: string; sourceManifestSha256: string; baselineManifestSha256: string
  failureEvidence: { name: string; sha256: string }; baselineEvidence: { name: string; sha256: string }
  stepIndex: number; sourceLine: number; before: { key: 'id' | 'accessibilityId'; value: string }; after: { key: 'id' | 'accessibilityId'; value: string }
  semanticDiff: string; yaml: string; digest: string
}
export type RepairResult = RepairProposal | { status: 'no-safe-repair'; reason: string }

/** Only an identity change corroborated by a unique, non-sensitive old/new node is proposed. */
export class WorkbenchRepair {
  constructor(private readonly store: WorkbenchStore) {}

  async suggest(sourceRunId: string, requestedBaselineRunId?: string): Promise<RepairResult> {
    const no = (reason: string): RepairResult => ({ status: 'no-safe-repair', reason })
    const { run: source, manifestSha256: sourceManifestSha256 } = await this.store.readOnlySnapshot(sourceRunId)
    if (source.phase !== 'finished' || source.verdict !== 'fail' || source.source === 'import') return no('Only a failed original run can be repaired')
    const failed = source.steps.find(step => step.status === 'failed' && step.kind === 'tap')
    const stepIndex = failed ? sourceTapIndex(source, failed, true) : undefined
    if (!failed || stepIndex === undefined) return no('No eligible failed locator-only tap step; assertions remain unchanged')
    const docs = parseAllDocuments(source.yaml)
    if (docs.length !== 2 || docs.some(doc => doc.errors.length) || !isSeq(docs[1]!.contents)) return no('Source YAML cannot be edited safely')
    const item = docs[1]!.contents.items[stepIndex]
    if (!isMap(item) || item.items.length !== 1 || String(item.items[0]?.key?.toJSON()) !== 'tap' || !isMap(item.items[0]?.value)) return no('Failed step is not a simple tap locator')
    const target = item.items[0]!.value
    if (target.items.length !== 1) return no('Locator has additional constraints; no automatic relaxation is allowed')
    const key = String(target.items[0]?.key?.toJSON())
    const old = target.items[0]?.value?.toJSON()
    if (!['id', 'accessibilityId'].includes(key) || typeof old !== 'string' || !old) return no('Locator has no stable identity field')
    const baselineId = requestedBaselineRunId ?? source.parentRunId ?? (await this.store.list()).find(run => run.verdict === 'pass' && run.yaml === source.yaml && run.platform === source.platform && run.source !== 'import')?.id
    if (!baselineId) return no('No successful run of the unchanged plan is available as an anchor')
    const { run: baseline, manifestSha256: baselineManifestSha256 } = await this.store.readOnlySnapshot(baselineId)
    if (baseline.verdict !== 'pass' || baseline.phase !== 'finished' || baseline.source === 'import' || baseline.yaml !== source.yaml || baseline.platform !== source.platform || baseline.platform === 'unknown' || source.platform === 'unknown') return no('Baseline does not match the original plan and platform')
    const platform = source.platform
    const baselinePlatform = baseline.platform
    const baselineStep = baseline.steps.find(step => step.kind === 'tap' && sourceTapIndex(baseline, step, true) === stepIndex)
    if (!baselineStep) return no('Baseline lacks the same tap step')
    const currentXml = xmlEvidence(failed), baselineXml = xmlEvidence(baselineStep)
    if (!currentXml || !baselineXml) return no('Verified hierarchy evidence is unavailable for both runs')
    let oldTree, newTree
    try {
      oldTree = normalizeScreenSource((await this.store.readEvidence(baseline.id, baselineXml)).toString('utf8'), baseline.platform)
      newTree = normalizeScreenSource((await this.store.readEvidence(source.id, currentXml)).toString('utf8'), source.platform)
    } catch { return no('Hierarchy evidence is unreadable or has failed integrity checks') }
    if (oldTree.truncated || newTree.truncated) return no('Truncated hierarchy cannot support a safe repair')
    const beforeNodes = oldTree.nodes.filter(node => selectorFields(node, baselinePlatform)[key as 'id' | 'accessibilityId'] === old)
    if (beforeNodes.length !== 1) return no('Old locator was not unique in the successful baseline')
    const anchor = beforeNodes[0]!
    if (anchor.sensitive || !anchor.text || !anchor.role) return no('Old control lacks a safe, non-sensitive text/role anchor')
    const matches = newTree.nodes.filter(node => !node.sensitive && node.text === anchor.text && node.role === anchor.role && node.visible !== false)
    if (matches.length !== 1) return no('The original control is missing or ambiguous; preserve the failure')
    const next = selectorFields(matches[0]!, platform)[key as 'id' | 'accessibilityId']
    if (!next || next === old || newTree.nodes.filter(node => selectorFields(node, platform)[key as 'id' | 'accessibilityId'] === next).length !== 1) return no('No unique replacement identity exists')
    if (newTree.nodes.some(node => selectorFields(node, platform)[key as 'id' | 'accessibilityId'] === old)) return no('Old locator still matches; failure may be a product defect')
    docs[1]!.setIn([stepIndex, 'tap', key], next)
    const yaml = `${docs[0]!.toString()}${docs[1]!.toString()}`
    try { assertLocatorOnlyDiff(source.yaml, yaml, stepIndex) } catch { return no('Candidate changes more than one static locator field') }
    const sourcePlanDigest = source.comparison?.planDigest ?? sha256(source.yaml)
    const body = { status: 'candidate' as const, sourceRunId, baselineRunId: baselineId, sourcePlanDigest, sourceManifestSha256, baselineManifestSha256,
      failureEvidence: { name: currentXml.name, sha256: currentXml.sha256 }, baselineEvidence: { name: baselineXml.name, sha256: baselineXml.sha256 },
      stepIndex: failed.index, sourceLine: failed.sourceLine ?? 0, before: { key: key as 'id' | 'accessibilityId', value: old }, after: { key: key as 'id' | 'accessibilityId', value: next },
      semanticDiff: `Step ${failed.index}: tap.${key}: ${JSON.stringify(old)} -> ${JSON.stringify(next)}; assertions and App scope unchanged`, yaml }
    return { ...body, digest: sha256(JSON.stringify(body)) }
  }

  async confirm(sourceRunId: string, baselineRunId: string, digest: string): Promise<RepairProposal> {
    const current = await this.suggest(sourceRunId, baselineRunId)
    if (current.status !== 'candidate' || current.digest !== digest) throw new Error('Repair proposal is stale or no longer safe; review again')
    return current
  }
}

function xmlEvidence(step: RunStep): EvidenceFile | undefined {
  const files = step.evidence.filter(file => file.contentType === 'application/xml; charset=utf-8' && !file.recovered && !file.incomplete && file.lineage?.integrity !== 'unverified')
  return files.find(file => file.name === step.tapFact?.observationFile) ?? files[0]
}
