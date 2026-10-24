import { createInspector } from './inspector.js'
import { createEnvironmentPreflight } from './environment-preflight.js'
import './workbench.js'
import './journey.js'
import { createViewerCapture } from './capture.js'
import {
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  applyDocumentTranslations,
  resolveInitialLocale,
  translate,
  writeLocalePreference,
} from './i18n.js'

const elements = {
  language: document.querySelector('#language-select'),
  provider: document.querySelector('#provider'),
  assistantPanel: document.querySelector('#assistant-panel'),
  assistantPlatformButtons: [...document.querySelectorAll('[data-platform]')],
  assistantDeviceKind: document.querySelector('#assistant-device-kind'),
  assistantCheck: document.querySelector('#assistant-check-button'),
  assistantSavedSetup: document.querySelector('#assistant-saved-setup'),
  assistantSavedDetail: document.querySelector('#assistant-saved-detail'),
  assistantQuickConnect: document.querySelector('#assistant-quick-connect-button'),
  assistantCancel: document.querySelector('#assistant-cancel-button'),
  assistantProgress: document.querySelector('#assistant-progress'),
  assistantProgressTitle: document.querySelector('#assistant-progress-title'),
  assistantReport: document.querySelector('#assistant-report'),
  assistantSummaryTitle: document.querySelector('#assistant-summary-title'),
  assistantSummaryExpiry: document.querySelector('#assistant-summary-expiry'),
  assistantChecks: document.querySelector('#assistant-checks'),
  assistantDevice: document.querySelector('#assistant-device'),
  assistantTarget: document.querySelector('#assistant-target'),
  assistantTargetHint: document.querySelector('#assistant-target-hint'),
  assistantRuntime: document.querySelector('#assistant-runtime'),
  assistantConnect: document.querySelector('#assistant-connect-button'),
  androidAssistantFields: document.querySelector('#android-assistant-fields'),
  androidHelperConfirmation: document.querySelector('#android-helper-confirmation'),
  iosAssistantFields: document.querySelector('#ios-assistant-fields'),
  iosTeamId: document.querySelector('#ios-team-id'),
  iosWdaBundleId: document.querySelector('#ios-wda-bundle-id'),
  rememberSetupRow: document.querySelector('#remember-setup-row'),
  rememberSetup: document.querySelector('#remember-setup'),
  assistantPolicySummary: document.querySelector('#assistant-policy-summary'),
  appiumOptions: document.querySelector('#appium-options'),
  sessionId: document.querySelector('#session-id'),
  capabilities: document.querySelector('#capabilities'),
  advancedStart: document.querySelector('#advanced-start-button'),
  androidPolicyWarning: document.querySelector('#android-policy-warning'),
  provisioningWarning: document.querySelector('#provisioning-warning'),
  start: document.querySelector('#start-button'),
  stop: document.querySelector('#stop-button'),
  operation: document.querySelector('#operation'),
  operationTitle: document.querySelector('#operation-title'),
  operationDetail: document.querySelector('#operation-detail'),
  error: document.querySelector('#error-message'),
  pill: document.querySelector('.connection-pill'),
  connectionLabel: document.querySelector('#connection-label'),
  deviceName: document.querySelector('#device-name'),
  deviceArea: document.querySelector('#device-area'),
  phone: document.querySelector('#phone'),
  frame: document.querySelector('#device-frame'),
  mjpeg: document.querySelector('#device-mjpeg'),
  video: document.querySelector('#device-video'),
  empty: document.querySelector('#empty-state'),
  metaProvider: document.querySelector('#meta-provider'),
  metaSession: document.querySelector('#meta-session'),
  metaFrame: document.querySelector('#meta-frame'),
  metaMedia: document.querySelector('#meta-media'),
  metaAgentPolicy: document.querySelector('#meta-agent-policy'),
  agentObservation: document.querySelector('#agent-observation'),
  agentObservationTitle: document.querySelector('#agent-observation-title'),
  agentObservationDetail: document.querySelector('#agent-observation-detail'),
  agentControl: document.querySelector('#agent-control'),
  agentControlTitle: document.querySelector('#agent-control-title'),
  agentControlDetail: document.querySelector('#agent-control-detail'),
  theme: document.querySelector('#theme-button'),
  zoomFit: document.querySelector('#zoom-fit-button'),
  zoomOut: document.querySelector('#zoom-out-button'),
  zoomValue: document.querySelector('#zoom-value'),
  zoomIn: document.querySelector('#zoom-in-button'),
  actions: [...document.querySelectorAll('[data-action]')],
}

let state = null
let operationInFlight = false
let currentOperation = null
let currentError = null
let assistantPlatform = 'android'
let assistantSelectionRevision = 0
let providerInitialized = false
const assistantState = {
  android: { phase: 'idle', report: null, controller: null, target: 'current-screen', activeTarget: null },
  ios: { phase: 'idle', report: null, controller: null, target: 'current-screen', activeTarget: null },
}
let frameTimer = null
let frameRequestInFlight = false
let frameFailureCount = 0
let framePollingDegraded = false
let framePollingSessionId = null
let frameImmediateRequested = false
let stateTimer = null
let mediaAbort = null
let mediaTransport = null
let mediaRendered = false
let videoDecoder = null
let mjpegReadyTimer = null
let localMediaFailure = null
let localMediaFailureSession = null
const localeStorage = browserStorage()
let locale = resolveInitialLocale({
  storage: localeStorage,
  languages: navigator.languages?.length ? navigator.languages : [navigator.language],
})
const capture = createViewerCapture((key) => t(key))
const inspector = createInspector((key) => t(key))
const environmentPreflight = createEnvironmentPreflight((key) => t(key))
const mediaMetrics = {
  transport: null,
  streamStartedAt: null,
  firstPaintAt: null,
  paintTimes: [],
  receiveToPaintMs: [],
  fallbackAt: null,
  fallbackReason: null,
  packetCounts: {},
  lastPacketType: null,
}
const MAX_FRAME_POLL_INTERVAL_MS = 10_000
const DEGRADED_FRAME_FAILURE_COUNT = 3
const MEDIA_START_POLL_DELAY_MS = 5_000
const PHONE_ASPECT_RATIO = 390 / 844
const ZOOM_STEPS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
const previewZoom = { mode: 'fit', scale: 1, fitHeight: 0 }

function browserStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

Object.defineProperty(window, '__mobileMirrorMediaMetrics', {
  value: { snapshot: () => mediaMetricsSnapshot() },
  configurable: false,
  writable: false,
})

elements.language.addEventListener('change', () => {
  const nextLocale = SUPPORTED_LOCALES.includes(elements.language.value) ? elements.language.value : 'en'
  if (nextLocale === locale) return
  locale = nextLocale
  writeLocalePreference(localeStorage, locale)
  renderLocalizedCopy()
})

Object.defineProperty(window, '__mobileMirrorPollingMetrics', {
  value: {
    snapshot: () => ({
      inFlight: frameRequestInFlight,
      consecutiveFailures: frameFailureCount,
      degraded: framePollingDegraded,
      nextDelayMs: framePollingDelay(state?.frameIntervalMs || 750),
    }),
  },
  configurable: false,
  writable: false,
})

