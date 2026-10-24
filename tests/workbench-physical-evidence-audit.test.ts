import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import type { TestRun } from '../src/workbench-domain.js'
import { auditPhysicalRunRoot } from '../src/workbench-physical-evidence-audit.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'physical-audit-')); roots.push(root)
  const store = new WorkbenchStore(root); await store.init()
  const id = randomUUID(), file = await store.put(id, 'step-1.xml', '<synthetic/>', 'application/xml')
  const run: TestRun = { schemaVersion: 1, id, name: 'private-name', yaml: '', engine: 'fixture', phase: 'finished', verdict: 'inconclusive',
    startedAt: '2026-01-01T00:00:00.000Z', sessionId: 'private-session', deviceName: 'private-device', platform: 'ios', provider: 'appium',
    verificationScope: 'declared-ui-assertions', visualVerification: 'not-performed', businessVerification: 'not-performed',
    steps: [], evidence: [file], cleanup: 'session-retained' }
  await store.save(run); await store.close()
  return { root, run, file, manifest: join(root, id, 'manifest.json') }
}
it('does not initialize/recover a store, alter its verdict or expose identities', async () => {
  const { root, run, manifest } = await fixture(), before = await readFile(manifest), entries = await readdir(root)
  const report = await auditPhysicalRunRoot(root)
  expect(report).toMatchObject({ runs: 1, files: 1, verdicts: { inconclusive: 1 }, manifestsUnchanged: true, originalVerdictsUpgraded: false })
  expect(JSON.stringify(report)).not.toMatch(/private-|step-1|manifest\.json|physical-audit-.*\//)
  expect(await readFile(manifest)).toEqual(before); expect(await readdir(root)).toEqual(entries)
  expect(JSON.parse((await readFile(manifest)).toString()).id).toBe(run.id)
})
it('rejects damaged evidence without recovering or rewriting it', async () => {
  const { root, run, file, manifest } = await fixture(), before = await readFile(manifest)
  await writeFile(join(root, run.id, file.name), 'damaged')
  await expect(auditPhysicalRunRoot(root)).rejects.toThrow('Evidence integrity')
  expect(await readFile(manifest)).toEqual(before)
})
it('rejects incomplete and corrupt manifests without recovery writes', async () => {
  const { root, run, manifest } = await fixture()
  await writeFile(manifest, JSON.stringify({ ...run, phase: 'running' }))
  await expect(auditPhysicalRunRoot(root)).rejects.toThrow('audit-nonterminal')
  await writeFile(manifest, '{broken')
  await expect(auditPhysicalRunRoot(root)).rejects.toThrow()
  expect((await readFile(manifest)).toString()).toBe('{broken')
})
it('refuses relative roots and symlinked evidence', async () => {
  const { root, run, file } = await fixture()
  await expect(auditPhysicalRunRoot('relative')).rejects.toThrow('audit-absolute')
  const target = join(root, 'target'); await writeFile(target, '<synthetic/>')
  await rm(join(root, run.id, file.name)); await symlink(target, join(root, run.id, file.name))
  await expect(auditPhysicalRunRoot(root)).rejects.toThrow()
})
