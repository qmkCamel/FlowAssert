import { z } from 'zod'

const integer = z.number().int().nonnegative().max(1_000_000)
const text = z.string().max(64_000)
const envelope = { protocolVersion: z.literal(1), sequence: integer.min(1) }
const resultSchema = z.object({ success: z.boolean(), stepsExecuted: integer, stepsTotal: integer, failedAt: integer.optional(), reason: text.optional() })
  .transform(({ failedAt, reason, ...result }) => ({ ...result, ...(failedAt !== undefined ? { failedAt } : {}), ...(reason !== undefined ? { reason } : {}) }))
const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('tool'), id: integer.min(1), name: z.enum(['appium_get_page_source', 'appium_set_value', 'appium_screenshot', 'appium_app_lifecycle', 'appium_gesture', 'appium_mobile_press_key']), args: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ ...envelope, type: z.literal('step'), step: integer.min(1), total: integer.min(1), kind: z.string().min(1).max(80), target: text.optional(), status: z.enum(['running', 'passed', 'failed']), error: text.optional(), message: text.optional(), durationMs: z.number().finite().nonnegative().optional() }).strict(),
  z.object({ ...envelope, type: z.literal('result'), result: resultSchema }).strict(),
  z.object({ ...envelope, type: z.literal('failure'), error: text }).strict(),
])
export type NativeExecutionResult = z.infer<typeof resultSchema>

/** One instance per native block; parse before dispatch, never trust a TS event annotation. */
export class NativeWorkerProtocol {
  #sequence = 0
  #toolId = 0
  #started = 0
  #active: number | null = null
  #failed = false
  #done = false
  constructor(private readonly kinds: readonly string[]) {}

  accept(input: unknown) {
    const event = eventSchema.parse(input)
    if (Buffer.byteLength(JSON.stringify(event)) > 1024 * 1024) throw new Error('Executor message exceeds budget')
    if (this.#done || event.sequence !== this.#sequence + 1) throw new Error('Invalid executor sequence')
    if (event.type === 'tool') {
      if (this.#active === null || event.id !== this.#toolId + 1) throw new Error('Unexpected executor tool dispatch')
      this.#toolId = event.id
    } else if (event.type === 'step') {
      if (event.step > this.kinds.length || event.total < this.kinds.length || event.total > this.kinds.length + 1 || event.kind !== this.kinds[event.step - 1]) throw new Error('Executor step does not match the compiled block')
      if (event.status === 'running') {
        if (this.#active !== null || this.#failed || event.step !== this.#started + 1) throw new Error('Invalid executor step start')
        this.#started = event.step; this.#active = event.step
      } else {
        if (this.#active !== event.step) throw new Error('Executor terminal step without matching start')
        this.#active = null; this.#failed ||= event.status === 'failed'
      }
    } else {
      if (event.type === 'result') {
        if (event.result.stepsExecuted > event.result.stepsTotal || event.result.stepsTotal < this.kinds.length || event.result.stepsTotal > this.kinds.length + 1) throw new Error('Invalid executor result counts')
        if (this.#active !== null || (event.result.success && (this.#failed || this.#started !== this.kinds.length))) throw new Error('Premature executor success or unfinished step')
      }
      this.#done = true
    }
    this.#sequence = event.sequence
    return event
  }
}
