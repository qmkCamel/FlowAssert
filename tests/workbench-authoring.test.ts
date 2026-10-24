import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { WorkbenchService } from '../src/workbench-service.js'
import { WorkbenchAcceptance, type AcceptanceWritePoint } from '../src/workbench-acceptance.js'
import { WorkbenchAuthoring, type authoringJournalSchema } from '../src/workbench-authoring.js'
import { WorkbenchReferences } from '../src/workbench-references.js'
import { ViewerServer } from '../src/viewer-server.js'
import type { z } from 'zod'
import { spawn } from 'node:child_process'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const yaml = 'name: Authoring fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n- done\n'
async function fixture(options: { now?: () => number; writeHook?: (point: AcceptanceWritePoint, journal: Readonly<z.infer<typeof authoringJournalSchema>>) => void; disconnected?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mirror-authoring-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const projectPath = join(root, 'project.json'); await writeFile(projectPath, '{}')
  const provider = new MockProvider(0), mutations = vi.spyOn(provider, 'manageApp')
  const config = resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 })
  const mirror = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => provider })
  cleanups.push(() => mirror.dispose())
  if (!options.disconnected) await mirror.start({ provider: 'mock' })
  const workbench = new WorkbenchService(mirror, { root: join(root, 'runs'), projectPath })
  const acceptance = new WorkbenchAcceptance(workbench.store), authoring = new WorkbenchAuthoring(workbench, acceptance, options)
  cleanups.push(() => workbench.close()); cleanups.push(() => acceptance.close())
  return { root, projectPath, mirror, workbench, acceptance, authoring, mutations, config,
    input: { yaml, params: {}, target: { platform: 'ios' as const, appId: 'com.example.mobilemirror.mock', sessionId: mirror.state().sessionId } } }
}
async function request(authoring: WorkbenchAuthoring, input: unknown, requestId = 'same-request') {
  const result = await authoring.validate(input)
  if (!result.valid) throw new Error(JSON.stringify(result))
  return { receipt: result.receipt.token, inputDigest: result.receipt.inputDigest, localEvidence: true as const, requestId }
}
async function finished(authoring: WorkbenchAuthoring, requestId: string) {
  await expect.poll(async () => (await authoring.status(requestId)).phase, { timeout: 10_000 }).toBe('finished')
  return authoring.status(requestId)
}

