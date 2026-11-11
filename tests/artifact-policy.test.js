import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { checkArtifacts } from '../scripts/check-artifacts.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test('local output stays ignored, curated evidence is admitted, forced local tracking is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowassert-artifacts-')); roots.push(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString()
  git('init', '-q')
  await writeFile(join(root, '.gitignore'), await readFile(new URL('../.gitignore', import.meta.url)))
  for (const folder of ['local', 'curated']) await mkdir(join(root, 'artifacts', folder), { recursive: true })
  await writeFile(join(root, 'artifacts/README.md'), 'Policy')
  await writeFile(join(root, 'artifacts/curated/summary.md'), 'Reviewed summary')
  await writeFile(join(root, 'artifacts/local/raw.png'), 'private capture')
  git('add', '.')
  expect(git('ls-files')).toContain('artifacts/curated/summary.md')
  expect(git('ls-files')).not.toContain('artifacts/local/')
  expect(git('check-ignore', 'artifacts/local/raw.png')).toContain('artifacts/local/raw.png')
  expect(await checkArtifacts(root)).toEqual([])
  git('add', '-f', 'artifacts/local/raw.png')
  expect(await checkArtifacts(root)).toEqual([expect.stringContaining('Artifact must not be tracked: artifacts/local/raw.png')])
})

test('a new or legacy output directory cannot silently escape the two-folder policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowassert-artifacts-')); roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  await mkdir(join(root, 'artifacts/screenshots'), { recursive: true })
  expect(await checkArtifacts(root)).toEqual([expect.stringContaining('Unexpected artifact root: artifacts/screenshots')])
})
