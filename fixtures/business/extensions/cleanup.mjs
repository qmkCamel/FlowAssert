export default async ({ base, id }) => {
  const url = `${base}/test/fixtures/${id}`
  const response = await fetch(url, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Fixture cleanup HTTP ${response.status}`)
  for (const route of ['fixtures', 'orders']) {
    const check = await fetch(`${base}/test/${route}/${id}`, { signal: AbortSignal.timeout(5000) })
    if (check.status !== 404) throw new Error('Fixture data remains after cleanup')
  }
  return { deleted: true }
}
