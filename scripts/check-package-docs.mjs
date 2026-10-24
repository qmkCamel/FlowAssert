import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { packageLinkErrors } from './documentation-utils.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = spawnSync('pnpm', ['pack', '--dry-run'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
// pnpm 11 prints one repository-relative filename per line after prepare/build.
const files = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^(?:[\w.-]+\/)*[\w.-]+$/.test(line))
if (!files.includes('package.json') || !files.includes('README.md') || !files.includes('lib/index.js')) throw new Error('Unrecognized pnpm pack inventory')
const documents = new Map()
for (const file of files.filter((file) => file.endsWith('.md'))) {
  documents.set(file, await readFile(new URL(file, new URL('../', import.meta.url)), 'utf8'))
}
const errors = packageLinkErrors(files, documents)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log(`Package documentation: OK (${documents.size} Markdown files; all local links included)`)
