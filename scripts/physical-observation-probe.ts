import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Config, type Config as PluginConfig } from '../src/config.js'
import { MirrorService } from '../src/mirror-service.js'
import type { ScreenNode, ScreenObservation } from '../src/types.js'

const platform = process.env.MOBILE_MIRROR_PLATFORM
const udid = process.env.MOBILE_MIRROR_UDID
if (platform !== 'android' && platform !== 'ios') throw new Error('MOBILE_MIRROR_PLATFORM must be android or ios')
if (!udid) throw new Error('MOBILE_MIRROR_UDID is required')

const semanticAcceptance = process.env.MOBILE_MIRROR_SEMANTIC_ACCEPT === '1'
const publicMarker = 'MOBILE-MIRROR-PUBLIC-ACCEPTANCE'
const publicAppendProbe = 'MMMMMMMM'
const expectedTargetAppId = platform === 'android' ? 'com.android.settings' : 'com.apple.Preferences'
const approvedAppId = process.env.MOBILE_MIRROR_APPROVED_APP_ID
if (semanticAcceptance && approvedAppId !== expectedTargetAppId) {
  throw new Error('Semantic acceptance requires the documented exact approved application id')
}

const evidenceRoot = resolve('artifacts/physical-validation')
const evidencePath = resolve(process.env.MOBILE_MIRROR_EVIDENCE_PATH
  ?? `artifacts/physical-validation/observation-${platform}-${semanticAcceptance ? 'semantic' : 'screen'}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
if (!evidencePath.startsWith(`${evidenceRoot}/`)) throw new Error('Evidence path must be inside artifacts/physical-validation')
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 })

const config = Config({
  defaultProvider: 'appium',
  agentScreenContentPolicy: 'image-and-structure',
  agentTextInputPolicy: semanticAcceptance ? 'non-sensitive' : 'mock-only',
  agentAppControlPolicy: semanticAcceptance ? 'session-app' : 'disabled',
  appiumUrl: process.env.MOBILE_MIRROR_APPIUM_URL ?? 'http://127.0.0.1:4723',
  viewerPort: 0,
  startupTimeoutMs: 120_000,
  mockStartupDelayMs: 0,
} as PluginConfig)
const service = new MirrorService(config, 'http://127.0.0.1:0')
let stopped = false
let markerMayBeApplied = false
let markerCleared = false

try {
  await service.start({ provider: 'appium', capabilities: capabilities(platform, udid) })
  progress('started')
  const first = await boundedObserve(service, { image: true, structure: true })
  assertObservation(first)
  let second: ScreenObservation
  let semanticLifecycle: Record<string, unknown> | undefined
  if (semanticAcceptance) {
    const target = await approvedInputTarget(service, first)
    progress('input-target-ready')
    await service.action({ kind: 'tap_node', observationId: target.observation.observationId, nodeId: target.node.nodeId }, physicalSignal())
    const focused = await focusedObservation(service)
    progress('input-focused')
    const focusedNode = focused.structure!.nodes.find((node) => isOrdinaryFocusedInput(node))!
    markerMayBeApplied = true
    await service.action({
      kind: 'input_text', observationId: focused.observationId, nodeId: focusedNode.nodeId, mode: 'replace', text: publicAppendProbe,
    }, physicalSignal())
    const replaced = await boundedObserve(service, { image: false, structure: true })
    if (!structureContains(replaced, publicAppendProbe)) throw new Error('Public append probe was not observable after replace')
    progress('replace-verified')

    const replacedNode = replaced.structure!.nodes.find((node) => isOrdinaryFocusedInput(node))
    if (!replacedNode) throw new Error('Focused ordinary input disappeared before append')
    await service.action({
      kind: 'input_text', observationId: replaced.observationId, nodeId: replacedNode.nodeId, mode: 'append', text: publicAppendProbe,
    }, physicalSignal())
    const appended = await boundedObserve(service, { image: false, structure: true })
    if (!structureContains(appended, publicAppendProbe.repeat(2))) throw new Error('Public append probe was not preserved after append')
    progress('append-verified')

    const appendedNode = appended.structure!.nodes.find((node) => isOrdinaryFocusedInput(node))
    if (!appendedNode) throw new Error('Focused ordinary input disappeared before evidence capture')
    await service.action({
      kind: 'input_text', observationId: appended.observationId, nodeId: appendedNode.nodeId, mode: 'replace', text: publicMarker,
    }, physicalSignal())
    const entered = await boundedObserve(service, { image: true, structure: true })
    assertObservation(entered)
    if (!structureContains(entered, publicMarker)) throw new Error('Public semantic marker was not observable before evidence capture')
    await writeFile(evidencePath, entered.image!.bytes)
    progress('evidence-written')

    const enteredNode = entered.structure!.nodes.find((node) => isOrdinaryFocusedInput(node))
    if (!enteredNode) throw new Error('Focused ordinary input disappeared before cleanup')
    await service.action({
      kind: 'input_text', observationId: entered.observationId, nodeId: enteredNode.nodeId, mode: 'replace', text: '',
    }, physicalSignal())
    const cleared = await boundedObserve(service, { image: false, structure: true })
    if (structureContains(cleared, publicMarker)) throw new Error('Public semantic marker remained after cleanup')
    markerCleared = true
    progress('input-cleared')

    const terminated = await service.manageApp({ operation: 'terminate', appId: approvedAppId! }, physicalSignal())
    progress('app-terminated')
    const activated = await service.manageApp({ operation: 'activate', appId: approvedAppId! }, physicalSignal())
    progress('app-activated')
    second = await boundedObserve(service, { image: true, structure: true })
    assertObservation(second)
    progress('session-reobserved')
    semanticLifecycle = {
      inputVerified: true,
      appendVerified: true,
      inputCleared: true,
      terminateAfterState: terminated.afterState,
      activateAfterState: activated.afterState,
      sessionReusable: true,
    }
  } else {
    const x = Math.floor(first.viewport.width / 2)
    await service.action({
      kind: 'swipe',
      startX: x,
      startY: Math.floor(first.viewport.height * 0.72),
      endX: x,
      endY: Math.floor(first.viewport.height * 0.36),
      durationMs: 500,
      observationId: first.observationId,
      coordinateSpace: 'viewport',
    }, physicalSignal())
    second = await boundedObserve(service, { image: true, structure: true })
    assertObservation(second)
    if (Buffer.compare(Buffer.from(first.image!.bytes), Buffer.from(second.image!.bytes)) === 0) {
      throw new Error('Physical screen image did not change after the safe action')
    }
    await writeFile(evidencePath, second.image!.bytes)
  }
  if (second.frameRevision <= first.frameRevision) throw new Error('Observation revision did not advance')
  if (second.screenEpoch <= first.screenEpoch) throw new Error('Screen epoch did not advance after action')
  const finalState = await service.stop(physicalSignal())
  stopped = finalState.lifecycle === 'idle'
  progress('owned-session-stopped')
  process.stdout.write(`${JSON.stringify({
    platform,
    appiumVersion: '3.2.0',
    driver: platform === 'android' ? 'uiautomator2@6.8.0' : 'xcuitest@10.19.1',
    firstRevision: first.frameRevision,
    finalRevision: second.frameRevision,
    firstEpoch: first.screenEpoch,
    finalEpoch: second.screenEpoch,
    viewport: second.viewport,
    orientation: second.orientation,
    pngBytes: second.image!.bytes.byteLength,
    structureNodes: second.structure!.nodes.length,
    structureTruncated: second.structure!.truncated,
    coordinateSpace: 'viewport',
    semanticAcceptance,
    ...(semanticLifecycle ? { semanticLifecycle } : {}),
    ownedSessionCleaned: stopped,
  }, null, 2)}\n`)
} finally {
  if (semanticAcceptance && markerMayBeApplied && !markerCleared) await clearFocusedInput(service).catch(() => undefined)
  await service.dispose()
}

async function approvedInputTarget(activeService: MirrorService, observation: ScreenObservation): Promise<{
  observation: ScreenObservation
  node: ScreenNode
}> {
  const initialNode = ordinaryInput(observation)
  if (initialNode) return { observation, node: initialNode }
  if (platform !== 'android') throw new Error('No user-approved visible ordinary input is available')

  const searchEntry = observation.structure?.nodes.find((candidate) => candidate.identifier === 'com.android.settings:id/search_src_text'
    && candidate.visible === true
    && candidate.enabled === true
    && candidate.actionable === true
    && candidate.bounds !== undefined)
  if (!searchEntry) throw new Error('No user-approved Settings search entry is available')
  await activeService.action({ kind: 'tap_node', observationId: observation.observationId, nodeId: searchEntry.nodeId }, physicalSignal())
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const searchObservation = await boundedObserve(activeService, { image: false, structure: true })
    const node = ordinaryInput(searchObservation)
    if (node) return { observation: searchObservation, node }
  }
  throw new Error('No user-approved visible ordinary input is available after opening Settings search')
}

function ordinaryInput(observation: ScreenObservation): ScreenNode | undefined {
  return observation.structure?.nodes.find((candidate) => candidate.role === 'input'
    && candidate.sensitive !== true
    && candidate.visible === true
    && candidate.enabled === true
    && candidate.bounds !== undefined)
}

async function focusedObservation(activeService: MirrorService): Promise<ScreenObservation> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observation = await boundedObserve(activeService, { image: false, structure: true })
    if (observation.structure?.nodes.some((node) => isOrdinaryFocusedInput(node))) return observation
  }
  throw new Error('The approved ordinary input did not become focused')
}

function isOrdinaryFocusedInput(node: ScreenNode): boolean {
  return node.role === 'input' && node.focused === true && node.sensitive !== true
    && node.visible === true && node.enabled === true && node.bounds !== undefined
}

function structureContains(observation: ScreenObservation, value: string): boolean {
  return observation.structure?.nodes.some((node) => [node.name, node.text, node.value].includes(value)) === true
}

async function boundedObserve(
  activeService: MirrorService,
  request: Parameters<MirrorService['observe']>[0],
): Promise<ScreenObservation> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await activeService.observe(request, AbortSignal.timeout(20_000))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function progress(stage: string): void {
  if (semanticAcceptance) process.stderr.write(`physical_semantic_stage=${stage}\n`)
}

function physicalSignal(): AbortSignal {
  return AbortSignal.timeout(20_000)
}

async function clearFocusedInput(activeService: MirrorService): Promise<void> {
  if (activeService.state().lifecycle !== 'streaming') return
  const observation = await boundedObserve(activeService, { image: false, structure: true })
  const node = observation.structure?.nodes.find((candidate) => isOrdinaryFocusedInput(candidate))
  if (!node) return
  await activeService.action({
    kind: 'input_text', observationId: observation.observationId, nodeId: node.nodeId, mode: 'replace', text: '',
  }, physicalSignal())
}

function capabilities(target: 'android' | 'ios', deviceId: string): Record<string, unknown> {
  if (target === 'android') {
    return {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Android',
      'appium:udid': deviceId,
      'appium:appPackage': 'com.android.settings',
      'appium:appActivity': '.Settings',
      'appium:noReset': true,
      'appium:forceAppLaunch': true,
      'appium:settings': {
        waitForIdleTimeout: semanticAcceptance ? 0 : 1_000,
        actionAcknowledgmentTimeout: 1_000,
      },
    }
  }
  const capabilities: Record<string, unknown> = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': 'iPhone',
    'appium:udid': deviceId,
    'appium:bundleId': 'com.apple.Preferences',
    'appium:noReset': true,
  }
  for (const [environment, key] of [
    ['MOBILE_MIRROR_IOS_TEAM_ID', 'appium:xcodeOrgId'],
    ['MOBILE_MIRROR_IOS_SIGNING_ID', 'appium:xcodeSigningId'],
    ['MOBILE_MIRROR_IOS_WDA_BUNDLE_ID', 'appium:updatedWDABundleId'],
    ['MOBILE_MIRROR_IOS_XCCONFIG', 'appium:xcodeConfigFile'],
  ] as const) {
    const value = process.env[environment]
    if (value) capabilities[key] = value
  }
  return capabilities
}

function assertObservation(observation: Awaited<ReturnType<MirrorService['observe']>>): void {
  const image = observation.image
  const structure = observation.structure
  if (!image || image.bytes.byteLength < 24) throw new Error('Physical observation did not return a non-empty PNG')
  if ([137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => image.bytes[index] !== value)) {
    throw new Error('Physical observation returned invalid PNG magic bytes')
  }
  if (!structure || structure.nodes.length === 0) throw new Error('Physical observation returned no accessibility nodes')
}