Object.defineProperty(window, '__mobileMirrorZoomMetrics', {
  value: {
    snapshot: () => ({
      mode: previewZoom.mode,
      scale: previewZoom.scale,
      fitHeight: previewZoom.fitHeight,
      width: elements.phone.getBoundingClientRect().width,
      height: elements.phone.getBoundingClientRect().height,
      scrollWidth: elements.deviceArea.scrollWidth,
      scrollHeight: elements.deviceArea.scrollHeight,
      clientWidth: elements.deviceArea.clientWidth,
      clientHeight: elements.deviceArea.clientHeight,
      scrollLeft: elements.deviceArea.scrollLeft,
      scrollTop: elements.deviceArea.scrollTop,
    }),
  },
  configurable: false,
  writable: false,
})

elements.provider.addEventListener('change', () => {
  environmentPreflight?.invalidate()
  const appium = elements.provider.value === 'appium'
  elements.assistantPanel.hidden = !appium
  elements.appiumOptions.hidden = !appium
  elements.start.hidden = appium
  if (!appium) void clearAllAssistantContexts()
  updateStartWarnings()
  updateControls()
})

elements.sessionId.addEventListener('input', updateStartWarnings)
elements.capabilities.addEventListener('input', updateStartWarnings)
elements.appiumOptions.addEventListener('toggle', updateStartWarnings)

elements.theme.addEventListener('click', () => {
  document.body.classList.toggle('light-stage')
  elements.theme.textContent = document.body.classList.contains('light-stage') ? '●' : '◐'
})

elements.zoomFit.addEventListener('click', () => setPreviewZoom('fit', 1))
elements.zoomOut.addEventListener('click', () => stepPreviewZoom(-1))
elements.zoomIn.addEventListener('click', () => stepPreviewZoom(1))
elements.phone.addEventListener('dblclick', (event) => {
  if (event.target === elements.phone) setPreviewZoom('fit', 1)
})

const previewResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(() => updatePreviewLayout())
  : null
previewResizeObserver?.observe(elements.deviceArea)
window.addEventListener('resize', updatePreviewLayout)

elements.start.addEventListener('click', () => startAdvanced(false))
elements.advancedStart.addEventListener('click', () => startAdvanced(true))

for (const button of elements.assistantPlatformButtons) {
  button.addEventListener('click', () => selectAssistantPlatform(button.dataset.platform))
}
elements.assistantCheck.addEventListener('click', () => checkAssistantPlatform())
function invalidateAssistantChecks() {
  if (Object.values(assistantState).some(local => local.phase === 'connecting')) return
  assistantSelectionRevision++
  for (const local of Object.values(assistantState)) {
    local.controller?.abort(); local.controller = null
    if (local.report) local.report = { ...local.report, status: 'blocked', stale: true }
    local.phase = local.report ? 'error' : 'idle'
  }
  clearAssistantInputs('ios')
  clearAssistantInputs('android')
  renderAssistant()
}
document.querySelector('#assistant-media-policy').addEventListener('change', invalidateAssistantChecks)
elements.assistantDeviceKind.addEventListener('change', invalidateAssistantChecks)
elements.assistantQuickConnect.addEventListener('click', () => quickConnectAssistantPlatform())
elements.assistantConnect.addEventListener('click', () => connectAssistantPlatform(false))
elements.assistantCancel.addEventListener('click', () => cancelAssistantPlatform())
elements.assistantTarget.addEventListener('change', () => {
  assistantState[assistantPlatform].target = elements.assistantTarget.value
  renderAssistant()
})
elements.assistantDevice.addEventListener('change', renderAssistant)

elements.stop.addEventListener('click', async () => {
  inspector.clear()
  if (operationInFlight && state?.lifecycle === 'connecting') {
    try {
      state = await api('/api/stop', {})
      render(state)
    } catch (error) {
      showRequestError(error)
      await refreshState()
    }
    return
  }
  await runOperation('operation.stop.title', 'operation.stop.detail', () => api('/api/stop', {}))
})

for (const button of elements.actions) {
  button.addEventListener('click', async () => {
    const kind = button.dataset.action
    const action = kind === 'tap'
      ? { kind, x: 195, y: 420 }
      : kind === 'swipe'
        ? { kind, startX: 195, startY: 620, endX: 195, endY: 260, durationMs: 420 }
        : { kind }
    const completed = await runOperation('operation.action.title', 'operation.action.detail', () => api('/api/action', action), { actionKind: kind })
    if (completed) requestImmediateFrame()
  })
}

async function runOperation(titleKey, detailKey, work, params = {}) {
  if (operationInFlight) return false
  operationInFlight = true
  currentOperation = { titleKey, detailKey, params }
  hideError()
  renderOperationText()
  elements.operation.hidden = false
  updateControls()
  try {
    state = await work()
    render(state)
    return true
  } catch (error) {
    showRequestError(error)
    await refreshState()
    return false
  } finally {
    operationInFlight = false
    currentOperation = null
    elements.operation.hidden = true
    updateControls()
  }
}

async function startAdvanced(forceAppium) {
  const provider = forceAppium ? 'appium' : elements.provider.value
  const payload = { provider }
  if (provider === 'appium') {
    if (elements.sessionId.value.trim()) payload.sessionId = elements.sessionId.value.trim()
    if (!payload.sessionId) {
      try {
        payload.capabilities = JSON.parse(elements.capabilities.value)
      } catch {
        showErrorKey('error.capabilitiesInvalid')
        elements.capabilities.focus()
        return
      }
    }
  }
  await runOperation('operation.connect.title', 'operation.connect.detail', () => api('/api/start', payload))
}

function selectAssistantPlatform(platform) {
  if (platform !== 'android' && platform !== 'ios') return
  if (assistantPlatform !== platform) {
    assistantSelectionRevision += 1
    const previous = assistantState[assistantPlatform]
    if (previous.phase !== 'connecting') {
      previous.controller?.abort(); previous.controller = null
      if (previous.report) previous.report = { ...previous.report, status: 'blocked', stale: true }
      previous.phase = previous.report ? 'error' : 'idle'
    }
    clearAssistantInputs(assistantPlatform)
  }
  assistantPlatform = platform
  renderAssistant()
}

async function checkAssistantPlatform() {
  const local = assistantState[assistantPlatform]
  if (local.phase === 'checking' || local.phase === 'connecting') return null
  const previous = local.report
  const revision = assistantSelectionRevision
  const controller = new AbortController()
  local.controller = controller
  local.phase = 'checking'
  hideError()
  renderAssistant()
  try {
    const report = await api('/api/connection-assistant/check', { platform: assistantPlatform, deviceKind: elements.assistantDeviceKind.value, media: document.querySelector('#assistant-media-policy').value }, controller.signal)
    if (controller.signal.aborted || revision !== assistantSelectionRevision || local.controller !== controller) {
      void api('/api/connection-assistant/cancel', { assistantId: report.assistantId }).catch(() => undefined)
      return null
    }
    if (previous?.assistantId && previous.assistantId !== report.assistantId) {
      void api('/api/connection-assistant/cancel', { assistantId: previous.assistantId }).catch(() => undefined)
    }
    local.report = report
    local.phase = report.status === 'blocked' ? 'error' : 'ready'
    return report
  } catch (error) {
    if (local.controller !== controller || revision !== assistantSelectionRevision) return null
    if (!controller.signal.aborted) {
      local.phase = 'error'
      showRequestError(error)
    } else {
      local.phase = previous ? 'ready' : 'idle'
    }
    return null
  } finally {
    if (local.controller === controller) local.controller = null
    renderAssistant()
  }
}

