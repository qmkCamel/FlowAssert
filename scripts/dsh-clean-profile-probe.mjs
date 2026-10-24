#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createConnection, createServer } from 'node:net'
import { parse, stringify } from 'yaml'
import { createProbeMatrixRegistry } from './dsh-runtime-probe.mjs'

const exec = promisify(execFile)
const args = parseArgs(process.argv.slice(2))
const directory = await mkdtemp(join(tmpdir(), 'mobile-mirror-dsh-profile-'))
const viewerPort = await allocatePort()
const startupPatch = join(directory, 'startup.patch.yml')
await writeFile(startupPatch, '- id: hmr\n  disabled: true\n')
// The plugin needs no install-time scripts; keep dependency hooks disabled in the clean profile.
const environment = { ...process.env, DSH_HOME: directory, MOBILE_MIRROR_PROBE_ORIGIN: `http://127.0.0.1:${viewerPort}` }

try {
  await run(args.dsh, ['plugin', '--profile', 'web', 'add', args.tarball, '--ignore-scripts'], environment, 120_000)
  const version = await run(args.dsh, ['--version'], environment, 30_000)
  if (version.stdout.trim() !== '0.2.0-rc.2') throw new Error(`Unexpected DSH version: ${version.stdout.trim()}`)
  const dump = await run(args.dsh, ['--profile', 'web', '--dump-config'], environment, 60_000)
  if (!dump.stdout.includes('mobile-mirror') || !dump.stdout.includes('flowassert')) throw new Error('Clean DSH profile did not compose the bundle')
  const entries = await readdir(directory, { recursive: true })
  const bundlePatch = entries.find((entry) => entry.endsWith('node_modules/flowassert/cordis.patch.yml'))
  if (!bundlePatch) throw new Error('Installed bundle patch was not found')
  const bundlePatchPath = join(directory, bundlePatch)
  await writeFile(bundlePatchPath, (await readFile(bundlePatchPath, 'utf8')).replace('viewerPort: 3210', `viewerPort: ${viewerPort}`))
  await runVersionMismatch(bundlePatchPath)
  for (const reload of ['live', 'startup']) for (const mode of ['native', 'ptc']) await runRuntime(mode, reload)
  await runHotReload(bundlePatchPath)
  await configureRegisteredTest()
  for (const mode of ['native', 'ptc']) await runAgentTest(mode)
  await runModelImageBoundary()
  process.stdout.write(`${JSON.stringify({ harness: '0.2.0-rc.2', profile: 'clean', peerMismatch: 'rejected', patchReload: ['live', 'startup'], hmr: 'valid-invalid-restore-pass', tools: 20, modes: ['native', 'ptc'], agentTests: 'native-ptc-pass', matrix: 'dual-mock-native-ptc-pass', modelImageBoundary: 'CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION', signalCleanup: 'exit-and-ports-released', lifecycle: 'complete' })}\n`)
} finally {
  await rm(directory, { recursive: true, force: true })
}

async function runVersionMismatch(bundlePatchPath) {
  const manifestPath = join(dirname(bundlePatchPath), 'package.json')
  const original = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(original)
  manifest.peerDependencies['@deepseek-ai/dsh-tools'] = '0.1.5-rc.2'
  try {
    // Negative metadata fixture only in the disposable installed copy.
    await writeFile(manifestPath, JSON.stringify(manifest))
    const denied = await run(args.dsh, ['--profile', 'web', '--dump-config'], environment, 30_000)
    if (/\bid: mobile-mirror(?:\s|$)/m.test(denied.stdout) || !denied.stderr.includes('incompatible')) {
      throw new Error('DSH did not reject the incompatible bundle peer contract')
    }
  } finally {
    await writeFile(manifestPath, original)
  }
}

async function configureRegisteredTest() {
  environment.MOBILE_MIRROR_MATRIX_REGISTRY = await createProbeMatrixRegistry(directory)
  const project = join(directory, 'agent-project')
  await import('node:fs/promises').then((fs) => fs.mkdir(project, { recursive: true, mode: 0o700 }))
  await writeFile(join(project, 'fixture.yaml'), 'name: Packed DSH Agent fixture\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- fillReady: {target: {testId: public-input}, text: public}\n- assertReady: {target: {testId: public-input}}\n- done\n')
  await writeFile(join(project, 'project.json'), JSON.stringify({ flows: { fixture: 'fixture.yaml' } }))
  const entries = await readdir(directory, { recursive: true })
  const relative = entries.find((entry) => entry.endsWith('node_modules/flowassert/cordis.patch.yml'))
  if (!relative) throw new Error('Installed FlowAssert bundle patch was not found')
  const patchPath = join(directory, relative), current = await readFile(patchPath, 'utf8')
  const addition = `\n        agentTestControl:\n          enabled: true\n          projectPath: ${join(project, 'project.json')}\n          allowedFlows: [fixture]\n          allowedSuites: []\n          allowedPlatforms: [ios]\n          allowedAppIds: [com.example.mobilemirror.mock]\n          sharedEvidence: [image]\n`
  await writeFile(patchPath, current.replace('        allowHostSigningDiagnostics: false\n', `        allowHostSigningDiagnostics: false${addition}`))
}

