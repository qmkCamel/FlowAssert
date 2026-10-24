## MODIFIED Requirements

### Requirement: Loopback-only serving

The Viewer SHALL accept only loopback bind addresses in configuration and SHALL apply same-origin security headers, bounded JSON request bodies, and bounded continuous-media responses. Every POST endpoint that changes local state or executes host work MUST require an exact matching Origin before reading its body; media routes MUST NOT accept an arbitrary upstream URL/port, and browser requests with a missing or mismatched Origin where required, or a mismatched Referer, MUST be rejected before a device media source or host command is opened.

#### Scenario: Loading the Viewer

- **WHEN** the plugin starts with valid configuration
- **THEN** the Viewer is reachable on its loopback URL
- **AND** its API is not bound to a LAN address.

#### Scenario: Loading continuous media

- **WHEN** the current loopback Viewer requests its media stream
- **THEN** the response uses the same origin, no-store and existing CSP/nosniff/frame-denial policy
- **AND** no upstream device address, local forwarding port, Android serial, iOS UDID or machine path is exposed to the page or response metadata.

#### Scenario: Mutating request has no matching origin

- **WHEN** a POST request to start, stop, act, report media failure, check a device or connect through the assistant has a missing or mismatched Origin
- **THEN** the Viewer MUST reject it before reading the body or executing provider/host work
- **AND** the response MUST NOT disclose local configuration, device identifiers or command output.

### Requirement: Nonblocking long-action feedback

Every user-triggered Viewer action, connection-assistant operation or media startup that may exceed 300 ms SHALL immediately show action-local progress without blocking unrelated safe interaction. Assistant and media progress MUST be independent from the main mirror lifecycle and MUST NOT disable stop after the Appium session is usable.

#### Scenario: Connecting while changing the display theme

- **WHEN** a user starts a connection whose provider takes longer than 300 ms
- **THEN** the start area shows a connecting indicator immediately
- **AND** duplicate start/stop actions are disabled
- **AND** the theme control remains operable before connection completes
- **AND** the final streaming state refreshes without a manual reload.

#### Scenario: Checking a device while another control remains interactive

- **WHEN** a user starts an assistant check or guided connection that takes longer than 300 ms
- **THEN** only that assistant action SHALL show busy progress and reject its duplicate submission
- **AND** theme, current status, advanced-panel expansion and any valid stop action SHALL remain operable.

#### Scenario: Media starts after the control session

- **WHEN** the mirror is streaming and a Viewer media source takes longer than 300 ms to produce its first frame
- **THEN** the page shows media starting while retaining the compatibility frame
- **AND** theme, status, stop and safe Appium controls remain operable.

### Requirement: Preserve useful state on failure

The Viewer SHALL present actionable errors and preserve the last usable frame and last successful assistant report when a transient polling, assistant-check, media-source, parser or browser-decoder refresh fails. A low-latency media failure MUST automatically resume screenshot polling without changing a usable main session to error; an assistant refresh failure MUST mark retained diagnostic data stale rather than presenting it as current. Screenshot polling MUST keep at most one request in flight, bound each established-session polling probe to the lesser of the configured startup timeout and 5 seconds, exponentially back off repeated failures up to 10 seconds, enter degraded polling after three consecutive timeouts, and restore the configured interval immediately after a successful frame. The initial connection frame retains the full startup timeout.

On initial page load or session change, Viewer MUST render the retained compatible frame without issuing a second Appium screenshot command. When a scrcpy or WDA low-latency transport is waiting for its first painted frame and that compatible frame is already retained, Viewer MUST defer the first fresh PNG fallback probe until the 5-second media first-frame boundary. A successful media paint cancels that probe; an explicit media failure resumes polling immediately.

#### Scenario: Frame refresh fails after streaming

- **WHEN** a new polling frame request fails after at least one frame succeeded
- **THEN** the prior frame remains visible
- **AND** status exposes the refresh error
- **AND** stop or retry controls remain available.

