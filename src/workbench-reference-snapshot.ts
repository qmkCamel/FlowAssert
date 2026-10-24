import { validateBuiltinReferences, hasAgentTombstone } from './workbench-builtin-references.js'
import type { ReferencePublications } from './workbench-evidence-contracts.js'
import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { validRunId, type WorkbenchStore } from './workbench-store.js'
import { WorkbenchReferences } from './workbench-references.js'
import { WorkbenchBaselines } from './workbench-baselines.js'
import { hasFrozenSuiteFacts } from './workbench-suite-facts.js'
import type { TrashJournal } from './workbench-cleanup-journal.js'
import { validatePublication } from './workbench-consumer-references.js'

/** Conservative legacy adapter plus the durable extension ledger.
 * New consumers publish WorkbenchReferences; do not add consumer-specific scans.
 */
export class WorkbenchReferenceSnapshot {
  constructor(private readonly store: WorkbenchStore, private readonly cleanup: {
    root: string; readJournal: (id: string) => Promise<TrashJournal>; pins: () => Promise<Iterable<string>>; pinReferences?: () => Promise<ReferencePublications | undefined>
  }) {}
  async snapshot(): Promise<Map<string, Set<string>>> {
    const refs = new Map<string, Set<string>>()
    const ledger = new Map((await new WorkbenchReferences(this.store).list()).map(reference => [reference.refId, reference]))
    const add = (id: unknown, reason: string) => { if (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) { const reasons = refs.get(id) ?? new Set<string>(); reasons.add(reason); refs.set(id, reasons) } }
    const addRequired = (id: unknown, reason: string) => {
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error(`Invalid ${reason} reference; retention is blocked`)
      add(id, reason)
    }
    const scan = async (directory: string, pattern: RegExp, visit: (value: any, name: string) => void) => {
      for (const entry of await safeEntries(directory)) {
        if (!entry.isFile() || !pattern.test(entry.name)) throw new Error(`Unsafe reference index: ${directory}`)
        const handle = await open(join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW)
        try { const info = await handle.stat(); if (info.size > 4 * 1024 * 1024) throw new Error('Reference index exceeds budget'); visit(JSON.parse(await handle.readFile('utf8')), entry.name) }
        finally { await handle.close() }
      }
    }
    await scan(join(this.store.root, 'suites'), /^[0-9a-f-]{36}\.json$/, (suite, name) => {
      if (suite.id !== name.slice(0, -5) && suite.referencePublications !== undefined) throw new Error('Suite identity mismatch')
      if (!suite || typeof suite !== 'object' || !Array.isArray(suite.cases)) throw new Error('Invalid suite reference index; retention is blocked')
      const active: string[] = []
      for (const c of suite.cases) {
        if (!c || !Array.isArray(c.attempts)) throw new Error('Invalid suite attempt index; retention is blocked')
        const released = suite.phase === 'finished' && hasFrozenSuiteFacts(c)
        if ((c.frozenAttempts || c.frozenDigest) && !released) throw new Error('Invalid suite attempt tombstone; retention is blocked')
        if (!released) for (const id of c.attempts) { active.push(id); if (suite.referencePublications === undefined) addRequired(id, 'suite') }
      }
      if (suite.referencePublications !== undefined) validateBuiltinReferences(suite.referencePublications, 'workbench:suite', suite.id, active, ledger)
    })
    for (const entry of await safeEntries(join(this.store.root, 'comparisons'))) {
      if (entry.name === '.input-hmac-key') continue
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) throw new Error('Unsafe comparison index')
      const path = join(this.store.root, 'comparisons', entry.name, 'report.json')
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const report = JSON.parse(await handle.readFile('utf8'))
        if (report.referencePublication !== undefined) {
          if (report.id !== entry.name) throw new Error('Comparison identity mismatch')
          validatePublication(report.referencePublication, 'workbench:comparison', entry.name, [
            { runId: report.baselineRunId, sourceHash: report.input?.baselineManifestSha256, evidenceRefs: [] },
            { runId: report.targetRunId, sourceHash: report.input?.targetManifestSha256, evidenceRefs: [] },
          ], ledger)
        } else { addRequired(report.baselineRunId, 'comparison'); addRequired(report.targetRunId, 'comparison') }
      }
      finally { await handle.close() }
    }
    await scan(join(this.store.root, 'shares'), /^[0-9a-f-]{36}\.json$/, (share, name) => {
      if (share.referencePublication !== undefined) validatePublication(share.referencePublication, 'workbench:share', name.slice(0, -5), [
        { runId: share.sourceRunId, sourceHash: share.sourceManifestSha256, evidenceRefs: share.files.map((file: { sourceName: string }) => file.sourceName) },
      ], ledger)
      else addRequired(share.sourceRunId, 'share-export')
    })
    const reasons: Record<string, string> = { 'workbench:pin': 'pin', 'workbench:baseline': 'baseline', 'workbench:suite': 'suite', 'workbench:agent': 'agent-request', 'workbench:child': 'child-run' }
    for (const ref of ledger.values()) addRequired(ref.targetRunId, reasons[ref.consumerKind] ?? ref.consumerKind)
    for (const baseline of await new WorkbenchBaselines(this.store, undefined).list()) {
      if (baseline.referencePublications !== undefined) {
        validateBuiltinReferences(baseline.referencePublications, 'workbench:baseline', baseline.baselineId, baseline.sourceRunId ? [baseline.sourceRunId] : [], ledger)
        if (baseline.sourceRunId && baseline.referencePublications[baseline.sourceRunId]?.references[0]?.sourceHash !== baseline.sourceManifestSha256) throw new Error('Baseline publication source mismatch')
      }
      else if (baseline.sourceRunId) addRequired(baseline.sourceRunId, 'baseline')
    }
    // The durable Agent journal is outside the run directory. A completed flow
    // with a frozen projection can lose media without losing requestId identity.
    // Older/incomplete journals remain protected until they can be migrated.
    await scan(join(this.store.root, 'agent-executions'), /^[0-9a-f-]{36}\.json$/, (journal, name) => {
      if (journal.referencePublications !== undefined && journal.executionId !== name.slice(0, -5)) throw new Error('Agent identity mismatch')
      if (journal?.schemaVersion !== 1 || typeof journal.requestKey !== 'string' || typeof journal.requestHash !== 'string'
        || !['accepted', 'running', 'cancelling', 'finished'].includes(journal.phase)
        || (journal.runId === undefined && journal.suiteId === undefined)) throw new Error('Invalid Agent request journal; retention is blocked')
      if (journal.runId !== undefined) {
        const durableTombstone = hasAgentTombstone(journal)
        if (journal.referencePublications !== undefined) validateBuiltinReferences(journal.referencePublications, 'workbench:agent', journal.executionId, durableTombstone ? [] : [journal.runId], ledger)
        else if (!durableTombstone) addRequired(journal.runId, 'agent-request')
        else validRunId(journal.runId)
      }
      if (journal.suiteId !== undefined && (typeof journal.suiteId !== 'string' || !/^[0-9a-f-]{36}$/.test(journal.suiteId))) throw new Error('Invalid Agent suite reference; retention is blocked')
    })
    for (const entry of await safeEntries(join(this.cleanup.root, 'journals'))) {
      if (entry.isFile() && /^\.journal-[0-9a-f-]{36}\.tmp$/.test(entry.name)) continue
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.json$/.test(entry.name)) throw new Error('Unsafe retention journal index')
      const journal = await this.cleanup.readJournal(entry.name.slice(0, -5))
      if (['move-interrupted', 'recovery-required'].includes(journal.state)) add(journal.id, 'lifecycle-interrupted')
      if (journal.referencePublications !== undefined && journal.state !== 'restored') validateBuiltinReferences(journal.referencePublications, 'workbench:child', journal.id, journal.state === 'purged' ? [] : journal.parentRunId ? [journal.parentRunId] : [], ledger)
      else if (journal.parentRunId && !['restored', 'purged'].includes(journal.state)) add(journal.parentRunId, 'trashed-child')
    }
    const pins = [...await this.cleanup.pins()], pinReferences = await this.cleanup.pinReferences?.()
    if (pinReferences !== undefined) validateBuiltinReferences(pinReferences, 'workbench:pin', 'pins', pins, ledger)
    else for (const id of pins) add(id, 'pin')
    for (const run of await this.store.list()) {
      if (run.referencePublications !== undefined) validateBuiltinReferences(run.referencePublications, 'workbench:child', run.id, run.parentRunId ? [run.parentRunId] : [], ledger)
      else add(run.parentRunId, 'child-run')
    }
    for (const entry of await safeEntries(join(this.cleanup.root, 'trash'))) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) throw new Error('Unsafe trash reference index')
      let handle
      try { handle = await open(join(this.cleanup.root, 'trash', entry.name, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          const journal = await this.cleanup.readJournal(entry.name)
          if (journal.state === 'purge-interrupted' && journal.parentRunId) continue
        }
        throw error
      }
      try {
        const run = JSON.parse(await handle.readFile('utf8'))
        if (run.referencePublications !== undefined) {
          if (run.id !== entry.name) throw new Error('Trashed child identity mismatch')
          validateBuiltinReferences(run.referencePublications, 'workbench:child', run.id, run.parentRunId ? [run.parentRunId] : [], ledger)
        } else add(run.parentRunId, 'trashed-child')
      }
      finally { await handle.close() }
    }
    return refs
  }
}

async function safeEntries(directory: string) {
  try { const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe retention directory'); return await readdir(directory, { withFileTypes: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
