import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { LocalDeviceRuntime } from './local-device-runtime.js'
import type { StandaloneMcpConfig } from './mcp-config.js'
import { MobileMirrorCommandError, type MobileMirrorCommandResult } from './mobile-mirror-commands.js'
import { TestRunControlError } from './test-run-control.js'
import { DeviceOwnerClaimError } from './device-owner-claim.js'
import { summarizeObservation, projectObservation } from './observation-store.js'
import { screenError, ScreenObservationError } from './screen-errors.js'
import {
  MOBILE_MIRROR_TOOL_CONTRACTS,
  MOBILE_MIRROR_TOOL_NAMES,
  REPAIR_TOOL_CONTRACTS,
  REPAIR_TOOL_NAMES,
  type MobileMirrorToolName,
} from './tool-contracts.js'
import { WdaStartError } from './wda-errors.js'
import { PACKAGE_VERSION } from './version.js'
import { repairToolsVisible } from './repair-tool-visibility.js'
import { RepairError } from './workbench-repair-contracts.js'

type HandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

export interface MobileMirrorMcpServerOptions {
  runtime?: LocalDeviceRuntime
  progressDelayMs?: number
  logger?: (message: string) => void
}

export class MobileMirrorMcpServer {
  readonly runtime: LocalDeviceRuntime
  readonly server: Server
  readonly #config: StandaloneMcpConfig
  readonly #progressDelayMs: number
  readonly #logger: (message: string) => void
  readonly #activeCalls = new Set<AbortController>()
  #connected = false
  #closePromise: Promise<void> | null = null

  constructor(config: StandaloneMcpConfig, options: MobileMirrorMcpServerOptions = {}) {
    this.#config = config
    this.#progressDelayMs = options.progressDelayMs ?? 300
    this.#logger = options.logger ?? (() => undefined)
    this.runtime = options.runtime ?? new LocalDeviceRuntime(config.mirror)
    this.server = new Server(
      { name: 'mobile-mirror', version: PACKAGE_VERSION },
      {
        capabilities: { tools: {} },
        instructions: 'Use discrete mobile observations and observation-bound actions. Open the loopback Viewer URL for human supervision; continuous video is not returned through MCP.',
      },
    )
    this.#registerHandlers()
  }

  async connect(transport: Transport): Promise<void> {
    if (this.#closePromise) throw new Error('MCP server is closed')
    if (this.#connected) throw new Error('MCP server is already connected')
    try {
      await this.runtime.listen()
      await this.server.connect(transport)
      this.#connected = true
    } catch (error) {
      await this.runtime.close().catch(() => undefined)
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closePromise = (async () => {
      if (this.#connected) await this.server.close().catch(() => undefined)
      this.#connected = false
      await this.runtime.viewer.closeListener().catch(() => undefined)
      for (const controller of this.#activeCalls) controller.abort(new Error('MCP server is closing'))
      await this.runtime.close()
    })()
    return this.#closePromise
  }

  #registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...MOBILE_MIRROR_TOOL_CONTRACTS, ...(repairToolsVisible(this.#config.mirror) ? REPAIR_TOOL_CONTRACTS : [])].map((contract) => ({
        name: contract.name,
        description: contract.description,
        inputSchema: contract.inputSchema,
        outputSchema: contract.outputSchema,
        annotations: contract.annotations,
      })),
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      if (!isToolName(request.params.name, repairToolsVisible(this.#config.mirror)))
        return errorResult('mobile_mirror_tool_not_found', 'Unknown mobile mirror tool')
      const name = request.params.name
      const controller = new AbortController()
      this.#activeCalls.add(controller)
      const signal = AbortSignal.any([extra.signal, controller.signal])
      try {
        return await this.#withProgress(name, request.params._meta?.progressToken, extra, async () => {
          const result = await this.runtime.commands.execute(name, request.params.arguments ?? {}, signal)
          return this.#projectResult(result)
        })
      } catch (error) {
        return publicErrorResult(error, signal.aborted)
      } finally {
        this.#activeCalls.delete(controller)
      }
    })
  }

  #projectResult(result: MobileMirrorCommandResult): CallToolResult {
    if (result.kind === 'data') return successResult(result.value)
    if (result.kind === 'artifact-image') {
      if (result.value.bytes.byteLength > this.#config.mcp.maxImageBytes) throw screenError('screen_observation_too_large')
      return {
        content: [
          { type: 'text', text: serialize(result.value.metadata) },
          { type: 'image', data: Buffer.from(result.value.bytes).toString('base64'), mimeType: result.value.contentType },
        ],
        structuredContent: result.value.metadata,
      }
    }
    const observation = result.value
    if (observation.image && observation.image.bytes.byteLength > this.#config.mcp.maxImageBytes) {
      throw screenError('screen_observation_too_large')
    }
    const summary = projectObservation(summarizeObservation(observation, observation.image ? 'mcp-image-content' : 'core-memory'), result.structureMode)
    const content: CallToolResult['content'] = [{ type: 'text', text: serialize(summary) }]
    if (observation.image) {
      content.push({
        type: 'image',
        data: Buffer.from(observation.image.bytes).toString('base64'),
        mimeType: observation.image.contentType,
      })
    }
    return {
      content,
      structuredContent: summary as unknown as Record<string, unknown>,
    }
  }

  async #withProgress(
    name: MobileMirrorToolName,
    progressToken: string | number | undefined,
    extra: HandlerExtra,
    operation: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    if (name === 'mobile_mirror_status' || progressToken === undefined) return operation()
    const notify = async (progress: number, message: string) => {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress, total: 1, message },
      }).catch(() => this.#logger('MCP progress notification could not be delivered'))
    }
    await notify(0, `${name}: started`)
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) void notify(0.5, `${name}: ${this.#progressPhase()}`)
    }, this.#progressDelayMs)
    timer.unref()
    try {
      const result = await operation()
      settled = true
      clearTimeout(timer)
      await notify(1, `${name}: completed`)
      return result
    } catch (error) {
      settled = true
      clearTimeout(timer)
      await notify(1, `${name}: failed`)
      throw error
    }
  }

  #progressPhase(): string {
    const state = this.runtime.service.state()
    if (state.observation.phase === 'capturing') return 'capturing'
    if (state.control.phase !== 'idle') return state.control.phase
    return state.lifecycle
  }
}

function successResult(value: object): CallToolResult {
  return {
    content: [{ type: 'text', text: serialize(value) }],
    structuredContent: value as Record<string, unknown>,
  }
}

function publicErrorResult(error: unknown, aborted: boolean): CallToolResult {
  if (aborted || isAbortError(error)) return errorResult('mobile_mirror_cancelled', 'Mobile mirror operation was cancelled')
  if (error instanceof ScreenObservationError || error instanceof WdaStartError || error instanceof TestRunControlError || error instanceof DeviceOwnerClaimError || error instanceof RepairError) return errorResult(error.code, error.message)
  if (error instanceof MobileMirrorCommandError) return errorResult(error.code, 'Invalid mobile mirror tool arguments')
  return errorResult('mobile_mirror_operation_failed', 'Mobile mirror operation failed')
}

function errorResult(code: string, message: string): CallToolResult {
  const value = { ok: false, error: { code, message } }
  return { isError: true, content: [{ type: 'text', text: serialize(value) }] }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message))
}

function isToolName(value: string, repairEnabled = false): value is MobileMirrorToolName {
  return (MOBILE_MIRROR_TOOL_NAMES as readonly string[]).includes(value)
    || (repairEnabled && (REPAIR_TOOL_NAMES as readonly string[]).includes(value))
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