#### Scenario: Repeated Appium screenshot timeouts

- **WHEN** PNG polling receives three consecutive session-command timeouts
- **THEN** Viewer SHALL retain the last frame, mark polling degraded and issue at most one 10-second liveness probe at a time
- **AND** status/stop and a new explicit control request SHALL remain operable without waiting behind additional Viewer-created screenshot requests

#### Scenario: A control succeeds but its visual refresh fails

- **WHEN** Appium acknowledges tap、swipe 或 back，但后续 Viewer screenshot 超时
- **THEN** control SHALL complete without synchronously waiting for that screenshot, and Viewer SHALL request visual refresh asynchronously
- **AND** the successful action MUST NOT be reported as failed or automatically retried; frame error and last-good image SHALL remain independently visible

#### Scenario: Appium server and session health differ

- **WHEN** Appium `/status` is reachable but a device-session command times out
- **THEN** Viewer SHALL expose a stable session-command-timeout code/message distinct from server-unreachable
- **AND** MUST NOT expose the session URL、session id、device id or raw driver stack

#### Scenario: Assistant refresh fails after a successful check

- **WHEN** a new assistant check fails after at least one check succeeded
- **THEN** the prior report remains visible with its original timestamp and a stale indicator
- **AND** the new stable error and retry action SHALL be shown without exposing raw host output.

#### Scenario: Continuous media fails after its first frame

- **WHEN** scrcpy H.264 or WDA MJPEG ends, becomes invalid or cannot be rendered after at least one media frame succeeded
- **THEN** the last rendered frame remains visible until a new screenshot polling frame loads
- **AND** the page shows a stable fallback reason, resumes polling within 2 seconds, and keeps action/stop controls available.

## ADDED Requirements

### Requirement: Viewer 必须提供引导连接并保留高级入口

Viewer SHALL 默认显示一个渐进式 Android/iOS 连接助手，依次呈现平台选择、显式检查、脱敏结果、设备选择、连接方式、平台专属人工/副作用确认、外部或一次性受管 Appium 选择和连接确认。主按钮 SHALL 为“连接设备 / Connect device”，连接方式默认“查看当前画面”，另可显式选择“打开系统设置”。当 iOS profile 缺少必要签名默认值时，Viewer SHALL 要求补充受限的短期签名字段；Android MUST 展示 ADB 授权、UiAutomator2 helper APK 和 hidden API compatibility 边界，并把 scrcpy 作为可选媒体状态。现有 raw capabilities 与 sessionId 表单 SHALL 保留在默认折叠的“高级”区域，且其 start 行为和校验规则 MUST 保持兼容。

#### Scenario: 默认连接与明确选择设置

- **WHEN** 用户完成任一平台检查并直接点击“连接设备”
- **THEN** Viewer SHALL 提交对应平台 current-screen；只有用户显式选择设置时才提交旧 Settings 预设
- **AND** 页面 SHALL 说明首次自动化启动可能短暂切换画面，不承诺保留连接前的每一个前台像素

#### Scenario: 连接方式与操作状态一致

- **WHEN** 用户切换语言、检查暂时失败、切换平台或开始慢连接
- **THEN** 语言切换/检查失败 SHALL 保留当前方式；切换平台/清除 SHALL 重置为 current-screen；连接中 SHALL 禁用目标选择和重复提交并显示对应方式的进度
- **AND** 主题、状态和高级面板仍可交互；设备 `settingsAvailable=false` 时 SHALL 禁用 Settings 选项而不阻止当前画面连接

#### Scenario: iOS 首次使用且 Appium 未运行

- **WHEN** 用户完成检查，系统发现可用 Appium/XCUITest 和 iPhone，但 loopback endpoint 未启动
- **THEN** Viewer SHALL 展示“启动并连接”的明确确认项及不会自动安装/注册设备的说明
- **AND** 未确认前 MUST NOT 启动进程或创建 session

