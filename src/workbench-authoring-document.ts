import { isMap, isScalar, isSeq, parseAllDocuments } from 'yaml'
import { z } from 'zod'
import { sha256 } from './content-hash.js'
import { compilePlan } from './workbench-plan.js'
import { emptyProject } from './workbench-project.js'

const yamlText = z.string().max(64 * 1024).refine(value => Buffer.byteLength(value) <= 64 * 1024)
const kinds = ['tap', 'type', 'assertVisible', 'assertNotVisible', 'waitUntil', 'waitUntilGone', 'launchApp', 'wait'] as const
const scalarValue = z.union([z.string().max(4096), z.number().finite()])
const selectorFields = ['text', 'accessibilityId', 'id']
function editableFields(payload: unknown, prefix = ''): { key: string; value: string | number }[] | null {
  if (isScalar(payload) && !payload.tag && !payload.anchor && (typeof payload.value === 'string' || typeof payload.value === 'number')) return [{ key: prefix, value: payload.value }]
  if (!isMap(payload) || payload.tag || payload.anchor) return null
  const fields: { key: string; value: string | number }[] = []
  for (const pair of payload.items) {
    const key = String(pair.key)
    if (![...selectorFields, 'value', 'timeout', 'seconds', 'mode', ...(prefix ? [] : ['into', 'target'])].includes(key)) return null
    const next = editableFields(pair.value, prefix ? `${prefix}.${key}` : key)
    if (!next) return null
    fields.push(...next)
  }
  return fields
}
const inputSchema = z.object({ yaml: yamlText }).strict()
function documents(yaml: string) {
  const docs = parseAllDocuments(yaml, { keepSourceTokens: true })
  if (docs.length !== 2 || docs.some(doc => doc.errors.length) || !isMap(docs[0]?.contents) || !isSeq(docs[1]?.contents)) throw new Error('authoring-document-invalid')
  return { header: docs[0]!, steps: docs[1]!.contents }
}

/** Cards are a source view. Changes splice only the selected node, never stringify the document. */
export function describeAuthoringDocument(value: unknown) {
  const { yaml } = inputSchema.parse(value), { header, steps } = documents(yaml)
  return { digest: sha256(yaml), header: header.toJS({ maxAliasCount: 20 }), cards: steps.items.map((item, index) => {
    const kind = isScalar(item) && typeof item.value === 'string' ? item.value : isMap(item) && item.items.length === 1 ? String(item.items[0]!.key) : 'advanced'
    const payload = isMap(item) ? item.items[0]!.value : null
    const fields = editableFields(payload)
    const supported = kinds.includes(kind as typeof kinds[number]) && (isScalar(item) || fields !== null)
    return { index, kind, editable: supported, fields: supported ? fields ?? [] : [], source: item?.range ? yaml.slice(item.range[0], item.range[2]) : '' }
  }) }
}

export function editAuthoringDocument(value: unknown) {
  const input = z.object({ yaml: yamlText, digest: z.string(), index: z.number().int().nonnegative(), field: z.string(), value: scalarValue }).strict().parse(value)
  if (sha256(input.yaml) !== input.digest) throw new Error('authoring-document-stale')
  const description = describeAuthoringDocument({ yaml: input.yaml }), card = description.cards[input.index]
  if (!card?.editable || !card.fields.some(field => field.key === input.field)) throw new Error('authoring-source-mode-required')
  const { steps } = documents(input.yaml), item = steps.items[input.index]
  const payload = isMap(item) ? item.items[0]?.value : undefined
  let target: unknown = payload
  if (input.field) for (const key of input.field.split('.')) target = isMap(target) ? target.items.find(pair => String(pair.key) === key)?.value : undefined
  if (!isScalar(target) || !target.range || target.anchor || target.tag) throw new Error('authoring-source-mode-required')
  const yaml = input.yaml.slice(0, target.range[0]) + JSON.stringify(input.value) + input.yaml.slice(target.range[1])
  documents(yaml)
  return { yaml, ...describeAuthoringDocument({ yaml }) }
}

export function editAuthoringHeader(value: unknown) {
  const input = z.object({ yaml: yamlText, key: z.enum(['name', 'platform', 'appId']), value: z.string().max(255) }).strict().parse(value)
  const { header } = documents(input.yaml)
  const target = header.get(input.key, true)
  if (!isScalar(target) || !target.range || target.tag || target.anchor) throw new Error('authoring-source-mode-required')
  const yaml = input.yaml.slice(0, target.range[0]) + JSON.stringify(input.value) + input.yaml.slice(target.range[1])
  documents(yaml); return { yaml }
}

export function appendAuthoringDocument(value: unknown) {
  const input = z.object({ yaml: yamlText, addition: yamlText }).strict().parse(value)
  const original = documents(input.yaml), addition = documents(input.addition)
  for (const key of ['platform', 'appId']) if (original.header.get(key) !== addition.header.get(key)) throw new Error('authoring-handoff-target-mismatch')
  // Header configuration cannot be silently discarded during append.
  if (!isMap(addition.header.contents) || addition.header.contents.items.some(pair => !['name', 'platform', 'appId'].includes(String(pair.key)))) throw new Error('authoring-handoff-advanced-header')
  if (original.steps.items.some(item => isScalar(item) && item.value === 'done')) throw new Error('authoring-handoff-after-done-source-required')
  const separators = [...input.addition.matchAll(/^---[ \t]*(?:#.*)?\r?\n/gm)]
  const separator = separators.at(-1)
  const offset = separator ? separator.index + separator[0].length : undefined
  if (offset === undefined) throw new Error('authoring-document-invalid')
  const yaml = input.yaml + (input.yaml.endsWith('\n') ? '' : '\n') + input.addition.slice(offset)
  inputSchema.parse({ yaml }); documents(yaml)
  return { yaml }
}

export async function exportAuthoringProject(value: unknown) {
  const input = z.object({ yaml: yamlText, params: z.record(z.unknown()), publicData: z.literal(true) }).strict().parse(value)
  if (Buffer.byteLength(JSON.stringify(input)) > 80 * 1024) throw new Error('authoring-input-budget')
  let plan
  try { plan = await compilePlan(input.yaml, emptyProject(), input.params) }
  catch (error) { throw new Error(`Standalone export unavailable; review syntax and external hook/flow/profile dependencies: ${error instanceof Error ? error.message : String(error)}`) }
  const files = {
    'flows/acceptance.yaml': input.yaml,
    'mobile-mirror.project.json': JSON.stringify({ flows: { acceptance: 'flows/acceptance.yaml' }, suites: { acceptance: { name: plan.header.name, cases: [{ id: 'acceptance', flow: 'acceptance', params: input.params, retries: 0 }] } } }, null, 2),
    'README.md': '# Local acceptance project / 本机验收项目\n\nReview flow and public parameters. Prepare the mobile toolchain and install the intended App. Set MOBILE_MIRROR_TEST_PROJECT to mobile-mirror.project.json, connect the intended device, and explicitly run the acceptance suite. UI success does not independently verify business persistence.\n\n审查流程和公开参数，准备设备与 App；显式连接并运行 acceptance 套件。UI 通过不代表业务持久化已验证。\n',
    '.gitignore': '.env\nartifacts/\nnode_modules/\n',
  }
  if (Buffer.byteLength(JSON.stringify(files)) > 256 * 1024) throw new Error('authoring-export-budget')
  return { files, dependencies: [], standalone: true, sha256: sha256(JSON.stringify(files)) }
}
