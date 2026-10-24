import { createServer, type Server } from 'node:net'
import { realpath, lstat } from 'node:fs/promises'
import { resolve, dirname, parse } from 'node:path'
import { resolveMirrorConfig } from './mcp-config.js'
import type { MatrixRegistry } from './device-matrix-contracts.js'

export async function preflightMatrixResources(registry: MatrixRegistry): Promise<() => Promise<void>> {
  const ports = new Set<number>(), paths = new Set<string>(), servers: Server[] = []
  try {
    for (const slot of registry.slots) {
      if (slot.capabilities['appium:sessionOverride'] || slot.capabilities.sessionOverride) throw new Error('matrix-session-override-forbidden')
      const config = resolveMirrorConfig(slot.config), url = new URL(config.appiumUrl)
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('matrix-loopback-required')
      const values = [...Object.values(slot.ports).filter((p): p is number => p !== undefined), ...(slot.provider === 'appium' && config.appiumRuntimeMode === 'managed' ? [Number(url.port || 80)] : [])]
      for (const port of values) { if (ports.has(port)) throw new Error('matrix-port-conflict'); ports.add(port) }
      if (slot.derivedDataPath) {
        const path = resolve(slot.derivedDataPath)
        let parent = path
        while (true) {
          try { const info = await lstat(parent); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('matrix-unsafe-derived-directory'); break }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; parent = dirname(parent) }
        }
        const canonical = resolve(await realpath(parent), path.slice(parent.length).replace(/^\//, ''))
        if (paths.has(canonical) || canonical === parse(canonical).root || [...paths].some(p => canonical.startsWith(`${p}/`) || p.startsWith(`${canonical}/`))) throw new Error('matrix-derived-directory-conflict')
        paths.add(canonical)
      }
      // Registry owns the identity/port fields; conflicting aliases are rejected rather than silently merged.
      for (const [key, expected] of Object.entries({ platformName: slot.platform === 'ios' ? 'iOS' : 'Android', 'appium:udid': slot.udid,
        'appium:systemPort': slot.platform === 'android' ? slot.ports.driver : undefined, 'appium:wdaLocalPort': slot.platform === 'ios' ? slot.ports.driver : undefined,
        'appium:mjpegServerPort': slot.ports.mjpeg, 'appium:webviewDevtoolsPort': slot.ports.webview, 'appium:derivedDataPath': slot.derivedDataPath })) {
        if (key in slot.capabilities && slot.capabilities[key] !== expected) throw new Error('matrix-capability-conflict')
        const alias = key.replace('appium:', ''); if (alias !== key && alias in slot.capabilities) throw new Error('matrix-capability-alias-forbidden')
      }
    }
    for (const port of ports) {
      const server = createServer(); servers.push(server)
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, () => { server.removeListener('error', reject); resolve() }) })
    }
  } catch { await Promise.all(servers.map(s => new Promise<void>(resolve => s.close(() => resolve())))); throw new Error('matrix-resource-preflight-rejected') }
  let released = false
  return async () => { if (!released) { released = true; await Promise.all(servers.map(s => new Promise<void>(resolve => s.close(() => resolve())))) } }
}
