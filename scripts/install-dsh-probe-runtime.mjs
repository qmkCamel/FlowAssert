#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { parse } from 'yaml'

const exec = promisify(execFile)
const VERSION = '0.2.0-rc.2'
const directory = parseArgs(process.argv.slice(2))

await mkdir(directory, { recursive: true, mode: 0o700 })
await install([`@deepseek-ai/dsh@${VERSION}`])

const manifestPath = join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const family = Object.keys(manifest.dependencies ?? {})
  .filter((name) => name.startsWith('@deepseek-ai/dsh-'))
  .sort()

if (family.length === 0) throw new Error('The DSH root package declared no DSH family dependencies')
const pinned = new Set(family)
const projectManifestPath = join(directory, 'package.json')
const projectManifest = JSON.parse(await readFile(projectManifestPath, 'utf8'))

for (let pass = 0; pass < 5; pass += 1) {
  const lockfile = await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8')
  const mixedNames = familyResolutions(lockfile)
    .filter((entry) => entry.version !== VERSION)
    .map((entry) => entry.name)
    .filter((name) => !pinned.has(name))
  for (const name of mixedNames) pinned.add(name)
  delete projectManifest.pnpm
  await writeFile(projectManifestPath, `${JSON.stringify(projectManifest, null, 2)}\n`, { mode: 0o600 })
  const overrides = [...pinned].sort().map((name) => `  '${name}': ${VERSION}`).join('\n')
  await writeFile(join(directory, 'pnpm-workspace.yaml'), `packages:\n  - .\noverrides:\n${overrides}\n`, { mode: 0o600 })
  await runPnpm(['install', '--ignore-scripts'])
  if (mixedNames.length === 0) break
}

const installedRoot = JSON.parse(await readFile(manifestPath, 'utf8'))
if (installedRoot.version !== VERSION) throw new Error(`@deepseek-ai/dsh resolved to ${installedRoot.version}; expected ${VERSION}`)

const lockfile = await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8')
const mixed = familyResolutions(lockfile).filter((entry) => entry.version !== VERSION)
if (mixed.length) throw new Error(`Mixed DSH prerelease family detected: ${mixed.map((entry) => `${entry.name}@${entry.version}`).join(', ')}`)

function familyResolutions(lockfile) {
  return Object.keys(parse(lockfile).packages ?? {}).flatMap((key) => {
    const match = key.match(/^(@deepseek-ai\/dsh(?:-[^@]+)?)@([^()]+)$/)
    return match ? [{ name: match[1], version: match[2] }] : []
  })
}

process.stdout.write(`${JSON.stringify({ harness: VERSION, familyPackages: pinned.size, resolution: 'exact-family' })}\n`)

async function install(specifiers) {
  await runPnpm(['add', '--ignore-scripts', ...specifiers])
}

async function runPnpm(args) {
  await exec('pnpm', ['--dir', directory, ...args], {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  })
}

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--directory' || !isAbsolute(args[1] ?? '')) {
    throw new Error('Usage: install-dsh-probe-runtime --directory <absolute>')
  }
  return args[1]
}
