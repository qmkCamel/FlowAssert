import { errorMessage } from './abort.js'

export type WdaStartErrorCode =
  | 'wda_developer_account_unavailable'
  | 'wda_profile_missing'
  | 'wda_signing_identity_invalid'
  | 'wda_device_trust_or_developer_mode_required'
  | 'wda_unknown_start_failure'

export class WdaStartError extends Error {
  readonly code: WdaStartErrorCode
  readonly action: string
  readonly summary: string | null

  constructor(code: WdaStartErrorCode, action: string, summary: string | null = null, cause?: unknown) {
    super(`[${code}] ${action}${summary ? ` Summary: ${summary}` : ''}`, { cause })
    this.name = 'WdaStartError'
    this.code = code
    this.action = action
    this.summary = summary
  }
}

export function classifyWdaStartFailure(error: unknown, sensitiveValues: unknown[]): WdaStartError {
  const raw = errorMessage(error)
  const normalized = raw.toLowerCase()
  if (/no accounts? with (?:team|id)\b|no accounts? for (?:the )?(?:signing )?team\b|no accounts? (?:registered|available) (?:with|in) xcode\b|(?:apple|developer|xcode) account[^\n]{0,100}(?:not signed in|not logged in|unavailable)/.test(normalized)) {
    return new WdaStartError(
      'wda_developer_account_unavailable',
      'Sign in to the Apple developer account for this Team in Xcode Settings > Accounts, then rerun the iOS readiness check and connect.',
      null,
      error,
    )
  }
  if (/no profiles for|provisioning profile.*(?:not found|missing)|requires a provisioning profile|doesn't include signing certificate/.test(normalized)) {
    return new WdaStartError(
      'wda_profile_missing',
      'Configure a unique WDA bundle ID and run WebDriverAgentRunner once with Xcode automatic signing, or explicitly authorize automatic provisioning.',
      null,
      error,
    )
  }
  if (/no signing certificate|private key|signing identity.*(?:invalid|not valid|expired)|identity used to sign.*no longer valid|0xe8008018/.test(normalized)) {
    return new WdaStartError(
      'wda_signing_identity_invalid',
      'Repair the Apple Development identity and private key for the configured Team in Xcode Accounts and Keychain, then retry.',
      null,
      error,
    )
  }
  if (/developer mode.*(?:disabled|required)|not trusted|trust.*device|device (?:is|was) locked|requestdenied.*locked/.test(normalized)) {
    return new WdaStartError(
      'wda_device_trust_or_developer_mode_required',
      'Unlock and trust the iPhone, enable Developer Mode and UI Automation, then retry.',
      null,
      error,
    )
  }
  return new WdaStartError(
    'wda_unknown_start_failure',
    'Inspect a temporary local Appium/Xcode log without sharing capabilities, then rerun the iOS WDA preflight.',
    sanitizeWdaSummary(raw, sensitiveValues),
    error,
  )
}

export function sanitizeWdaSummary(message: string, sensitiveValues: unknown[]): string {
  let summary = message
  for (const value of sensitiveValues) {
    if (typeof value === 'string' && value.length >= 3) summary = summary.replaceAll(value, '<redacted>')
  }
  summary = summary
    .replace(/[0-9a-f]{40}/gi, '<identity>')
    .replace(/[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}/g, '<device>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<account>')
    .replace(/No signing certificate\s+["'][^"']+["']/gi, 'No signing certificate <redacted>')
    .replace(/(?:\/Users|\/private|\/var|\/tmp|\/Applications|\/Library)(?:\/[^\s:'"]+)+/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
  return summary.slice(0, 320)
}