describe('revision-bound Viewer authoring', () => {
  it.each(['accepted:temporary-synced', 'accepted:renamed', 'accepted:directory-synced', 'referenced:directory-synced', 'finished:temporary-synced'])('survives actual process death at %s without replay', async boundary => {
    const root = await mkdtemp(join(tmpdir(), 'mirror-authoring-kill-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    await writeFile(join(root, 'mock-writes.log'), '')
    const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/workbench-authoring-kill-child.ts', root, boundary], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''; child.stderr.on('data', chunk => { errors += String(chunk) })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Crash fixture timeout: ${errors}`)) }, 12_000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', (code, signal) => { clearTimeout(timeout); signal === 'SIGKILL' ? resolve() : reject(new Error(`Fixture exited ${code}: ${errors}`)) })
    })
    const writesBefore = await readFile(join(root, 'mock-writes.log'), 'utf8')
    if (boundary.startsWith('finished')) expect(writesBefore).not.toBe('')
    else expect(writesBefore).toBe('')
    const { mirror, mutations } = await fixture()
    const workbench = new WorkbenchService(mirror, { root: join(root, 'runs') }), shared = new WorkbenchAcceptance(workbench.store)
    const restored = new WorkbenchAuthoring(workbench, shared)
    cleanups.push(() => workbench.close()); cleanups.push(() => shared.close())
    const input = JSON.parse(await readFile(join(root, 'request.json'), 'utf8'))
    if (boundary === 'accepted:temporary-synced') await expect(restored.run(input)).rejects.toThrow('authoring-validation-expired')
    else {
      expect(await restored.run(input)).toMatchObject({ phase: 'finished', outcome: { verdict: 'inconclusive', error: 'Interrupted; execution was not replayed' } })
      expect(await restored.run(input)).toMatchObject({ phase: 'finished' })
    }
    expect(mutations).not.toHaveBeenCalled()
    expect(await readFile(join(root, 'mock-writes.log'), 'utf8')).toBe(writesBefore)
  }, 20_000)

  it('validates without device calls and binds exact text, params, project, compiler and target', async () => {
    const { authoring, input, mutations } = await fixture()
    const first = await authoring.validate(input), edited = await authoring.validate({ ...input, yaml: '# comment\n' + yaml })
    expect(first).toMatchObject({ valid: true, canRun: true, scope: { business: 'not-performed' } })
    if (!first.valid || !edited.valid) throw new Error('Validation failed')
    expect(first.receipt.inputDigest).not.toBe(edited.receipt.inputDigest)
    expect(Date.parse(first.receipt.expiresAt) - Date.now()).toBeGreaterThan(599_000)
    expect(first.receipt.projectDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(first.receipt.compilerVersion).toContain('workbench-plan')
    expect(mutations).not.toHaveBeenCalled()
    await expect(authoring.run({ ...(await request(authoring, input)), inputDigest: edited.receipt.inputDigest })).rejects.toThrow('authoring-input-changed')
    expect(mutations).not.toHaveBeenCalled()
  })

  it('allows disconnected validation but not execution; labels action-only flow', async () => {
    const { authoring, input, mutations } = await fixture({ disconnected: true })
    expect(await authoring.validate(input)).toMatchObject({ valid: true, canRun: false })
    await expect(authoring.run(await request(authoring, input))).rejects.toThrow('authoring-target-changed')
    expect(await authoring.validate({ ...input, yaml: yaml.replace('- assertVisible: {text: "Hello, harness."}\n', '') })).toMatchObject({ valid: false, actionOnly: true })
    expect(mutations).not.toHaveBeenCalled()
  })

  it('rejects expired, changed project, reconnected target and missing consent before mutation', async () => {
    let now = Date.now()
    const { authoring, input, projectPath, mirror, mutations } = await fixture({ now: () => now })
    const original = await request(authoring, input)
    await expect(authoring.run({ ...original, localEvidence: false })).rejects.toThrow()
    now += 600_001
    await expect(authoring.run(original)).rejects.toThrow('authoring-validation-expired')
    const next = await request(authoring, input)
    await writeFile(projectPath, '{"provenance":{"appBuild":"changed"}}')
    await expect(authoring.run(next)).rejects.toThrow('authoring-project-changed')
    await writeFile(projectPath, '{}')
    const target = await request(authoring, input)
    await mirror.stop(); await mirror.start({ provider: 'mock' })
    await expect(authoring.run(target)).rejects.toThrow('authoring-target-changed')
    expect(mutations).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent requests and retries after expiry or restart without another write', async () => {
    let now = Date.now()
    const { root, authoring, input, mutations, acceptance, workbench, mirror, projectPath } = await fixture({ now: () => now })
    const value = await request(authoring, input), [first, duplicate] = await Promise.all([authoring.run(value), authoring.run(value)])
    expect(duplicate.executionId).toBe(first.executionId)
    expect(await finished(authoring, value.requestId)).toMatchObject({ outcome: { verdict: 'pass' } })
    const count = mutations.mock.calls.length
    expect(count).toBeGreaterThan(0)
    now += 600_001; expect((await authoring.run(value)).runId).toBe(first.runId)
    await expect(authoring.run({ ...value, inputDigest: 'f'.repeat(64) })).rejects.toThrow('acceptance-request-conflict')
    const raw = await readFile(join(root, 'runs', 'authoring-executions', `${first.executionId}.json`), 'utf8')
    expect(raw).not.toContain('Hello, harness.'); expect(raw).not.toContain(value.receipt)
    expect((await new WorkbenchReferences(workbench.store).list()).filter(ref => ref.consumerId === first.executionId)).toEqual([])
    await acceptance.close(); await workbench.close()
    const reopened = new WorkbenchService(mirror, { root: join(root, 'runs'), projectPath }), shared = new WorkbenchAcceptance(reopened.store)
    const restored = new WorkbenchAuthoring(reopened, shared)
    cleanups.push(() => reopened.close()); cleanups.push(() => shared.close())
    expect((await restored.run(value)).runId).toBe(first.runId)
    await expect(restored.run({ ...value, requestId: 'new-after-restart' })).rejects.toThrow('authoring-validation-expired')
    expect(mutations).toHaveBeenCalledTimes(count)
  }, 15_000)

  it.each(['temporary-synced', 'renamed', 'directory-synced'] as const)('never re-dispatches a live retry after uncertain %s acceptance', async point => {
    let once = false
    const { authoring, input, mutations } = await fixture({ writeHook(current, journal) {
      if (!once && current === point && journal.phase === 'accepted') { once = true; throw new Error('synthetic ENOSPC') }
    } })
    const value = await request(authoring, input)
    await expect(authoring.run(value)).rejects.toThrow('synthetic ENOSPC')
    await expect(authoring.run(value)).rejects.toThrow('acceptance-outcome-unknown')
    expect(mutations).not.toHaveBeenCalled()
  })

  it('keeps the execute gate closed after reference-bearing publication fails', async () => {
    let injected = false
    const { authoring, input, mutations, workbench } = await fixture({ writeHook(point, journal) {
      if (!injected && point === 'temporary-synced' && journal.referencePublications && journal.phase === 'running') { injected = true; throw new Error('reference publication failed') }
    } })
    const value = await request(authoring, input), accepted = await authoring.run(value)
    expect(await finished(authoring, value.requestId)).toMatchObject({ outcome: { verdict: 'inconclusive' } })
    expect((await workbench.get(accepted.runId)).steps).toEqual([])
    expect(mutations).not.toHaveBeenCalled()
    expect((await new WorkbenchReferences(workbench.store).list()).some(ref => ref.consumerId === accepted.executionId)).toBe(true)
  })

  it('does not dispatch when shutdown wins immediately after durable acceptance', async () => {
    let shared: WorkbenchAcceptance | undefined
    const { authoring, acceptance, input, mutations, workbench } = await fixture({ writeHook(point, journal) {
      if (point === 'directory-synced' && journal.phase === 'accepted') shared!.stopAccepting()
    } })
    shared = acceptance
    const value = await request(authoring, input)
    await authoring.run(value)
    expect(await authoring.status(value.requestId)).toMatchObject({ phase: 'finished', outcome: { verdict: 'cancelled' } })
    expect(workbench.activeId).toBeNull(); expect(mutations).not.toHaveBeenCalled()
    await expect(authoring.run({ ...value, requestId: 'after-close' })).rejects.toThrow('acceptance-closed')
  })

  it('serves bounded same-origin authoring without changing the old run or validation APIs', async () => {
    const { root, config, mirror, input, mutations } = await fixture()
    const viewer = new ViewerServer(config, { service: mirror, assistant: null, disposeServiceOnClose: false, workbenchRoot: join(root, 'http-runs') })
    cleanups.push(() => viewer.close()); await viewer.listen()
    const post = (path: string, data: unknown, origin = viewer.url, type = 'application/json') => fetch(viewer.url + path, { method: 'POST', headers: { origin, 'content-type': type }, body: JSON.stringify(data) })
    for (const response of [await post('/api/workbench/authoring/validate', input, 'http://evil.test'),
      await post('/api/workbench/authoring/validate', input, viewer.url, 'text/plain'),
      await post('/api/workbench/authoring/validate', { ...input, yaml: 'a'.repeat(81 * 1024) }),
      await post('/api/workbench/authoring/run', { namespace: 'agent' })]) expect(response.ok).toBe(false)
    const response = await post('/api/workbench/authoring/validate', input)
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ valid: true, canRun: true })
    expect((await post('/api/workbench/drafts/validate', { yaml })).status).toBe(200)
    expect(mutations).not.toHaveBeenCalled()
  })
})
