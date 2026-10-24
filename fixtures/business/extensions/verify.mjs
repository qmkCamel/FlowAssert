export default async ({ base, id, expectedAmount }) => {
  const source = `${base}/test/orders/${id}`
  const response = await fetch(source, { signal: AbortSignal.timeout(5000) })
  if (!response.ok && response.status !== 404) throw new Error(`Fixture query HTTP ${response.status}`)
  const actual = response.status === 404 ? { missing: true } : await response.json()
  const expected = { fixtureId: id, id: `order-${id}`, sku: 'fixture-item', quantity: 1, amountCents: expectedAmount, status: 'submitted' }
  const pass = Object.entries(expected).every(([key, value]) => actual[key] === value)
  return { verdict: pass ? 'pass' : 'fail', expected: JSON.stringify(expected), actual: JSON.stringify(actual), source, readAt: new Date().toISOString(), artifactRefs: [] }
}
