import { afterEach, expect, test, vi } from 'vitest'
import { ViewerServer } from '../src/viewer-server.js'
import { MirrorService } from '../src/mirror-service.js'
import { MockProvider } from '../src/providers/mock-provider.js'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { abortableDelay } from '../src/abort.js'
const viewers: ViewerServer[] = []
afterEach(async () => { for (const v of viewers.splice(0)) await v.close() })
async function setup(provider = new MockProvider(0), startupTimeoutMs = 2000) {
  const config = resolveMirrorConfig({ viewerPort: 0, mockStartupDelayMs: 0, startupTimeoutMs })
  const service = new MirrorService(config, 'http://127.0.0.1', { providerFactory: () => provider })
  const viewer = new ViewerServer(config, { service, assistant: null, disposeServiceOnClose: true }); viewers.push(viewer)
  await viewer.listen(); await service.start({ provider: 'mock' }); return { viewer, service }
}
const post = (v: ViewerServer, body = '{}', origin = v.url, type = 'application/json', signal?: AbortSignal) => fetch(v.url + '/api/inspection/capture', { method: 'POST', headers: { origin, 'content-type': type }, body, ...(signal ? { signal } : {}) })
test('Origin, JSON, request size and fixed browser route are enforced before provider calls', async () => {
  const provider = new MockProvider(0), snapshot = vi.spyOn(provider, 'snapshot'), { viewer } = await setup(provider)
  for (const [body, origin, type, status] of [['{}','null','application/json',403], ['{}','http://evil.test','application/json',403], ['{}',viewer.url,'text/plain',400], ['{"extra":1}',viewer.url,'application/json',400], [' '.repeat(1025),viewer.url,'application/json',400], ['',viewer.url,'application/json',400]] as const) {
    const response = await post(viewer, body, origin, type); expect(response.status).toBe(status); expect(Object.keys(await response.json()).sort()).toEqual(['code','message'])
  }
  expect(snapshot).not.toHaveBeenCalled()
  const asset = await fetch(viewer.url + '/inspection-query.js'); expect(asset.status).toBe(200); expect(await asset.text()).not.toMatch(/node:|@deepseek|@modelcontextprotocol/)
  expect((await fetch(viewer.url + '/lib/index.js')).status).toBe(404)
  const response = await post(viewer); expect(response.status).toBe(200); const data = await response.json(); expect(data.inspectionId).toBeTruthy(); expect(data.observationId).toBeUndefined(); expect(data.image.base64.length).toBeGreaterThan(100)
})
test('response-close abort reaches source after complete body and releases busy gate', async () => {
  let slow = true, aborted = false, entered = false
  class Slow extends MockProvider { override async screenSource(signal?: AbortSignal) { if (slow) { entered = true; try { await abortableDelay(1000, signal!) } catch(e) { aborted = signal!.aborted; throw e } } return super.screenSource() } }
  const { viewer } = await setup(new Slow(0)), controller = new AbortController()
  const request = post(viewer, '{}', viewer.url, 'application/json', controller.signal).catch(() => null)
  await vi.waitFor(() => expect(entered).toBe(true))
  expect((await post(viewer)).status).toBe(409)
  controller.abort(); await request; await vi.waitFor(() => expect(aborted).toBe(true))
  slow = false; expect((await post(viewer)).status).toBe(200)
})
test('geometry changes and PNG pixel limits fail closed and next capture recovers', async () => {
  class Bad extends MockProvider {
    changed = true; count = 0; big = false
    override async screenGeometry(signal?: AbortSignal) { const g = await super.screenGeometry(); return { ...g, viewport: { ...g.viewport, x: this.changed ? this.count++ : 0 } } }
    override async snapshot(signal?: AbortSignal) { const image = await super.snapshot(); if(this.big) { const b=Buffer.from(image.bytes); b.writeUInt32BE(17000,16); image.bytes=b; image.width=17000 } return image }
  }
  const provider = new Bad(0), { viewer } = await setup(provider)
  expect((await post(viewer)).status).toBe(410)
  provider.changed = false; provider.big = true; expect((await post(viewer)).status).toBe(400)
  provider.big = false; expect((await post(viewer)).status).toBe(200)
})
test('a paused response client holds one send slot and the total timeout releases it', async () => {
  const { connect } = await import('node:net')
  let large = true
  class Large extends MockProvider { override async snapshot() { const image = await super.snapshot(); return large ? { ...image, bytes: Buffer.concat([image.bytes, Buffer.alloc(7 * 1024 * 1024)]) } : image } }
  const { viewer } = await setup(new Large(0), 1000)
  const address = new URL(viewer.url), socket = connect(Number(address.port), address.hostname)
  socket.on('error', () => {})
  await new Promise<void>(resolve => socket.once('connect', resolve))
  socket.pause(); socket.write(`POST /api/inspection/capture HTTP/1.1\r\nHost: ${address.host}\r\nOrigin: ${viewer.url}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`)
  try {
    await new Promise(resolve => setTimeout(resolve, 150))
    expect((await post(viewer)).status).toBe(409)
    large = false
    await new Promise(resolve => setTimeout(resolve, 1050))
    const response = await post(viewer); expect(response.status).toBe(200); await response.arrayBuffer()
  } finally { socket.destroy() }
})
