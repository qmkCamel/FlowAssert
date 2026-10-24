import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { runAcceptanceCli } from '../src/workbench-change-cli.js'
import { seedAcceptance } from './fixtures/acceptance-fixture.js'

it('CLI and HTTP share results, require loopback/confirmation, and do not control a device', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acceptance-http-')), viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0 }), { workbenchRoot: join(root, 'runs') })
  let out = '', error = ''
  const io = { stdout: { write: (value: string) => { out += value } }, stderr: { write: (value: string) => { error += value } } }
  try {
    await viewer.listen()
    const { input } = await seedAcceptance(viewer.workbench.store), file = join(root, 'input.json'), id = randomUUID()
    await writeFile(file, JSON.stringify(input))
    expect(await runAcceptanceCli(['preview', '--file', file, '--url', 'https://example.invalid'], io)).toBe(2)
    expect(error).toContain('loopback'); error = ''; out = ''
    expect(await runAcceptanceCli(['preview', '--file', file, '--url', viewer.url], io)).toBe(0)
    expect(JSON.parse(out).summary.status).toBe('pass'); out = ''
    expect(await runAcceptanceCli(['publish', '--file', file, '--url', viewer.url], io)).toBe(2)
    expect(error).toContain('--reviewed'); error = ''; out = ''
    expect(await runAcceptanceCli(['publish', '--file', file, '--url', viewer.url, '--reviewed', '--id', id], io)).toBe(0)
    expect(out).toContain('"revision":1')
    out = ''
    expect(await runAcceptanceCli(['export', '--id', id, '--format', 'markdown', '--url', viewer.url], io)).toBe(0)
    expect(out).toContain('Result: pass')
    expect(viewer.service.state().sessionId).toBeNull()
    const denied = await fetch(`${viewer.url}/api/workbench/acceptance-records/preview`, { method: 'POST', headers: { origin: 'https://bad.invalid', 'content-type': 'application/json' }, body: JSON.stringify(input) })
    expect(denied.ok).toBe(false)
    const post = (path: string, body: string) => fetch(`${viewer.url}/api/workbench/acceptance-records${path}`, { method: 'POST', headers: { origin: viewer.url, 'content-type': 'application/json' }, body })
    expect((await post('/preview', JSON.stringify({ ...input, extra: true }))).ok).toBe(false)
    expect((await post('/preview', ' '.repeat(1024 * 1024 + 1))).ok).toBe(false)
    expect((await post(`/jobs/${randomUUID()}/cancel`, '{"extra":true}')).ok).toBe(false)
    expect((await fetch(`${viewer.url}/api/workbench/acceptance-records/not-a-uuid`)).ok).toBe(false)
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
}, 15_000)
