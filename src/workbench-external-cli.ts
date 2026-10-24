import { randomUUID } from 'node:crypto'
import { extname, basename } from 'node:path'
import { readExternalFile } from './workbench-external-files.js'
import { externalLimits, type ExternalJob } from './workbench-external-contracts.js'
import { acceptanceId } from './workbench-change-contracts.js'
export async function runExternalCli(args: readonly string[], io: { stdout: { write(value: string): unknown }; stderr: { write(value: string): unknown } }): Promise<number> {
  let jobId: string | undefined, interrupted = false
  const interrupt = () => { interrupted = true }
  process.on('SIGINT', interrupt)
  try {
    const action = args[0], options: Record<string, string> = {}, files: string[] = []; let reviewed = false
    if (!['preview', 'import', 'show', 'grant', 'revoke'].includes(action ?? '')) throw new Error('Usage: test external-results preview|import|show|grant|revoke --url <loopback> [--report file --adapter junit --engine name --engine-version version --attachment file --mapping json --reviewed] [--id uuid]')
    for (let n = 1; n < args.length; n++) { const flag = args[n]!
      if (flag === '--reviewed') { reviewed = true; continue }
      if (!['--url', '--report', '--adapter', '--engine', '--engine-version', '--attachment', '--mapping', '--id', '--request-key'].includes(flag) || !args[n + 1]) throw new Error('Invalid external-results option')
      if (flag === '--attachment') files.push(args[++n]!); else { if (options[flag]) throw new Error('Duplicate option'); options[flag] = args[++n]! }
    }
    const origin = new URL(options['--url'] ?? '')
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Explicit loopback Viewer URL required')
    const call = async (path: string, value?: unknown) => {
      const response = await fetch(new URL(`/api/workbench/external-assets${path}`, origin), { redirect: 'error', headers: { origin: origin.origin, 'content-type': 'application/json' }, ...(value === undefined ? {} : { method: 'POST', body: JSON.stringify(value) }), signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`External result request failed: HTTP ${response.status}`)
      return response.json()
    }
    if (action === 'show') { const result = await call(`/${acceptanceId.parse(options['--id'])}`); io.stdout.write(`${JSON.stringify(result)}\n`); return result.availability === 'verified' ? 0 : 2 }
    if (action === 'grant' || action === 'revoke') {
      if (!reviewed) throw new Error('Explicit --reviewed required for authorization changes')
      const id = acceptanceId.parse(options['--id']), project = await call('/project')
      io.stdout.write(`${JSON.stringify(await call(`/${id}/grant`, { project, granted: action === 'grant', confirm: `${action === 'grant' ? 'GRANT' : 'REVOKE'} ${id}` }))}\n`); return 0
    }
    if (!options['--report'] || !options['--adapter'] || !options['--engine'] || !options['--engine-version']) throw new Error('Explicit report, adapter, engine and engine version required')
    if (files.length > 32) throw new Error('Attachment count exceeded')
    const mapping = options['--mapping'] ? JSON.parse((await readExternalFile(options['--mapping'], 1024 * 1024)).toString('utf8')) as { declaration?: unknown; bindings?: unknown; attachments?: Array<{ contentType?: string; testId?: string }> } : {}
    if (Object.keys(mapping).some(key => !['declaration', 'bindings', 'attachments'].includes(key))) throw new Error('Invalid mapping')
    let total = 0
    const attachments = []
    for (const [i, path] of files.entries()) {
      const bytes = await readExternalFile(path, externalLimits.attachment); total += bytes.length
      if (total > externalLimits.total) throw new Error('Attachment budget exceeded')
      const inferred = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain', '.json': 'application/json', '.xml': 'application/xml' } as Record<string, string>)[extname(path).toLowerCase()]
      attachments.push({ label: basename(path), contentType: mapping.attachments?.[i]?.contentType ?? inferred, bytes: bytes.toString('base64'), ...(mapping.attachments?.[i]?.testId ? { testId: mapping.attachments[i]!.testId } : {}) })
    }
    if (interrupted) return 130
    let job = await call('/preview', { contractVersion: 1, requestKey: options['--request-key'] ?? randomUUID(), adapter: options['--adapter'], engine: options['--engine'], engineVersion: options['--engine-version'], report: (await readExternalFile(options['--report'], externalLimits.report)).toString('base64'), attachments, declaration: mapping.declaration ?? {}, bindings: mapping.bindings ?? [] }) as ExternalJob
    jobId = job.id
    while (!['preview', 'finished', 'failed', 'cancelled', 'interrupted'].includes(job.phase)) {
      if (interrupted) { await call(`/jobs/${jobId}/cancel`, {}); return 130 }
      await new Promise(resolve => setTimeout(resolve, 100)); job = await call(`/jobs/${jobId}`)
    }
    io.stdout.write(`${JSON.stringify(job)}\n`)
    if (interrupted) { await call(`/jobs/${jobId}/cancel`, {}); return 130 }
    if (job.phase === 'finished') return 0
    if (job.phase !== 'preview') return 2
    if (action === 'preview' || !reviewed) {
      await call(`/jobs/${jobId}/cancel`, {})
      if (action === 'import') throw new Error('Import requires explicit --reviewed; preview cancelled')
      return 0
    }
    job = await call(`/jobs/${jobId}/confirm`, { previewDigest: job.previewDigest, reviewed: true })
    io.stdout.write(`${JSON.stringify(job)}\n`)
    return job.phase === 'finished' ? 0 : 2 // Successful import is not a successful test verdict.
  } catch (error) { io.stderr.write(`${error instanceof Error ? error.message : 'External result failed'}\n`); return interrupted ? 130 : 2 }
  finally { process.removeListener('SIGINT', interrupt) }
}
