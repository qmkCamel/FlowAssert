#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

const { tarball, output, tag } = parseArgs(process.argv.slice(2))
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const expectedTag = `v${manifest.version}`
if (tag !== expectedTag) throw new Error('Release tag does not match package version')
const expectedName = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`
if (basename(tarball) !== expectedName) throw new Error('Release tarball name does not match package version')
const bytes = await readFile(tarball)
const digest = createHash('sha256').update(bytes).digest('hex')
await writeFile(output, `${digest}  ${expectedName}\n`, { mode: 0o600 })
process.stdout.write(`${JSON.stringify({ version: manifest.version, tag: expectedTag, asset: expectedName, sha256: digest })}\n`)

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!value) throw new Error('Usage: prepare-release --tarball <absolute> --output <absolute> --tag <tag>')
    if (key === '--tarball') parsed.tarball = value
    else if (key === '--output') parsed.output = value
    else if (key === '--tag') parsed.tag = value
    else throw new Error('Usage: prepare-release --tarball <absolute> --output <absolute> --tag <tag>')
  }
  if (!isAbsolute(parsed.tarball ?? '') || !isAbsolute(parsed.output ?? '') || !parsed.tag) throw new Error('Release paths must be absolute')
  return parsed
}
