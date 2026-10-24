import { build } from 'tsdown'
import { startLocalViewerCli } from '../src/local-viewer-cli.js'

await build({ config: false, entry: { 'report-presentation': 'src/workbench-report-presentation.ts', 'inspection-query': 'src/screen-query.ts', 'selector-adapter': 'src/workbench-selector-adapter.ts' }, outDir: 'lib/viewer', platform: 'browser', deps: { alwaysBundle: ['zod'] }, format: ['esm'], target: 'es2022', dts: false, clean: false, fixedExtension: false })

const handle = await startLocalViewerCli(process.argv.slice(2), { stdout: process.stdout }, { env: process.env })

const shutdown = async () => {
  await handle?.close()
  process.exit(0)
}
if (handle) {
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}