async function quickConnectAssistantPlatform() {
  const preferred = state?.localSetup?.preferredPlatform
  if (preferred !== 'android' && preferred !== 'ios') return
  selectAssistantPlatform(preferred)
  const selectionRevision = assistantSelectionRevision
  const report = await checkAssistantPlatform()
  if (selectionRevision !== assistantSelectionRevision || assistantPlatform !== preferred
    || !report || report !== assistantState[preferred].report || report.status === 'blocked' || report.devices.length !== 1
    || !report.runtimeChoices.includes('configured') || (report.signing?.requiredInputs?.length || 0) > 0) {
    return
  }
  elements.assistantDevice.value = '0'
  elements.assistantRuntime.value = 'configured'
  assistantState[preferred].target = 'current-screen'
  await connectAssistantPlatform(true)
}

async function connectAssistantPlatform(quick) {
  const platform = assistantPlatform
  const local = assistantState[platform]
  const report = local.report
  if (!report || local.phase === 'checking' || local.phase === 'connecting') return
  const device = report.devices[Number(elements.assistantDevice.value)]
  const runtime = elements.assistantRuntime.value
  if (!device || !runtime) return showErrorKey('error.deviceRuntimeRequired')
  if (platform === 'android' && !quick && !elements.androidHelperConfirmation.checked) {
    return showErrorKey('error.helperConfirmationRequired')
  }
  const payload = {
    assistantId: report.assistantId,
    deviceRef: device.deviceRef,
    targetPreset: `${platform}-${quick ? 'current-screen' : local.target}`,
    runtime,
  }
  if (platform === 'android') payload.confirmHelperApkSideEffect = true
  if (platform === 'ios' && elements.assistantDeviceKind.value !== 'simulator' && (elements.iosTeamId.value.trim() || elements.iosWdaBundleId.value.trim())) {
    payload.signing = { teamId: elements.iosTeamId.value.trim(), wdaBundleId: elements.iosWdaBundleId.value.trim() }
  }
  if (!quick && elements.rememberSetup.checked) payload.rememberOnThisMac = true
  const controller = new AbortController()
  local.controller = controller
  local.phase = 'connecting'
  local.activeTarget = quick ? 'current-screen' : local.target
  hideError()
  renderAssistant()
  let connected = false
  try {
    state = await api('/api/connection-assistant/connect', payload, controller.signal)
    connected = true
    render(state)
  } catch (error) {
    showRequestError(error)
    await refreshState()
  } finally {
    local.controller = null
    local.activeTarget = null
    if (connected) {
      local.report = null
      local.phase = 'idle'
      clearAssistantInputs(platform)
    } else {
      local.phase = local.report?.status === 'blocked' ? 'error' : 'ready'
    }
    renderAssistant()
  }
}

async function cancelAssistantPlatform() {
  assistantSelectionRevision += 1
  const local = assistantState[assistantPlatform]
  local.controller?.abort()
  const assistantId = local.report?.assistantId
  local.report = null
  local.controller = null
  local.phase = 'idle'
  clearAssistantInputs(assistantPlatform)
  renderAssistant()
  if (assistantId) await api('/api/connection-assistant/cancel', { assistantId }).catch(() => undefined)
}

async function clearAllAssistantContexts() {
  assistantSelectionRevision += 1
  await Promise.all(Object.keys(assistantState).map(async (platform) => {
    const local = assistantState[platform]
    local.controller?.abort()
    const assistantId = local.report?.assistantId
    local.report = null
    local.controller = null
    local.phase = 'idle'
    clearAssistantInputs(platform)
    if (assistantId) await api('/api/connection-assistant/cancel', { assistantId }).catch(() => undefined)
  }))
  renderAssistant()
}

function clearAssistantInputs(platform) {
  assistantState[platform].target = 'current-screen'
  if (platform === 'android') elements.androidHelperConfirmation.checked = false
  elements.rememberSetup.checked = false
  if (platform === 'ios') {
    elements.iosTeamId.value = ''
    elements.iosWdaBundleId.value = ''
  }
}

