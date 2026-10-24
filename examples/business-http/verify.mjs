const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** GET-only poll: a timeout/unknown state is inconclusive, never pass. */
export default async ({ base, id, expectedAmount }) => {
  const parsed = new URL(base)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Use a plain trusted test origin')
  const url = parsed.origin
  if (!/^[a-z][a-z0-9-]{0,39}-[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid run-scoped identity')
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0) throw new Error('Invalid expected amount')
  const token = process.env.MOBILE_MIRROR_HTTP_TOKEN
  if (!token || /[\r\n]/.test(token)) throw new Error('Missing local test credential')
  const deadline = Date.now() + 10_000
  for (let attempt = 0; attempt < 8 && Date.now() < deadline; attempt++) {
    let response
    try { response = await fetch(`${url}/test/jobs/${id}`, { headers: { authorization: `Bearer ${token}`, 'x-correlation-id': id }, signal: AbortSignal.timeout(Math.min(2_000, deadline - Date.now())) }) }
    catch { return { verdict: 'inconclusive', expected: String(expectedAmount), actual: 'unknown', source: 'registered-job-query', readAt: new Date().toISOString(), artifactRefs: [] } }
    if (!response.ok) return { verdict: 'inconclusive', expected: String(expectedAmount), actual: `HTTP ${response.status}`, source: 'registered-job-query', readAt: new Date().toISOString(), artifactRefs: [] }
    const chunks = []
    let size = 0
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength
      if (size > 16 * 1024) throw new Error('Business query response exceeds 16 KiB')
      chunks.push(chunk)
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (result.status === 'pending') { await pause(Math.min(250, Math.max(0, deadline - Date.now()))); continue }
    const actual = Number.isSafeInteger(result.amountCents) && result.amountCents >= 0 ? result.amountCents : null
    return { verdict: result.status === 'complete' && actual === expectedAmount ? 'pass' : result.status === 'complete' && actual !== null ? 'fail' : 'inconclusive',
      expected: String(expectedAmount), actual: actual === null ? 'unknown' : String(actual), source: 'registered-job-query', readAt: new Date().toISOString(), artifactRefs: [] }
  }
  return { verdict: 'inconclusive', expected: String(expectedAmount), actual: 'poll-budget-exhausted', source: 'registered-job-query', readAt: new Date().toISOString(), artifactRefs: [] }
}
