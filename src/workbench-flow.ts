import { parseAllDocuments, stringify } from 'yaml'
import { validatePublicText } from './semantic-actions.js'
import type { TextInputMode } from './types.js'
import { Worker } from 'node:worker_threads'
import { runOwnedWorker, WorkerTimeoutError } from './workbench-worker-lifecycle.js'
import { parseElementSelector } from '@appclaw/core/flow/selector'
import type { ElementSelector, ParsedFlow } from '@appclaw/core/flow/types'
import type { ReadyStep } from './workbench-readiness.js'

export const WORKBENCH_WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? '../scripts/workbench-worker.mjs' : './workbench-worker.js', import.meta.url)

export const WORKBENCH_ENGINE = 'AppClaw 2.7.0 · MirrorService' as const
export interface WorkbenchFlow { yaml: string; parsed: ParsedFlow; blockers: ElementSelector[]; inputModes: Record<number, TextInputMode>; readySteps?: Record<number, ReadyStep> }

export async function parseWorkbenchFlow(yaml: string, block = false, signal?: AbortSignal): Promise<WorkbenchFlow> {
  signal?.throwIfAborted()
  if (typeof yaml !== 'string' || Buffer.byteLength(yaml) > 64 * 1024 || yaml.includes('${')) throw new Error('YAML must be at most 64 KiB, without environment or secret interpolation')
  const docs = parseAllDocuments(yaml)
  if (docs.length !== 2 || docs.some((d) => d.errors.length)) throw new Error('Use a YAML header, --- and a flat step list')
  const header: unknown = docs[0]!.toJS({ maxAliasCount: 0 })
  const raw: unknown = docs[1]!.toJS({ maxAliasCount: 0 })
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('Missing flow header')
  const meta = header as Record<string, unknown>
  if (Object.keys(meta).some((k) => !['name', 'platform', 'appId', 'blockers'].includes(k))) throw new Error('Supported header fields: name, platform, appId, blockers')
  if (typeof meta.name !== 'string' || !meta.name.trim() || meta.name.length > 160) throw new Error('A flow name is required (max 160 characters)')
  if (meta.platform !== 'android' && meta.platform !== 'ios') throw new Error('platform must be android or ios')
  if (typeof meta.appId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test(meta.appId)) throw new Error('A valid installed appId is required')
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw new Error('Use 1–100 flat steps')
  const inputModes: Record<number, TextInputMode> = {}
  const allowed = new Set(['type', 'tap', 'assert', 'assertVisible', 'assertNotVisible', 'assertCount', 'waitUntil', 'waitUntilGone', 'wait', 'swipe'])
  for (const [i, step] of raw.entries()) {
    if (typeof step === 'string') {
      if (!['launchApp', 'back', 'done'].includes(step)) throw new Error(`Step ${i + 1}: use structured YAML; natural language is disabled`)
      if (step === 'done' && i !== raw.length - 1) throw new Error('done must be the last step')
    } else if (!step || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).length !== 1 || !allowed.has(Object.keys(step)[0]!)) {
      throw new Error(`Step ${i + 1}: unsupported deterministic step`)
    }
  }
  for (const [i, step] of raw.entries()) {
    if (!step || typeof step !== 'object' || !('type' in step)) continue
    const value = step.type
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('type requires a structured selector and public text')
    const mode = value.mode ?? 'replace'
    const text = value.text ?? value.value
    if (typeof text !== 'string' || !['replace', 'append'].includes(mode)) throw new Error('type text must be a string; mode must be replace or append')
    validatePublicText(text, mode)
    inputModes[i + 1] = mode
    delete value.mode
  }
  // Keep the source YAML intact for evidence; feed only native fields to AppClaw.
  const parsed = await parseNativeFlow(`${stringify({ name: meta.name, platform: meta.platform, appId: meta.appId })}---\n${stringify(raw)}`, signal)
  let assertions = 0
  for (const [i, step] of parsed.steps.entries()) {
    if (['type', 'tap', 'assert', 'waitUntil'].includes(step.kind) && !('selector' in step && step.selector)) throw new Error(`Step ${i + 1}: a structured selector is required`)
    if (step.kind === 'assert') assertions++
    if (step.kind === 'wait' && (!Number.isFinite(step.seconds) || step.seconds < 0 || step.seconds > 60)) throw new Error('wait must be between 0 and 60 seconds')
    if (step.kind === 'waitUntil' && (!Number.isFinite(step.timeoutSeconds) || step.timeoutSeconds > 60)) throw new Error('waitUntil timeout must be at most 60 seconds')
    if (step.kind === 'swipe' && (step.selector || step.target || !Number.isInteger(step.repeat ?? 1) || (step.repeat ?? 1) < 1 || (step.repeat ?? 1) > 10)) throw new Error('Use a direction-only swipe, repeated 1–10 times')
    if (!['type', 'tap', 'assert', 'waitUntil', 'wait', 'swipe', 'back', 'launchApp', 'done'].includes(step.kind)) throw new Error(`Unsupported step ${step.kind}`)
  }
  if (!block && !assertions) throw new Error('At least one structured assertion is required')
  if (!block && parsed.steps.at(-1)?.kind !== 'done') parsed.steps.push({ kind: 'done' })
  if (meta.blockers !== undefined && (!Array.isArray(meta.blockers) || meta.blockers.length > 20)) throw new Error('blockers must contain at most 20 selectors')
  const blockers = (meta.blockers as unknown[] | undefined ?? []).map((s, i) => parseElementSelector(s, `blockers[${i}]`))
  return { yaml, parsed, blockers, inputModes }
}

// Native parsing is isolated as well: AppClaw loads dotenv/config on import.
// Unrelated host environment/API keys must not select a model or affect startup.
async function parseNativeFlow(yaml: string, signal?: AbortSignal): Promise<ParsedFlow> {
  try {
    return await runOwnedWorker(WORKBENCH_WORKER_URL, {
      workerData: { mode: 'parse', yaml },
      env: { DOTENV_CONFIG_PATH: '/dev/null', AGENT_MODE: 'dom', NO_COLOR: '1' },
      stdout: true, stderr: true,
    }, raw => {
      const event = raw as { parsed?: ParsedFlow; error?: string }
      if (!event?.parsed) throw new Error(event?.error ?? 'Native parser failed')
      return event.parsed
    }, signal, 10_000, 'Native YAML validation', (url, options) => {
      const worker = new Worker(url, options)
      worker.stdout.resume(); worker.stderr.resume()
      return worker
    })
  } catch (error) {
    if (error instanceof WorkerTimeoutError) throw new Error('Native YAML validation timed out', { cause: error })
    throw error
  }
}
