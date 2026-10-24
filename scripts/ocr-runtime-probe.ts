import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { ocrProfileSchema } from '../src/workbench-ocr-contracts.js'
const args = process.argv.slice(2), options: Record<string, string> = {}
for (let i = 0; i < args.length; i += 2) { if (!['--module', '--cache', '--output'].includes(args[i]!) || !args[i + 1] || !isAbsolute(args[i + 1]!)) throw new Error('Explicit absolute --module/--cache/--output required'); options[args[i]!] = args[i + 1]! }
if (!options['--cache'] || !options['--output']) throw new Error('Probe requires cache and output')
const api = await import(pathToFileURL(options['--module'] ?? resolve('src/application.ts')).href) as typeof import('../src/application.js')
const helper = await api.prepareOcr(options['--cache']), ocr = new api.WorkbenchOcr(options['--cache']), output = options['--output']
await mkdir(output, { recursive: true, mode: 0o700 })
const results: unknown[] = []
try {
  for (const [id, expected, language, font] of [['english', 'Hello harness', 'en-US', 'Arial 48'], ['chinese', '订单', 'zh-Hans', 'PingFang SC 60']]) {
    const support = helper.identity.capabilities.revisions.toReversed().find(r => r.languages.includes(language!))
    if (!support) throw new Error('Required engineering language unavailable')
    const profile = ocrProfileSchema.parse({ contractVersion: 1, id, revision: 1, appId: 'com.example.synthetic', platform: 'ios', builds: ['synthetic'], pageKey: id, width: 640, height: 200, orientation: 'landscape', region: { x: 0, y: 0, width: 640, height: 200 }, identity: helper.identity, requestRevision: support.revision, languages: [language], expected, blockers: [], normalization: { nfc: true, trim: true }, minimumConfidence: .9 })
    const text = await sharp({ text: { text: expected!, font: font!, rgba: true } }).png().toBuffer()
    const image = await sharp({ create: { width: 640, height: 200, channels: 3, background: 'white' } }).composite([{ input: text, gravity: 'center' }]).png().toBuffer()
    const result = await ocr.preview(image, profile), { crop, ...summary } = result
    await writeFile(join(output, `${id}.png`), image); await writeFile(join(output, `${id}-crop.png`), crop)
    await writeFile(join(output, `${id}.json`), JSON.stringify({ synthetic: true, ...summary }, null, 2))
    if (result.decision.status !== 'pass') throw new Error(`Actual Vision engineering recognition failed: ${id} ${result.decision.reason}`)
    results.push({ id, decision: result.decision, imageSha256: result.imageSha256, cropSha256: result.cropSha256, durationMs: result.durationMs })
    for (const invalid of [Buffer.from('not-png'), await sharp(image).resize(320, 100).png().toBuffer()]) {
      let rejected = false; try { await ocr.preview(invalid, profile) } catch { rejected = true }
      if (!rejected) throw new Error('Invalid image geometry accepted')
    }
  }
  const record = { syntheticOnly: true, productionEnabled: false, identity: helper.identity, results, capacity: ocr.capacity }
  await writeFile(join(output, 'summary.json'), JSON.stringify(record, null, 2)); process.stdout.write(`${JSON.stringify(record)}\n`)
} finally { await ocr.close() }
