import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { acceptanceId, acceptancePublishSchema } from './workbench-change-contracts.js'
import type { AcceptanceJob } from './workbench-change-acceptance.js'

export async function runAcceptanceCli(args: readonly string[], io: { stdout: { write(s: string): unknown }; stderr: { write(s: string): unknown } }): Promise<number> {
  let interrupted = false, jobId: string | undefined
  const controller = new AbortController()
  let cancellation: Promise<unknown> | undefined
  let interrupt = () => { interrupted = true; controller.abort() }
  const onInterrupt = () => interrupt()
  try {
    const action = args[0]
    if (!['preview', 'publish', 'show', 'export'].includes(action ?? '')) throw new Error('Usage: test acceptance preview|publish --file <json> --url <loopback> [--reviewed], or show|export --id <uuid> --url <loopback> [--revision N] [--format json|markdown]')
    const options: Record<string, string> = {}; let reviewed = false
    for (let index = 1; index < args.length; index++) {
      const flag = args[index]!
      if (flag === '--reviewed') { reviewed = true; continue }
      if (!['--url', '--file', '--id', '--revision', '--format', '--request-key'].includes(flag) || !args[index + 1] || options[flag] !== undefined) throw new Error('Invalid acceptance option')
      options[flag] = args[++index]!
    }
    const base = new URL(options['--url'] ?? '')
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('An explicit loopback Viewer URL is required')
    const call = async (path: string, body?: unknown, abortable = true) => {
      const response = await fetch(new URL(path, base), { redirect: 'error', headers: { origin: base.origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal: abortable ? AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`Acceptance request failed: HTTP ${response.status}`)
      return response
    }
    process.on('SIGINT', onInterrupt)
    if (action === 'show' || action === 'export') {
      const id = acceptanceId.parse(options['--id']), revision = Number(options['--revision'] ?? '1')
      if (!Number.isSafeInteger(revision) || revision < 1 || revision > 100) throw new Error('Invalid revision')
      const format = options['--format'] ?? 'json'
      if (!['json', 'markdown'].includes(format)) throw new Error('Invalid format')
      const result = await (await call(`/api/workbench/acceptance-records/${id}${options['--revision'] ? `?revision=${revision}` : ''}`)).json() as { revision: number; current: { exitCode: number }; input?: unknown }
      if (action === 'export') io.stdout.write(await (await call(`/api/workbench/acceptance-records/${id}/revisions/${result.revision}/export?format=${format}`)).text())
      else { delete result.input; io.stdout.write(`${JSON.stringify(result)}\n`) }
      return result.current.exitCode
    }
    if (!options['--file']) throw new Error('An explicit JSON file is required')
    const handle = await open(options['--file'], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let input: unknown
    try { const stat = await handle.stat(); if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid acceptance input file'); input = JSON.parse(await handle.readFile('utf8')) }
    finally { await handle.close() }
    const preview = await (await call('/api/workbench/acceptance-records/preview', input)).json() as { previewId: string; previewDigest: string; summary: { exitCode: number } }
    io.stdout.write(`${JSON.stringify(preview)}\n`)
    if (action === 'preview') return preview.summary.exitCode
    if (!reviewed) throw new Error('Publish requires explicit --reviewed')
    const id = options['--id'] ?? randomUUID(), request = acceptancePublishSchema.parse({ id, expectedRevision: Number(options['--revision'] ?? 0), previewId: preview.previewId,
      previewDigest: preview.previewDigest, requestKey: options['--request-key'] ?? randomUUID(), reviewed: true })
    // A request may already be durably accepted when SIGINT arrives: keep its response
    // readable, then cancel by the known idempotency key rather than losing ownership.
    interrupt = () => { interrupted = true }
    let job = await (await call('/api/workbench/acceptance-records', request, false)).json() as AcceptanceJob
    jobId = job.jobId
    interrupt = () => { interrupted = true; cancellation ??= call(`/api/workbench/acceptance-records/jobs/${jobId}/cancel`, {}, false).catch(() => io.stderr.write('Cancellation could not be confirmed; inspect the job explicitly.\n')) }
    if (interrupted) interrupt()
    io.stdout.write(`${JSON.stringify(job)}\n`)
    while (!['finished', 'cancelled', 'failed', 'interrupted'].includes(job.phase)) {
      await new Promise(resolve => setTimeout(resolve, 250))
      job = await (await call(`/api/workbench/acceptance-records/jobs/${jobId}`, undefined, false)).json() as AcceptanceJob
    }
    await cancellation
    if (job.phase !== 'finished') { io.stdout.write(`${JSON.stringify(job)}\n`); return job.phase === 'cancelled' || interrupted ? 130 : 2 }
    const result = await (await call(`/api/workbench/acceptance-records/${id}?revision=${job.revision}`, undefined, false)).json() as { input?: unknown; current: { exitCode: number } }
    delete result.input; io.stdout.write(`${JSON.stringify(result)}\n`)
    return result.current.exitCode
  } catch (error) { io.stderr.write(`${error instanceof Error ? error.message : 'Acceptance command failed'}\n`); return interrupted ? 130 : 2 }
  finally { process.removeListener('SIGINT', onInterrupt) }
}
