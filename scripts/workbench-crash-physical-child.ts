/** Isolated host process used by the physical crash-recovery probe. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { stringify } from 'yaml'
import { resolveMirrorConfig } from '../src/mcp-config.js'
import { MirrorService } from '../src/mirror-service.js'
import { WorkbenchService } from '../src/workbench-service.js'

const [capsPath, root, appiumUrl] = process.argv.slice(2)
if (!capsPath || !root || !appiumUrl) throw new Error('Capabilities, private root and Appium URL are required')
const caps = JSON.parse(await readFile(capsPath, 'utf8')) as Record<string, unknown>
const platform = String(caps.platformName).toLowerCase()
const mirror = new MirrorService(resolveMirrorConfig({
  defaultProvider: 'appium', appiumRuntimeMode: 'external', appiumUrl,
  startupTimeoutMs: 120_000,
}), 'http://127.0.0.1')
const workbench = new WorkbenchService(mirror, { root: resolve(root, 'runs'), projectPath: resolve(root, 'project.json') })
try {
  await mirror.start({ provider: 'appium', capabilities: {
    ...caps, 'appium:noReset': true, 'appium:fullReset': false, 'appium:autoLaunch': false,
    'appium:allowProvisioningDeviceRegistration': false,
  } })
  await writeFile(resolve(root, 'session.json'), JSON.stringify({ sessionId: mirror.state().sessionId }), { mode: 0o600 })
  const yaml = `${stringify({ name: 'Physical host crash', platform, appId: 'dev.mobilemirror.fixture', prepare: [{ ref: 'hold' }] })}---\n${stringify(['launchApp', { assertVisible: { text: 'Mirror Fixture · Test Order' } }])}`
  const started = await workbench.start(yaml)
  await writeFile(resolve(root, 'run-id'), started.id, { mode: 0o600 })
  await workbench.wait()
} finally { await workbench.close(); await mirror.dispose() }
