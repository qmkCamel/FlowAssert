import { LineCounter, parseAllDocuments, stringify, isSeq, isMap } from 'yaml'
import { z } from 'zod'
import { parseElementSelector } from './workbench-engine-adapter.js'
import { parseWorkbenchFlow, type WorkbenchFlow } from './workbench-flow.js'
import { nameSchema, sampleShape, valuesSchema, validateShape, ocrProjectDigest, type ProjectSnapshot } from './workbench-project.js'
import { requireOcrApproval } from './workbench-ocr-approval.js'
import { READY_OPERATIONS, parseReadyStep } from './workbench-readiness.js'
import { runtimeGatesSchema, type RuntimeFeature } from './workbench-runtime-contracts.js'
import { temporalWorstSamples } from './workbench-temporal.js'
import { RUNTIME_OPERATIONS, parseTemporalStep, parseBusinessStep, measureStepSchema, restartStepSchema } from './workbench-runtime-syntax.js'
import { factDigest, stepDigest, type SourceStepIdentity } from './workbench-tap-facts.js'

const paramSchema = z.object({ type: z.enum(['string','number','boolean']), default: z.union([z.string(),z.number(),z.boolean()]).optional() }).strict()
export const hookSchema = z.object({ ref: nameSchema, args: valuesSchema.default({}), as: nameSchema.optional() }).strict()
export type Hook = z.infer<typeof hookSchema>
const headerSchema = z.object({ name: z.string().min(1).max(160), platform: z.enum(['android','ios']), appId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/), blockers: z.array(z.unknown()).max(20).default([]), params: z.record(nameSchema,paramSchema).default({}), prepare: z.array(hookSchema).max(20).default([]), verify: z.array(hookSchema).max(20).default([]), runtimeGates: runtimeGatesSchema.optional() }).strict()
export type Header = z.infer<typeof headerSchema>
export type Condition = { platform: 'android'|'ios' } | { equals: [unknown,unknown] } | { visible: unknown } | { notVisible: unknown }
export type PlanNode = { kind: 'leaf'; path: string; line: number; sourceLines: number[]; sourceSteps: SourceStepIdentity[]; raw: unknown[]; scope: Record<string,unknown>; header: Header; validated: WorkbenchFlow; dynamic: boolean }
  | { kind: 'ready'; path: string; line: number; raw: Record<string, unknown>; scope: Record<string, unknown>; header: Header }
  | { kind: 'temporal'; path: string; line: number; operation: 'assertEventually' | 'assertStable'; raw: unknown; scope: Record<string,unknown>; header: Header }
  | { kind: 'restart'; path: string; line: number; timeoutMs: number; header: Header }
  | { kind: 'business'; path: string; line: number; raw: unknown; scope: Record<string,unknown>; header: Header }
  | { kind: 'measure'; path: string; line: number; id: string; maxElapsedMs: number; steps: PlanNode[] }
  | { kind: 'visual'; path: string; line: number; profile: string; header: Header }
  | { kind: 'ocr'; path: string; line: number; profile: string; header: Header }
  | { kind: 'recover'; path: string; line: number; id: string; policy: string; tap: unknown; postcondition: WorkbenchFlow; header: Header }
  | { kind: 'if'; path: string; condition: Condition; scope: Record<string,unknown>; then: PlanNode[]; else: PlanNode[] }
  | { kind: 'repeat'; path: string; condition?: Condition; times: number; scope: Record<string,unknown>; steps: PlanNode[] }
