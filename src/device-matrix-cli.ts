export async function runMatrixCli(args: readonly string[], io: { stdout: { write(s: string): unknown }; stderr: { write(s: string): unknown } }): Promise<number> {
  try {
    const [action, id] = args, options = new Map<string, string>()
    if (!['validate', 'start', 'status', 'cancel', 'retry'].includes(action ?? '') || !id) throw new Error('matrix-cli-usage')
    for (let i = 2; i < args.length; i += 2) { if (!['--url', '--confirm', '--slot', '--cell'].includes(args[i]!) || !args[i + 1] || options.has(args[i]!)) throw new Error('matrix-cli-option'); options.set(args[i]!, args[i + 1]!) }
    const origin = new URL(options.get('--url') ?? '')
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('matrix-loopback-url-required')
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(new URL(`/api/workbench/matrices${path}`, origin), { headers: { origin: origin.origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error('matrix-request-rejected'); return response.json() as Promise<{ id: string; phase: string; exitCode?: number }>
    }
    const path = action === 'start' ? '' : action === 'validate' ? '/validate' : `/${encodeURIComponent(id)}${action === 'status' ? '' : `/${action}`}`
    const body = action === 'status' ? undefined : action === 'validate' ? { planId: id } : action === 'start' ? { planId: id, confirm: options.get('--confirm'), localEvidence: true } : action === 'retry' ? { cellId: options.get('--cell'), confirm: options.get('--confirm') } : { slotId: options.get('--slot'), confirm: options.get('--confirm') }
    io.stderr.write('Matrix: requesting local operation; other Viewer controls remain available…\n')
    let result = await call(path, body)
    if (action === 'start' || action === 'retry') {
      let cancellation: Promise<unknown> | undefined
      let cancelError = false
      const interrupt = () => { cancellation ??= call(`/${result.id}/cancel`, { confirm: `CANCEL ${result.id}` }).catch(() => { cancelError = true }) }
      process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt)
      try { while (result.phase !== 'finished') { await new Promise(resolve => setTimeout(resolve, 300)); result = await call(`/${result.id}`); if (cancelError) throw new Error('matrix-cancel-unconfirmed') }; await cancellation }
      finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt) }
    }
    io.stdout.write(`${JSON.stringify(result)}\n`); return result.exitCode ?? 0
  } catch { io.stderr.write('Matrix operation failed. Use validate|start|status|cancel|retry <id> --url <explicit loopback URL>, with --confirm for writes and --cell for retry.\n'); return 2 }
}
