import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { sha256 } from '../src/content-hash.js'

it('restricts case mutations and binds run provenance to an immutable, exact public revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-cases-http-'))
  const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: root })
  try {
    await viewer.listen(); await viewer.service.start({ provider: 'mock' })
    const yaml = 'name: Case HTTP\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n'
    const request = { requestId: randomUUID(), expectedRevision: null, publicData: true, content: { yaml, publicParams: {}, name: 'Case HTTP', tags: [], platform: 'ios', appId: 'com.example.mobilemirror.mock' } }
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${viewer.url}${path}`, { method: 'POST', headers: { origin: viewer.url, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    expect((await post('/api/workbench/cases', request, { origin: 'https://untrusted.example' })).ok).toBe(false)
    expect((await post('/api/workbench/cases', request, { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await post('/api/workbench/cases', { ...request, path: '/tmp/not-allowed' })).ok).toBe(false)
    expect((await post('/api/workbench/cases', { ...request, publicData: false })).ok).toBe(false)
    const created = await post('/api/workbench/cases', request); expect(created.ok).toBe(true); const saved = await created.json()
    expect(await (await post('/api/workbench/cases', request)).json()).toEqual(saved)
    const revision = await viewer.application.cases.revision(saved.caseId, saved.revisionId)
    const validation = await viewer.application.authoring.validate({ yaml, params: {}, target: { platform: 'ios', appId: request.content.appId, sessionId: viewer.service.state().sessionId } })
    if (!validation.valid) throw new Error('validation failed')
    const execution = { requestId: randomUUID(), localEvidence: true, receipt: validation.receipt.token, inputDigest: validation.receipt.inputDigest,
      caseRevision: { caseId: saved.caseId, revisionId: saved.revisionId, inputDigest: revision.contentDigest } }
    expect((await post('/api/workbench/authoring/run', { ...execution, caseRevision: { ...execution.caseRevision, inputDigest: '0'.repeat(64) } })).status).toBe(409)
    expect(viewer.workbench.activeId).toBe(null)
    const accepted = await (await post('/api/workbench/authoring/run', execution)).json()
    await expect.poll(async () => (await viewer.application.authoring.status(execution.requestId)).phase).toBe('finished')
    const manifest = await readFile(join(root, accepted.runId, 'manifest.json'))
    expect(JSON.parse(manifest.toString()).authoringOrigin).toEqual(execution.caseRevision)
    const archive = { requestId: randomUUID(), expectedRevision: saved.revisionId, archived: true }
    expect((await post(`/api/workbench/cases/${saved.caseId}/archive`, archive)).ok).toBe(true)
    expect((await post(`/api/workbench/cases/${saved.caseId}/revisions`, { ...request, requestId: randomUUID(), expectedRevision: saved.revisionId })).status).toBe(409)
    expect((await (await post('/api/workbench/authoring/run', execution)).json()).executionId).toBe(accepted.executionId)
    expect(await readFile(join(root, accepted.runId, 'manifest.json'))).toEqual(manifest)
    const history = await (await fetch(`${viewer.url}/api/workbench/history?query=${saved.caseId}`)).json()
    expect(history.runs).toHaveLength(1); expect(history.runs[0].authoringOrigin).toEqual(execution.caseRevision)
    expect(history.runs[0].paramsDigest).toBe(sha256('{}'))
    expect((await viewer.application.retention.snapshot()).runs.map(run => run.id)).toEqual([accepted.runId])
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
})
