import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { WorkbenchStore } from '../src/workbench-store.js'
import { WorkbenchCaseLibrary, type CaseWritePoint } from '../src/workbench-cases.js'
import { appendAuthoringDocument, describeAuthoringDocument, editAuthoringDocument, exportAuthoringProject } from '../src/workbench-authoring-document.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const yaml = '# Keep this comment\nname: Case\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."} # inline\n'
const content = { yaml, name: 'Case', tags: ['smoke'], platform: 'ios', appId: 'com.example.mobilemirror.mock', publicParams: {} }
const input = () => ({ requestId: randomUUID(), expectedRevision: null, content, publicData: true })
async function fixture(hook?: (point: CaseWritePoint) => Promise<void>, capacity?: () => Promise<number>) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-cases-')); cleanup.push(() => rm(root, { force: true, recursive: true }))
  const store = new WorkbenchStore(root, capacity); cleanup.push(() => store.close())
  const cases = new WorkbenchCaseLibrary(store, async () => 'a'.repeat(64), hook); cleanup.push(() => cases.close())
  return { root, store, cases }
}
it('saves immutable revisions, deduplicates requests, CAS conflicts and restores archives', async () => {
  const { cases, store, root } = await fixture(), request = input(), first = await cases.save(null, request)
  expect(await cases.save(null, request)).toEqual(first)
  await expect(cases.save(null, { ...request, content: { ...content, name: 'different' } })).rejects.toThrow('case-request-conflict')
  const original = await readFile(join(root, 'cases', first.caseId, `${first.revisionId}.json`))
  const updates = await Promise.allSettled(['Left', 'Right'].map(name => cases.save(first.caseId, { ...input(), expectedRevision: first.revisionId, content: { ...content, name } })))
  expect(updates.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  expect(updates.filter(item => item.status === 'rejected')).toHaveLength(1)
  const head = await cases.get(first.caseId)
  expect(head.revisions).toHaveLength(2)
  expect(await readFile(join(root, 'cases', first.caseId, `${first.revisionId}.json`))).toEqual(original)
  await cases.archive(first.caseId, { requestId: randomUUID(), expectedRevision: head.headRevision, archived: true })
  expect((await cases.list()).cases).toHaveLength(0)
  expect((await cases.list({ archived: true })).cases).toHaveLength(1)
  await cases.archive(first.caseId, { requestId: randomUUID(), expectedRevision: head.headRevision, archived: false })
  expect((await cases.list({ tag: 'smoke' })).cases).toHaveLength(1)
  const revision = await cases.revision(first.caseId, first.revisionId)
  expect(revision.platform !== 'web' && revision.yaml).toBe(yaml)
  expect(await store.list()).toEqual([])
})
it.each(['revision-synced', 'revision-renamed', 'revision-directory-synced', 'head-synced', 'head-renamed', 'head-directory-synced'] as const)('survives interrupted %s with an intact committed head and retry identity', async point => {
  let armed = false
  const { cases, root, store } = await fixture(async stage => { if (armed && stage === point) { armed = false; throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }) } })
  const first = await cases.save(null, input()), request = { ...input(), expectedRevision: first.revisionId, content: { ...content, name: 'Updated' } }
  armed = true; await expect(cases.save(first.caseId, request)).rejects.toThrow('ENOSPC')
  const old = await cases.revision(first.caseId, first.revisionId); expect(old.platform !== 'web' && old.yaml).toBe(yaml)
  await cases.close(); await store.close()
  const reopenedStore = new WorkbenchStore(root); cleanup.push(() => reopenedStore.close())
  const reopened = new WorkbenchCaseLibrary(reopenedStore, async () => 'a'.repeat(64)); cleanup.push(() => reopened.close())
  const previous = await reopened.get(first.caseId)
  expect([first.revisionId, (await reopened.save(first.caseId, request)).revisionId]).toContain(previous.headRevision)
  expect((await reopened.get(first.caseId)).revisions).toHaveLength(2)
})
it('rejects capacity, consent, path traversal and corrupt/symlink catalogs without replacing data', async () => {
  const constrained = await fixture(undefined, async () => 1)
  await expect(constrained.cases.save(null, input())).rejects.toThrow('storage-insufficient')
  const { cases, root } = await fixture(), first = await cases.save(null, input())
  await expect(cases.save(null, { ...input(), publicData: false })).rejects.toThrow()
  await expect(cases.revision('../outside', first.revisionId)).rejects.toThrow()
  const path = join(root, 'cases', 'catalog.json'); await writeFile(path, 'corrupt')
  await expect(cases.list()).rejects.toThrow(); await expect(cases.save(null, input())).rejects.toThrow(); expect(await readFile(path, 'utf8')).toBe('corrupt')
  const second = await fixture(); await symlink(root, join(second.root, 'cases'))
  await expect(second.cases.list()).rejects.toThrow('case-unsafe-directory')
})
it('edits only scalar source spans, preserving comments and advanced nodes', async () => {
  const advanced = yaml + '- unknownExtension: {keep: true}\n', description = describeAuthoringDocument({ yaml: advanced })
  expect(description.cards.at(-1)?.editable).toBe(false)
  const edited = editAuthoringDocument({ yaml: advanced, digest: description.digest, index: 1, field: 'text', value: 'New text' })
  expect(edited.yaml).toBe(advanced.replace('"Hello, harness."', '"New text"'))
  expect(() => editAuthoringDocument({ yaml: advanced, digest: description.digest, index: 2, field: 'keep', value: 'changed' })).toThrow('source-mode')
  expect(() => appendAuthoringDocument({ yaml, addition: yaml.replace('platform: ios', 'platform: android') })).toThrow('target-mismatch')
  const result = await exportAuthoringProject({ yaml, params: {}, publicData: true })
  expect(Object.keys(result.files)).toEqual(['flows/acceptance.yaml', 'mobile-mirror.project.json', 'README.md', '.gitignore'])
  expect(result.files['flows/acceptance.yaml']).toBe(yaml)
  await expect(exportAuthoringProject({ yaml: yaml + '- runFlow: missing\n', params: {}, publicData: true })).rejects.toThrow('Standalone export unavailable')
})
it('paginates 50 summaries and refuses stale generations, revision/case budgets and oversized input', async () => {
  const { cases, root } = await fixture()
  const first = await cases.save(null, input())
  for (let index = 0; index < 50; index++) await cases.save(null, { ...input(), content: { ...content, name: `Case ${index}` } })
  const page = await cases.list(); expect(page.cases).toHaveLength(50); expect(page.cursor).toBeTruthy(); expect((await cases.list({ cursor: page.cursor })).cases).toHaveLength(1)
  await cases.save(null, input()); await expect(cases.list({ cursor: page.cursor })).rejects.toThrow('case-library-refresh-required')
  const same = await cases.save(first.caseId, { ...input(), expectedRevision: first.revisionId }); expect(same.revisionId).toBe(first.revisionId)
  await expect(cases.save(null, { ...input(), content: { ...content, publicParams: { large: 'x'.repeat(81 * 1024) } } })).rejects.toThrow('case-request-budget')
  const path = join(root, 'cases', 'catalog.json'), catalog = JSON.parse(await readFile(path, 'utf8')), template = catalog.cases[first.caseId]
  while (Object.keys(catalog.cases).length < 1000) { const key = randomUUID(); catalog.cases[key] = { ...template, caseId: key } }
  await writeFile(path, JSON.stringify(catalog)); await expect(cases.save(null, input())).rejects.toThrow('case-library-budget')
  while (template.revisions.length < 100) template.revisions.push({ revisionId: randomUUID(), contentDigest: 'b'.repeat(64), createdAt: template.createdAt })
  await writeFile(path, JSON.stringify(catalog)); await expect(cases.save(first.caseId, { ...input(), expectedRevision: first.revisionId, content: { ...content, name: 'Over budget' } })).rejects.toThrow('case-revision-budget')
}, 20000)
