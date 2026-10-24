import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { verifyGate } from './gate.mjs'

// Negative checks mutate a disposable copy only, never original evidence.
const source = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Pass a reviewed pilot directory')
const temporary = await mkdtemp(join(tmpdir(), 'visual-gate-probes-')), target = join(temporary, 'copy'), results = []
try {
  await cp(source, target, { recursive: true })
  assert.equal((await verifyGate(target)).status, 'pass')
  results.push({ check: 'reviewed-control', pass: true })
  const key = JSON.parse(await readFile(join(target, 'calibration-key.json'), 'utf8'))
  const fault = key.find(row => row.variant === 'fault'), normal = key.find(row => row.variant === 'none')
  for (const [name, path, mutate] of [
    ['false-pass', join(target, fault.id, 'result.json'), bytes => Buffer.from(JSON.stringify({ ...JSON.parse(bytes), acceptance: 'pass' }))],
    ['missing-review', join(target, 'review.json'), () => Buffer.from('[]')],
    ['changed-screenshot', join(target, normal.id, 'screenshots/overview-viewport.png'), bytes => Buffer.concat([bytes, Buffer.from('corruption')])],
  ]) {
    const before = await readFile(path)
    try { await writeFile(path, mutate(before)); const report = await verifyGate(target); assert.equal(report.status, 'blocked'); results.push({ check: name, pass: true, issues: report.issues }) }
    finally { await writeFile(path, before) }
  }
  const path = join(target, normal.id, 'screenshots/overview-full.png'), before = await readFile(path)
  await rm(path); assert.equal((await verifyGate(target)).status, 'blocked'); await writeFile(path, before)
  results.push({ check: 'missing-screenshot', pass: true })
  assert.equal((await verifyGate(source)).status, 'pass')
  await writeFile(join(source, 'gate-negative-probes.json'), JSON.stringify({ results, originalUnchanged: true }, null, 2) + '\n')
  console.log(JSON.stringify(results.map(({ check, pass }) => ({ check, pass })), null, 2))
} finally { await rm(temporary, { recursive: true, force: true }) }
