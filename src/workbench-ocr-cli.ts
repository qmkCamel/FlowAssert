import { isAbsolute } from 'node:path'
import { doctorOcr, prepareOcr } from './workbench-ocr-helper.js'
import { runOcrEvaluationCli } from './workbench-ocr-evaluation-cli.js'
export async function runOcrCli(args: readonly string[], io: { stdout: { write(s: string): unknown }; stderr: { write(s: string): unknown } }) {
  if (['freeze', 'evaluate', 'approve'].includes(args[0] ?? '')) return runOcrEvaluationCli(args, io)
  if (!['doctor', 'prepare'].includes(args[0] ?? '') || args.length !== 3 || args[1] !== '--cache' || !isAbsolute(args[2]!)) {
    io.stderr.write('Usage: ocr doctor|prepare --cache <absolute-private-directory>\n'); return 2
  }
  const controller = new AbortController(), abort = () => controller.abort(new Error('ocr-cancelled'))
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  io.stderr.write(args[0] === 'prepare' ? 'OCR: explicitly preparing the local Vision helper…\n' : 'OCR: checking the existing local helper (no compilation)…\n')
  try {
    const result = await (args[0] === 'prepare' ? prepareOcr : doctorOcr)(args[2]!, controller.signal)
    io.stdout.write(`${JSON.stringify({ status: 'ready', identity: result.identity, productionEnabled: false })}\n`); return 0
  } catch {
    io.stderr.write(controller.signal.aborted ? 'OCR cancelled; owned process cleanup completed.\n' : 'OCR unavailable. On macOS, run explicit ocr prepare with an installed Xcode command-line compiler; check the private cache and supported languages.\n'); return controller.signal.aborted ? 130 : 2
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort) }
}
