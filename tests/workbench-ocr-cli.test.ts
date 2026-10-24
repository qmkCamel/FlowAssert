import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runOcrCli } from '../src/workbench-ocr-cli.js'
import { ocrHash } from '../src/workbench-ocr-contracts.js'
import { sha256 } from '../src/workbench-store.js'
import { ocrFixtureEvaluation } from './fixtures/ocr-fixture.js'

it('freezes explicit image files, refuses output overwrite and reports no-go when helper unavailable', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ocr-cli-'))), image = Buffer.from('synthetic invalid PNG')
  try {
    const report = ocrFixtureEvaluation(), item = report.dataset.cases[0]!
    report.dataset.cases = [{ ...item, source: 'synthetic', imageSha256: sha256(image) }]
    await writeFile(join(root, 'image.png'), image)
    await writeFile(join(root, 'input.json'), JSON.stringify({ dataset: report.dataset, images: { [item.id]: join(root, 'image.png') } }))
    let output = ''; const io = { stdout: { write: (s: string) => { output += s } }, stderr: { write: () => {} } }
    const freeze = ['freeze', '--manifest', join(root, 'input.json'), '--output', join(root, 'frozen.json')]
    expect(await runOcrCli(freeze, io)).toBe(0); expect(JSON.parse(output).datasetDigest).toBe(ocrHash(report.dataset))
    expect(await runOcrCli(freeze, io)).toBe(2)
    output = ''
    expect(await runOcrCli(['evaluate', '--manifest', join(root, 'frozen.json'), '--digest', ocrHash(report.dataset), '--cache', join(root, 'missing-cache'), '--output', join(root, 'evaluation.json')], io)).toBe(2)
    expect(JSON.parse(output)).toMatchObject({ gate: 'no-go', defaultProductionEnabled: false })
  } finally { await rm(root, { recursive: true, force: true }) }
})
