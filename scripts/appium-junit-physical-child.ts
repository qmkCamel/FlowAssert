/** Real node:test JUnit producer, not a Workbench executor or report adapter. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'

const capsPath = process.env.MOBILE_MIRROR_CAPABILITIES_PATH
const root = process.env.MOBILE_MIRROR_JUNIT_ROOT
const appiumUrl = process.env.MOBILE_MIRROR_APPIUM_URL
if (!capsPath || !root || !/^http:\/\/127\.0\.0\.1:\d+$/.test(appiumUrl ?? '')) throw new Error('Private capabilities/root and loopback Appium required')
const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platform = String(caps.platformName).toLowerCase()
if (!['android', 'ios'].includes(platform) || !caps['appium:udid'] || caps['appium:app'] || caps['appium:fullReset'] ||
  (platform === 'android' ? caps['appium:appPackage'] : caps['appium:bundleId']) !== 'dev.mobilemirror.fixture') throw new Error('Only preinstalled Fixture, without reset, allowed')
// MirrorService only claims/starts/stops the explicitly selected session. Actual
// test assertions below use an Appium W3C HTTP client, not Workbench or Mock.
const mirror = new MirrorService(resolveMirrorConfig({ defaultProvider: 'appium', appiumRuntimeMode: 'external', appiumUrl, startupTimeoutMs: 120_000 }), 'http://127.0.0.1')
async function command(path: string, body?: unknown) {
  const response = await fetch(`${appiumUrl}/session/${encodeURIComponent(mirror.state().sessionId!)}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
  })
  assert(response.ok, `Appium client request failed (${response.status})`)
  return (await response.json() as { value: string }).value
}
before(async () => {
  await mirror.start({ provider: 'appium', capabilities: { ...caps, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': true, 'appium:forceAppLaunch': true } })
}, { timeout: 180_000 })
after(async () => { await mirror.stop(); await mirror.dispose() })
describe('Appium Fixture · source', () => {
  it('真实标题与截图', async () => {
    assert((await command('source')).includes('Mirror Fixture · Test Order'))
    const image = Buffer.from(await command('screenshot'), 'base64')
    assert.equal(image.subarray(1, 4).toString(), 'PNG')
    await writeFile(resolve(root, 'fixture.png'), image, { mode: 0o600 })
  })
  it('故意失败 · missing-title', async () => {
    assert((await command('source')).includes('MOBILE-MIRROR-INTENTIONAL-MISSING-TITLE'), 'Deliberately false assertion against real Appium source')
  })
  it('未提供附件 · skipped', { skip: 'Deliberately skipped: no device command or attachment' }, () => {})
})
describe('Appium Fixture · parameterized', () => {
  for (const parameter of ['Mirror Fixture', 'Synthetic data only']) {
    it('同名参数化 · Unicode', async () => { assert((await command('source')).includes(parameter)) })
  }
})
