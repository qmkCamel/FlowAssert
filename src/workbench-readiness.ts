import { setTimeout as sleep } from 'node:timers/promises'
import { z } from 'zod'
import { isSensitivePlatformRole, validatePublicText } from './semantic-actions.js'
import type { ScreenNode, ScreenStructure } from './types.js'

const field = z.string().min(1).max(128).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Control characters are forbidden')
const selectorBase = z.object({ testId: field.optional(), role: z.enum(['application', 'button', 'checkbox', 'image', 'input', 'link', 'list', 'list-item', 'scroll-view', 'switch', 'text', 'unknown']).optional(), name: field.optional(), text: field.optional() }).strict()
const nonempty = (value: object) => Object.keys(value).length > 0
export const semanticTargetSchema = selectorBase.extend({ within: selectorBase.refine(nonempty, 'Empty scope').optional() }).strict()
  .refine(value => ['testId', 'role', 'name', 'text'].some(key => Object.hasOwn(value, key)), 'Empty target')
export type SemanticTarget = z.infer<typeof semanticTargetSchema>
const readiness = z.object({ target: semanticTargetSchema, timeoutMs: z.number().int().min(100).max(60_000).default(5000), pollMs: z.number().int().min(50).max(1000).default(150) }).strict()
export const readyStepSchema = z.discriminatedUnion('operation', [
  readiness.extend({ operation: z.literal('tapReady') }).strict(),
  readiness.extend({ operation: z.literal('fillReady'), text: z.string().max(4096), mode: z.enum(['replace', 'append']).default('replace') }).strict(),
  readiness.extend({ operation: z.literal('waitFor'), state: z.enum(['visible', 'hidden', 'enabled']).default('visible') }).strict(),
  readiness.extend({ operation: z.literal('assertReady'), state: z.enum(['visible', 'hidden', 'enabled']).default('visible') }).strict(),
])
export type ReadyStep = z.infer<typeof readyStepSchema>
export const READY_OPERATIONS = ['tapReady', 'fillReady', 'waitFor', 'assertReady'] as const
export function parseReadyStep(value: unknown): ReadyStep {
  const step = readyStepSchema.parse(value)
  if (step.operation === 'fillReady') validatePublicText(step.text, step.mode)
  return step
}
export class ReadinessFailure extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ReadinessFailure' }
}
const matches = (node: ScreenNode, selector: Omit<SemanticTarget, 'within'>) =>
  (selector.testId === undefined || node.identifier === selector.testId) &&
  (selector.role === undefined || node.role === selector.role) &&
  (selector.name === undefined || node.name === selector.name) &&
  (selector.text === undefined || node.text === selector.text)

/** Exact matching against the same normalized tree used by Inspector. Never pick the first duplicate. */
export function resolveSemanticTarget(structure: ScreenStructure, target: SemanticTarget): ScreenNode[] {
  if (structure.truncated) throw new ReadinessFailure('readiness-incomplete-tree')
  let candidates = structure.nodes
  if (target.within) {
    const parents = candidates.filter(node => matches(node, target.within!))
    if (parents.length > 1) throw new ReadinessFailure('ambiguous-scope')
    if (!parents.length) throw new ReadinessFailure('readiness-scope-missing')
    const root = parents[0]!
    if (root.sensitive || isSensitivePlatformRole(root.platformRole)) throw new ReadinessFailure('sensitive-target')
    const index = new Map(candidates.map(node => [node.nodeId, node]))
    candidates = candidates.filter(node => {
      const visited = new Set<string>(); let parent = node.parentId
      while (parent && !visited.has(parent)) { if (parent === root.nodeId) return true; visited.add(parent); parent = index.get(parent)?.parentId }
      return false
    })
  }
  const result = candidates.filter(node => matches(node, target))
  if (result.some(node => node.sensitive || isSensitivePlatformRole(node.platformRole))) throw new ReadinessFailure('sensitive-target')
  if (result.length > 1) throw new ReadinessFailure('ambiguous-target')
  return result
}

export function readinessCondition(structure: ScreenStructure, target: SemanticTarget, state: 'visible' | 'hidden' | 'enabled'): boolean {
  const [node] = resolveSemanticTarget(structure, target)
  if (state === 'hidden') return !node || node.visible === false
  return Boolean(node && node.visible === true && node.bounds && node.bounds.width > 0 && node.bounds.height > 0 && (state !== 'enabled' || node.enabled === true))
}
export function readinessFingerprint(node: ScreenNode): string {
  return JSON.stringify([node.identifier, node.role, node.name, node.text, node.bounds])
}

export async function waitForReadiness(step: ReadyStep, observe: (signal: AbortSignal) => Promise<ScreenStructure>, signal: AbortSignal, focused = false): Promise<ScreenNode | undefined> {
  const deadline = AbortSignal.timeout(step.timeoutMs), combined = AbortSignal.any([signal, deadline])
  let previous: string | undefined, reason = 'missing'
  const actionable = step.operation === 'tapReady' || step.operation === 'fillReady'
  try {
    while (true) {
      combined.throwIfAborted()
      const structure = await observe(combined)
      combined.throwIfAborted()
      let node: ScreenNode | undefined
      try { [node] = resolveSemanticTarget(structure, step.target) }
      catch (error) {
        if (!(error instanceof ReadinessFailure) || error.code !== 'readiness-scope-missing') throw error
        reason = 'scope-missing'; previous = undefined
        await sleep(step.pollMs, undefined, { signal: combined }); continue
      }
      const state = 'state' in step ? step.state : 'enabled'
      if (state === 'hidden' && (!node || node.visible === false)) return undefined
      if (!node) reason = 'missing'
      else if (state === 'hidden') reason = 'still-visible'
      else if (node.visible !== true || !node.bounds || node.bounds.width <= 0 || node.bounds.height <= 0) reason = 'hidden'
      else if ((actionable || state === 'enabled') && node.enabled !== true) reason = 'disabled'
      else if (focused && node.focused !== true) reason = 'unfocused'
      else {
        const fingerprint = readinessFingerprint(node)
        if (!actionable || fingerprint === previous) return node
        previous = fingerprint; reason = 'unstable'
        await sleep(step.pollMs, undefined, { signal: combined }); continue
      }
      previous = undefined
      await sleep(step.pollMs, undefined, { signal: combined })
    }
  } catch (error) {
    signal.throwIfAborted()
    if (deadline.aborted) throw new ReadinessFailure(`readiness-timeout-${reason}`)
    throw error
  }
}
