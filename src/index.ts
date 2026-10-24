import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { Config, type Config as PluginConfig } from './config.js'
import { LocalDeviceRuntime } from './local-device-runtime.js'
import { registerTools } from './tools.js'

export const name = 'mobile-mirror'
export const inject = ['tools', 'attachments']
export { Config }
export type { PluginConfig as MobileMirrorConfig }
export { MirrorService } from './mirror-service.js'
export { LocalDeviceRuntime } from './local-device-runtime.js'
export { LocalViewerConfigStore, defaultLocalViewerConfigPath, resolveLocalViewerSettings } from './local-viewer-config.js'
export { startLocalViewerCli } from './local-viewer-cli.js'
export { MobileMirrorCommands, MobileMirrorCommandError } from './mobile-mirror-commands.js'
export { TestRunCoordinator, TestRunControlError } from './test-run-control.js'
export { DeviceOwnerClaim, DeviceOwnerClaimError } from './device-owner-claim.js'
export { MOBILE_MIRROR_TOOL_CONTRACTS, MOBILE_MIRROR_TOOL_NAMES } from './tool-contracts.js'
export { ObservationStore, summarizeObservation } from './observation-store.js'
export { ScreenObservationError, screenErrorCode } from './screen-errors.js'
export type { ScreenErrorCode } from './screen-errors.js'
export { ViewerMediaCoordinator, ViewerMediaSubscriptionConflict } from './viewer-media-coordinator.js'
export { ViewerMediaError, viewerMediaErrorCode } from './viewer-media-error.js'
export { NodeLoopbackPortAllocator } from './loopback-port.js'
export type { LoopbackPortAllocator } from './loopback-port.js'
export { NodeStreamingHostProcessRunner } from './streaming-host-process.js'
export type { StreamingHostProcess, StreamingHostProcessRunner } from './streaming-host-process.js'
export type {
  AgentScreenContentPolicy,
  AgentTextInputPolicy,
  AgentAppControlPolicy,
  AppManagementInput,
  AppManagementOperation,
  AppManagementOutcome,
  AppManagementResult,
  AppManagementTargetScope,
  AppiumRuntimeErrorCode,
  AppiumRuntimeMode,
  AppiumRuntimePhase,
  AppiumRuntimeState,
  MirrorAction,
  MirrorControlPhase,
  MobileAppState,
  MirrorState,
  ProviderScreenSource,
  ScreenCoordinateSpace,
  ScreenGeometry,
  ScreenNode,
  ScreenObservation,
  ScreenObservationImage,
  ScreenObservationRequest,
  ScreenObservationSummary,
  ScreenStructure,
  ViewerMediaClientFailureCode,
  ViewerMediaErrorCode,
  ViewerMediaMode,
  ViewerMediaPacket,
  ViewerMediaPhase,
  ViewerMediaSource,
  ViewerMediaState,
  ViewerMediaSubscription,
  ViewerMediaTransport,
} from './types.js'
export { ViewerServer } from './viewer-server.js'
export { IosWdaPreflightService } from './ios-wda-preflight.js'
export type {
  IosWdaPreflightCode,
  IosWdaPreflightIssue,
  IosWdaPreflightResult,
  IosWdaPreflightStatus,
} from './ios-wda-preflight.js'
export { NodeHostCommandRunner } from './host-command-runner.js'
export type { HostCommandOptions, HostCommandResult, HostCommandRunner } from './host-command-runner.js'
export { createAppiumRuntime, ExternalAppiumRuntime, ManagedAppiumError, ManagedAppiumRuntime } from './managed-appium-runtime.js'
export type { AppiumRuntimeLifecycle, ManagedAppiumRuntimeOptions } from './managed-appium-runtime.js'
export { DoctorService, doctorExitCode, renderDoctorHuman } from './doctor.js'
export type { DoctorCheck, DoctorCheckStatus, DoctorPlatform, DoctorReport } from './doctor.js'

export function apply(ctx: Context, config: PluginConfig): void {
  const runtime = new LocalDeviceRuntime(config)
  // Runtime contract schemas cannot use the literal DSL's recursive inference.
  // defineTool still compiles and validates every input/output at this boundary.
  const defineRuntimeTool = defineTool as (definition: unknown) => ToolDefinition
  registerTools(ctx, runtime.commands, config, {
    defineTool: (definition) => defineRuntimeTool(definition),
  })
  ctx.effect(async () => {
    await runtime.listen()
    return async () => {
      await runtime.close()
    }
  })
}
