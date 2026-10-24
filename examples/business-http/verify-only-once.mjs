import { performance } from 'node:perf_hooks'
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Trusted GET-only verifier. Register allowedModes: ["once"], never eventually. */
export default async ({ base, id, expectedAmount, owner, windowMs = 2000 }) => {
  const origin = new URL(base)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Trusted plain origin required')
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) || !Number.isSafeInteger(expectedAmount)
    || expectedAmount < 0 || typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(owner)
    || !Number.isInteger(windowMs) || windowMs < 100 || windowMs > 8000) throw new Error('Invalid fixed expectation/window')
  // This endpoint proves one visible record, not the backend's physical write
  // count or unrelated payment/notification side effects.
  const expected = JSON.stringify({ id, owner, amountCents: expectedAmount, quantity: 1, records: 1 })
  const result = (verdict, actual) => ({ verdict, expected, actual, source: 'registered-only-once-query', readAt: new Date().toISOString(), artifactRefs: [] })
  const started = performance.now(); let first, last, samples = 0, actual = 'unknown'
  while (samples < 100 && performance.now() - started < 10000) {
    const before = performance.now()
    if (last !== undefined && before - last > 750) return result('inconclusive', 'sampling-gap')
    try {
      const response = await fetch(origin.origin + '/test/orders/' + id, { redirect: 'error', signal: AbortSignal.timeout(Math.min(500, 10000 - (before - started))) })
      if (!response.ok) return result('inconclusive', 'query-unavailable')
      let size = 0; const chunks = []
      for await (const chunk of response.body ?? []) { size += chunk.byteLength; if (size > 16384) return result('inconclusive', 'query-overflow'); chunks.push(chunk) }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!Array.isArray(value.orders)) return result('inconclusive', 'query-incomplete')
      actual = JSON.stringify(value.orders)
      if (value.orders.length !== 1 || !value.orders.every(order => order.businessKey === id && order.owner === owner && order.amountCents === expectedAmount && order.quantity === 1 && order.status === 'submitted'))
        return result('fail', actual)
    } catch { return result('inconclusive', 'query-failed') }
    const after = performance.now()
    if (after - before > 750 || (last !== undefined && after - last > 750)) return result('inconclusive', 'sampling-gap')
    first ??= after; last = after; samples++
    if (samples >= 2 && after - first >= windowMs) return result('pass', actual)
    await pause(Math.min(100, Math.max(1, windowMs - (after - first))))
  }
  return result('inconclusive', 'observation-budget')
}
