import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { readExternalFile } from './workbench-external-files.js'
import { readAcceptance, writeAcceptance } from './workbench-change-storage.js'
import { ocrDatasetSchema, evaluateOcrDataset, freezeOcrDataset, summarizeOcrEvaluation } from './workbench-ocr-evaluation.js'
import { approveOcrRegistration } from './workbench-ocr-approval.js'
import { loadTestProject, ocrProjectDigest } from './workbench-project.js'
import { WorkbenchOcr } from './workbench-ocr.js'
import { createHash } from 'node:crypto'

const manifestSchema = z.object({ dataset: ocrDatasetSchema, images: z.record(z.string(), z.string().refine(isAbsolute)) }).strict()
export async function runOcrEvaluationCli(args: readonly string[], io: { stdout: { write(s: string): unknown }; stderr: { write(s: string): unknown } }): Promise<number> {
  const controller = new AbortController(), abort = () => controller.abort(), options = new Map<string, string>()
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  let recognizer: WorkbenchOcr | undefined
  try {
    for (let i = 1; i < args.length; i += 2) { const key = args[i]!, value = args[i + 1]; if (!key.startsWith('--') || !value || options.has(key)) throw new Error('ocr-cli-options'); options.set(key, value) }
    const expected = args[0] === 'freeze' ? ['--manifest', '--output'] : args[0] === 'evaluate' ? ['--manifest', '--digest', '--cache', '--output'] : ['--registration', '--project', '--approver', '--confirm', '--output']
    if (options.size !== expected.length || expected.some(k => !options.has(k))) throw new Error('ocr-cli-options')
    const path = (key: string) => { const value = options.get(key)!; if (!isAbsolute(value)) throw new Error('ocr-cli-absolute-path-required'); return value }
    io.stderr.write('OCR: processing local frozen data; no device operations or automatic production activation…\n')
    if (args[0] === 'approve') {
      if (options.get('--confirm') !== 'APPROVE') throw new Error('ocr-explicit-approval-required')
      const registration = JSON.parse((await readExternalFile(path('--registration'), 4 * 1024 * 1024)).toString('utf8'))
      const project = await loadTestProject(path('--project'))
      const approved = approveOcrRegistration(registration, ocrProjectDigest(project), options.get('--approver')!, true)
      controller.signal.throwIfAborted(); await writeAcceptance(path('--output'), approved)
      io.stdout.write(`${JSON.stringify({ status: 'scope-approved', approval: approved.approval })}\n`); return 0
    }
    const manifest = args[0] === 'freeze'
      ? manifestSchema.parse(JSON.parse((await readExternalFile(path('--manifest'), 4 * 1024 * 1024)).toString('utf8')))
      : await readAcceptance(path('--manifest'), manifestSchema)
    const images = new Map<string, Buffer>(); let total = 0
    if (Object.keys(manifest.images).length !== manifest.dataset.cases.length) throw new Error('ocr-cli-image-map')
    for (const item of manifest.dataset.cases) {
      controller.signal.throwIfAborted()
      const file = manifest.images[item.id]; if (!file) throw new Error('ocr-cli-image-map')
      const bytes = await readExternalFile(file, 16 * 1024 * 1024)
      if ((total += bytes.length) > 128 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== item.imageSha256) throw new Error('ocr-cli-image-integrity-or-budget')
      images.set(item.id, bytes)
    }
    if (args[0] === 'freeze') {
      const frozen = freezeOcrDataset(manifest.dataset)
      controller.signal.throwIfAborted(); await writeAcceptance(path('--output'), manifest)
      io.stdout.write(`${JSON.stringify({ status: 'frozen', datasetDigest: frozen.digest, cases: manifest.dataset.cases.length, productionEnabled: false })}\n`); return 0
    }
    recognizer = new WorkbenchOcr(path('--cache'))
    const report = await evaluateOcrDataset(manifest.dataset, options.get('--digest')!, images, recognizer, controller.signal), summary = summarizeOcrEvaluation(report)
    controller.signal.throwIfAborted(); await writeAcceptance(path('--output'), { report, summary })
    io.stdout.write(`${JSON.stringify(summary)}\n`); return summary.gate === 'candidate-go' ? 0 : 2
  } catch {
    io.stderr.write(controller.signal.aborted ? 'OCR cancelled; no approval published.\n' : 'OCR operation rejected. Check explicit absolute input/output paths, frozen digest, authorized dataset and approval scope. Existing output is never overwritten.\n')
    return controller.signal.aborted ? 130 : 2
  } finally { await recognizer?.close(); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort) }
}
