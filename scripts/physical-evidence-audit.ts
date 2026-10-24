import { auditPhysicalRunRoot } from '../src/workbench-physical-evidence-audit.js'

if (!process.argv.slice(2).length) throw new Error('Provide explicit absolute private runs directories')
for (const root of process.argv.slice(2)) {
  try { process.stdout.write(JSON.stringify(await auditPhysicalRunRoot(root)) + '\n') }
  catch { process.stderr.write('Physical evidence audit failed; inspect the explicit private source locally.\n'); process.exitCode = 1 }
}
