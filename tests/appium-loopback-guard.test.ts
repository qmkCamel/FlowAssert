import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const execute = promisify(execFile)
const hook = new URL('../scripts/appium-loopback-guard.mjs', import.meta.url).href
const patch = new URL('../scripts/appium-loopback-patch.mjs', import.meta.url).href
it('rewrites exactly one forwarding bind to IPv4 loopback with a real TCP server', async () => {
  const source = `import {rewriteLoopbackBinding} from ${JSON.stringify(patch)};import net from 'node:net';
    const code=rewriteLoopbackBinding('this.localServer.listen(this.localport);');
    const localServer=net.createServer(), fixture={localServer,localport:0};
    Function(code).call(fixture);await new Promise(r=>localServer.once('listening',r));
    console.log(JSON.stringify(localServer.address()));await new Promise(r=>localServer.close(r));
    for(const bad of ['', 'this.localServer.listen(this.localport);this.localServer.listen(this.localport);']) {
      try {rewriteLoopbackBinding(bad);throw Error('unexpected acceptance')}catch(e){if(!e.message.includes('unsupported'))throw e}
    }`
  const result = await execute(process.execPath, ['--input-type=module', '-e', source])
  expect(JSON.parse(result.stdout).address).toBe('127.0.0.1')
})
it.each(['unknown-version', 'changed-bytes'])('rejects %s before driver execution, preserving source and parent environment', async mode => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-forwarder-')), driver = join(root, 'appium-xcuitest-driver')
  const originalOptions = process.env.NODE_OPTIONS
  try {
    await mkdir(join(driver, 'build/lib/device'), { recursive: true })
    await writeFile(join(driver, 'package.json'), JSON.stringify({ version: mode === 'unknown-version' ? '11.0.0' : '10.19.1', type: 'module' }))
    const file = join(driver, 'build/lib/device/device-connections-factory.js'), source = 'console.log("UNSAFE EXECUTION");'
    await writeFile(file, source)
    await expect(execute(process.execPath, ['--import', hook, file])).rejects.toMatchObject({ stderr: expect.stringContaining('mobile_mirror_ios_forwarder_unsupported') })
    expect(await readFile(file, 'utf8')).toBe(source)
    expect(process.env.NODE_OPTIONS).toBe(originalOptions)
    const unrelated = await execute(process.execPath, ['--import', hook, '--input-type=module', '-e', 'console.log("unrelated")'])
    expect(unrelated.stdout.trim()).toBe('unrelated')
    // File URL escaped paths remain loadable in packaged/worktree contexts.
    expect(pathToFileURL(file).protocol).toBe('file:')
  } finally { await rm(root, { recursive: true, force: true }) }
})
