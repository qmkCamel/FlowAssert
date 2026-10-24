import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const core = [
  'workbench-contracts', 'workbench-evidence-contracts', 'workbench-store', 'workbench-store-owner',
  'workbench-references', 'workbench-cleanup-journal', 'workbench-retention', 'workbench-share', 'workbench-share-jobs',
  'workbench-run-finalization', 'workbench-step-evidence',
]
const http = ['runs', 'baselines', 'share', 'retention', 'trends'].map(name => `viewer-workbench-${name}-http`)

describe('workbench dependency direction', () => {
  it.each(core)('%s cannot depend on Viewer, MCP, DSH or a provider', async name => {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
    const imports = [...source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)].map(match => match[1]!)
    expect(imports.filter(value => /(?:viewer-server|viewer-workbench|\/providers\/|\bmcp\b|\bdsh\b)/.test(value))).toEqual([])
  })
  it.each(http)('%s cannot own device or import a provider', async name => {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
    const imports = [...source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)].map(match => match[1]!)
    expect(imports.filter(value => /(?:mirror-service|workbench-device|\/providers\/)/.test(value))).toEqual([])
  })
})
