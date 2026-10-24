import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const exec = promisify(execFile)
const script = resolve('scripts/export-promo-case.py')
async function fixture(root: string, id: string, verdict: string) {
  const dir = join(root, 'runs', id)
  await mkdir(dir, { recursive: true })
  const bytes = Buffer.from('synthetic evidence, never device acceptance')
  const run = { id, provider: 'appium', platform: 'ios', verdict, yaml: 'synthetic flow', startedAt: '2026-10-12T00:00:00Z', endedAt: '2026-10-12T00:00:01Z', steps: [{ index: 1, kind: 'tap', evidence: [{ name: 'step-1.png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }] }
  await writeFile(join(dir, 'step-1.png'), bytes)
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(run))
  await writeFile(join(dir, 'flow.yaml'), run.yaml)
  return { dir, run, bytes }
}

it('exports explicit source evidence without business labels and rejects changed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promo-export-'))
  try {
    const positive = await fixture(root, 'positive', 'pass'), negative = await fixture(root, 'negative', 'fail')
    const output = join(root, 'output')
    const args = [script, '--success', positive.dir, '--failure', negative.dir, '--output', output]
    await exec('python3', args)
    expect(await readFile(join(output, 'success', 'step-1.png'))).toEqual(positive.bytes)
    const source = await readFile(join(output, 'cases.js'), 'utf8')
    const cases = JSON.parse(source.slice('window.physicalCases = '.length).replace(/;\s*$/, ''))
    expect(cases.success.steps[0].label).toBe('tap')
    expect(cases.failure.verdict).toBe('fail')
    await writeFile(join(positive.dir, 'step-1.png'), 'changed')
    await expect(exec('python3', args)).rejects.toThrow('Evidence mismatch')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('labels sequential captures as not evaluated and checks their original identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promo-collection-'))
  try {
    const positive = await fixture(root, 'positive', 'pass'), negative = await fixture(root, 'negative', 'fail')
    const path = join(root, 'collection.json'), output = join(root, 'output')
    await writeFile(path, JSON.stringify({ runs: [positive.run], original: 'synthetic collection' }))
    const args = [script, '--collection', path, '--failure', negative.dir, '--output', output]
    await exec('python3', args)
    const source = await readFile(join(output, 'cases.js'), 'utf8')
    const cases = JSON.parse(source.slice('window.physicalCases = '.length).replace(/;\s*$/, ''))
    expect(cases.success.verdict).toBe('not-evaluated')
    expect(cases.success.steps[0].runId).toBe('positive')
    await writeFile(path, JSON.stringify({ runs: [{ ...positive.run, yaml: 'forged' }], original: 'synthetic' }))
    await expect(exec('python3', args)).rejects.toThrow('Collection does not match original manifest')
  } finally { await rm(root, { recursive: true, force: true }) }
})
