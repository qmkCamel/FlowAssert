import { readFile, readdir } from 'node:fs/promises'
import { posix } from 'node:path'
import ts from 'typescript'

export interface Edge { from: string; to: string; typeOnly: boolean }
export interface Graph { files: Set<string>; edges: Edge[]; errors: string[]; dynamic: string[] }

export async function sourceFiles(root: URL, prefix = 'src'): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const entry of await readdir(new URL(`${prefix}/`, root), { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`
    if (entry.isDirectory()) for (const [key, value] of await sourceFiles(root, path)) files.set(key, value)
    else if (/\.(?:ts|mts|cts|js|mjs)$/.test(path) && !path.endsWith('.d.ts')) files.set(path, await readFile(new URL(path, root), 'utf8'))
  }
  return files
}

export function dependencyGraph(sources: Map<string, string>): Graph {
  const graph: Graph = { files: new Set(sources.keys()), edges: [], errors: [], dynamic: [] }
  for (const [file, text] of sources) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const add = (name: string, typeOnly = false) => {
      let target = name
      if (name.startsWith('.')) {
        const path = posix.normalize(posix.join(posix.dirname(file), name))
        target = [path, path.replace(/\.m?js$/, '.ts'), `${path}.ts`, `${path}/index.ts`].find(value => sources.has(value)) ?? ''
        if (!target) { graph.errors.push(`${file}: unresolved local dependency ${name}`); return }
      }
      graph.edges.push({ from: file, to: target, typeOnly })
    }
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause, bindings = clause?.namedBindings
        add(node.moduleSpecifier.text, !!clause && (clause.isTypeOnly || (!clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(value => value.isTypeOnly))))
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        add(node.moduleSpecifier.text, node.isTypeOnly || (!!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(value => value.isTypeOnly)))
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        add(node.argument.literal.text, true)
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
        add(node.moduleReference.expression.text, node.isTypeOnly)
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const argument = node.arguments[0]
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) add(argument.text)
        else graph.dynamic.push(`${file}: ${node.getText(ast)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  return graph
}

export function runtimeCycles(graph: Graph): string[] {
  const edges = new Map<string, string[]>()
  for (const edge of graph.edges) if (!edge.typeOnly && graph.files.has(edge.to)) edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge.to])
  const visited = new Set<string>(), active: string[] = [], cycles: string[] = []
  const walk = (file: string) => {
    const index = active.indexOf(file)
    if (index !== -1) { cycles.push([...active.slice(index), file].join(' -> ')); return }
    if (visited.has(file)) return
    visited.add(file); active.push(file)
    for (const next of edges.get(file) ?? []) walk(next)
    active.pop()
  }
  for (const file of graph.files) walk(file)
  return cycles
}

export function forbiddenPaths(graph: Graph, roots: (file: string) => boolean, forbidden: (file: string) => boolean, includeTypes = true): string[] {
  const violations: string[] = []
  for (const root of [...graph.files].filter(roots)) {
    const seen = new Set<string>([root]), queue = [[root]]
    for (let index = 0; index < queue.length; index++) {
      const path = queue[index]!
      for (const edge of graph.edges.filter(edge => edge.from === path.at(-1) && (includeTypes || !edge.typeOnly))) {
        if (seen.has(edge.to)) continue
        seen.add(edge.to)
        const next = [...path, edge.to]
        if (forbidden(edge.to)) violations.push(next.join(' -> '))
        else if (graph.files.has(edge.to)) queue.push(next)
      }
    }
  }
  return violations
}
