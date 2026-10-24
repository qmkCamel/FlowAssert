import { expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runExternalCli } from '../src/workbench-external-cli.js'
import { ViewerServer } from '../src/viewer-server.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
it('CLI imports explicit bytes and HTTP rejects cross-origin, unknown format and authorization without a project', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'external-http-'))), viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0 }), { workbenchRoot: join(root, 'runs') })
  let output = '', error = ''
  const io = { stdout: { write: (s: string) => { output += s } }, stderr: { write: (s: string) => { error += s } } }
  try {
    await viewer.listen(); const report = join(root, 'report.xml'); await writeFile(report, '<testsuite><testcase name="cli"/></testsuite>')
    const args = ['--url', viewer.url, '--report', report, '--adapter', 'junit', '--engine', 'synthetic', '--engine-version', '1']
    expect(await runExternalCli(['import', ...args], io)).toBe(2); expect(error).toContain('--reviewed')
    output = ''; expect(await runExternalCli(['import', ...args, '--reviewed'], io)).toBe(0)
    const job = JSON.parse(output.trim().split('\n').at(-1)!); expect(job.phase).toBe('finished')
    output = ''; expect(await runExternalCli(['show', '--url', viewer.url, '--id', job.assetId], io)).toBe(0)
    expect(JSON.parse(output).summary.boundary).toBe('external-report-not-revalidated')
    expect(viewer.service.state().sessionId).toBeNull()
    expect(await runExternalCli(['show', '--url', 'https://untrusted.invalid', '--id', job.assetId], io)).toBe(2)
    const denied = await fetch(`${viewer.url}/api/workbench/external-assets/preview`, { method: 'POST', headers: { origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, body: '{}' }); expect(denied.status).toBe(400)
    expect((await viewer.application.externalAssets.list()).items).toHaveLength(1)
    expect((await fetch(`${viewer.url}/api/workbench/external-assets/project`)).ok).toBe(false)
    expect((await fetch(`${viewer.url}/api/workbench/external-assets/not-an-id`)).ok).toBe(false)
  } finally { await viewer.close(); await rm(root, { recursive: true, force: true }) }
}, 15_000)
