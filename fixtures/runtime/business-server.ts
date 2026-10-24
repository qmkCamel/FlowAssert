import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

/** Loopback-only synthetic backend. Fault modes are host-owned, never HTTP options. */
export async function startRuntimeBusinessFixture(fault: { duplicate?: boolean; delayedDuplicateMs?: number; amount?: number; owner?: string; cleanupFailure?: boolean } = {}) {
  const key = randomUUID(), owner = 'fixture-owner'
  const orders: { businessKey: string; owner: string; amountCents: number; quantity: number; status: string }[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.headers.origin || path !== '/test/orders/' + key) return send(404, { error: 'unknown' })
    if (req.method === 'GET') return send(200, { orders })
    if (req.method === 'DELETE') {
      if (fault.cleanupFailure) return send(500, { deleted: false })
      for (const timer of timers) clearTimeout(timer); timers.clear(); orders.splice(0); return send(200, { deleted: true })
    }
    if (req.method !== 'POST') return send(405, {})
    const value = { businessKey: key, owner: fault.owner ?? owner, amountCents: fault.amount ?? 1200, quantity: 1, status: 'submitted' }
    if (!orders.length || fault.duplicate) orders.push(value)
    if (orders.length === 1 && fault.delayedDuplicateMs !== undefined) {
      const timer = setTimeout(() => { timers.delete(timer); orders.push({ ...value }) }, fault.delayedDuplicateMs)
      timers.add(timer)
    }
    send(200, { submitted: true })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable')
  return { base: 'http://127.0.0.1:' + address.port, key, owner, orders,
    close: async () => { for (const timer of timers) clearTimeout(timer); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); server.closeAllConnections() } }
}
