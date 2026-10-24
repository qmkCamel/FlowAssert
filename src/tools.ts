import type { ParameterSchemaSpec, ToolDefinition, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Config } from './config.js'
import { IosWdaPreflightService } from './ios-wda-preflight.js'
import { MobileMirrorCommands, type MobileMirrorCommandResult } from './mobile-mirror-commands.js'
import { summarizeObservation, projectObservation } from './observation-store.js'
import { screenError } from './screen-errors.js'
import { dshOutputSchema, dshParameters, mobileMirrorToolContract, REPAIR_TOOL_CONTRACTS, SCREEN_OBSERVATION_OUTPUT_SCHEMA } from './tool-contracts.js'
import { repairToolsVisible } from './repair-tool-visibility.js'
import type { ScreenObservation, ScreenObservationSummary } from './types.js'
import { ViewerServer } from './viewer-server.js'
import type { TestEvidenceImage } from './test-run-control.js'

type ToolContext = {
  tools: {
    register(tool: unknown): unknown
  }
  attachments?: {
    imageLimits: {
      maxImageBytes: number
      maxImagesPerMessage: number
      maxMessageImageBytes: number
      maxImagePixels: number
      mediaTypes: readonly string[]
    }
    saveImage(input: { data: Uint8Array; mediaType: 'image/png'; name?: string }): Promise<ImageAttachmentRef>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mobile-mirror': { kind: 'mobile-mirror' } & ContextFormed
  }
}

type DshToolExec = Pick<ToolRunContext, 'signal' | 'deferContext'>

type MessageFactory = (input: {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; attachment: ImageAttachmentRef }>
  source: { kind: 'mobile-mirror'; form: 'notice'; summary: string }
}) => UserMessage

// Shared contracts are runtime schemas, so their result shape cannot be inferred
// from a literal DSL. The registry validates their canonical values at dispatch.
type DshToolDefinition = Omit<ToolDefinition, 'parameters' | 'output' | 'execute'> & {
  parameters: ParameterSchemaSpec
  output: { schema: ValueSchemaSpec; render(args: unknown, value: unknown): ContentBlock[] }
  execute(args: Record<string, unknown>, exec: DshToolExec): Promise<unknown>
}
type DefineToolFactory = (definition: DshToolDefinition) => unknown

