import { createFixture } from './web-synthetic-fixture.js'
import { webBuildIdentity } from './workbench-web-runtime.js'
import { z } from 'zod'

let fixture: Awaited<ReturnType<typeof createFixture>> | undefined, closing = false
async function close() { if (closing) return; closing = true; await fixture?.close(); process.disconnect?.() }
const input = z.object({ requestId: z.string().uuid(), command: z.enum(['start','configure','restoreEvidence','holdSlow','releaseSlow','requests','close']), root: z.string().optional(), fault: z.enum(['none','covered-play','shifted-marker','hidden-retry','narrow-overflow']).optional(), scenario: z.string().optional() }).strict()
let queue = Promise.resolve()
process.on('message', message => { queue = queue.then(async () => {
  const parsed = input.safeParse(message); if (!parsed.success || closing) return
  const item = parsed.data
  try {
    let value: unknown = null
    if (item.command === 'start') {
      if (fixture || !item.root || process.env.MOBILE_MIRROR_WEB_CHILD !== '1') throw new Error('Invalid synthetic child owner')
      fixture = await createFixture(item.root)
      value = { origin: fixture.origin, id: fixture.id, expectedMarker: fixture.expectedMarker, pid: process.pid, buildSha256: await webBuildIdentity() }
    } else if (!fixture) throw new Error('Fixture not started')
    else if (item.command === 'configure') fixture.configure(item.fault ?? 'none', item.scenario === 'VA-05', item.scenario)
    else if (item.command === 'requests') value = fixture.requests
    else if (item.command === 'close') { await close(); return }
    else fixture[item.command]()
    process.send?.({ requestId: item.requestId, value })
  } catch (error) { process.send?.({ requestId: item.requestId, error: String(error) }) }
}) })
process.once('disconnect', () => { void close() })
process.once('SIGTERM', () => { void close() })
