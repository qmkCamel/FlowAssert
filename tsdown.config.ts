import { defineConfig } from 'tsdown'

export default defineConfig([{
  entry: { application: 'src/application.ts', index: 'src/index.ts', mcp: 'src/mcp.ts', 'onboarding-cli': 'src/onboarding-cli.ts', 'host-runtime': 'src/host-runtime.ts', 'local-viewer-cli': 'src/local-viewer-cli.ts', 'triage-rules': 'src/workbench-triage-rules.ts', 'external-parser': 'src/workbench-external-parser.ts', 'external-files': 'src/workbench-external-files.ts', 'workbench-worker': 'scripts/workbench-worker.mjs', 'workbench-extension': 'scripts/workbench-extension.mjs', 'workbench-visual-worker': 'scripts/workbench-visual-worker.mjs', 'workbench-share-image-worker': 'scripts/workbench-share-image-worker.mjs' },
  outDir: 'lib',
  // The report parser is also consumed by a bounded worker without a device runtime.
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: false,
  deps: {
    alwaysBundle: [/^@appclaw\/core(?:\/|$)/],
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/schemastery',
    ],
  },
}, { entry: { 'device-matrix-child': 'src/device-matrix-child.ts', 'web-fixture-child': 'src/web-fixture-child.ts' }, outDir: 'lib', platform: 'node', format: ['esm'], target: 'es2024', dts: false, clean: false, fixedExtension: false,
  deps: { alwaysBundle: [/^@appclaw\/core(?:\/|$)/], neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery'] },
}, { entry: { 'report-presentation': 'src/workbench-report-presentation.ts', 'inspection-query': 'src/screen-query.ts', 'selector-adapter': 'src/workbench-selector-adapter.ts' }, outDir: 'lib/viewer', platform: 'browser', deps: { alwaysBundle: ['zod'] }, format: ['esm'], target: 'es2022', dts: false, clean: false, fixedExtension: false }])
