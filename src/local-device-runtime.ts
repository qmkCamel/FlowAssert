import { assertAppiumRuntimeConfig, DISABLED_AGENT_TEST_CONTROL, type Config } from './config.js'
import {
  type ConnectionAssistantApi,
  type ConnectionAssistantPersistedSetup,
} from './connection-assistant.js'
import type { IosWdaPreflightService } from './ios-wda-preflight.js'
import type { ArmableAppiumRuntimeLifecycle } from './managed-appium-runtime.js'
import type { MirrorService } from './mirror-service.js'
import { MobileMirrorCommands } from './mobile-mirror-commands.js'
import { ViewerServer, type ViewerLocalSetupSummary } from './viewer-server.js'
import { TestRunCoordinator } from './test-run-control.js'
import { WorkbenchApplication } from './workbench-application.js'
import { createDeviceServices } from './device-services.js'
import { closeInOrder } from './lifecycle.js'
import type { TriageAnalyzer } from './workbench-triage-analyzer.js'

export interface LocalDeviceRuntimeOptions {
  deviceClaim?: Pick<import('./device-owner-claim.js').DeviceOwnerClaim, 'acquire'>
  service?: MirrorService
  iosWdaPreflight?: IosWdaPreflightService
  appiumRuntime?: ArmableAppiumRuntimeLifecycle
  assistant?: ConnectionAssistantApi
  persistSetup?: (input: ConnectionAssistantPersistedSetup) => Promise<void>
  localSetup?: () => ViewerLocalSetupSummary
  workbenchRoot?: string
  matrixRegistryPath?: string
  analyzer?: TriageAnalyzer | null
}

export class LocalDeviceRuntime {
  readonly config: Config
  readonly service: MirrorService
  readonly viewer: ViewerServer
  readonly iosWdaPreflight: IosWdaPreflightService
  readonly appiumRuntime: ArmableAppiumRuntimeLifecycle
  readonly assistant: ConnectionAssistantApi
  readonly commands: MobileMirrorCommands
  readonly coordinator: TestRunCoordinator
  readonly application: WorkbenchApplication
  #listening = false
  #closed = false
  #closePromise: Promise<void> | null = null

  constructor(config: Config, options: LocalDeviceRuntimeOptions = {}) {
    this.config = assertAppiumRuntimeConfig(config)
    const devices = createDeviceServices(config, viewerUrl(config), options)
    this.appiumRuntime = devices.appiumRuntime
    this.service = devices.service
    this.iosWdaPreflight = devices.iosWdaPreflight
    this.assistant = devices.assistant
    this.application = new WorkbenchApplication(this.service, {
      ...(options.workbenchRoot ? { root: options.workbenchRoot } : {}),
      ...(options.matrixRegistryPath ? { matrixRegistryPath: options.matrixRegistryPath } : {}),
      ...(config.agentTestControl?.projectPath ? { projectPath: config.agentTestControl.projectPath } : {}),
      ...(options.analyzer !== undefined ? { analyzer: options.analyzer } : {}),
    })
    this.coordinator = new TestRunCoordinator(this.service, config.agentTestControl ?? DISABLED_AGENT_TEST_CONTROL, {
      application: this.application,
    })
    this.viewer = new ViewerServer(config, {
      service: this.service,
      assistant: this.assistant,
      disposeServiceOnClose: false,
      disposeAssistantOnClose: false,
      coordinator: this.coordinator,
      ...(options.localSetup ? { localSetup: options.localSetup } : {}),
    })
    this.commands = new MobileMirrorCommands(config, {
      service: this.service,
      iosWdaPreflight: this.iosWdaPreflight,
      coordinator: this.coordinator,
      repairCases: this.application.repairCases,
    })
  }

  async listen(): Promise<void> {
    if (this.#closed) throw new Error('Local device runtime is closed')
    if (this.#listening) return
    try {
      await this.viewer.listen()
      if (this.#closed) throw new Error('Local device runtime is closed')
      this.#listening = true
    } catch (error) {
      try { await this.close() } catch (cleanup) { throw new AggregateError([error, cleanup], 'Runtime startup and cleanup failed') }
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#listening = false
    this.#closePromise = closeInOrder([
      () => this.viewer.closeListener(),
      () => this.assistant.dispose(),
      () => this.coordinator.close(),
      () => this.application.close(),
      () => this.service.dispose(),
    ])
    return this.#closePromise
  }
}

function viewerUrl(config: Config): string {
  const host = config.viewerHost === '::1' ? '[::1]' : config.viewerHost
  return `http://${host}:${config.viewerPort}`
}
