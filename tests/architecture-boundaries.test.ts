import { readFile, readdir } from 'node:fs/promises'
import ts from 'typescript'
import { expect, it } from 'vitest'

async function imports(file: string) {
  const text = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  return { text, imports: ast.statements.filter(ts.isImportDeclaration).map(node => ({
    path: (node.moduleSpecifier as ts.StringLiteral).text,
    types: node.importClause?.isTypeOnly || (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.every(element => element.isTypeOnly)),
  })) }
}

it('keeps domain/contracts free of concrete storage, host and transport dependencies', async () => {
  for (const file of ['workbench-domain.ts', 'workbench-contracts.ts', 'workbench-triage-contracts.ts', 'workbench-evidence-contracts.ts', 'workbench-repair-contracts.ts', 'workbench-tap-facts.ts']) {
    const module = await imports(file)
    expect(module.imports.filter(item => /workbench-store|viewer-server|test-run-control|cordis|dsh-/.test(item.path)), file).toEqual([])
  }
})

it('does not import domain types from the Store internally', async () => {
  for (const file of await readdir(new URL('../src/', import.meta.url))) {
    if (!file.endsWith('.ts') || file === 'workbench-store.ts') continue
    const { text } = await imports(file)
    expect(text, file).not.toMatch(/import (?:type )?\{[^}]*\b(?:TestRun|RunStep|EvidenceFile|Verdict)\b[^}]*\} from ['"]\.\/workbench-store/)
  }
})

it('keeps service construction out of transport and Agent adapters', async () => {
  for (const file of ['viewer-server.ts', 'test-run-control.ts']) {
    const { text } = await imports(file)
    expect(text).not.toMatch(/new (?:WorkbenchService|WorkbenchSuites|WorkbenchComparisonService|WorkbenchTriageService|WorkbenchShareJobs|MirrorService)\(/)
  }
  const retention = await imports('workbench-retention.ts')
  expect(retention.text).not.toContain("'agent-executions'")
  expect(retention.text).not.toContain("'comparisons'")
})

it('keeps AppClaw perception imports behind the engine adapter', async () => {
  for (const file of ['workbench-service.ts', 'workbench-device.ts', 'workbench-plan.ts']) {
    expect((await imports(file)).imports.filter(item => item.path.startsWith('@appclaw/')), file).toEqual([])
  }
})

it('keeps the analyzer runner independent from storage, devices and host contexts', async () => {
  const module = await imports('workbench-triage-analyzer.ts')
  expect(module.imports.filter(item => /workbench-store|mirror-service|viewer-server|cordis|dsh-/.test(item.path))).toEqual([])
})
