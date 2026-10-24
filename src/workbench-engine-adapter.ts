/** AppClaw ABI boundary. Only adapters/flow compiler/worker know the pinned engine package. */
export { parseIOSPageSource } from '@appclaw/core/perception/ios-parser'
export { parseAndroidPageSource } from '@appclaw/core/perception/android-parser'
export { resolveElementSelector, parseElementSelector, evaluateStructuredAssertion } from '@appclaw/core/flow/selector'
export type { RunYamlFlowResult } from '@appclaw/core/flow/run-yaml-flow'