#### Scenario: Android 首次使用且 Appium 未运行

- **WHEN** 用户完成 Android 检查，系统发现 Appium/UiAutomator2、已授权设备和 Settings 目标，但 loopback endpoint 未启动
- **THEN** Viewer SHALL 展示“启动并连接”、UiAutomator2 helper APK 可能安装/更新、当前 hidden API compatibility 策略和 scrcpy 可选状态
- **AND** 用户未确认 managed 启动及 helper APK 副作用前 MUST NOT 启动进程或创建 session

#### Scenario: 使用高级 capabilities

- **WHEN** 熟悉 Appium 的用户展开高级区域并提交原有 capabilities JSON 或 sessionId
- **THEN** Viewer SHALL 继续通过既有 `/api/start` 和 MirrorService 流程连接
- **AND** 引导助手 MUST NOT 改写、回显或持久化该原始 JSON

### Requirement: Viewer 不得把连接助手变成 Agent 权限开关

连接助手 SHALL 只简化本地 Viewer 到 Appium/Android/iPhone 的连接，不得修改 `agentScreenContentPolicy`、文本输入策略、应用管理策略、MCP 工具注册、Android hidden API compatibility 默认值或 iOS provisioning 授权。页面 SHALL 显示当前 Agent 分享策略及平台兼容策略的只读摘要，并明确 Viewer 可见不等于 Agent 可见。

#### Scenario: 默认 Agent 画面策略仍为 mock-only

- **WHEN** 用户通过助手连接真实 Android 或 iPhone，而 profile 的 Agent 画面策略仍为 `mock-only`
- **THEN** Viewer SHALL 可以按现有本地策略显示设备画面
- **AND** MCP/Harness snapshot 或 structure MUST 继续按原策略拒绝真实设备内容

### Requirement: Viewer 必须提供正式本地启动与安全快速连接

包 SHALL 提供正式的 `flowassert-viewer` 命令，并让 `pnpm dev`/`pnpm start` 复用同一 runtime 组合。命令默认从仓库外的本机私有路径读取 Viewer 配置，只允许绝对 `--config` 覆盖和 loopback port 覆盖；读取配置或页面加载 MUST NOT 搜索 PATH、执行主机诊断、枚举设备或启动 Appium。公开 Viewer state 只能暴露持久化是否可用以及已保存的平台偏好，不得返回 Appium 路径、Team ID 或 bundle ID。

#### Scenario: 使用已保存配置启动 Viewer

- **WHEN** 用户运行正式 Viewer 命令且本机配置有效
- **THEN** runtime SHALL 使用保存的 validated defaults 并输出 loopback URL
- **AND** 在用户点击连接前 MUST NOT 启动 Appium、调用 ADB/Xcode 或创建 session

#### Scenario: 唯一设备可快速连接

- **WHEN** 用户点击“检查并连接”，且检查发现唯一设备、零 blocked、无需补充签名字段，并可由已保存配置确定 runtime
- **THEN** Viewer SHALL 在同一可见状态机中完成 check 后提交 connect，并依次显示 checking 与 connecting 进度
- **AND** iOS SHALL 复用已保存 WDA 默认值；Android SHALL 在按钮文案/说明中明确该次点击确认 UiAutomator2 可能安装或更新 helper APK
- **AND** 快捷连接 SHALL 固定使用对应平台 current-screen，不复用之前的 Settings 选择；检查期间用户切换平台或取消时 MUST NOT 继续自动提交连接

#### Scenario: 快速连接存在歧义

- **WHEN** 检查发现多个设备、缺少字段、runtime 无法确定、存在 blocked 项或连接失败
- **THEN** Viewer SHALL 停在完整脱敏报告，允许用户选择/修复/重试
- **AND** MUST NOT 自动选择设备、循环重试 mutation、隐藏副作用或丢弃最近一次可用结果