function renderAssistant() {
  const local = assistantState[assistantPlatform]
  const target = local.phase === 'connecting' ? local.activeTarget : local.target
  const report = local.report
  const selectedDevice = elements.assistantDevice.value
  const selectedRuntime = elements.assistantRuntime.value
  const platformName = assistantPlatform === 'android' ? 'Android' : 'iPhone'
  const savedPlatform = state?.localSetup?.preferredPlatform
  const savedForCurrentPlatform = savedPlatform === assistantPlatform
  const simulator = elements.assistantDeviceKind.value === 'simulator'
  elements.androidAssistantFields.querySelector('[data-i18n="assistant.android.helper"]').textContent = t(simulator ? 'assistant.android.helper.simulator' : 'assistant.android.helper')
  elements.rememberSetupRow.querySelector('[data-i18n="assistant.remember"]').textContent = t(simulator ? 'assistant.remember.simulator' : 'assistant.remember')
  for (const button of elements.assistantPlatformButtons) {
    button.classList.toggle('selected', button.dataset.platform === assistantPlatform)
    button.setAttribute('aria-pressed', String(button.dataset.platform === assistantPlatform))
  }
  elements.androidAssistantFields.hidden = assistantPlatform !== 'android'
  elements.iosAssistantFields.hidden = assistantPlatform !== 'ios' || simulator
  elements.androidAssistantFields.querySelector('.manual-boundary').hidden = simulator
  document.querySelector('#assistant-simulator-hint').hidden = !simulator
  elements.assistantDeviceKind.disabled = Object.values(assistantState).some(local => local.phase === 'connecting')
  elements.assistantProgress.hidden = local.phase !== 'checking' && local.phase !== 'connecting'
  elements.assistantProgressTitle.textContent = local.phase === 'connecting'
    ? t(target === 'settings' ? 'assistant.progress.connectSettings' : 'assistant.progress.connect', { platform: platformName })
    : t('assistant.progress.check', { platform: platformName })
  elements.assistantCheck.disabled = local.phase === 'checking' || local.phase === 'connecting'
  document.querySelector('#assistant-media-policy').disabled = Object.values(assistantState).some(state => state.phase === 'connecting')
  elements.assistantSavedSetup.hidden = simulator || !savedForCurrentPlatform || Boolean(report) || state?.lifecycle === 'streaming'
  elements.assistantSavedDetail.textContent = t(assistantPlatform === 'android' ? 'assistant.saved.detail.android' : 'assistant.saved.detail.ios')
  elements.assistantQuickConnect.disabled = local.phase === 'checking' || local.phase === 'connecting'
  elements.assistantCheck.textContent = t(report ? 'assistant.check.again' : simulator ? 'assistant.check.simulator' : 'assistant.check.initial')
  elements.assistantCancel.hidden = !report && !local.controller
  elements.assistantReport.hidden = !report
  elements.rememberSetupRow.hidden = state?.localSetup?.persistenceAvailable !== true
  if (!report) return

  const labels = { ready: 'assistant.summary.ready', 'action-required': 'assistant.summary.actionRequired', blocked: 'assistant.summary.blocked' }
  elements.assistantSummaryTitle.textContent = t(report.stale ? 'preflight.stale' : labels[report.status] || 'assistant.summary.checked')
  elements.assistantSummaryExpiry.textContent = expiresIn(report.expiresAt)
  elements.assistantChecks.replaceChildren(...report.checks.map((check) => {
    const row = document.createElement('div')
    row.className = `readiness-row ${check.status}`
    const dot = document.createElement('i')
    dot.setAttribute('aria-hidden', 'true')
    const text = document.createElement('span')
    const title = document.createElement('strong')
    const titleKey = `assistant.checkTitle.${check.id}`
    title.textContent = t(hasTranslation(titleKey) ? titleKey : 'assistant.checkTitle.unknown')
    const detail = document.createElement('small')
    const actionKey = `assistant.action.${check.code}`
    detail.textContent = `${t(hasTranslation(actionKey) ? actionKey : 'assistant.action.unknown')}${check.version ? ` · ${check.version}` : ''}`
    text.append(title, detail)
    row.append(dot, text)
    return row
  }))
  elements.assistantDevice.replaceChildren(...report.devices.map((device, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = `${device.label}${device.osVersion ? ` · ${device.osVersion}` : ''}`
    return option
  }))
  elements.assistantRuntime.replaceChildren(...report.runtimeChoices.map((runtime) => {
    const option = document.createElement('option')
    option.value = runtime
    option.textContent = t(runtime === 'managed-once' ? 'assistant.runtime.managedOnce' : 'assistant.runtime.configured')
    return option
  }))
  if ([...elements.assistantDevice.options].some((option) => option.value === selectedDevice)) elements.assistantDevice.value = selectedDevice
  if ([...elements.assistantRuntime.options].some((option) => option.value === selectedRuntime)) elements.assistantRuntime.value = selectedRuntime
  const settingsUnavailable = report.devices[Number(elements.assistantDevice.value)]?.settingsAvailable === false
  elements.assistantTarget.querySelector('[value="settings"]').disabled = settingsUnavailable
  elements.assistantTarget.value = target
  elements.assistantTargetHint.textContent = t(target === 'settings' ? 'assistant.target.settingsHint' : 'assistant.target.currentHint')
  const missingDevice = report.devices.length === 0
  const missingRuntime = report.runtimeChoices.length === 0
  const busy = local.phase === 'checking' || local.phase === 'connecting'
  elements.assistantDevice.disabled = missingDevice || busy
  elements.assistantRuntime.disabled = missingRuntime || busy
  elements.assistantTarget.disabled = missingDevice || busy
  elements.assistantConnect.disabled = report.status === 'blocked' || missingDevice || missingRuntime || busy || (local.target === 'settings' && settingsUnavailable)
  if (assistantPlatform === 'ios') {
    const required = report.signing?.requiredInputs || []
    elements.iosTeamId.required = required.includes('team-id')
    elements.iosWdaBundleId.required = required.includes('wda-bundle-id')
  }
}

async function api(path, body, signal) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const payload = await response.json()
  if (!response.ok) {
    const error = new Error('Viewer request failed')
    const candidateCode = typeof payload.code === 'string' ? payload.code : typeof payload.error === 'string' ? payload.error : null
    error.code = candidateCode && /^[a-z0-9_]{1,96}$/.test(candidateCode) ? candidateCode : null
    error.status = response.status
    throw error
  }
  return payload
}

async function refreshState() {
  try {
    state = await api('/api/state')
    render(state)
  } catch (error) {
    inspector.unconfirmed()
    capture.stop('disconnected')
    showErrorKey('error.viewerUnavailable')
  }
}

function render(next) {
  inspector.setContext(next.inspectionContext ?? null)
  const streaming = next.lifecycle === 'streaming'
  capture.setSession(streaming ? next.sessionId : null)
  const retainedFrame = !streaming && Boolean(next.frameUpdatedAt)
  const frameSessionChanged = framePollingSessionId !== next.sessionId
  if (frameSessionChanged) resetFramePolling(next.sessionId)
  if (!streaming || (localMediaFailureSession && localMediaFailureSession !== next.sessionId)) {
    localMediaFailure = null
    localMediaFailureSession = null
  }
  renderStateCopy(next)
  elements.phone.classList.toggle('streaming', streaming || retainedFrame)
  elements.phone.closest('.stage').classList.toggle('streaming', streaming || retainedFrame)
  elements.empty.hidden = streaming || retainedFrame
  if (streaming) {
    manageMedia(next.media)
    if (!mediaRendered || next.media?.phase === 'fallback' || next.media?.transport === 'appium-screenshot') {
      const frameInterval = next.media?.transport !== 'appium-screenshot' && next.media?.phase !== 'fallback'
        ? MEDIA_START_POLL_DELAY_MS
        : next.frameIntervalMs || 750
      if (frameSessionChanged && next.frameUpdatedAt) {
        void refreshFrame(false, true).finally(() => scheduleFrames(frameInterval))
      } else {
        scheduleFrames(frameInterval)
      }
    } else {
      clearTimeout(frameTimer)
      frameTimer = null
    }
  } else {
    stopMedia(false)
    clearTimeout(frameTimer)
    frameTimer = null
    if (retainedFrame) void refreshFrame(false, true)
    else elements.frame.hidden = true
    elements.mjpeg.hidden = true
    elements.video.hidden = true
  }
  scheduleStateRefresh()
}

function renderStateCopy(next) {
  if (!providerInitialized) {
    const preferred = next.localSetup?.preferredPlatform
    if (preferred === 'android' || preferred === 'ios') {
      elements.provider.value = 'appium'
      assistantPlatform = preferred
      elements.assistantPanel.hidden = false
      elements.appiumOptions.hidden = false
      elements.start.hidden = true
    }
    providerInitialized = true
  }
  renderOperationText(next)
  elements.pill.className = `connection-pill ${next.lifecycle}`
  elements.connectionLabel.textContent = labelFor(next.lifecycle)
  elements.deviceName.textContent = next.deviceName || t('stage.noDevice')
  elements.metaProvider.textContent = next.provider || '—'
  elements.metaSession.textContent = next.sessionId || '—'
  elements.metaFrame.textContent = next.frameUpdatedAt ? relativeTime(next.frameUpdatedAt) : '—'
  elements.metaMedia.textContent = mediaLabel(next.media, localMediaFailure, framePollingDegraded)
  elements.metaAgentPolicy.textContent = next.agentScreenContentPolicy || '—'
  elements.assistantPolicySummary.textContent = t('assistant.policy.summary', {
    screen: next.agentScreenContentPolicy || t('assistant.policy.profileDefault'),
    text: next.agentTextInputPolicy || t('assistant.policy.profileDefault'),
    apps: next.agentAppControlPolicy || t('assistant.policy.profileDefault'),
    hiddenApi: t(next.androidIgnoreHiddenApiPolicyError ? 'assistant.policy.on' : 'assistant.policy.strict'),
    registration: t(next.iosWdaProvisioningMutationEnabled ? 'assistant.policy.registrationEnabled' : 'assistant.policy.off'),
  })
  renderObservation(next.observation)
  renderControl(next.control)
  if (next.lifecycle === 'error') {
    showErrorCode(next.lastErrorCode, 'state')
  } else if (currentError?.source === 'state') {
    hideError()
  }
  updateStartWarnings()
  updateControls()
  renderAssistant()
}

