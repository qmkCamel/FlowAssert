import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFixture } from './fixture.js'

it('serves fresh synthetic history and rejects all browser mutation paths without phone actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'visual-read-only-'))
  const fixture = await createFixture(root)
  try {
    for (const path of ['/api/runs', '/api/start', '/api/action', '/api/workbench/baselines/approve']) {
      const response = await fetch(`${fixture.origin}${path}`, { method: 'POST', body: '{}' })
      expect(response.status).toBe(403)
    }
    expect((await fetch(`${fixture.origin}/api/frame?cached=1`)).status).toBe(204)
    expect((await fetch(`${fixture.origin}/api/runs`)).status).toBe(200)
    const response = await fetch(`${fixture.origin}/`)
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'")
    expect(await response.text()).toContain('FlowAssert')
    fixture.configure('hidden-retry', true)
    expect(await (await fetch(`${fixture.origin}/styles.css`)).text()).toContain('display:none!important')
    expect((await fetch(`${fixture.origin}/api/runs/${fixture.id}/artifacts/step-3-action-1-before.png`)).status).toBe(503)
    fixture.restoreEvidence()
    expect((await fetch(`${fixture.origin}/api/runs/${fixture.id}/artifacts/step-3-action-1-before.png`)).status).toBe(200)
  } finally { await fixture.close(); await rm(root, { recursive: true, force: true }) }
}, 20000)
