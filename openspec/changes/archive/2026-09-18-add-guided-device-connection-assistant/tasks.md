## 1. Core contract and short-lived context

- [x] 1.1 Add cross-platform connection-assistant result types, strict platform-specific request parsers, stable error codes/static messages, Android confirmation validation and iOS Team/bundle validation without adding MCP/Harness tool contracts.
- [x] 1.2 Implement the bounded in-memory assistant registry with 128-bit opaque identifiers, hashed lookup, 120-second TTL, atomic single-use consumption, cancellation, expiry cleanup, and dispose cleanup.
- [x] 1.3 Add deterministic registry/parser tests for valid, invalid, unknown-key, expired, cancelled, replayed, concurrent-consumption, and maximum-context cases.

## 2. Platform strategies and read-only discovery

- [x] 2.1 Implement injected Appium candidate discovery that prefers configured absolute paths, allows explicit one-shot PATH lookup, canonicalizes/checks executability, stores only a private fingerprint between phases, and never returns paths or raw output.
- [x] 2.2 Implement `AndroidConnectionStrategy` with injected ADB resolution, strict `devices -l` state/USB-transport parsing, emulator/TCP rejection, generic device refs, read-only system-version/Settings-intent resolution, UiAutomator2 checks, and no ADB mutation commands.
- [x] 2.3 Add Android optional-media diagnostics that validate only the explicitly configured scrcpy 4.1 path, report polling fallback as a warning, and never search/download/install media binaries.
- [x] 2.4 Implement `IosConnectionStrategy` and physical-iPhone parsing that retain UDID only behind generic device refs and reuse WDA preflight.
- [x] 2.5 Extend `IosWdaPreflightService` with consumable Viewer-only authorization, absolute Appium executable override, and in-memory Team/bundle overrides while preserving current profile-gated MCP behavior.
- [x] 2.6 Implement the strategy registry and `ConnectionAssistantService.check()` with selected-platform command isolation, bounded concurrency, AbortSignal propagation, partial results, manual confirmations, and no process/session startup.
- [x] 2.7 Add fake-runner tests for Android/iOS command isolation, ADB state/Settings parsing, optional scrcpy fallback, WDA authorization, timeouts, partial failure, candidate priority, driver parsing, and canary redaction.

## 3. One-shot managed Appium ownership

- [x] 3.1 Add `ArmableAppiumRuntimeLifecycle`/`GuidedAppiumRuntime` that preserves configured external/managed behavior and atomically arms one validated absolute executable for one assistant connection.
- [x] 3.2 Reuse `ManagedAppiumRuntime` for the armed delegate so listener conflict, fixed loopback args, `shell=false`, `/status` readiness, bounded output, cancellation, and exact child-handle cleanup remain unchanged.
- [x] 3.3 Clear unused or active arms on consumption, expiry, cancellation, failed provider start, stop, and dispose without PATH fallback, process-table scans, or changes to external listeners.
- [x] 3.4 Add deterministic runtime tests for successful one-shot start, no-spawn check, concurrent arm consumption, expiry, conflict, timeout, provider failure, stop/dispose races, and return to configured base mode.

## 4. Guided connection orchestration

- [x] 4.1 Implement `ConnectionAssistantService.connect()` and `cancel()` with atomic platform-bound context consumption, `configured|managed-once` enforcement, `android-settings|ios-settings` allowlists, and unknown/cross-platform field rejection.
- [x] 4.2 Generate minimum Android Settings capabilities from revalidated ADB target data, require explicit UiAutomator2 helper APK confirmation, and preserve the configured hidden API compatibility merge without executing policy writes.
- [x] 4.3 Generate minimum iOS Settings capabilities, merge only allowed one-shot WDA overrides, and refuse assistant connection when provisioning/device registration is enabled.
- [x] 4.4 Call the existing `MirrorService.start()` as the sole provider/session owner for both platforms and compose guided runtime, strategies, preflight, assistant and Viewer in `LocalDeviceRuntime`.
- [x] 4.5 Require explicit fake assistant injection when tests provide a custom service, preventing Viewer from creating a second service/runtime.
- [x] 4.6 Add orchestration tests for Android/iOS external-ready and managed-once connections, Settings targets, helper/signing confirmation gaps, provisioning refusal, failure cleanup, platform-token mismatch, and public-state redaction.

## 5. Viewer HTTP security boundary

- [x] 5.1 Add bounded `/api/connection-assistant/check`, `/connect`, and `/cancel` routes with exact input allowlists, stable `{ code, message }` failures, and request cancellation propagation.
- [x] 5.2 Require an exact matching Origin before reading every state-changing Viewer POST body, including existing start/stop/action/media-failure routes, while retaining current media Referer/CSP/no-store protections.
- [x] 5.3 Update Viewer server tests for missing/mismatched Origin, oversized bodies, malformed JSON, stable error mapping, no host work before rejection, and compatibility of advanced `/api/start` with a valid Origin.

## 6. Viewer guided Android/iOS experience

