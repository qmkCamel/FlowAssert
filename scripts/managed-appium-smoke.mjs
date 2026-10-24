#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const args = parseArgs(process.argv.slice(2))
const directory = await mkdtemp(join(tmpdir(), 'mobile-mirror-managed-appium-'))
const port = await allocatePort()
const appiumUrl = `http://127.0.0.1:${port}`
const configPath = join(directory, 'doctor.json')
const runtimeModule = await import(pathToFileURL(join(args.packageRoot, 'lib', 'host-runtime.js')).href)
const config = runtimeModule.Config({
  appiumRuntimeMode: 'managed',
  appiumExecutablePath: args.appium,
  appiumUrl,
  startupTimeoutMs: 30_000,
})
const runtime = runtimeModule.createAppiumRuntime(config)

try {
  await runtime.ensureReady({ provider: 'appium' })
  if (runtime.state().phase !== 'ready' || runtime.state().owned !== true) throw new Error('Managed Appium did not become ready')
  await writeFile(configPath, JSON.stringify({
    appiumRuntimeMode: 'managed',
    appiumExecutablePath: args.appium,
    appiumUrl,
  }), { mode: 0o600 })
  const cli = join(args.packageRoot, 'scripts', 'mobile-mirror-cli.mjs')
  const doctor = await exec(process.execPath, [cli, 'doctor', '--platform', 'android', '--format', 'json', '--config', configPath], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  }).catch((error) => ({ stdout: String(error.stdout ?? '') }))
  const report = JSON.parse(doctor.stdout)
  const endpoint = report.checks?.find((check) => check.id === 'appium-endpoint')
  const executable = report.checks?.find((check) => check.id === 'appium-executable')
  if (endpoint?.status !== 'pass' || executable?.status !== 'pass') throw new Error('Doctor did not recognize managed Appium')
  await runtime.stop()
  await assertUnavailable(appiumUrl)
  process.stdout.write(`${JSON.stringify({ managedAppium: 'ready-stop-clean', doctorEndpoint: endpoint.code, physicalDeviceClaim: false })}\n`)
} finally {
  await runtime.stop().catch(() => undefined)
  await rm(directory, { recursive: true, force: true })
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (key === '--package-root') parsed.packageRoot = value
    else if (key === '--appium') parsed.appium = value
    else throw new Error('Usage: managed-appium-smoke --package-root <absolute> --appium <absolute>')
  }
  if (!isAbsolute(parsed.packageRoot ?? '') || !isAbsolute(parsed.appium ?? '')) throw new Error('Managed Appium smoke paths must be absolute')
  parsed.packageRoot = resolve(parsed.packageRoot)
  parsed.appium = resolve(parsed.appium)
  return parsed
}

async function allocatePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to allocate loopback port')
  await new Promise((resolve) => server.close(resolve))
  return address.port
}

async function assertUnavailable(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await fetch(`${url}/status`, { signal: AbortSignal.timeout(100) })
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Managed Appium listener remained available after stop')
}
