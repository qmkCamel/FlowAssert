import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { documentInfo, localTarget, repositoryUrl, taskCounts } from './documentation-utils.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (name) => readFile(new URL(name, new URL('../', import.meta.url)), 'utf8')
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
const docs = [...new Set(files)].filter((file) => file.endsWith('.md') && (file.startsWith('docs/') || !file.includes('/')))
const cache = new Map()
const info = async (file) => {
  if (!cache.has(file)) cache.set(file, documentInfo(await read(file)))
  return cache.get(file)
}
const errors = []
for (const file of docs) {
  for (let href of (await info(file)).links) {
    // Repository links used by package readers are also checked against this checkout.
    const rawPrefix = 'https://raw.githubusercontent.com/qmkCamel/flowassert/main/'
    if (href.startsWith(rawPrefix)) href = `${'../'.repeat(file.split('/').length - 1)}${href.slice(rawPrefix.length)}`
    for (const kind of ['blob', 'raw', 'tree']) {
      const prefix = `${repositoryUrl}/${kind}/main/`
      if (href.startsWith(prefix)) href = `${'../'.repeat(file.split('/').length - 1)}${href.slice(prefix.length)}`
    }
    try {
      const link = localTarget(file, href)
      if (!link) continue
      const entry = await stat(new URL(link.target, new URL('../', import.meta.url)))
      if (link.fragment && entry.isFile() && link.target.endsWith('.md') && !(await info(link.target)).anchors.has(link.fragment)) {
        errors.push(`${file}: missing anchor: ${href}`)
      }
    } catch (error) {
      errors.push(`${file}: invalid link ${href} (${error.code ?? error.message})`)
    }
  }
}

const todo = await read('PRODUCT_TODO.md')
const rows = [...todo.matchAll(/^\| \[([^\]]+)\]\([^\n]+?\/tasks\.md\) \| (\d+\/\d+) \|/gm)]
const active = (await readdir(new URL('../openspec/changes/', import.meta.url), { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== 'archive')
const names = new Set()
for (const entry of active) {
  const tasks = await read(`openspec/changes/${entry.name}/tasks.md`)
  names.add(entry.name)
  const matches = rows.filter((row) => row[1] === entry.name)
  if (matches.length !== 1 || matches[0][2] !== taskCounts(tasks)) errors.push(`PRODUCT_TODO.md: ${entry.name} must appear once with ${taskCounts(tasks)}`)
}
for (const row of rows) if (!names.has(row[1])) errors.push(`PRODUCT_TODO.md: inactive change ${row[1]}`)

try {
  execFileSync(process.execPath, ['scripts/render-technical-introduction.mjs', '--check'], { cwd: root, stdio: 'pipe' })
} catch (error) {
  errors.push(error.stderr?.toString().trim() || 'Technical introduction is out of sync; run pnpm docs:render')
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log(`Documentation: OK (${docs.length} documents, ${active.length} active changes, generated introduction in sync)`)