function renderControl(control) {
  const active = control?.phase === 'acting' || control?.phase === 'managing-app'
  const errorCode = control?.lastErrorCode
  elements.agentControl.classList.toggle('active', active)
  elements.agentControl.classList.toggle('failed', Boolean(errorCode))
  if (active) {
    elements.agentControlTitle.textContent = t(control.phase === 'acting' ? 'control.acting.title' : 'control.managing.title')
    elements.agentControlDetail.textContent = control.startedAt
      ? t('time.started', { time: relativeTime(control.startedAt) })
      : t('control.active.detail')
  } else if (errorCode) {
    elements.agentControlTitle.textContent = t('control.failed.title')
    elements.agentControlDetail.textContent = errorCode
  } else if (control?.lastCompletedAt) {
    elements.agentControlTitle.textContent = t('control.complete.title')
    elements.agentControlDetail.textContent = t('time.completed', { time: relativeTime(control.lastCompletedAt) })
  } else {
    elements.agentControlTitle.textContent = t('control.idle.title')
    elements.agentControlDetail.textContent = t('control.idle.detail')
  }
}

function renderObservation(observation) {
  const capturing = observation?.phase === 'capturing'
  const errorCode = observation?.lastErrorCode
  elements.agentObservation.classList.toggle('capturing', capturing)
  elements.agentObservation.classList.toggle('failed', Boolean(errorCode))
  if (capturing) {
    elements.agentObservationTitle.textContent = t('observation.capturing.title')
    elements.agentObservationDetail.textContent = observation.startedAt
      ? t('time.started', { time: relativeTime(observation.startedAt) })
      : t('observation.capturing.detail')
  } else if (errorCode) {
    elements.agentObservationTitle.textContent = t('observation.failed.title')
    elements.agentObservationDetail.textContent = errorCode
  } else if (observation?.lastCompletedAt) {
    elements.agentObservationTitle.textContent = t('observation.ready.title')
    elements.agentObservationDetail.textContent = t('time.completed', { time: relativeTime(observation.lastCompletedAt) })
  } else {
    elements.agentObservationTitle.textContent = t('observation.idle.title')
    elements.agentObservationDetail.textContent = t('observation.idle.detail')
  }
}

function scheduleStateRefresh() {
  clearTimeout(stateTimer)
  stateTimer = setTimeout(async () => {
    try {
      const next = await api('/api/state')
      if (!state || next.revision !== state.revision) {
        state = next
        render(next)
      } else {
        scheduleStateRefresh()
      }
    } catch {
      inspector.unconfirmed()
    capture.stop('disconnected')
      scheduleStateRefresh()
    }
  }, 250)
}

function updateStartWarnings() {
  updateAndroidPolicyWarning()
  updateProvisioningWarning()
}

function updateAndroidPolicyWarning() {
  let enabled = state?.androidIgnoreHiddenApiPolicyError === true
  if (elements.provider.value !== 'appium' || !elements.appiumOptions.open || elements.sessionId.value.trim()) {
    elements.androidPolicyWarning.hidden = true
    return
  }
  try {
    const capabilities = JSON.parse(elements.capabilities.value)
    const androidSession = capabilities && typeof capabilities === 'object'
      && typeof capabilities.platformName === 'string'
      && capabilities.platformName.toLowerCase() === 'android'
    if (!androidSession) {
      elements.androidPolicyWarning.hidden = true
      return
    }
    if (Object.hasOwn(capabilities, 'appium:ignoreHiddenApiPolicyError')) {
      enabled = capabilities['appium:ignoreHiddenApiPolicyError'] === true
    }
  } catch {
    elements.androidPolicyWarning.hidden = true
    return
  }
  elements.androidPolicyWarning.hidden = !enabled
}

function updateProvisioningWarning() {
  let enabled = state?.iosWdaProvisioningMutationEnabled === true
  if (elements.provider.value !== 'appium' || !elements.appiumOptions.open || elements.sessionId.value.trim()) {
    elements.provisioningWarning.hidden = true
    return
  }
  try {
    const capabilities = JSON.parse(elements.capabilities.value)
    const iosSession = capabilities && typeof capabilities === 'object'
      && typeof capabilities.platformName === 'string'
      && capabilities.platformName.toLowerCase() === 'ios'
    if (!iosSession) {
      elements.provisioningWarning.hidden = true
      return
    }
    if (capabilities && typeof capabilities === 'object' && Object.hasOwn(capabilities, 'appium:allowProvisioningDeviceRegistration')) {
      enabled = capabilities['appium:allowProvisioningDeviceRegistration'] === true
    }
  } catch {
    // The start handler owns JSON validation; an invalid request cannot start provisioning.
    elements.provisioningWarning.hidden = true
    return
  }
  elements.provisioningWarning.hidden = !enabled
}

function updateControls() {
  const lifecycle = state?.lifecycle || 'idle'
  const streaming = lifecycle === 'streaming'
  elements.start.disabled = operationInFlight || streaming
  elements.advancedStart.disabled = operationInFlight || streaming
  elements.stop.disabled = Boolean(state?.runOwner) || !(streaming || lifecycle === 'connecting')
  elements.provider.disabled = operationInFlight || streaming
  for (const button of elements.actions) button.disabled = !streaming || operationInFlight || Boolean(state?.runOwner)
}

function scheduleFrames(interval, immediate = false) {
  if (mediaRendered || state?.lifecycle !== 'streaming') return
  if (immediate) {
    frameImmediateRequested = true
    clearTimeout(frameTimer)
    frameTimer = null
  }
  if (frameTimer || frameRequestInFlight) return
  const delay = frameImmediateRequested ? 0 : framePollingDelay(interval)
  frameImmediateRequested = false
  frameTimer = setTimeout(async () => {
    frameTimer = null
    if (mediaRendered || state?.lifecycle !== 'streaming') return
    await refreshFrame()
    if (state?.lifecycle === 'streaming' && !mediaRendered) scheduleFrames(interval, frameImmediateRequested)
  }, delay)
}

