import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { WorkbenchStore } from './workbench-store.js'
import { compilePlan } from './workbench-plan.js'
import { verifyRuntimeEvidence } from './workbench-runtime-evidence.js'
import type { EvidenceFile } from './workbench-domain.js'
import type { ProjectSnapshot } from './workbench-project.js'

/** Offline integrity replay only; never initializes, repairs, executes or leases a source store. */
export async function auditPhysicalRunRoot(root: string) {
  if (!isAbsolute(root)) throw new Error('audit-absolute-root-required')
  const directory = await lstat(root)
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('audit-root-type')
  const entries = (await readdir(root, { withFileTypes: true })).filter(entry => /^[0-9a-f-]{36}$/.test(entry.name))
  if (!entries.length || entries.length > 1000 || entries.some(entry => !entry.isDirectory() || entry.isSymbolicLink())) throw new Error('audit-run-budget-or-type')
  const store = new WorkbenchStore(root)
  let files = 0, bytes = 0, runtimeRuns = 0, dispatches = 0
  const verdicts: Record<string, number> = {}
  for (const entry of entries) {
    const metadata = await lstat(join(root, entry.name, 'manifest.json'))
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 8 * 1024 * 1024) throw new Error('audit-manifest-budget-or-type')
    const snapshot = await store.readOnlySnapshot(entry.name), run = snapshot.run
    if (run.phase !== 'finished' || !run.verdict) throw new Error('audit-nonterminal-run')
    const evidence = new Map<string, EvidenceFile>()
    for (const file of [...run.evidence, ...run.steps.flatMap(step => step.evidence)]) {
      if (evidence.has(file.name) && JSON.stringify(evidence.get(file.name)) !== JSON.stringify(file)) throw new Error('audit-conflicting-reference')
      evidence.set(file.name, file)
    }
    for (const file of evidence.values()) {
      files++; bytes += file.bytes
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 64 * 1024 * 1024 || files > 20000 || bytes > 512 * 1024 * 1024) throw new Error('audit-evidence-budget')
      await store.readEvidence(run.id, file)
    }
    if (run.productContract?.contractVersion === 2) {
      // The saved plan is registered evidence, not a new config or executable module.
      const planFile = evidence.get('plan.json')
      if (!planFile || planFile.bytes > 1024 * 1024) throw new Error('audit-runtime-plan-missing-or-budget')
      const frozen = JSON.parse((await store.readEvidence(run.id, planFile)).toString()) as { yaml: string; project: ProjectSnapshot; params: Record<string, unknown> }
      if (frozen.yaml !== run.yaml || JSON.stringify(frozen.params) !== JSON.stringify(run.params ?? {})) throw new Error('audit-runtime-input-conflict')
      await verifyRuntimeEvidence(store, run, await compilePlan(frozen.yaml, frozen.project, frozen.params))
      runtimeRuns++
    }
    if ((await store.readOnlySnapshot(run.id)).manifestSha256 !== snapshot.manifestSha256) throw new Error('audit-source-changed')
    verdicts[run.verdict] = (verdicts[run.verdict] ?? 0) + 1
    dispatches += run.dispatches?.length ?? 0
  }
  return { schemaVersion: 1, scope: 'offline-native-evidence-integrity', runs: entries.length, files, bytes,
    runtimeRuns, dispatches, verdicts, manifestsUnchanged: true, deviceConnected: false, originalVerdictsUpgraded: false }
}
