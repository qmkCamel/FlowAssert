import { createServer } from 'node:http'
import { test, expect } from 'vitest'
import { AppiumProvider } from '../src/providers/appium-provider.js'
import { normalizeScreenSource } from '../src/screen-source-normalizer.js'

test('recognizes XCTest search fields without inventing focus', () => {
  const node = normalizeScreenSource('<AppiumAUT><XCUIElementTypeSearchField visible="true" enabled="true"/></AppiumAUT>', 'ios').nodes[0]!
  expect(node.role).toBe('input')
  expect(node.focused).toBeUndefined()
})

for (const scenario of ['stable', 'changed-id', 'moved', 'duplicate', 'missing', 'type-mismatch', 'secure', 'text-view'] as const) {
  test(`iOS focus requires a stable unique typed target: ${scenario}`, async () => {
    let reads = 0
    const kind = scenario === 'text-view' ? 'XCUIElementTypeTextView' : scenario === 'secure' ? 'XCUIElementTypeSecureTextField' : 'XCUIElementTypeSearchField'
    const node = `<${kind} name="field" value="PRIVATE_TEST_VALUE" focused="true" visible="true" enabled="true" x="10" y="20" width="100" height="40"/>`
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      let value: unknown = null
      if (req.url === '/status') value = { ready: true }
      else if (req.url === '/session' && req.method === 'POST') value = { sessionId: 'focus-session', capabilities: { platformName: 'iOS' } }
      else if (req.url?.endsWith('/element/active')) {
        reads++
        if (scenario === 'missing') { res.statusCode = 404; value = { error: 'no such element' } }
        else value = { 'element-6066-11e4-a52e-4f735466cecf': scenario === 'changed-id' && reads > 1 ? 'second' : 'first' }
      } else if (req.url?.endsWith('/name')) value = scenario === 'type-mismatch' ? 'XCUIElementTypeTextField' : kind
      else if (req.url?.endsWith('/rect')) value = { x: scenario === 'moved' && reads > 1 ? 60 : 10.25, y: 20, width: 100, height: 40 }
      else if (req.url?.endsWith('/source')) value = `<AppiumAUT>${scenario === 'text-view' ? '<XCUIElementTypeOther x="10" y="20" width="100" height="40"/>' : ''}${node}${scenario === 'duplicate' ? node : ''}</AppiumAUT>`
      res.end(JSON.stringify({ value }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const address = server.address() as { port: number }
    const provider = new AppiumProvider(`http://127.0.0.1:${address.port}`)
    try {
      await provider.start({ provider: 'appium', capabilities: { platformName: 'iOS' } }, AbortSignal.timeout(2000))
      const raw = await provider.screenSource(AbortSignal.timeout(2000))
      expect(raw.kind).toBe('xml')
      expect(raw.structure).toBeUndefined()
      expect(reads).toBe(0)
      const result = await provider.screenSource(AbortSignal.timeout(2000), { resolveFocus: true })
      expect(result.kind).toBe('xml')
      if (!result.structure) throw new Error('Expected normalized source')
      expect(result.structure.nodes.filter((n) => n.focused).length).toBe(['stable', 'secure', 'text-view'].includes(scenario) ? 1 : 0)
      if (scenario === 'secure') {
        expect(result.structure.nodes[0]?.sensitive).toBe(true)
        expect(JSON.stringify(result.structure)).not.toContain('PRIVATE_TEST_VALUE')
      }
      expect(JSON.stringify(result)).not.toContain('focus-session')
    } finally {
      await provider.stop(AbortSignal.timeout(2000))
      await new Promise<void>((r, j) => server.close(e => e ? j(e) : r()))
    }
  })
}