async function refreshFrame(trackFailure = true, cached = false) {
  if (frameRequestInFlight) return false
  frameRequestInFlight = true
  const requestedSession = state?.sessionId
  try {
    const response = await fetch(`/api/frame?${cached ? 'cached=1&' : ''}t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`frame request failed (${response.status})`)
    const stale = response.headers.get('x-mobile-mirror-frame-status') === 'stale'
    if (stale && elements.frame.src) {
      await response.body?.cancel().catch(() => undefined)
      if (trackFailure) recordFramePollingFailure()
      return false
    }
    const blob = await response.blob()
    if (requestedSession !== state?.sessionId) return false
    const objectUrl = URL.createObjectURL(blob)
    try {
      await new Promise((resolve, reject) => {
        elements.frame.onload = resolve
        elements.frame.onerror = reject
        elements.frame.src = objectUrl
      })
    } finally {
      elements.frame.onload = null
      elements.frame.onerror = null
      URL.revokeObjectURL(objectUrl)
    }
    if (requestedSession !== state?.sessionId) return false
    showPollingFrame()
    if (stale) {
      if (trackFailure) recordFramePollingFailure()
      return false
    }
    resetFrameFailures()
    return true
  } catch {
    if (trackFailure) recordFramePollingFailure()
    return false
  } finally {
    frameRequestInFlight = false
  }
}

function framePollingDelay(interval) {
  if (framePollingDegraded) return MAX_FRAME_POLL_INTERVAL_MS
  return Math.min(interval * (2 ** Math.max(0, frameFailureCount - 1)), MAX_FRAME_POLL_INTERVAL_MS)
}

function requestImmediateFrame() {
  scheduleFrames(state?.frameIntervalMs || 750, true)
}

function recordFramePollingFailure() {
  frameFailureCount += 1
  framePollingDegraded = frameFailureCount >= DEGRADED_FRAME_FAILURE_COUNT
  elements.metaMedia.textContent = mediaLabel(state?.media, localMediaFailure, framePollingDegraded)
}

function resetFrameFailures() {
  frameFailureCount = 0
  framePollingDegraded = false
  elements.metaMedia.textContent = mediaLabel(state?.media, localMediaFailure, false)
}

function resetFramePolling(sessionId = null) {
  clearTimeout(frameTimer)
  frameTimer = null
  frameImmediateRequested = false
  framePollingSessionId = sessionId
  resetFrameFailures()
}

function manageMedia(media) {
  const transport = media?.transport || 'appium-screenshot'
  const eligible = !localMediaFailure && media?.mode === 'auto' && (media?.phase === 'ready' || media?.phase === 'starting' || media?.phase === 'live')
  if (!eligible || transport === 'appium-screenshot') {
    if (mediaTransport) resumePolling(media?.lastErrorCode || 'server-fallback')
    return
  }
  if (mediaTransport === transport && mediaAbort && !mediaAbort.signal.aborted) return
  stopMedia(true)
  if (transport === 'scrcpy-h264') void startAndroidMedia()
  if (transport === 'wda-mjpeg') startIosMedia()
}

async function startAndroidMedia() {
  if (!('VideoDecoder' in window) || !('EncodedVideoChunk' in window)) {
    localMediaFailure = 'decoder unsupported'
    localMediaFailureSession = state?.sessionId || null
    elements.metaMedia.textContent = mediaLabel(state?.media, localMediaFailure)
    resumePolling('decoder-unsupported')
    return
  }
  let baseline
  try {
    baseline = await VideoDecoder.isConfigSupported({ codec: 'avc1.42E01E', optimizeForLatency: true })
  } catch {
    baseline = { supported: false }
  }
  if (!baseline.supported) {
    localMediaFailure = 'decoder unsupported'
    localMediaFailureSession = state?.sessionId || null
    elements.metaMedia.textContent = mediaLabel(state?.media, localMediaFailure)
    resumePolling('decoder-unsupported')
    return
  }

  mediaTransport = 'scrcpy-h264'
  mediaRendered = false
  resetMediaMetrics('scrcpy-h264')
  mediaAbort = new AbortController()
  const signal = mediaAbort.signal
  let generation = null
  let decoderConfigured = false
  let codec = 'avc1.42E01E'
  let decodedWidth = 0
  let decodedHeight = 0
  let waitingForDecoderKey = true
  let buffer = new Uint8Array()
  const relayByTimestamp = new Map()
  let failureReason = 'stream-start-failed'

  try {
    const response = await fetch('/api/media/stream', { cache: 'no-store', signal })
    generation = response.headers.get('x-mobile-mirror-generation')
    if (!response.ok || !response.body || !generation) throw new Error('media stream unavailable')
    failureReason = 'stream-read-failed'
    videoDecoder = new VideoDecoder({
      output: (frame) => {
        try {
          const width = frame.displayWidth || frame.codedWidth || frame.width
          const height = frame.displayHeight || frame.codedHeight || frame.height
          if (width > 0 && height > 0) {
            const frameElement = elements.video.closest('.phone-frame')
            const pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
            const canvasWidth = Math.max(1, Math.round(frameElement.clientWidth * pixelRatio))
            const canvasHeight = Math.max(1, Math.round(frameElement.clientHeight * pixelRatio))
            if (elements.video.width !== canvasWidth) elements.video.width = canvasWidth
            if (elements.video.height !== canvasHeight) elements.video.height = canvasHeight
            const context = elements.video.getContext('2d', { alpha: false })
            const scale = Math.min(canvasWidth / width, canvasHeight / height)
            const drawWidth = Math.round(width * scale)
            const drawHeight = Math.round(height * scale)
            const drawX = Math.floor((canvasWidth - drawWidth) / 2)
            const drawY = Math.floor((canvasHeight - drawHeight) / 2)
            context.fillStyle = '#000'
            context.fillRect(0, 0, canvasWidth, canvasHeight)
            context.drawImage(frame, drawX, drawY, drawWidth, drawHeight)
            capture.videoFrame(frame, state?.sessionId, elements.video)
            const relayAt = typeof frame.timestamp === 'number' ? relayByTimestamp.get(frame.timestamp) : undefined
            if (typeof frame.timestamp === 'number') relayByTimestamp.delete(frame.timestamp)
            showMediaElement(elements.video, relayAt)
          }
        } catch {
          void reportMediaFailure(generation, 'render-failed')
          resumePolling('render-failed')
        } finally {
          frame.close()
        }
      },
      error: () => {
        void reportMediaFailure(generation, 'decoder-failed')
        resumePolling('decoder-failed')
      },
    })

    const reader = response.body.getReader()
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer = appendBytes(buffer, value)
        while (buffer.byteLength >= 36) {
          const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
          if (readAscii(buffer, 0, 4) !== 'MMV1' || view.getUint8(4) !== 1) {
            failureReason = 'invalid-envelope'
            throw new Error('invalid media envelope')
          }
          const type = view.getUint8(5)
          const packetType = androidPacketType(type)
          if (!packetType) {
            failureReason = 'invalid-envelope'
            throw new Error('invalid media packet type')
          }
          const payloadLength = view.getUint32(8)
          const width = view.getUint32(12)
          const height = view.getUint32(16)
          if (payloadLength > 8 * 1024 * 1024) {
            failureReason = 'invalid-envelope'
            throw new Error('media packet too large')
          }
          if (buffer.byteLength < 36 + payloadLength) break
          const pts = view.getBigUint64(20)
          const relayAt = Number(view.getBigUint64(28))
          const payload = buffer.slice(36, 36 + payloadLength)
          buffer = buffer.slice(36 + payloadLength)
          mediaMetrics.lastPacketType = packetType
          mediaMetrics.packetCounts[packetType] = (mediaMetrics.packetCounts[packetType] || 0) + 1

          if (type === 1) {
            failureReason = 'invalid-metadata'
            const metadata = JSON.parse(new TextDecoder().decode(payload))
            if (metadata.generation !== generation || typeof metadata.codec !== 'string' || metadata.codec.length > 32) {
              throw new Error('invalid media metadata')
            }
            codec = metadata.codec
            const support = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true })
            if (!support.supported) {
              await reportMediaFailure(generation, 'decoder-unsupported')
              resumePolling('decoder-unsupported')
              return
            }
            videoDecoder.configure({ codec, optimizeForLatency: true })
            decoderConfigured = true
            failureReason = 'stream-read-failed'
            continue
          }
          if (type === 2) {
            if (decoderConfigured) {
              videoDecoder.reset()
              videoDecoder.configure({ codec, optimizeForLatency: true })
            }
            decodedWidth = width
            decodedHeight = height
            continue
          }
          if (type === 3) continue
          if ((type !== 4 && type !== 5) || !decoderConfigured) {
            failureReason = 'invalid-envelope'
            throw new Error('invalid media packet order')
          }
          if (width > 0 && height > 0 && (width !== decodedWidth || height !== decodedHeight)) {
            if (type !== 4) continue
            videoDecoder.reset()
            videoDecoder.configure({ codec, optimizeForLatency: true })
            decodedWidth = width
            decodedHeight = height
          }
          if (type === 5 && (waitingForDecoderKey || videoDecoder.decodeQueueSize > 2)) {
            waitingForDecoderKey = true
            continue
          }
          if (type === 4) waitingForDecoderKey = false
          const timestamp = Number(pts <= BigInt(Number.MAX_SAFE_INTEGER) ? pts : 0n)
          relayByTimestamp.set(timestamp, relayAt)
          while (relayByTimestamp.size > 64) relayByTimestamp.delete(relayByTimestamp.keys().next().value)
          failureReason = 'decoder-threw'
          videoDecoder.decode(new EncodedVideoChunk({ type: type === 4 ? 'key' : 'delta', timestamp, data: payload }))
          failureReason = 'stream-read-failed'
        }
      }
      if (!signal.aborted) {
        failureReason = 'stream-ended'
        throw new Error('media stream ended')
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  } catch {
    if (!signal.aborted) {
      await reportMediaFailure(generation, 'decoder-failed')
      resumePolling(failureReason)
    }
  }
}

function startIosMedia() {
  mediaTransport = 'wda-mjpeg'
  mediaRendered = false
  resetMediaMetrics('wda-mjpeg')
  mediaAbort = new AbortController()
  elements.mjpeg.onload = () => showMediaElement(elements.mjpeg)
  elements.mjpeg.onerror = () => resumePolling('mjpeg-failed')
  elements.mjpeg.src = '/api/media/stream'
  clearInterval(mjpegReadyTimer)
  mjpegReadyTimer = setInterval(() => {
    if (!mediaRendered && elements.mjpeg.naturalWidth > 0 && elements.mjpeg.naturalHeight > 0) showMediaElement(elements.mjpeg)
  }, 100)
}

function showMediaElement(element, relayAt = undefined) {
  if (!state || state.lifecycle !== 'streaming') return
  recordMediaPaint(relayAt)
  mediaRendered = true
  elements.frame.hidden = true
  elements.mjpeg.hidden = element !== elements.mjpeg
  elements.video.hidden = element !== elements.video
  if (element !== elements.video) capture.frame(element, state.sessionId)
  clearTimeout(frameTimer)
  frameTimer = null
}

function showPollingFrame() {
  if (!state || (state.lifecycle !== 'streaming' && !state.frameUpdatedAt)) return
  mediaRendered = false
  elements.frame.hidden = false
  capture.frame(elements.frame, state.sessionId)
  elements.mjpeg.hidden = true
  elements.video.hidden = true
}

function resumePolling(reason = 'unknown') {
  mediaMetrics.fallbackAt = Date.now()
  mediaMetrics.fallbackReason = reason
  stopMedia(true)
  mediaRendered = false
  requestImmediateFrame()
}

function stopMedia(preserveLastFrame) {
  mediaAbort?.abort()
  mediaAbort = null
  mediaTransport = null
  clearInterval(mjpegReadyTimer)
  mjpegReadyTimer = null
  elements.mjpeg.onload = null
  elements.mjpeg.onerror = null
  if (elements.mjpeg.src) elements.mjpeg.removeAttribute('src')
  if (videoDecoder) {
    try { videoDecoder.close() } catch {}
    videoDecoder = null
  }
  if (!preserveLastFrame) {
    mediaRendered = false
    const context = elements.video.getContext('2d')
    context?.clearRect(0, 0, elements.video.width, elements.video.height)
  }
}

async function reportMediaFailure(generation, code) {
  const activeGeneration = generation || document.querySelector('meta[name="media-generation"]')?.content
  if (!activeGeneration) return
  try {
    await api('/api/media/client-failure', { generation: activeGeneration, code })
  } catch {
    // Screenshot polling is the local recovery path even if the report races teardown.
  }
}

function appendBytes(left, right) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength)
  bytes.set(left)
  bytes.set(right, left.byteLength)
  return bytes
}

function readAscii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function androidPacketType(type) {
  return ({ 1: 'metadata', 2: 'session', 3: 'config', 4: 'key', 5: 'delta' })[type] || null
}

function mediaLabel(media, localFailure = null, pollingDegraded = false) {
  if (!media) return t('media.polling')
  const transportKey = `media.transport.${media.transport}`
  const transport = hasTranslation(transportKey) ? t(transportKey) : t('common.unavailable')
  if (localFailure) {
    const failureKey = `media.failure.${localFailure}`
    return t('media.status', {
      transport: t('media.transport.appium-screenshot'),
      phase: t(hasTranslation(failureKey) ? failureKey : 'media.failure.unknown'),
    })
  }
  if (pollingDegraded && media.transport === 'appium-screenshot') {
    return t('media.status', { transport, phase: t('media.degradedRetry') })
  }
  const phaseKey = `media.phase.${media.phase}`
  return t('media.status', { transport, phase: t(hasTranslation(phaseKey) ? phaseKey : 'common.unavailable') })
}

function resetMediaMetrics(transport) {
  mediaMetrics.transport = transport
  mediaMetrics.streamStartedAt = Date.now()
  mediaMetrics.firstPaintAt = null
  mediaMetrics.paintTimes = []
  mediaMetrics.receiveToPaintMs = []
  mediaMetrics.fallbackAt = null
  mediaMetrics.fallbackReason = null
  mediaMetrics.packetCounts = {}
  mediaMetrics.lastPacketType = null
}

function recordMediaPaint(relayAt) {
  const now = Date.now()
  mediaMetrics.firstPaintAt ||= now
  mediaMetrics.paintTimes.push(now)
  if (mediaMetrics.paintTimes.length > 1_200) mediaMetrics.paintTimes.shift()
  if (Number.isFinite(relayAt)) {
    const latency = now - relayAt
    if (latency >= 0 && latency <= 60_000) {
      mediaMetrics.receiveToPaintMs.push(latency)
      if (mediaMetrics.receiveToPaintMs.length > 1_200) mediaMetrics.receiveToPaintMs.shift()
    }
  }
}

function mediaMetricsSnapshot() {
  const times = [...mediaMetrics.paintTimes]
  const durationMs = times.length >= 2 ? times[times.length - 1] - times[0] : 0
  const latencies = [...mediaMetrics.receiveToPaintMs].sort((left, right) => left - right)
  const p95Index = latencies.length ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : -1
  return {
    transport: mediaMetrics.transport,
    firstPaintMs: mediaMetrics.firstPaintAt && mediaMetrics.streamStartedAt
      ? mediaMetrics.firstPaintAt - mediaMetrics.streamStartedAt
      : null,
    paintedFrames: times.length,
    paintedFps: times.length >= 2 && durationMs > 0 ? (times.length - 1) * 1_000 / durationMs : null,
    receiveToPaintP95Ms: p95Index >= 0 ? latencies[p95Index] : null,
    fallbackMs: mediaMetrics.fallbackAt && mediaMetrics.streamStartedAt
      ? mediaMetrics.fallbackAt - mediaMetrics.streamStartedAt
      : null,
    fallbackReason: mediaMetrics.fallbackReason,
    packetCounts: { ...mediaMetrics.packetCounts },
    lastPacketType: mediaMetrics.lastPacketType,
    mediaVisible: mediaRendered,
    pollingVisible: !elements.frame.hidden,
  }
}

function t(key, params = {}) {
  return translate(locale, key, params)
}

function hasTranslation(key) {
  return Object.hasOwn(TRANSLATIONS.en, key)
}

function renderLocalizedCopy() {
  applyDocumentTranslations(document, locale)
  capture.render()
  inspector.render()
  elements.language.value = locale
  renderPreviewZoom(false)
  renderOperationText(state)
  if (state) renderStateCopy(state)
  else renderAssistant()
  renderCurrentError()
}

function stepPreviewZoom(direction) {
  const current = previewZoom.mode === 'fit' ? 1 : previewZoom.scale
  const currentIndex = ZOOM_STEPS.indexOf(current)
  const fallbackIndex = ZOOM_STEPS.findIndex((step) => step >= current)
  const index = currentIndex >= 0 ? currentIndex : Math.max(0, fallbackIndex)
  const nextIndex = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction))
  setPreviewZoom('manual', ZOOM_STEPS[nextIndex])
}

function setPreviewZoom(mode, scale) {
  inspector.setZoom(mode === 'fit' ? 1 : scale)
  previewZoom.mode = mode
  previewZoom.scale = ZOOM_STEPS.includes(scale) ? scale : 1
  updatePreviewLayout()
  renderPreviewZoom(true)
}

function updatePreviewLayout() {
  const style = getComputedStyle(elements.deviceArea)
  const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
  const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
  const availableWidth = Math.max(1, elements.deviceArea.clientWidth - horizontalPadding)
  const availableHeight = Math.max(1, elements.deviceArea.clientHeight - verticalPadding)
  const fitHeight = Math.max(1, Math.min(availableHeight, availableWidth / PHONE_ASPECT_RATIO))
  previewZoom.fitHeight = fitHeight
  const multiplier = previewZoom.mode === 'fit' ? 1 : previewZoom.scale
  const height = Math.max(1, Math.round(fitHeight * multiplier))
  const width = Math.max(1, Math.round(height * PHONE_ASPECT_RATIO))
  if (elements.phone.style.getPropertyValue('--phone-height') !== `${height}px`) {
    elements.phone.style.setProperty('--phone-height', `${height}px`)
    elements.phone.style.setProperty('--phone-width', `${width}px`)
  }
}

function renderPreviewZoom(announce) {
  const label = previewZoom.mode === 'fit'
    ? t('zoom.fit')
    : t('zoom.percent', { percent: Math.round(previewZoom.scale * 100) })
  if (announce || elements.zoomValue.textContent !== label) elements.zoomValue.textContent = label
  const effectiveScale = previewZoom.mode === 'fit' ? 1 : previewZoom.scale
  elements.zoomOut.disabled = effectiveScale <= ZOOM_STEPS[0]
  elements.zoomIn.disabled = effectiveScale >= ZOOM_STEPS.at(-1)
  elements.zoomFit.setAttribute('aria-pressed', String(previewZoom.mode === 'fit'))
}

function renderOperationText(next = state) {
  if (!currentOperation) return
  let { titleKey, detailKey } = currentOperation
  if (next?.lifecycle === 'connecting' && next.appiumRuntime?.phase === 'starting') {
    titleKey = 'operation.managedStart.title'
    detailKey = 'operation.managedStart.detail'
  } else if (next?.lifecycle === 'stopping' && next.appiumRuntime?.owned) {
    titleKey = 'operation.managedStop.title'
    detailKey = 'operation.managedStop.detail'
  }
  const params = currentOperation.params.actionKind
    ? { ...currentOperation.params, action: t(`action.${currentOperation.params.actionKind}`) }
    : currentOperation.params
  elements.operationTitle.textContent = t(titleKey, params)
  elements.operationDetail.textContent = t(detailKey, params)
}

function showErrorKey(key, params = {}, source = 'local') {
  currentError = { key, params, source }
  renderCurrentError()
}

function showErrorCode(code, source = 'local') {
  const errorKey = code ? `error.${code}` : null
  showErrorKey(errorKey && hasTranslation(errorKey) ? errorKey : 'error.operationFailed', {}, source)
}

function showRequestError(error) {
  if (error?.code) {
    showErrorCode(error.code)
    return
  }
  showErrorKey('error.requestFailed', { status: Number.isInteger(error?.status) ? error.status : '—' })
}

function renderCurrentError() {
  if (!currentError) return
  elements.error.textContent = t(currentError.key, currentError.params)
  elements.error.hidden = false
}

function hideError() {
  currentError = null
  elements.error.hidden = true
  elements.error.textContent = ''
}

function labelFor(lifecycle) {
  const key = `lifecycle.${lifecycle}`
  return t(hasTranslation(key) ? key : 'common.unavailable')
}

function relativeTime(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  return seconds < 2 ? t('time.justNow') : t('time.secondsAgo', { seconds })
}

function expiresIn(value) {
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000))
  return t(seconds === 0 ? 'assistant.expiry.expired' : 'assistant.expiry.seconds', { seconds })
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopMedia(true)
  else if (state?.lifecycle === 'streaming') manageMedia(state.media)
})
window.addEventListener('pagehide', () => stopMedia(false))
window.addEventListener('beforeunload', (event) => { if (!event.defaultPrevented) stopMedia(false) })

updatePreviewLayout()
renderLocalizedCopy()
void refreshState()
