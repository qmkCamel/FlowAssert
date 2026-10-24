import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchStore, sha256 } from '../src/workbench-store.js'
import { WorkbenchSuites, type SuiteRun } from '../src/workbench-suites.js'
import { WorkbenchRetention } from '../src/workbench-retention.js'
import { WorkbenchTrendIndex } from '../src/workbench-trends.js'

describe('suite attempt retention tombstones', () => {
  it('preserves a verified historical denominator while released media moves to trash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-suite-tombstone-'))
    const store = new WorkbenchStore(join(root, 'runs'))
    const mirror = new MirrorService(resolveMirrorConfig({ mockStartupDelayMs: 0 }), 'http://127.0.0.1', { providerFactory: () => new MockProvider(0) })
    const workbench = new WorkbenchService(mirror, { store })
    try {
      await mirror.start({ provider: 'mock' })
      const started = await workbench.start('name: History\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- assertVisible: {text: "Hello, harness."}\n- done\n')
      await workbench.wait()
      const verified = await workbench.get(started.id)
      expect(verified.resultProjection?.evidenceAvailability).toBe('verified')
      verified.startedAt = '2020-01-01T00:00:00.000Z'
      delete verified.resultProjection
      await store.save(verified)
      const suiteId = randomUUID()
      const fixture: SuiteRun = { id: suiteId, name: 'history', registeredId: 'regression', phase: 'finished',
        startedAt: '2020-01-01T00:00:00.000Z', endedAt: '2020-01-01T00:00:20.000Z', sessionId: 'fixture',
        cases: [{ id: 'case:row', flow: 'flow', rowId: 'row', status: 'pass', attempts: [started.id], retries: 0, retrySafe: false, params: {} }],
        project: {} as SuiteRun['project'], snapshotSha256: sha256('{}'), stopOnFailure: false, timeoutMs: 60_000 }
      const suitesRoot = join(store.root, 'suites')
      await mkdir(suitesRoot)
      await writeFile(join(suitesRoot, `${suiteId}.json`), JSON.stringify(fixture))
      const suites = new WorkbenchSuites(workbench)
      const retention = new WorkbenchRetention(store)
      expect((await retention.snapshot()).runs.find(item => item.id === started.id)?.protectedBy).toContain('suite')
      await suites.freezeForRetention(suiteId)
      const suitePath = join(suitesRoot, `${suiteId}.json`)
      const originalSuite = await readFile(suitePath, 'utf8')
      const tampered = JSON.parse(originalSuite)
      tampered.cases[0].frozenAttempts[0].trendRun.verdict = 'fail'
      await writeFile(suitePath, JSON.stringify(tampered))
      await expect(retention.snapshot()).rejects.toThrow(/tombstone/)
      await writeFile(suitePath, originalSuite)
      expect((await retention.snapshot()).runs.find(item => item.id === started.id)?.protectedBy).not.toContain('suite')
      const plan = await retention.plan(0)
      expect(plan.candidates.map(item => item.id)).toContain(started.id)
      expect((await retention.confirm(plan)).moved).toContain(started.id)
      const historical = await new WorkbenchTrendIndex(store, suites).rebuild()
      expect(historical.coverage).toMatchObject({ planned: 1, firstPassRate: 1, cleanPassRate: 1, corruptOrMissing: 0 })
      expect(historical.groups[0]?.cases[0]).toMatchObject({ outcome: 'first-pass', evidenceStatus: 'trashed' })
      const view = await suites.get(suiteId)
      expect(view.cases[0]?.resultProjections?.[0]).toMatchObject({ reportedVerdict: 'pass', verdict: 'inconclusive', evidenceAvailability: 'unavailable' })
      await retention.purge(started.id, `PURGE ${started.id}`)
      const purged = await new WorkbenchTrendIndex(store, suites).rebuild()
      expect(purged.groups[0]?.cases[0]).toMatchObject({ outcome: 'first-pass', evidenceStatus: 'purged' })
      await rm(join(store.root, 'retention', 'journals', `${started.id}.json`))
      const unexplained = await new WorkbenchTrendIndex(store, suites).rebuild()
      expect(unexplained.coverage).toMatchObject({ planned: 1, firstPassRate: 0, corruptOrMissing: 1 })
      expect(unexplained.groups[0]?.cases[0]).toMatchObject({ outcome: 'inconclusive', evidenceStatus: 'missing' })
    } finally { await workbench.close(); await mirror.dispose(); await rm(root, { recursive: true, force: true }) }
  }, 30_000)
})
