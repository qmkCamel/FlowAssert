import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ViewerServer } from './viewer-server.js'
import { resolveMirrorConfig } from './mcp-config.js'

export type Fault = 'none' | 'covered-play' | 'shifted-marker' | 'hidden-retry' | 'narrow-overflow'

/** Fresh synthetic history only. Never accepts an upstream URL or an archive path. */
export async function createFixture(root: string) {
  await mkdir(root, { recursive: true })
  const viewer = new ViewerServer(resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0 }), { workbenchRoot: resolve(root), webTests: false })
  let fault: Fault = 'none', missing = false
  let scenario = '', releaseSlow: (() => void) | undefined, slow: Promise<void> | undefined
  const requests: { method: string; path: string; status: number }[] = []
  try {
    await viewer.listen()
    await viewer.service.start({ provider: 'mock' })
    const run = await viewer.workbench.start(`name: Synthetic Viewer evidence\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible:\n    text: Hello, harness.\n- tap:\n    accessibilityId: action-card\n- assertVisible:\n    text: 1 actions received\n- done\n`)
    await viewer.workbench.wait()
    const frozen = await viewer.workbench.get(run.id)
    // Freeze synthetic presentation time/duration; run identity remains unique in the manifest and URL.
    frozen.startedAt = '2026-01-01T00:00:00.000Z'; frozen.endedAt = '2026-01-01T00:00:01.000Z'
    for (const step of frozen.steps) { step.startedAt = frozen.startedAt; step.endedAt = frozen.endedAt; step.executionMs = 20
      for (const action of step.actionEvidence?.actions ?? []) action.capturedAt = frozen.startedAt }
    await viewer.workbench.store.save(frozen)
    await viewer.service.stop()
    const action = frozen.steps.find(step => step.index === 3)?.actionEvidence?.actions[0]
    if (!action?.points[0]) throw new Error('Synthetic action evidence missing')
    const expectedMarker = { x: (action.points[0].x - action.viewport.x) / action.viewport.width, y: (action.points[0].y - action.viewport.y) / action.viewport.height }
    let origin = ''
    const server = createServer(async (req, res) => {
      const path = req.url ?? '/', method = req.method ?? 'UNKNOWN'
      const reply = (status: number, body: string | Buffer, type = 'text/plain') => {
        requests.push({ method, path, status })
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" }); res.end(body)
      }
      try {
        if (req.headers.host !== new URL(origin).host || !path.startsWith('/') || path.startsWith('//')) return reply(403, 'Origin rejected')
        if (method !== 'GET') return reply(403, 'Read-only synthetic target: writes rejected')
        const parsed = new URL(path, origin)
        // Viewer asks for a cached device frame during startup; never forward this to a provider.
        if (parsed.pathname === '/api/frame') return reply(204, '')
        if (parsed.pathname.startsWith('/api/') && !(/^\/api\/runs(?:\/|$)/.test(parsed.pathname) || ['/api/state', '/api/workbench/history', '/api/workbench/capabilities', '/api/workbench/acceptance/capabilities'].includes(parsed.pathname))) return reply(403, 'Read API not in fixture allowlist')
        if (missing && parsed.pathname.endsWith('-before.png')) return reply(503, 'Synthetic evidence temporarily unavailable')
        if (slow && parsed.pathname.endsWith('/step-2.png')) await slow
        const upstream = await fetch(`${viewer.url}${path}`, { redirect: 'error', signal: AbortSignal.timeout(10000) })
        let bytes = Buffer.from(await upstream.arrayBuffer())
        if (scenario === 'VA-03' && parsed.pathname === `/api/runs/${run.id}`) {
          const body = JSON.parse(bytes.toString()); body.steps[3].status = 'failed'; body.steps[3].error = 'Synthetic assertion failure'
          body.steps[3].verification = { ...body.steps[3].verification, status: 'fail', message: 'Synthetic assertion failure' }
          body.verdict = 'fail'; delete body.resultProjection
          bytes = Buffer.from(JSON.stringify(body))
        }
        if (parsed.pathname === '/styles.css') {
          const css = fault === 'covered-play' ? '#playback-toggle{position:relative} #playback-toggle::after{content:"";position:absolute;inset:-4px;background:#111827;z-index:1000}'
            : fault === 'shifted-marker' ? '.action-image-plane svg{transform:translate(45%,25%)}'
              : fault === 'hidden-retry' ? '.action-comparison button{display:none!important}'
                : fault === 'narrow-overflow' ? '#journey{min-width:1100px!important}' : ''
          bytes = Buffer.concat([bytes, Buffer.from(`\n/* synthetic test mutation */\n${css}`)])
        }
        reply(upstream.status, bytes, upstream.headers.get('content-type') ?? 'application/octet-stream')
      } catch (error) { reply(502, String(error)) }
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port')
    origin = `http://127.0.0.1:${address.port}`
    return { origin, id: run.id, expectedMarker, requests, root,
      configure(next: Fault, unavailable = false, scene = '') { fault = next; missing = unavailable; scenario = scene; releaseSlow?.(); slow = undefined },
      holdSlow() { slow = new Promise<void>(done => { releaseSlow = done }) },
      releaseSlow() { releaseSlow?.(); slow = undefined },
      restoreEvidence() { missing = false },
      async close() { releaseSlow?.(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await viewer.close() },
    }
  } catch (error) { await viewer.close(); throw error }
}
