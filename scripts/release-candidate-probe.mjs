#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const { tarball, checksum, ocrOutput } = parseArgs(process.argv.slice(2))
const directory = await mkdtemp(join(tmpdir(), 'mobile-mirror-release-probe-'))
const prefix = join(directory, 'install')
const screenshot = join(directory, 'mcp.png')

try {
  await verifyChecksum(tarball, checksum)
  await run('npm', ['install', '--ignore-scripts', '--legacy-peer-deps', '--omit=dev', '--prefix', prefix, tarball], 120_000)
  const packageRoot = join(prefix, 'node_modules', 'flowassert')
  const cli = join(packageRoot, 'scripts', 'mobile-mirror-cli.mjs')
  const mcp = join(packageRoot, 'scripts', 'mobile-mirror-mcp.mjs')
  const version = (await run(process.execPath, [cli, '--version'])).stdout.trim()
  if (version !== '0.1.0-alpha.2') throw new Error('Installed CLI version mismatch')
  const help = (await run(process.execPath, [cli, '--help'])).stdout
  if (!help.includes('doctor') || !help.includes('config')) throw new Error('Installed CLI help is incomplete')
  const generated = JSON.parse((await run(process.execPath, [cli, 'config', '--target', 'mcp', '--platform', 'mock'])).stdout)
  if (generated.defaultProvider !== 'mock'
    || generated.agentScreenContentPolicy !== 'mock-only'
    || generated.agentTextInputPolicy !== 'mock-only'
    || generated.agentAppControlPolicy !== 'disabled'
    || !Array.isArray(generated.agentAllowedAppIds)
    || generated.agentAllowedAppIds.length !== 0
    || generated.appiumRuntimeMode !== 'external') {
    throw new Error('Installed CLI generated unsafe defaults')
  }
  const tsx = resolve(fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url)))
  const probe = resolve(fileURLToPath(new URL('./mcp-runtime-probe.ts', import.meta.url)))
  const lifecycle = await run(process.execPath, [tsx, probe, '--launcher', mcp, '--screenshot', screenshot, '--viewer-localization', 'true'], 60_000)
  const summary = JSON.parse(lifecycle.stdout.trim().split('\n').at(-1) ?? '{}')
  if (summary.toolCount !== 20 || summary.matrix !== 'dual-mock-cli-mcp-pass' || summary.viewerLocalization !== 'ok' || summary.signalCleanup !== 'ok' || summary.packagedYaml !== 'pass-with-evidence-hashes' || summary.agentTests !== 'catalog-flow-suite-cancel-evidence-triage') {
    throw new Error('Installed MCP lifecycle probe failed')
  }
  let ocr = 'not-requested'
  if (ocrOutput) {
    const cache = join(directory, 'ocr-cache')
    const absent = await run(process.execPath, [cli, 'ocr', 'doctor', '--cache', cache]).then(() => { throw new Error('Doctor silently prepared missing helper') }, error => error)
    if (absent.code !== 2) throw new Error('Missing helper doctor did not fail closed')
    const prepared = JSON.parse((await run(process.execPath, [cli, 'ocr', 'prepare', '--cache', cache], 130_000)).stdout)
    const diagnosed = JSON.parse((await run(process.execPath, [cli, 'ocr', 'doctor', '--cache', cache])).stdout)
    if (prepared.productionEnabled !== false || JSON.stringify(prepared.identity) !== JSON.stringify(diagnosed.identity)) throw new Error('Packaged OCR preparation identity changed')
    const ocrProbe = resolve(fileURLToPath(new URL('./ocr-runtime-probe.ts', import.meta.url)))
    const recognized = JSON.parse((await run(process.execPath, [tsx, ocrProbe, '--module', join(packageRoot, 'lib', 'application.js'), '--cache', cache, '--output', ocrOutput], 30_000)).stdout.trim().split('\n').at(-1))
    if (!recognized.syntheticOnly || recognized.productionEnabled !== false || recognized.results.length !== 2 || recognized.capacity.active !== 0 || recognized.capacity.queued !== 0) throw new Error('Packaged OCR engineering probe failed')
    ocr = 'actual-vision-synthetic-only'
  }
  process.stdout.write(`${JSON.stringify({ checksum: 'verified', install: 'clean-prefix', cli: version, mcpTools: summary.toolCount, viewerLocalization: summary.viewerLocalization, signalCleanup: summary.signalCleanup, packagedYaml: summary.packagedYaml, agentTests: summary.agentTests, matrix: summary.matrix, ocr })}\n`)
} finally {
  await rm(directory, { recursive: true, force: true })
}

async function run(command, args, timeout = 30_000) {
  return await exec(command, args, { encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 })
}

async function verifyChecksum(tarball, checksum) {
  const line = (await readFile(checksum, 'utf8')).trim()
  const match = line.match(/^([0-9a-f]{64})  ([^/]+)$/)
  if (!match || match[2] !== basename(tarball)) throw new Error('Release checksum manifest is invalid')
  const digest = createHash('sha256').update(await readFile(tarball)).digest('hex')
  if (digest !== match[1]) throw new Error('Release checksum mismatch')
}

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === '--tarball') parsed.tarball = value
    else if (key === '--checksum') parsed.checksum = value
    else if (key === '--ocr-output' && isAbsolute(value ?? '')) parsed.ocrOutput = value
    else throw new Error('Usage: release-candidate-probe --tarball <absolute> --checksum <absolute> [--ocr-output <absolute-directory>]')
  }
  if (!isAbsolute(parsed.tarball ?? '') || !isAbsolute(parsed.checksum ?? '')) throw new Error('Release candidate paths must be absolute')
  return parsed
}
