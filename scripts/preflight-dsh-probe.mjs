#!/usr/bin/env node
// Explicit acceptance only: never imported by doctor or run automatically.
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createConnection, createServer } from 'node:net'
import { createHash } from 'node:crypto'

const [executable, tarball] = process.argv.slice(2)
if (!isAbsolute(executable ?? '') || !isAbsolute(tarball ?? '')) throw new Error('Usage: preflight-dsh-probe <absolute-dsh> <absolute-tarball>')
const exec = promisify(execFile), dsh = await realpath(executable)
const directory = await mkdtemp(join(tmpdir(), 'mobile-mirror-preflight-dsh-'))
const viewerPort = await port(), environment = { ...process.env, DSH_HOME: directory, MOBILE_MIRROR_PROBE_ORIGIN: `http://127.0.0.1:${viewerPort}` }
try {
  await exec(dsh, ['plugin', '--profile', 'web', 'add', tarball, '--ignore-scripts'], { env: environment, timeout: 120_000, maxBuffer: 1_048_576 })
  const entries = await readdir(directory, { recursive: true })
  const relative = entries.find(path => path.endsWith('node_modules/flowassert/cordis.patch.yml'))
  if (!relative) throw new Error('Installed bundle missing')
  const bundle = join(directory, relative)
  const diagnosed = await exec(process.execPath, [join(dirname(bundle), 'scripts/mobile-mirror-cli.mjs'), 'doctor', '--target', 'dsh',
    '--dsh-executable', dsh, '--dsh-profile-root', join(directory, 'profiles/web'), '--format', 'json'], {
    env: environment, timeout: 65_000, maxBuffer: 1_048_576,
  }).then(result => ({ ...result, code: 0 }), error => ({ stdout: error.stdout, code: error.code }))
  const report = JSON.parse(diagnosed.stdout)
  if (diagnosed.code !== 2 || report.overall !== 'incomplete'
    || !report.checks.some(check => check.id === 'dsh-version' && check.status === 'pass')
    || !report.checks.some(check => check.id === 'dsh-peers' && check.status === 'pass')
    || !report.checks.some(check => check.code === 'dsh-profile-unverified')) throw new Error('Static preparation did not preserve the activation boundary')
  // Only mutate our disposable profile's installed copy for non-conflicting ports.
  await writeFile(bundle, (await readFile(bundle, 'utf8')).replace('viewerPort: 3210', `viewerPort: ${viewerPort}`))
  for (const mode of ['native', 'ptc']) {
    const webPort = await port()
    const child = spawn(dsh, ['web', '--patch', fileURLToPath(new URL('./dsh-runtime-probe.patch.yml', import.meta.url)), '--no-open', '--port', String(webPort)], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...environment, DSH_TOOLS_MODE: mode }, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '', spawnError
    const append = chunk => { output = `${output}${chunk}`.slice(-1_048_576) }
    child.stdout.on('data', append); child.stderr.on('data', append); child.on('error', error => { spawnError = error })
    const ended = new Promise(resolve => child.once('exit', code => resolve(code)))
    try {
      await until(() => {
        if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error('DSH runtime ended before acceptance')
        return output.includes('[mobile-mirror-probe] lifecycle=complete')
      }, 60_000)
      for (const marker of ['[mobile-mirror-probe] registered=', 'mobile_mirror_manage_app', 'mobile_mirror_stop', 'summary-query=no-additional-images']) {
        if (!output.includes(marker)) throw new Error(`Missing runtime acceptance marker: ${marker}`)
      }
    } finally {
      if (spawnError) throw new Error('Selected DSH executable could not start')
      if (child.exitCode === null && child.signalCode === null && !spawnError) child.kill('SIGTERM')
      let timer
      try {
        const code = await Promise.race([ended, new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 10_000) })])
        if (code === 'timeout') { child.kill('SIGKILL'); await ended; throw new Error('DSH graceful shutdown timed out') }
        if (code !== 0) throw new Error('DSH did not shut down cleanly')
      } finally { clearTimeout(timer) }
      await until(async () => !(await listening(webPort)) && !(await listening(viewerPort)), 5000)
    }
  }
  process.stdout.write(`${JSON.stringify({ harness: '0.2.0-rc.2', tarballSha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), target: 'same-canonical-executable-and-profile', preflight: 'incomplete-activation-unverified', metadata: 'version-and-peers-pass', runtime: ['native-pass', 'ptc-pass'], cleanup: 'owned-process-exit-and-ports-released', physicalDevices: 'not-used' })}\n`)
} finally { await rm(directory, { recursive: true, force: true }) }

async function port() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const value = server.address().port
  await new Promise(resolve => server.close(resolve))
  return value
}
async function listening(value) {
  return await new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: value })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => { socket.destroy(); resolve(false) })
    socket.setTimeout(500, () => { socket.destroy(); resolve(false) })
  })
}
async function until(predicate, timeout) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('Acceptance deadline exceeded')
}
