import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { sha256 } from './workbench-store.js'
import { recoveryModelSchema, recoveryPolicySchema, type RecoveryModel, type RecoveryPolicy } from './workbench-recovery.js'
import { projectProvenanceDeclarationSchema, type ProjectProvenanceDeclaration } from './workbench-contracts.js'
import { registerVisualProfile, visualProfileSchema, type VisualProfile } from './workbench-visual.js'
import { ocrRegistrationSchema, type OcrRegistration } from './workbench-ocr-approval.js'
import { ocrHash } from './workbench-ocr-contracts.js'
import { repairProjectSchema, type RepairProjectPolicy } from './workbench-repair-project.js'

export type Value = null | string | number | boolean | Value[] | { [key: string]: Value }
export const nameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
export const valuesSchema = z.record(nameSchema, z.unknown())
export interface Shape { type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'; properties?: Record<string, Shape> | undefined; required?: string[] | undefined; items?: Shape | undefined; enum?: Value[] | undefined }
export const shapeSchema: z.ZodType<Shape> = z.lazy(() => z.object({ type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']), properties: z.record(nameSchema, shapeSchema).optional(), required: z.array(nameSchema).optional(), items: shapeSchema.optional(), enum: z.array(z.any()).optional() }).strict())
export function validateShape(shape: Shape, value: unknown, path = 'value'): void {
  if (shape.type === 'null' ? value !== null : shape.type === 'array' ? !Array.isArray(value) : shape.type === 'object' ? !value || typeof value !== 'object' || Array.isArray(value) : typeof value !== shape.type) throw new Error(`${path}: expected ${shape.type}`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path}: finite number required`)
  if (shape.enum && !shape.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) throw new Error(`${path}: invalid enum value`)
  if (shape.type === 'object') {
    const object = value as Record<string, unknown>
    for (const key of Object.keys(object)) { if (!Object.hasOwn(shape.properties ?? {}, key)) throw new Error(`${path}: unknown field ${key}`); validateShape(shape.properties![key]!, object[key], `${path}.${key}`) }
    for (const key of shape.required ?? []) if (!Object.hasOwn(object, key)) throw new Error(`${path}: missing ${key}`)
  }
  if (shape.type === 'array') { if (!shape.items) throw new Error(`${path}: items schema required`); for (const entry of value as unknown[]) validateShape(shape.items, entry, `${path}[]`) }
}
export function sampleShape(shape: Shape): Value {
  if (shape.enum?.length) return shape.enum[0]!
  switch (shape.type) { case 'string': return 'sample'; case 'number': return 1; case 'boolean': return true; case 'null': return null; case 'array': return []; case 'object': return Object.fromEntries(Object.entries(shape.properties ?? {}).map(([k,s]) => [k,sampleShape(s)])) }
}
const extensionSchema = z.object({ module: z.string(), input: shapeSchema, output: shapeSchema, role: z.enum(['prepare', 'verify', 'cleanup']), timeoutMs: z.number().int().min(1).max(60_000).default(30_000), credentials: z.record(nameSchema, nameSchema).default({}), cleanup: nameSchema.optional(),
  observation: z.object({ readOnly: z.literal(true), repeatable: z.literal(true), allowedModes: z.array(z.enum(['once', 'eventually'])).min(1).max(2) }).strict().optional(),
}).strict()
export type ExtensionDefinition = z.infer<typeof extensionSchema>
export interface ExtensionSnapshot extends ExtensionDefinition { source: string; sha256: string }
const caseSchema = z.object({ id: nameSchema, flow: nameSchema, tags: z.array(nameSchema).default([]), params: valuesSchema.default({}), dataset: nameSchema.optional(), retries: z.number().int().min(0).max(1).default(0), retrySafe: z.boolean().default(false), reset: nameSchema.optional() }).strict()
export const suiteSchema = z.object({ name: z.string().min(1).max(160), params: valuesSchema.default({}), cases: z.array(caseSchema).min(1).max(100), stopOnFailure: z.boolean().default(false), timeoutMs: z.number().int().min(1).max(86_400_000).default(3_600_000) }).strict()
export type SuiteDefinition = z.infer<typeof suiteSchema>
export interface ProjectSnapshot { flows: Record<string,string>; datasets: Record<string,{id: string; params: Record<string,unknown>}[]>; extensions: Record<string,ExtensionSnapshot>; suites: Record<string,SuiteDefinition>; recoveryPolicies: Record<string,RecoveryPolicy>; recoveryModels: Record<string,RecoveryModel>; visualProfiles: Record<string, VisualProfile>; ocrProfiles?: Record<string, OcrRegistration>; repair?: RepairProjectPolicy; provenance: ProjectProvenanceDeclaration; sha256: string }
const projectSchema = z.object({ flows: z.record(nameSchema,z.string()).default({}), datasets: z.record(nameSchema,z.string()).default({}), extensions: z.record(nameSchema,extensionSchema).default({}), suites: z.record(nameSchema,suiteSchema).default({}), recoveryPolicies: z.record(nameSchema,recoveryPolicySchema).default({}), recoveryModels: z.record(nameSchema,recoveryModelSchema).default({}), visualProfiles: z.record(nameSchema,visualProfileSchema).default({}), ocrProfiles: z.record(nameSchema,ocrRegistrationSchema).optional(), repair: repairProjectSchema.optional(), provenance: projectProvenanceDeclarationSchema.default({ required: [] }) }).strict()
/** Exclude approval envelopes to avoid a circular digest; every executable project input stays bound. */
export function ocrProjectDigest(project: ProjectSnapshot): string {
  const { sha256: _digest, ocrProfiles: _ocr, ...inputs } = project
  return ocrHash(inputs)
}
export const emptyProject = (): ProjectSnapshot => ({ flows: {}, datasets: {}, extensions: {}, suites: {}, recoveryPolicies: {}, recoveryModels: {}, visualProfiles: {}, provenance: { required: [] }, sha256: sha256('{}') })
/** Host configuration only: HTTP callers can select names, never provide this path. */
export async function loadTestProject(configPath?: string, signal?: AbortSignal): Promise<ProjectSnapshot> {
  signal?.throwIfAborted()
  if (!configPath) return emptyProject()
  if (!isAbsolute(configPath)) throw new Error('Test project path must be absolute')
  const configInfo = await stat(configPath)
  if(!configInfo.isFile() || configInfo.size>1024*1024)throw new Error('Project configuration must be a regular file at most 1 MiB')
  const configText=await readFile(configPath,{ encoding: 'utf8', signal })
  const root = await realpath(dirname(configPath)), config = projectSchema.parse(JSON.parse(configText))
  let bytes = Buffer.byteLength(configText)
  const load = async (file: string) => {
    signal?.throwIfAborted()
    if (isAbsolute(file)) throw new Error('Project files must be relative')
    const full = await realpath(resolve(root,file)), rel = relative(root,full)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Project path escapes root')
    const info = await stat(full)
    if (!info.isFile() || info.size > 1024*1024) throw new Error('Project file too large')
    const text = await readFile(full,{ encoding: 'utf8', signal }); bytes += Buffer.byteLength(text)
    if (bytes > 1024*1024) throw new Error('Project snapshot exceeds 1 MiB')
    return text
  }
  const result = emptyProject()
  for (const [id,file] of Object.entries(config.flows)) result.flows[id] = await load(file)
  for (const [id,file] of Object.entries(config.datasets)) {
    const rows = z.array(z.object({ id: nameSchema, params: valuesSchema }).strict()).min(1).max(100).parse(JSON.parse(await load(file)))
    if (new Set(rows.map(r=>r.id)).size !== rows.length) throw new Error('Duplicate dataset row id')
    result.datasets[id] = rows
  }
  for (const [id,definition] of Object.entries(config.extensions)) {
    const source = await load(definition.module)
    // Executed as a data URL: relative and bare package imports cannot resolve.
    // Trusted extensions must be self-contained bundles with only node: imports.
    result.extensions[id] = { ...definition, source, sha256: sha256(source) }
  }
  let visualBytes = 0
  for (const [id,profile] of Object.entries(config.visualProfiles)) {
    signal?.throwIfAborted()
    if (isAbsolute(profile.reference)) throw new Error('Visual references must be project-relative')
    const full = await realpath(resolve(root, profile.reference)), rel = relative(root, full)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Visual reference escapes project root')
    const info = await stat(full)
    if (!info.isFile() || info.size > 4 * 1024 * 1024 || (visualBytes += info.size) > 8 * 1024 * 1024) throw new Error('Visual reference budget exceeded')
    result.visualProfiles[id] = await registerVisualProfile(profile, await readFile(full, { signal }))
  }
  result.suites = config.suites
  result.recoveryPolicies = config.recoveryPolicies
  result.recoveryModels = config.recoveryModels
  result.provenance = config.provenance
  if (config.ocrProfiles) result.ocrProfiles = config.ocrProfiles
  if (config.repair) result.repair = config.repair
  result.sha256 = sha256(JSON.stringify({ ...result, sha256: undefined }))
  return result
}