export function registerTools(
  ctx: ToolContext,
  target: ViewerServer | MobileMirrorCommands,
  config: Config,
  services: {
    iosWdaPreflight?: Pick<IosWdaPreflightService, 'run'>
    createUserMessage?: MessageFactory
    defineTool: DefineToolFactory
  },
): void {
  const defineTool = services.defineTool
  const iosWdaPreflight = services.iosWdaPreflight ?? new IosWdaPreflightService(config)
  const commands = target instanceof MobileMirrorCommands
    ? target
    : new MobileMirrorCommands(config, { service: target.service, iosWdaPreflight, repairCases: target.repairCases })
  const listDevices = mobileMirrorToolContract('mobile_mirror_list_devices')
  ctx.tools.register(defineTool({
    name: listDevices.name,
    description: listDevices.description,
    parameters: dshParameters(listDevices.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      return serialize(dataValue(await commands.execute(listDevices.name, args, exec.signal)))
    },
  }))

  const iosPreflight = mobileMirrorToolContract('mobile_mirror_ios_preflight')
  ctx.tools.register(defineTool({
    name: iosPreflight.name,
    description: iosPreflight.description,
    parameters: dshParameters(iosPreflight.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      return serialize(dataValue(await commands.execute(iosPreflight.name, args, exec.signal)))
    },
  }))

  const start = mobileMirrorToolContract('mobile_mirror_start')
  ctx.tools.register(defineTool({
    name: start.name,
    description: start.description,
    parameters: dshParameters(start.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      return serialize(dataValue(await commands.execute(start.name, args, exec.signal)))
    },
  }))

  const status = mobileMirrorToolContract('mobile_mirror_status')
  ctx.tools.register(defineTool({
    name: status.name,
    description: status.description,
    parameters: dshParameters(status.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>) {
      return serialize(dataValue(await commands.execute(status.name, args)))
    },
  }))

  const snapshot = mobileMirrorToolContract('mobile_mirror_snapshot')
  ctx.tools.register(defineTool({
    name: snapshot.name,
    description: snapshot.description,
    parameters: dshParameters(snapshot.inputSchema) as ParameterSchemaSpec,
    output: observationOutput(),
    timeoutMs: config.startupTimeoutMs,
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      const observation = observationValue(await commands.execute(snapshot.name, args, exec.signal))
      return deliverObservation(ctx, observation, exec, services.createUserMessage)
    },
  }))

  const query = mobileMirrorToolContract('mobile_mirror_query_screen')
  const registerQuery = () => ctx.tools.register(defineTool({
    name: query.name, description: query.description, parameters: dshParameters(query.inputSchema) as ParameterSchemaSpec,
    output: { schema: dshOutputSchema(query.outputSchema) as unknown as ValueSchemaSpec, render: (_args: unknown, value: object) => [{ type: 'text' as const, text: JSON.stringify(value) }] },
    async execute(args: Record<string, unknown>, exec: DshToolExec) { return dataValue(await commands.execute(query.name, args, exec.signal)) },
  }))

  const inspect = mobileMirrorToolContract('mobile_mirror_inspect_screen')
  ctx.tools.register(defineTool({
    name: inspect.name,
    description: inspect.description,
    parameters: dshParameters(inspect.inputSchema) as ParameterSchemaSpec,
    output: { ...observationOutput(), schema: dshOutputSchema(inspect.outputSchema) as unknown as ValueSchemaSpec },
    timeoutMs: config.startupTimeoutMs,
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      const result = await commands.execute(inspect.name, args, exec.signal)
      const observation = observationValue(result)
      const summary = observation.image ? await deliverObservation(ctx, observation, exec, services.createUserMessage) : summarizeObservation(observation)
      return projectObservation(summary, result.kind === 'observation' ? result.structureMode : 'full')
    },
  }))

  const action = mobileMirrorToolContract('mobile_mirror_action')
  ctx.tools.register(defineTool({
    name: action.name,
    description: action.description,
    parameters: dshParameters(action.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      return serialize(dataValue(await commands.execute(action.name, args, exec.signal)))
    },
  }))

  const manageApp = mobileMirrorToolContract('mobile_mirror_manage_app')
  ctx.tools.register(defineTool({
    name: manageApp.name,
    description: manageApp.description,
    parameters: dshParameters(manageApp.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      return serialize(dataValue(await commands.execute(manageApp.name, args, exec.signal)))
    },
  }))

  const stop = mobileMirrorToolContract('mobile_mirror_stop')
  ctx.tools.register(defineTool({
    name: stop.name,
    description: stop.description,
    parameters: dshParameters(stop.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      return serialize(dataValue(await commands.execute(stop.name, args, exec.signal)))
    },
  }))
  registerQuery()
  for (const name of ['mobile_mirror_test_catalog', 'mobile_mirror_run_start', 'mobile_mirror_run_status', 'mobile_mirror_run_cancel'] as const) {
    const contract = mobileMirrorToolContract(name)
    ctx.tools.register(defineTool({
      name: contract.name, description: contract.description, parameters: dshParameters(contract.inputSchema) as ParameterSchemaSpec,
      output: jsonTextOutput(),
      async execute(args: Record<string, unknown>, exec: DshToolExec) { return serialize(dataValue(await commands.execute(contract.name, args, exec.signal))) },
    }))
  }
  const evidence = mobileMirrorToolContract('mobile_mirror_run_evidence')
  ctx.tools.register(defineTool({
    name: evidence.name, description: evidence.description, parameters: dshParameters(evidence.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) {
      const result = await commands.execute(evidence.name, args, exec.signal)
      if (result.kind !== 'artifact-image') return serialize(dataValue(result))
      await deliverEvidenceImage(ctx, result.value, exec, services.createUserMessage)
      return serialize(result.value.metadata)
    },
  }))
  const diagnostic = mobileMirrorToolContract('mobile_mirror_run_diagnostic_context')
  ctx.tools.register(defineTool({
    name: diagnostic.name, description: diagnostic.description, parameters: dshParameters(diagnostic.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) { return serialize(dataValue(await commands.execute(diagnostic.name, args, exec.signal))) },
  }))
  const triage = mobileMirrorToolContract('mobile_mirror_run_triage')
  ctx.tools.register(defineTool({
    name: triage.name, description: triage.description, parameters: dshParameters(triage.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) { return serialize(dataValue(await commands.execute(triage.name, args, exec.signal))) },
  }))
  const acceptance = mobileMirrorToolContract('mobile_acceptance_get')
  ctx.tools.register(defineTool({
    name: acceptance.name, description: acceptance.description, parameters: dshParameters(acceptance.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) { return serialize(dataValue(await commands.execute(acceptance.name, args, exec.signal))) },
  }))
  const external = mobileMirrorToolContract('mobile_external_result_get')
  ctx.tools.register(defineTool({
    name: external.name, description: external.description, parameters: dshParameters(external.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(),
    async execute(args: Record<string, unknown>, exec: DshToolExec) { return serialize(dataValue(await commands.execute(external.name, args, exec.signal))) },
  }))
  const matrix = mobileMirrorToolContract('mobile_matrix_status')
  ctx.tools.register(defineTool({ name: matrix.name, description: matrix.description, parameters: dshParameters(matrix.inputSchema) as ParameterSchemaSpec,
    output: jsonTextOutput(), async execute(args: Record<string, unknown>, exec: DshToolExec) { return serialize(dataValue(await commands.execute(matrix.name, args, exec.signal))) },
  }))
  if (repairToolsVisible(config)) for (const contract of REPAIR_TOOL_CONTRACTS) {
    ctx.tools.register(defineTool({ name: contract.name, description: contract.description,
      parameters: dshParameters(contract.inputSchema) as ParameterSchemaSpec, output: jsonTextOutput(),
      async execute(args: Record<string, unknown>, exec: DshToolExec) {
        return serialize(dataValue(await commands.execute(contract.name, args, exec.signal)))
      },
    }))
  }
}