- [x] 6.1 Replace the default Appium form with a progressive device assistant containing Android/iOS selection, explicit check, sanitized readiness rows, generic device selection, platform Settings preset, runtime choice and final confirmation.
- [x] 6.2 Render Android-specific ADB/manual states, helper APK confirmation, read-only hidden API compatibility summary and optional scrcpy/polling status; render iOS-specific WDA signing fields and trust/Developer Mode/UI Automation states.
- [x] 6.3 Move existing sessionId/raw capabilities controls into a default-collapsed advanced panel without changing payload semantics, and display current Agent sharing/platform compatibility policies as read-only information.
- [x] 6.4 Implement per-platform `idle|checking|ready|connecting|error` UI state, action-local progress, duplicate protection, same-platform last-good retention, retry/cancel, token isolation and short-lived input/confirmation clearing.
- [x] 6.5 Ensure checks and connections longer than 300 ms leave platform switching, theme, status, advanced-panel expansion and valid stop actions interactive; preserve the last frame and existing media fallback behavior.

## 7. Automated UX and security verification

- [x] 7.1 Add Playwright E2E coverage for Android/iOS ready, partial, platform-switch, external, managed-once, expired, cancelled, replayed, cross-platform-token and unsupported-target flows.
- [x] 7.2 Cover Android unauthorized/offline/emulator/TCP-only devices, unresolved Settings target, missing UiAutomator2, unconfirmed helper APK, scrcpy polling fallback and hidden API policy disclosure; cover iOS missing signing/provisioning refusal.
- [x] 7.3 Add slow-operation E2E coverage proving local progress and simultaneous platform/theme/status/advanced/stop interactivity, plus same-platform last-good retention after a failed refresh.
- [x] 7.4 Add canary scans proving Android serial/model, iOS UDID/device name, Team ID, WDA bundle, certificate text, executable paths, raw command output and complete capabilities do not appear in responses, logs, DOM snapshots or screenshots.
- [x] 7.5 Retain and visually inspect runtime Viewer screenshots for Android and iOS guided-ready/action-required states, platform-specific manual boundaries and collapsed advanced panel.

## 8. Product and architecture documentation

- [x] 8.1 Update ADR 0001 and ADR 0004 with Viewer-scoped one-shot diagnostics, candidate fingerprint/revalidation, guided runtime ownership, ephemeral private paths and unchanged DSH/MCP authority.
- [x] 8.2 Update Android/iOS real-device guides, beta installation guide, product-shape/security docs and validation matrix with the unified guided flow, profile persistence boundary, error recovery and rollback path.
- [x] 8.3 Document that P0 supports USB physical Android/iPhone Settings only; it does not install host dependencies, edit profiles, pair/root Android, register Apple devices, log into Apple, or change Agent sharing/text/app policies, while explicitly disclosing UiAutomator2 helper APK behavior.

## 9. Repository and physical-device gates

- [x] 9.1 Run focused unit/server/E2E suites during implementation and fix all regressions without weakening existing external/managed, Mock, MCP or advanced Viewer contracts.
- [x] 9.2 Run `pnpm check`, `pnpm test:e2e`, `pnpm build`, `pnpm pack:check`, `git diff --check`, and strict OpenSpec validation; record exact outcomes in `docs/validation.md`.
- [x] 9.3 From the packed artifact and a loopback Viewer, verify explicit check does not start Appium, then confirm managed-once startup reaches real `/status` and releases only its owned listener on stop.
- [x] 9.4 With an authorized physical Android, run `check → select generic device ref → confirm helper APK boundary → connect Settings → capture non-empty PNG and structure → stop`, verify UiAutomator2/session/child cleanup and PNG fallback when scrcpy is unavailable.
- [x] 9.5 With the connected physical iPhone, run `check → select generic device ref → connect Settings → capture non-empty PNG and structure → stop`, verify the owned Appium session/child cleanup, and record manual trust/Developer Mode/UI Automation boundaries separately.

## 10. Android session timeout resilience

- [x] 10.1 Add `forceAppLaunch=true` and session-scoped `waitForIdleTimeout=1000`/`actionAcknowledgmentTimeout=1000` to guided Android Settings capabilities, with exact payload and no-system-mutation tests.
- [x] 10.2 Add stable Appium server-unreachable versus device-session-command-timeout classification, propagate frame error codes without identifiers/raw paths, and cover connection refusal、AbortSignal timeout and HTTP failure independently.
- [x] 10.3 Decouple successful tap/swipe/back completion from optional post-action frame capture; preserve mutation fencing, uncertain-timeout behavior and immediate asynchronous Viewer refresh without automatic mutation retry.
- [x] 10.4 Add a 5-second established-session polling bound, single-flight PNG failure accounting, exponential backoff、three-timeout degraded mode、10-second liveness probing and success reset while keeping status/stop/control interactive.
- [x] 10.5 Allow the local development entry to consume explicit absolute scrcpy 4.1 executable/server environment paths without PATH discovery or installation, retaining empty-path PNG fallback.
- [x] 10.6 Add focused provider/service/Viewer/Playwright coverage for stuck screenshots, action success with refresh failure, timeout taxonomy, backoff/reset and Android capability stability; retain and inspect an updated runtime screenshot.
- [x] 10.7 Update Android troubleshooting、architecture/ADR and validation records with the verified ColorOS freeze evidence, immediate recovery, non-mutating boundaries and the distinction between server readiness and session health.
- [x] 10.8 On the connected Android, verify guided Settings foreground、bounded control response、polling degradation/recovery or configured scrcpy path、owned stop and zero Appium/UiAutomator2 residue; do not mark complete if OEM freezing prevents the acceptance.
- [x] 10.9 Run `pnpm check`, `pnpm test:e2e`, `pnpm build`, `pnpm pack:check`, `pnpm public:check`, `git diff --check` and strict OpenSpec validation.

