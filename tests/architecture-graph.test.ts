import { readFile, readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { dependencyGraph, forbiddenPaths, runtimeCycles, sourceFiles } from '../scripts/architecture-graph.js'

it('checks the complete recursive source graph for runtime cycles and reverse layer reachability', async () => {
  const sources = await sourceFiles(new URL('../', import.meta.url))
  // Worker modules are separate execution roots, not module edges from new URL().
  for (const name of (await readdir(new URL('../scripts/', import.meta.url))).filter(name => /^workbench-.*\.mjs$/.test(name))) sources.set(`scripts/${name}`, await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8'))
  const graph = dependencyGraph(sources)
  expect(graph.errors).toEqual([])
  expect(runtimeCycles(graph)).toEqual([])
  const host = (file: string) => /^(?:cordis|dsh-|@deepseek-ai\/dsh-|@modelcontextprotocol)/.test(file) || /^src\/(?:index|tools|mcp|viewer-server|local-device-runtime|test-run-control)\.ts$/.test(file)
  const composition = new Set(['src/workbench-cli.ts', 'src/workbench-managed-job.ts'])
  expect(forbiddenPaths(graph, file => /^src\/workbench-/.test(file) && !composition.has(file), host)).toEqual([])
  expect(forbiddenPaths(graph, file => /^src\/workbench-(?:domain|contracts|triage-contracts|evidence-contracts|repair-contracts|tap-facts)\.ts$/.test(file),
    file => /(?:workbench-store|workbench-service|mirror-service|viewer-|node:fs|node:worker_threads)/.test(file) || host(file))).toEqual([])
  // viewer-media-error is a shared error contract, not an HTTP/UI adapter.
  expect(forbiddenPaths(graph, file => file.startsWith('src/providers/'), file => /src\/(?:workbench-|viewer-workbench-|viewer-inspection-|test-run-control|local-device-runtime)/.test(file) || host(file))).toEqual([])
  expect(forbiddenPaths(graph, file => file === 'src/workbench-triage-analyzer.ts', file => /(?:workbench-store|mirror-service|viewer-server)/.test(file) || host(file))).toEqual([])
  // Exact expressions: snapshotted hook, trusted startup parser/analyzer paths, fixed DSH SDK.
  expect(graph.dynamic.sort()).toEqual(['scripts/workbench-extension.mjs: import(entry)', 'scripts/workbench-external-worker.mjs: import(workerData.moduleUrl)', 'scripts/workbench-triage-worker.mjs: import(workerData.moduleUrl)', 'src/tools.ts: import(moduleName)', 'src/workbench-web-review.ts: import(path)', 'src/workbench-web-runtime.ts: import(runtimePath)', 'src/workbench-web-runtime.ts: import(scenarioPath)'])
  // Fixed shipped helpers, never a user-supplied URL or module path (ADR 0028).
  expect(sources.get('src/workbench-web-review.ts')).toContain("new URL('../scripts/web-visual-acceptance/verify-product.mjs', import.meta.url)")
  expect(sources.get('src/workbench-web-runtime.ts')).toContain("new URL('../scripts/web-visual-acceptance/browser.mjs', import.meta.url)")
  expect(sources.get('src/workbench-web-runtime.ts')).toContain("new URL('../scripts/web-visual-acceptance/scenarios.mjs', import.meta.url)")
  expect(sources.get('src/tools.ts')).toContain("const moduleName = '@deepseek-ai/dsh-llm/message'")
})

it('detects indirect re-export/dynamic/require boundaries and nested modules', () => {
  const graph = dependencyGraph(new Map([
    ['src/domain.ts', "export * from './nested/barrel.js'"],
    ['src/nested/barrel.ts', "const next = import('../loader.js')"],
    ['src/loader.ts', "const storage = require('./store.js')"],
    ['src/store.ts', 'export const value = 1'],
  ]))
  expect(graph.errors).toEqual([])
  expect(forbiddenPaths(graph, file => file === 'src/domain.ts', file => file === 'src/store.ts')).toEqual([
    'src/domain.ts -> src/nested/barrel.ts -> src/loader.ts -> src/store.ts',
  ])
})

it('distinguishes runtime cycles from erased types and includes mixed/default imports', () => {
  const graph = dependencyGraph(new Map([
    ['a.ts', "import value, { type T } from './b.js'; export type { C } from './c.js'"],
    ['b.ts', "export * from './a.js'"],
    ['c.ts', "import type { T } from './a.js'; type U = import('./b.js').T"],
  ]))
  expect(runtimeCycles(graph)).toEqual(['a.ts -> b.ts -> a.ts'])
  expect(graph.edges.find(edge => edge.from === 'a.ts' && edge.to === 'b.ts')?.typeOnly).toBe(false)
  expect(runtimeCycles(dependencyGraph(new Map([['a.ts', "import { type T } from './b.js'"], ['b.ts', "export type { T } from './a.js'"]])))).toEqual([])
})

it('reports unresolved imports and nonliteral loads rather than ignoring them', () => {
  const graph = dependencyGraph(new Map([['a.ts', "export * from './missing.js'; import(name); require(name)"]]))
  expect(graph.errors).toEqual(['a.ts: unresolved local dependency ./missing.js'])
  expect(graph.dynamic).toEqual(['a.ts: import(name)', 'a.ts: require(name)'])
})
