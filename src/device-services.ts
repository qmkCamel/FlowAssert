import type { Config } from './config.js'
import { MirrorService } from './mirror-service.js'
import { GuidedAppiumRuntime, type ArmableAppiumRuntimeLifecycle } from './managed-appium-runtime.js'
import { IosWdaPreflightService } from './ios-wda-preflight.js'
import { ConnectionAssistantService, type ConnectionAssistantApi, type ConnectionAssistantPersistedSetup } from './connection-assistant.js'

export interface DeviceServicesOptions {
  deviceClaim?: Pick<import('./device-owner-claim.js').DeviceOwnerClaim, 'acquire'>
  service?: MirrorService
  appiumRuntime?: ArmableAppiumRuntimeLifecycle
  assistant?: ConnectionAssistantApi
  iosWdaPreflight?: IosWdaPreflightService
  persistSetup?: (input: ConnectionAssistantPersistedSetup) => Promise<void>
}

/** Host-neutral device assembly shared by runtime and standalone Viewer compatibility entry. */
export function createDeviceServices(config: Config, viewerUrl: string, options: DeviceServicesOptions = {}) {
  if (options.service && (!options.appiumRuntime || !options.assistant))
    throw new TypeError('A custom local service requires an explicit runtime and assistant')
  const appiumRuntime = options.appiumRuntime ?? new GuidedAppiumRuntime(config)
  const service = options.service ?? new MirrorService(config, viewerUrl, { appiumRuntime, ...(options.deviceClaim ? { deviceClaim: options.deviceClaim } : {}) })
  const iosWdaPreflight = options.iosWdaPreflight ?? new IosWdaPreflightService(config)
  const assistant = options.assistant ?? new ConnectionAssistantService(config, {
    service, runtime: appiumRuntime, iosWdaPreflight,
    ...(options.persistSetup ? { persistSetup: options.persistSetup } : {}),
  })
  return { service, appiumRuntime, iosWdaPreflight, assistant }
}