## 11. 本机私有配置与正式启动入口

- [x] 11.1 实现 `LocalViewerConfigStore`：默认仓库外路径、绝对覆盖路径、64 KiB 上限、严格字段校验、symlink 拒绝、`0700/0600` 权限与同目录原子替换。
- [x] 11.2 扩展连接请求和助手编排，仅在 `rememberOnThisMac=true` 时持久化重新验证的 Appium/平台/WDA allowlist 默认值，并在 spawn/session 前稳定失败。
- [x] 11.3 增加 `flowassert-viewer` 正式 bin，让 `pnpm dev`/`pnpm start` 复用同一 `LocalDeviceRuntime` 启动实现，同时保持页面加载零主机诊断/零 Appium 启动。
- [x] 11.4 增加配置 store、CLI、解析/权限/失败/canary 测试，并更新 package exports/files、安装与安全文档。

## 12. 快速连接、超时分层与 iOS MJPEG 兼容

- [x] 12.1 在 Viewer state/UI 增加不回显值的 saved-setup 摘要、显式“记住此电脑”和唯一设备的“检查并连接”状态机；歧义或失败停在完整报告。
- [x] 12.2 新增默认 120 秒的 `appiumSessionStartupTimeoutMs`，让 Appium provider start 使用独立 cold-start timeout，同时保持 server ready、初帧和 established-session 命令原上限。
- [x] 12.3 iOS 自动媒体优先使用可用的默认 WDA MJPEG 端口 9100；冲突/转发失败安全回退 PNG，不随机改写缓存 WDA 设备端口且不强制重装 WDA。
- [x] 12.4 增加 Viewer E2E、MirrorService/Appium provider 单测，覆盖保存/不保存、单设备快速连接、多设备歧义、120 秒 WDA 冷启动、默认 9100、端口冲突和显式端口。
- [x] 12.5 将 in-flight Viewer frame 绑定 session generation/abort，并在 provider DELETE 竞争失败但 owned managed child 已成功静止时以 child cleanup 返回 idle；external 删除失败保持显式错误。

## 13. 文档、门禁与真机验收

- [x] 13.1 更新 ADR 0001/0004、Android/iOS 真机指南、beta 安装、安全和验证文档，明确独立本机配置、快速连接、副作用、timeout 与 MJPEG fallback 边界。
- [x] 13.2 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`、`pnpm public:check`、`git diff --check` 和 strict OpenSpec validation，并保留/目检中英文 Viewer 截图。
- [x] 13.3 在当前 iPhone 上从正式 Viewer 命令执行首次保存与下一次快速连接，确认 Settings 截图/结构、WDA MJPEG 9100 首帧、停止后的 session/owned child 清理；若端口冲突则记录 PNG fallback 证据。

## 14. 通用设备连接入口

- [x] 14.1 更新设计和规范并复核：默认 current-screen、Settings 显式可选、旧 API 兼容、初始化画面变化边界和原权限不变。
- [x] 14.2 实现双平台 current-screen capabilities、Android Settings 可选诊断及逐设备可用性；测试未知/跨平台拒绝、设备重验、旧 Settings 和不启动 App 的 payload。
- [x] 14.3 更新中英文 Viewer 主按钮、连接方式、动态进度与快捷默认值；验证目标保留、平台隔离、慢操作交互、取消及错误恢复。
- [x] 14.4 更新使用文档；运行完整门禁与 strict OpenSpec，保留并目检运行截图；真机证据不足时不声明真机通过。

2026-09-15 iPhone 9.5/13.3 补验通过；Android 10.8 未在本轮补验。见 [iPhone 验收记录](../../../../docs/ios-acceptance-2026-09-15.md)。

2026-09-16：Android 10.8 首次设置连接/保存/重启快连、scrcpy、约 0.55 秒滑动和 owned stop 通过。最终设备进程检查在人工恢复 ADB 后无残留，停止瞬间审计可用性与 ADB 稳定性不作通过承诺，详见 [Android 报告](../../../../docs/android-acceptance-2026-09-16.md)。
