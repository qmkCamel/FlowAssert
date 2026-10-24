import { randomUUID } from 'node:crypto'

const origin = value => {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Use a plain trusted test origin')
  return parsed.origin
}

/** Trusted test worker, not a sandbox. Never retry a write whose outcome is unknown. */
export default async ({ base, namespace }, context) => {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(namespace)) throw new Error('Invalid test namespace')
  const token = process.env.MOBILE_MIRROR_HTTP_TOKEN
  if (!token || /[\r\n]/.test(token)) throw new Error('Missing local test credential')
  const url = origin(base)
  const id = `${namespace}-${randomUUID()}`
  await context.registerCleanup({ base: url, id })
  const response = await fetch(`${url}/test/fixtures/${id}`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-correlation-id': id },
    body: JSON.stringify({ namespace }), signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Fixture prepare HTTP ${response.status}; inspect the scoped resource before retrying`)
  return { id, correlationId: id }
}
