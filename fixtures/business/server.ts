import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Synthetic test data only. No production integrations or payment operations. */
export async function startFixtureServer(options: { database: string; host?: string; port?: number; submissionDelayMs?: number }) {
  const delay = options.submissionDelayMs ?? 0
  if (!Number.isInteger(delay) || delay < 0 || delay > 20_000) throw new Error('Submission delay must be 0–20000 ms')
  mkdirSync(dirname(resolve(options.database)), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(options.database)
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS fixtures (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS orders (
      fixtureId TEXT PRIMARY KEY REFERENCES fixtures(id) ON DELETE CASCADE,
      id TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL,
      amountCents INTEGER NOT NULL, status TEXT NOT NULL);`)
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    try {
      // Native clients and registered extensions do not send Origin. Reject browser writes/reads.
      if (req.headers.origin) return send(403, { error: 'Browser origins forbidden' })
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      if (req.method === 'GET' && path === '/health') return send(200, { service: 'mobile-mirror-fixture' })
      const match = /^\/(test\/fixtures|app\/orders|test\/orders)\/([a-f0-9-]{36})$/.exec(path)
      if (!match || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(match[2]!)) return send(404, { error: 'Unknown fixture route' })
      const [, route, id] = match
      if (req.method === 'PUT' || req.method === 'POST') {
        if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON required' })
        let body = ''
        for await (const chunk of req) {
          body += chunk.toString()
          if (Buffer.byteLength(body) > 4096) return send(413, { error: 'Body too large' })
        }
        const value = JSON.parse(body)
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) return send(400, { error: 'Expected empty object' })
      }
      if (route === 'test/fixtures' && req.method === 'PUT') {
        db.prepare('INSERT OR IGNORE INTO fixtures(id) VALUES (?)').run(id!)
        return send(200, { id })
      }
      if (route === 'test/fixtures' && req.method === 'DELETE') {
        db.prepare('DELETE FROM fixtures WHERE id = ?').run(id!)
        return send(200, { deleted: true })
      }
      if (route === 'app/orders' && req.method === 'POST') {
        // In-process test option only; never controlled by HTTP callers.
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        if (!db.prepare('SELECT id FROM fixtures WHERE id = ?').get(id!)) return send(404, { error: 'Fixture missing' })
        db.prepare("INSERT OR IGNORE INTO orders VALUES (?, ?, 'fixture-item', 1, 1200, 'submitted')").run(id!, `order-${id}`)
        return send(200, { submitted: true })
      }
      if (route === 'test/orders' && req.method === 'GET') {
        const order = db.prepare('SELECT * FROM orders WHERE fixtureId = ?').get(id!)
        return order ? send(200, order) : send(404, { error: 'Order missing' })
      }
      if (route === 'test/fixtures' && req.method === 'GET') {
        const fixture = db.prepare('SELECT id FROM fixtures WHERE id = ?').get(id!)
        return fixture ? send(200, fixture) : send(404, { error: 'Fixture missing' })
      }
      send(405, { error: 'Method not allowed' })
    } catch (error) {
      send(error instanceof SyntaxError ? 400 : 500, { error: error instanceof SyntaxError ? 'Invalid JSON' : 'Fixture service error' })
    }
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  try {
    await new Promise<void>((yes, no) => { server.once('error', no); server.listen(options.port ?? 47831, options.host ?? '127.0.0.1', yes) })
  } catch (error) { db.close(); throw error }
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  return { port: address.port, close: () => new Promise<void>((yes, no) => {
    server.close(error => { db.close(); error ? no(error) : yes() }); server.closeIdleConnections()
  }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = await startFixtureServer({
    database: process.env.FIXTURE_DATABASE ?? 'artifacts/fixture/orders.sqlite',
    host: process.env.FIXTURE_HOST ?? '127.0.0.1',
    port: Number(process.env.FIXTURE_PORT ?? 47831),
  })
  console.log(`Fixture server listening on ${process.env.FIXTURE_HOST ?? '127.0.0.1'}:${service.port}`)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void service.close().then(() => process.exit(0)) })
}