export interface ExecutionPlan { yaml: string; header: Header; params: Record<string,unknown>; nodes: PlanNode[]; project: ProjectSnapshot; worstSteps: number; requiredFeatures?: RuntimeFeature[]; worstSamples?: number }
const binding = /^\{\{\s*(params|outputs)\.([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}$/
const unsafe = new Set(['__proto__','prototype','constructor'])
export function bind(value: unknown, params: Record<string,unknown>, outputs: Record<string,unknown>): any {
  if (typeof value === 'string') {
    if (value.includes('${')) throw new Error('Environment/code interpolation is forbidden')
    if (!value.includes('{{')) return value
    const match = value.match(binding)
    if (!match) throw new Error('Only whole-field params/outputs bindings are supported')
    let current: unknown = match[1] === 'params' ? params : outputs
    for (const key of match[2]!.split('.')) {
      if (unsafe.has(key) || !current || typeof current !== 'object' || !Object.hasOwn(current,key)) throw new Error(`Unknown binding ${value}`)
      current = (current as Record<string,unknown>)[key]
    }
    return structuredClone(current)
  }
  if (Array.isArray(value)) return value.map(v=>bind(v,params,outputs))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=> {
    if (unsafe.has(k) || k.includes('{{')) throw new Error('Invalid binding key')
    return [k,bind(v,params,outputs)]
  }))
  return value
}
function parameters(header: Header, values: Record<string,unknown>): Record<string,unknown> {
  const result: Record<string,unknown> = {}
  for (const key of Object.keys(values)) if (!Object.hasOwn(header.params,key)) throw new Error(`Unknown parameter ${key}`)
  for (const [key,definition] of Object.entries(header.params)) {
    const value = Object.hasOwn(values,key) ? values[key] : definition.default
    if (typeof value !== definition.type || (typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Parameter ${key} requires ${definition.type}`)
    result[key] = value
  }
  return result
}
function read(yaml: string) {
  if (Buffer.byteLength(yaml)>64*1024) throw new Error('Flow exceeds 64 KiB')
  const counter = new LineCounter(), docs = parseAllDocuments(yaml,{lineCounter:counter})
  if (docs.length!==2 || docs.some(d=>d.errors.length)) throw new Error('Use a YAML header, --- and steps')
  const header = headerSchema.parse(docs[0]!.toJS({maxAliasCount:0}))
  const steps: unknown = docs[1]!.toJS({maxAliasCount:0})
  if (!Array.isArray(steps)||!steps.length||steps.length>100) throw new Error('Use 1–100 steps per flow')
  const lines = isSeq(docs[1]!.contents) ? docs[1]!.contents.items.map(n=>counter.linePos((n as any)?.range?.[0] ?? 0).line) : []
  const locations=new Map<unknown,number>()
  const mark=(ast:any,value:unknown)=>{if(ast?.range)locations.set(value,counter.linePos(ast.range[0]).line);if(isSeq(ast)&&Array.isArray(value))ast.items.forEach((item,index)=>mark(item,value[index]));if(isMap(ast)&&value&&typeof value==='object')for(const pair of ast.items)mark(pair.value,(value as Record<string,unknown>)[String(pair.key)])}
  mark(docs[1]!.contents,steps)
  return {header,steps,lines,locations}
}
export function inspectFlowHeader(yaml: string): Header { return read(yaml).header }
function condition(value: unknown, scope: Record<string,unknown>, outputs: Record<string,unknown>): Condition {
  const parsed = z.union([z.object({platform:z.enum(['android','ios'])}).strict(), z.object({equals:z.tuple([z.unknown(),z.unknown()])}).strict(),z.object({visible:z.unknown()}).strict(),z.object({notVisible:z.unknown()}).strict()]).parse(value)
  const bound = bind(parsed,bind(scope,{},outputs),outputs)
  if ('visible' in bound) parseElementSelector(bound.visible,'condition')
  if ('notVisible' in bound) parseElementSelector(bound.notVisible,'condition')
  return parsed as Condition
}
export function nativeYaml(header: Header, steps: unknown[]): string {
  return `${stringify({name:header.name,platform:header.platform,appId:header.appId,blockers:header.blockers})}---\n${stringify(steps)}`
}
export class WorkbenchPlanError extends Error {
  constructor(message: string, readonly line: number) { super(message) }
}
export async function compilePlan(yaml: string, project: ProjectSnapshot, supplied: Record<string,unknown> = {}, signal?: AbortSignal): Promise<ExecutionPlan> {
  signal?.throwIfAborted()
  const root = read(yaml), params = parameters(root.header,supplied), placeholders: Record<string,unknown> = {}
  for (const hook of [...root.header.prepare,...root.header.verify]) {
    const def = project.extensions[hook.ref]
    if (!def || def.role !== (root.header.prepare.includes(hook)?'prepare':'verify')) throw new Error(`Unregistered ${hook.ref} extension or wrong role`)
    if (def.cleanup && project.extensions[def.cleanup]?.role !== 'cleanup') throw new Error(`Unregistered cleanup ${def.cleanup}`)
    if (hook.as) { if (Object.hasOwn(placeholders,hook.as)) throw new Error('Duplicate output name'); placeholders[hook.as] = sampleShape(def.output) }
  }
  // Hook input bindings are validated in lifecycle order; verify outputs cannot feed UI.
  const available: Record<string,unknown> = {}
  for (const hook of root.header.prepare) { validateShape(project.extensions[hook.ref]!.input,bind(hook.args,params,available),'prepare input'); if (hook.as) available[hook.as] = placeholders[hook.as] }
  for (const hook of root.header.verify) validateShape(project.extensions[hook.ref]!.input,bind(hook.args,params,available),'verify input')
  let worstSteps = 0, worstSamples = 0, worstMeasurements = 0, hasAssertion = false
  const features = new Set<RuntimeFeature>(), measurements = new Set<string>()
  if (root.header.runtimeGates?.health) {
    features.add('app-health-v1')
    if (root.header.runtimeGates.health.signals.some(signal => root.header.platform === 'ios' ? signal === 'anr' : signal === 'hang')) throw new Error('health-signal-platform-mismatch')
  }
  async function build(steps: unknown[], header: Header, scope: Record<string,unknown>, path: string, stack: string[], depth: number, multiplier: number, lines: number[] = [], locations: Map<unknown,number> = root.locations, inMeasure = false, document = yaml): Promise<PlanNode[]> {
    if (depth>5) throw new Error('Flow nesting exceeds 5')
    const nodes: PlanNode[] = []
    for (let i=0;i<steps.length;i++) {
      signal?.throwIfAborted()
      const sourceIndex = i
      try {
      const raw = steps[i], stepPath = `${path}/${i+1}`
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 1 && RUNTIME_OPERATIONS.some(key => key in raw)) {
        const operation = Object.keys(raw)[0]!, body = (raw as Record<string, unknown>)[operation]
        const resolved = bind(body, bind(scope, {}, available), available), line = lines[i] ?? locations.get(raw) ?? 0
        if (operation === 'measure') {
          const measure = measureStepSchema.parse(resolved)
          if (inMeasure || measurements.has(measure.id) || measurements.size >= 8) throw new Error('measurement-nested-duplicate-or-budget')
          worstMeasurements += multiplier
          if (worstMeasurements > 256) throw new Error('measurement-expanded-report-budget')
          measurements.add(measure.id); features.add('e2e-measure-v1')
          const nested = await build((body as { steps: unknown[] }).steps, header, scope, `${stepPath}/measure`, stack, depth + 1, multiplier, [], locations, true, document)
          const hasEndpoint = (nodes: PlanNode[]): boolean => nodes.some(node => node.kind === 'temporal' || node.kind === 'business' || node.kind === 'visual' || node.kind === 'ocr' || node.kind === 'recover'
            || node.kind === 'ready' && node.raw.operation === 'assertReady' || node.kind === 'leaf' && node.validated.parsed.steps.some(step => step.kind === 'assert')
            || node.kind === 'if' && (hasEndpoint(node.then) || hasEndpoint(node.else)) || node.kind === 'repeat' && hasEndpoint(node.steps))
          if (!hasEndpoint(nested)) throw new Error('measurement-assertion-required')
          nodes.push({ kind: 'measure', path: stepPath, line, id: measure.id, maxElapsedMs: measure.maxElapsedMs, steps: nested })
          continue
        }
        worstSteps += multiplier
        if (worstSteps > 500) throw new Error('Expanded flow exceeds 500 steps')
        if (operation === 'assertEventually' || operation === 'assertStable') {
          const { step } = await parseTemporalStep(operation, resolved, header)
          worstSamples += temporalWorstSamples(step) * multiplier
          if (worstSamples > 1024) throw new Error('temporal-run-sample-budget')
          features.add('temporal-ui-v1'); hasAssertion = true
          nodes.push({ kind: 'temporal', path: stepPath, line, operation, raw: body, scope, header })
        } else if (operation === 'restartApp') {
          const restart = restartStepSchema.parse(resolved); features.add('app-restart-v1')
          nodes.push({ kind: 'restart', path: stepPath, line, timeoutMs: restart.timeoutMs, header })
        } else {
          const business = parseBusinessStep(resolved), extension = project.extensions[business.ref]
          if (!extension || extension.role !== 'verify' || !extension.observation?.readOnly || !extension.observation.repeatable
            || !extension.observation.allowedModes.includes(business.mode)) throw new Error('business-observation-unregistered-or-mode-forbidden')
          validateShape(extension.input, business.args, 'business input'); features.add('step-business-v1')
          worstSamples += (business.mode === 'once' ? 1 : Math.ceil(business.withinMs / business.pollMs) + 2) * multiplier
          if (worstSamples > 1024) throw new Error('temporal-run-sample-budget')
          nodes.push({ kind: 'business', path: stepPath, line, raw: body, scope, header })
        }
        continue
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 1 && 'assertTextInRegion' in raw) {
        const assertion = z.object({ profile: nameSchema }).strict().parse(raw.assertTextInRegion)
        const registration = project.ocrProfiles?.[assertion.profile]
        if (!registration) throw new Error('ocr-profile-unregistered')
        const { profile, page } = requireOcrApproval(registration, ocrProjectDigest(project))
        parseElementSelector(page, 'OCR page precondition')
        if (profile.platform !== header.platform || profile.appId !== header.appId) throw new Error('ocr-profile-app-platform-mismatch')
        worstSteps += multiplier
        if (worstSteps > 500) throw new Error('Expanded flow exceeds 500 steps')
        nodes.push({ kind: 'ocr', path: stepPath, line: lines[i] ?? locations.get(raw) ?? 0, profile: assertion.profile, header })
        continue
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 1 && READY_OPERATIONS.some(key => key in raw)) {
        const operation = Object.keys(raw)[0]!, body = (raw as Record<string, unknown>)[operation]
        if (!body || typeof body !== 'object' || Array.isArray(body) || 'operation' in body) throw new Error('Readiness step requires a structured target')
        const value = { operation, ...body }
        parseReadyStep(bind(value, bind(scope, {}, available), available))
        hasAssertion ||= operation === 'assertReady'; worstSteps += multiplier
        if (worstSteps > 500) throw new Error('Expanded flow exceeds 500 steps')
        nodes.push({ kind: 'ready', path: stepPath, line: lines[i] ?? locations.get(raw) ?? 0, raw: value, scope, header })
        continue
      }
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 1 && 'assertVisual' in raw) {
        const assertion = z.object({ profile: nameSchema }).strict().parse((raw as { assertVisual: unknown }).assertVisual)
        const profile = project.visualProfiles?.[assertion.profile]
        if (!profile || profile.platform !== header.platform || profile.appId !== header.appId) throw new Error(`Unregistered visual profile or App/platform mismatch: ${assertion.profile}`)
        worstSteps += multiplier
        if (worstSteps > 500) throw new Error('Expanded flow exceeds 500 steps')
        nodes.push({ kind: 'visual', path: stepPath, line: lines[i] ?? locations.get(raw) ?? 0, profile: assertion.profile, header })
        continue
      }
      if (raw && typeof raw === 'object' && 'recover' in raw) {
        const wrapper = z.object({ recover: z.object({ id: nameSchema, policy: nameSchema, step: z.object({ tap: z.unknown() }).strict(), postcondition: z.object({ visible: z.unknown() }).strict() }).strict() }).strict().parse(raw).recover
        const policy = project.recoveryPolicies[wrapper.policy]
        if (!policy || policy.platform !== header.platform || policy.appId !== header.appId) throw new Error('Unknown recovery policy or app/platform mismatch')
        if (!project.recoveryModels[policy.modelRef]) throw new Error('Unknown recovery model')
        parseElementSelector(policy.page, 'recovery page')
        for (const target of policy.allowedTargets) parseElementSelector(target, 'recovery target')
        const resolved = bind(wrapper, bind(scope, {}, available), available)
        if (JSON.stringify(wrapper).includes('{{')) throw new Error('Recovery selectors must be static')
        parseElementSelector(resolved.step.tap, 'recovery tap')
        const postcondition = await parseWorkbenchFlow(nativeYaml(header, [{ assertVisible: resolved.postcondition.visible }]), true, signal)
        worstSteps += 3 * multiplier; hasAssertion = true
        if (worstSteps > 500) throw new Error('Expanded flow exceeds 500 steps')
        nodes.push({ kind: 'recover', path: stepPath, line: lines[i] ?? locations.get(raw) ?? 0, id: wrapper.id, policy: wrapper.policy, tap: resolved.step.tap, postcondition, header })
        continue
      }
      if (raw==='done') { if(i!==steps.length-1) throw new Error('done must be last'); if(path!=='root')continue }
      if (raw && typeof raw==='object' && !Array.isArray(raw) && Object.keys(raw).length===1 && ('runFlow' in raw || 'if' in raw || 'repeat' in raw)) {
        if ('runFlow' in raw) {
          const call = z.object({ref:nameSchema,with:valuesSchema.default({})}).strict().parse(raw.runFlow)
          if(stack.includes(call.ref)) throw new Error('Cyclic flow reference')
          if(!Object.hasOwn(project.flows,call.ref)) throw new Error(`Unknown flow ${call.ref}`)
          const sub = read(project.flows[call.ref]!)
          if(sub.header.platform!==root.header.platform||sub.header.appId!==root.header.appId||sub.header.prepare.length||sub.header.verify.length||sub.header.runtimeGates) throw new Error('Subflow must share platform/appId and cannot declare hooks')
          const childScope=parameters(sub.header,bind(call.with,bind(scope,{},available),available))
          for(const [key,value] of Object.entries(call.with)) {if(typeof value==='string' && /\{\{\s*outputs\./.test(value))childScope[key]=value;else if(typeof value==='string' && value.match(binding)?.[1]==='params'){const keyPath=value.match(binding)![2]!;if(typeof scope[keyPath]==='string'&&/\{\{\s*outputs\./.test(scope[keyPath] as string))childScope[key]=scope[keyPath]}}
          nodes.push(...await build(sub.steps,{...sub.header,blockers:[...header.blockers,...sub.header.blockers]},childScope,`${stepPath}:${call.ref}`,[...stack,call.ref],depth+1,multiplier,sub.lines,sub.locations,inMeasure,project.flows[call.ref]!))
        } else if ('if' in raw) {
          const branch = z.object({condition:z.unknown(),then:z.array(z.unknown()).min(1),else:z.array(z.unknown()).default([])}).strict().parse(raw.if)
          nodes.push({kind:'if',path:stepPath,condition:condition(branch.condition,scope,available),scope,then:await build(branch.then,header,scope,`${stepPath}/then`,stack,depth+1,multiplier,[],locations,inMeasure,document),else:await build(branch.else,header,scope,`${stepPath}/else`,stack,depth+1,multiplier,[],locations,inMeasure,document)})
        } else {
          const loop = z.union([z.object({times:z.number().int().min(1).max(20),steps:z.array(z.unknown()).min(1)}).strict(),z.object({until:z.unknown(),maxIterations:z.number().int().min(1).max(20),steps:z.array(z.unknown()).min(1)}).strict()]).parse(raw.repeat)
          const times = 'times' in loop ? loop.times : loop.maxIterations
          nodes.push({kind:'repeat',path:stepPath,scope,times,...('until' in loop ? {condition:condition(loop.until,scope,available)}:{}),steps:await build(loop.steps,header,scope,`${stepPath}/body`,stack,depth+1,multiplier*times,[],locations,inMeasure,document)})
        }
      } else {
        // Coalesce adjacent leaves so existing flows pay only one native startup.
        const raws = [raw]; const start = i
        while(i+1<steps.length) { const next = steps[i+1]; if((next==='done'&&path!=='root')||(next&&typeof next==='object'&&['if','repeat','runFlow','recover','assertVisual','assertTextInRegion',...READY_OPERATIONS,...RUNTIME_OPERATIONS].some(k=>k in next))) break; raws.push(next);i++ }
        const resolved = bind(raws,bind(scope,{},available),available)
        const validated = await parseWorkbenchFlow(nativeYaml(header,resolved),true,signal)
        if (validated.parsed.steps.length !== raws.length) throw new Error('Native parser changed source step cardinality')
        const sourceSteps: SourceStepIdentity[] = raws.map((item, index) => ({ version: 1, documentSha256: factDigest(document),
          path: `${path}/${start + index + 1}`, stepSha256: stepDigest(item), line: lines[start + index] ?? locations.get(item) ?? 0,
          topLevel: depth === 0, static: !JSON.stringify(item).includes('{{') }))
        worstSteps += validated.parsed.steps.length*multiplier
        hasAssertion ||= validated.parsed.steps.some(s=>s.kind==='assert')
        if(worstSteps>500) throw new Error('Expanded flow exceeds 500 steps')
        nodes.push({kind:'leaf',path:stepPath,line:lines[start]??locations.get(raw)??0,sourceLines:sourceSteps.map(item=>item.line),sourceSteps,raw:raws,scope,header,validated,dynamic:/\{\{\s*outputs\./.test(JSON.stringify([raws,scope]))})
      }
      } catch (error) {
        if (path !== 'root') throw error
        throw new WorkbenchPlanError(error instanceof Error ? error.message : String(error), lines[sourceIndex] ?? locations.get(steps[sourceIndex]) ?? 0)
      }
    }
    return nodes
  }
  if(root.steps.at(-1)!=='done')root.steps.push('done')
  const nodes = await build(root.steps,root.header,params,'root',[],0,1,root.lines)
  if(!hasAssertion) throw new Error('At least one structured assertion is required')
  return {yaml,header:root.header,params,nodes,project,worstSteps,...(features.size ? { requiredFeatures: [...features], worstSamples } : {})}
}