async function runAgentTest(mode) {
  const patch = resolve(fileURLToPath(new URL('./dsh-runtime-probe.patch.yml', import.meta.url)))
  const webPort = await allocatePort()
  const child = spawn(args.dsh, ['web', '--patch', patch, '--no-open', '--port', String(webPort)], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    env: { ...environment, DSH_TOOLS_MODE: mode, MOBILE_MIRROR_PROBE_CASE: 'agent-test-control', MOBILE_MIRROR_RUNS_DIR: join(directory, `runs-${mode}`) },
    shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''; const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1024 * 1024) }
  child.stdout.on('data', append); child.stderr.on('data', append)
  try {
    await waitFor(() => { if (child.exitCode !== null || child.signalCode !== null) throw new Error(`DSH exited before completing: ${child.exitCode ?? child.signalCode}`); return output.includes('[mobile-mirror-probe] lifecycle=complete') }, 60_000).catch((error) => { throw new Error(`${error.message}\n${output}`) })
    if (!output.includes(`[mobile-mirror-probe] agent-test-control=${mode}=PASS`)) throw new Error(`DSH ${mode} registered-test probe failed`)
    if (!output.includes(`[mobile-mirror-probe] external-result=${mode}=PASS`)) throw new Error(`DSH ${mode} external-result probe failed`)
    if (!output.includes(`[mobile-mirror-probe] acceptance-record=${mode}=PASS`)) throw new Error(`DSH ${mode} acceptance query failed`)
    if (!output.includes(`[mobile-mirror-probe] matrix=${mode}=DUAL_MOCK_PASS`)) throw new Error(`DSH ${mode} matrix query failed`)
  } finally {
    await stopRuntime(child, webPort, output)
  }
}

async function runModelImageBoundary() {
  const patch = resolve(fileURLToPath(new URL('./dsh-runtime-probe.patch.yml', import.meta.url)))
  const webPort = await allocatePort()
  const child = spawn(args.dsh, ['web', '--patch', patch, '--no-open', '--port', String(webPort)], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    env: { ...environment, DSH_TOOLS_MODE: 'native', MOBILE_MIRROR_PROBE_CASE: 'model-image-boundary' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1024 * 1024) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  try {
    await waitFor(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`DSH exited before completing: ${child.exitCode ?? child.signalCode}`)
      return output.includes('[mobile-mirror-probe] lifecycle=complete')
    }, 60_000).catch((error) => { throw new Error(`${error.message}\n${output}`) })
    if (!output.includes('[mobile-mirror-probe] model-image-boundary=CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION')) {
      throw new Error('DSH image-capable/text-only model boundary was not preserved')
    }
  } finally {
    await stopRuntime(child, webPort, output)
  }
}

async function runRuntime(mode, reload) {
  const patch = resolve(fileURLToPath(new URL('./dsh-runtime-probe.patch.yml', import.meta.url)))
  const webPort = await allocatePort()
  const child = spawn(args.dsh, ['web', '--patch', patch, ...(reload === 'startup' ? ['--patch', startupPatch] : []), '--no-open', '--port', String(webPort)], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    env: { ...environment, DSH_TOOLS_MODE: mode },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1024 * 1024) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  try {
    await waitFor(() => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`DSH exited before completing: ${child.exitCode ?? child.signalCode}`)
      return output.includes('[mobile-mirror-probe] lifecycle=complete')
    }, 60_000).catch((error) => { throw new Error(`${error.message}\n${output}`) })
    if (!output.includes('[mobile-mirror-probe] registered=') || !output.includes('mobile_mirror_manage_app') || !output.includes('mobile_mirror_run_evidence') || !output.includes('mobile_mirror_run_diagnostic_context') || !output.includes('mobile_mirror_run_triage') || !output.includes('mobile_acceptance_get') || !output.includes('mobile_external_result_get') || !output.includes('mobile_matrix_status') || !output.includes('mobile_mirror_stop') || !output.includes('summary-query=no-additional-images')) throw new Error(`DSH ${mode} probe did not register twenty tools`)
  } finally {
    await stopRuntime(child, webPort, output)
  }
}

