import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function checkArtifacts(root) {
  const errors = []
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'artifacts/'], { cwd: root }).toString().split('\0').filter(Boolean)
  for (const file of tracked) {
    if (file !== 'artifacts/README.md' && !file.startsWith('artifacts/curated/')) {
      errors.push(`Artifact must not be tracked: ${file}; keep generated evidence in artifacts/local/`)
    }
  }
  const entries = await readdir(resolve(root, 'artifacts'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    const allowed = entry.name === 'README.md' ? entry.isFile()
      : ['curated', 'local'].includes(entry.name) && entry.isDirectory()
    if (!allowed) errors.push(`Unexpected artifact root: artifacts/${entry.name}; use curated/ or local/`)
  }
  return errors
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const errors = await checkArtifacts(fileURLToPath(new URL('../', import.meta.url)))
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else console.log('Artifact directories: OK (curated tracked, local ignored)')
}
