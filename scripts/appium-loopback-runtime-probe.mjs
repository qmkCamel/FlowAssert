import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import net from 'node:net'
import './appium-loopback-guard.mjs'

// Run with --import ./scripts/appium-loopback-guard.mjs. This uses the real,
// installed upstream factory without a device connection or a WDA session.
const path = process.env.MOBILE_MIRROR_XCUITEST_FACTORY
if (!path || !isAbsolute(path) || !path.endsWith('/appium-xcuitest-driver/build/lib/device/device-connections-factory.js'))
  throw new Error('Explicit installed XCUITest factory path required')
const sha = async () => createHash('sha256').update(await readFile(path)).digest('hex')
const before = await sha(), load = createRequire(import.meta.url)
const { DeviceConnectionsFactory } = load(path), factory = new DeviceConnectionsFactory()
const bindings = [], ports = []
const report = { scope: 'real-upstream-host-forwarder-no-device', physicalDevice: false,
  upstreamSha256: before, bindings, complete: false, cleanup: false }
try {
  for (const devicePort of [8100, 9100]) {
    const reservation = net.createServer()
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen({ host: '127.0.0.1', port: 0 }, resolve) })
    const port = reservation.address().port
    await new Promise(resolve => reservation.close(resolve))
    ports.push(port)
    await factory.requestConnection('synthetic-no-device', port, { usePortForwarding: true, devicePort })
    const { iproxy } = factory._connectionsMapping[`synthetic-no-device:${port}`]
    const address = iproxy.localServer.address()
    if (address.address !== '127.0.0.1') throw new Error('Forwarder must bind loopback, not wildcard')
    bindings.push({ channel: devicePort === 8100 ? 'wda' : 'mjpeg', ...address })
  }
  if (await sha() !== before) throw new Error('Installed dependency changed on disk')
  report.complete = true
} finally {
  factory.releaseConnection('synthetic-no-device')
  await new Promise(resolve => setImmediate(resolve))
  report.cleanup = factory.listConnections('synthetic-no-device').length === 0
  for (const port of ports) {
    const opened = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (opened) report.cleanup = false
  }
  const root = resolve('artifacts/physical-validation', `loopback-forwarder-${new Date().toISOString().replaceAll(':', '-')}`)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ root, ...report }))
  if (!report.complete || !report.cleanup) process.exitCode = 1
}
