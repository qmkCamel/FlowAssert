/** Delete only the resource registered by this execution. No list/bulk delete. */
export default async ({ base, id }) => {
  const parsed = new URL(base)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Use a plain trusted test origin')
  const url = parsed.origin
  if (!/^[a-z][a-z0-9-]{0,39}-[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid run-scoped identity')
  const token = process.env.MOBILE_MIRROR_HTTP_TOKEN
  if (!token || /[\r\n]/.test(token)) throw new Error('Missing local test credential')
  const headers = { authorization: `Bearer ${token}`, 'x-correlation-id': id }
  const removed = await fetch(`${url}/test/fixtures/${id}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5_000) })
  if (!removed.ok && removed.status !== 404) throw new Error(`Scoped cleanup HTTP ${removed.status}`)
  const check = await fetch(`${url}/test/fixtures/${id}`, { headers, signal: AbortSignal.timeout(5_000) })
  if (check.status !== 404) throw new Error('Scoped resource remains after cleanup')
  return { deleted: true }
}
