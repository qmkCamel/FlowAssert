import { randomUUID } from 'node:crypto'
export default async ({ base }, ctx) => {
  const id = randomUUID()
  await ctx.registerCleanup({ base, id })
  const response = await fetch(`${base}/test/fixtures/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Fixture prepare HTTP ${response.status}`)
  return { id }
}