async function deliverEvidenceImage(
  ctx: ToolContext,
  image: TestEvidenceImage,
  exec: DshToolExec,
  injectedFactory?: MessageFactory,
): Promise<void> {
  const attachments = ctx.attachments
  if (!attachments) throw screenError('screen_attachment_failed')
  if (exec.signal.aborted) throw exec.signal.reason
  const limits = attachments.imageLimits
  if (!limits.mediaTypes.includes('image/png') || limits.maxImagesPerMessage < 1 || image.bytes.byteLength > limits.maxImageBytes || image.bytes.byteLength > limits.maxMessageImageBytes) throw screenError('screen_observation_too_large')
  const data = Uint8Array.from(image.bytes)
  try {
    const attachment = await attachments.saveImage({ data, mediaType: 'image/png', name: `mobile-test-evidence-${String(image.metadata.artifactId).slice(0, 12)}.png` })
    const factory = injectedFactory ?? await loadCreateUserMessage()
    exec.deferContext(factory({
      content: [{ type: 'text', text: `Verified mobile test evidence ${String(image.metadata.artifactId)}.` }, { type: 'image', attachment }],
      source: { kind: 'mobile-mirror', form: 'notice', summary: 'Verified mobile test evidence image' },
    }))
  } finally { data.fill(0) }
}

function jsonTextOutput() {
  return {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

async function deliverObservation(
  ctx: ToolContext,
  observation: ScreenObservation,
  exec: DshToolExec,
  injectedFactory?: MessageFactory,
): Promise<ScreenObservationSummary> {
  const image = observation.image
  if (!image) throw screenError('screen_capture_failed')
  const attachments = ctx.attachments
  if (!attachments) throw screenError('screen_attachment_failed')
  if (exec.signal.aborted) throw exec.signal.reason
  const limits = attachments.imageLimits
  if (!limits.mediaTypes.includes('image/png')
    || limits.maxImagesPerMessage < 1
    || image.bytes.byteLength > limits.maxImageBytes
    || image.bytes.byteLength > limits.maxMessageImageBytes
    || image.width * image.height > limits.maxImagePixels) {
    throw screenError('screen_observation_too_large')
  }

  try {
    const factory = injectedFactory ?? await loadCreateUserMessage()
    const deliveryBytes = Uint8Array.from(image.bytes)
    let attachment: ImageAttachmentRef
    try {
      attachment = await attachments.saveImage({
        data: deliveryBytes,
        mediaType: 'image/png',
        name: `mobile-screen-${observation.frameRevision}.png`,
      })
    } finally {
      deliveryBytes.fill(0)
    }
    if (exec.signal.aborted) throw exec.signal.reason
    const summary = summarizeObservation(observation, 'deferred-context')
    const message = factory({
      content: [
        {
          type: 'text',
          text: `Mobile screen observation ${observation.observationId}; revision ${observation.frameRevision}; captured ${observation.capturedAt} to ${observation.captureEndedAt}; viewport ${observation.viewport.width}x${observation.viewport.height}; orientation ${observation.orientation}.`,
        },
        { type: 'image', attachment },
      ],
      source: {
        kind: 'mobile-mirror',
        form: 'notice',
        summary: `Mobile screen observation revision ${observation.frameRevision}`,
      },
    })
    exec.deferContext(message)
    return summary
  } catch (error) {
    if (exec.signal.aborted) throw exec.signal.reason
    throw screenError('screen_attachment_failed', error)
  }
}

async function loadCreateUserMessage(): Promise<MessageFactory> {
  const moduleName = '@deepseek-ai/dsh-llm/message'
  const module = await import(moduleName) as { createUserMessage?: MessageFactory }
  if (typeof module.createUserMessage !== 'function') throw new Error('DSH message factory is unavailable')
  return module.createUserMessage
}

function observationOutput() {
  return {
    schema: dshOutputSchema(SCREEN_OBSERVATION_OUTPUT_SCHEMA) as unknown as ValueSchemaSpec,
    render: (_args: unknown, value: ScreenObservationSummary) => [{
      type: 'text' as const,
      text: JSON.stringify(value, null, 2),
    }],
  }
}

function dataValue(result: MobileMirrorCommandResult): object {
  if (result.kind !== 'data') throw new Error('Expected command data result')
  return result.value
}

function observationValue(result: MobileMirrorCommandResult): ScreenObservation {
  if (result.kind !== 'observation') throw new Error('Expected command observation result')
  return result.value
}
