import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { rewriteLoopbackBinding } from './appium-loopback-patch.mjs'

// Only the Appium process owned by this runtime receives this preload. No disk patch,
// global net monkey-patch or external-server claim. Re-audit upstream before upgrading.
const version = '10.19.1'
const digest = '7b4c45e6145d37b6036f60d085f3182653551f2c32709a6573983671fef56657'
const factory = 'build/lib/device/device-connections-factory.js'
const sha = source => createHash('sha256').update(source).digest('hex')
registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:')) return nextLoad(url, context)
    const path = fileURLToPath(url), marker = '/appium-xcuitest-driver/'
    const index = path.lastIndexOf(marker)
    if (index < 0) return nextLoad(url, context)
    const root = path.slice(0, index + marker.length)
    try {
      if (JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version !== version
        || sha(readFileSync(`${root}${factory}`)) !== digest) throw new Error('unsupported')
      const loaded = nextLoad(url, context)
      if (path !== `${root}${factory}`) return loaded
      const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8')
      if (sha(source) !== digest) throw new Error('changed')
      return { ...loaded, source: rewriteLoopbackBinding(source) }
    } catch {
      throw new Error('mobile_mirror_ios_forwarder_unsupported: supported XCUITest version and fingerprint required')
    }
  },
})