async function run(command, commandArgs, env, timeout) {
  return await exec(command, commandArgs, { env, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 })
}

async function runHotReload(bundlePatchPath) {
  const profilePatch = join(directory, 'profiles', 'web', 'cordis.patch.yml')
  const original = await readFile(profilePatch, 'utf8')
  const config = parse(await readFile(bundlePatchPath, 'utf8'))[0].insert.find((entry) => entry.id === 'mobile-mirror').config
  const patch = resolve(fileURLToPath(new URL('./dsh-runtime-probe.patch.yml', import.meta.url)))
  const webPort = await allocatePort()
  const child = spawn(args.dsh, ['web', '--patch', patch, '--no-open', '--port', String(webPort)], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    env: { ...environment, MOBILE_MIRROR_PROBE_CASE: 'hmr', DSH_TOOLS_MODE: 'native' },
    shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const append = (chunk) => { output = `${output}${String(chunk)}`.slice(-1024 * 1024) }
  child.stdout.on('data', append); child.stderr.on('data', append)
  const state = async () => {
    const response = await fetch(`${environment.MOBILE_MIRROR_PROBE_ORIGIN}/api/state`, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) throw new Error(`HMR Viewer state HTTP ${response.status}`)
    return response.json()
  }
  try {
    await waitFor(() => output.includes('[mobile-mirror-probe] hmr-ready'), 60_000)
    await waitFor(async () => { try { return (await state()).frameIntervalMs === config.frameIntervalMs } catch { return false } }, 10_000)
    await writeFile(profilePatch, stringify([{ id: 'mobile-mirror', config: { ...config, frameIntervalMs: 375 } }]))
    await waitFor(async () => { try { return (await state()).frameIntervalMs === 375 } catch { return false } }, 15_000)
    const beforeInvalid = output.length
    await writeFile(profilePatch, '- id: mobile-mirror\n  config: [\n')
    await waitFor(() => output.slice(beforeInvalid).includes('[mobile-mirror-probe] hmr-config-reload-failed'), 15_000)
    if ((await state()).frameIntervalMs !== 375) throw new Error('Invalid HMR patch replaced the last usable Viewer')
    await writeFile(profilePatch, original)
    await waitFor(async () => { try { return (await state()).frameIntervalMs === config.frameIntervalMs } catch { return false } }, 15_000)
    await waitFor(() => [...output.matchAll(/hmr-tools=(\d+)/g)].at(-1)?.[1] === '20', 5_000)
    if (output.includes('EADDRINUSE')) throw new Error('HMR leaked a duplicate listener')
  } catch (error) {
    throw new Error(`${error.message}\n${output}`)
  } finally {
    await writeFile(profilePatch, original)
    await stopRuntime(child, webPort, output)
  }
}

async function stopRuntime(child, webPort, output) {
  if (child.exitCode !== null || child.signalCode !== null) throw new Error(`DSH exited unexpectedly: ${child.exitCode ?? child.signalCode}\n${output}`)
  child.kill('SIGTERM')
  try {
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 10_000)
  } catch (error) {
    child.kill('SIGKILL')
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 3_000)
    throw new Error(`DSH required forced shutdown: ${error.message}\n${output}`)
  }
  if (child.exitCode !== 0) throw new Error(`DSH shutdown failed: ${child.exitCode ?? child.signalCode}\n${output}`)
  for (const port of [webPort, viewerPort]) {
    if (await portIsOpen(port)) throw new Error(`DSH shutdown retained a listener on ${port}`)
  }
}

async function allocatePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (open) => { socket.destroy(); resolve(open) }
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false))
    socket.setTimeout(1_000, () => finish(true))
  })
}

async function waitFor(predicate, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('DSH runtime probe timed out')
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (key === '--dsh') parsed.dsh = value
    else if (key === '--tarball') parsed.tarball = value
    else throw new Error('Usage: dsh-clean-profile-probe --dsh <absolute> --tarball <absolute>')
  }
  if (!isAbsolute(parsed.dsh ?? '') || !isAbsolute(parsed.tarball ?? '')) throw new Error('DSH probe paths must be absolute')
  return parsed
}
