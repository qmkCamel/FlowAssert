## MODIFIED Requirements

### Requirement: Frames and actions

The provider SHALL obtain fresh screenshots, send W3C pointer actions for taps/swipes, send the WebDriver back action, input bounded ordinary text through a verified active element, and execute policy-authorized app state/activate/terminate operations. Continuous Viewer media MUST NOT replace the provider screenshot method, change action coordinates, carry text, or enable `mjpegScreenshotUrl`; media failures MUST remain separate from screenshot/action errors once the Appium session is usable. The provider MUST NOT use clipboard, ADB input, shell, locator fallback, arbitrary execute script, app install/remove/clear-data/deep-link, or expose request bodies in public errors/logs.

#### Scenario: Agent taps a streamed screen

- **WHEN** the mirror is streaming and the agent supplies finite tap coordinates
- **THEN** the provider SHALL send a touch pointer sequence to the active Appium session
- **AND** status SHALL record the completed action without changing media ownership

#### Scenario: Agent inputs text into the verified active element

- **WHEN** core supplies an authorized text request with expected node bounds
- **THEN** the provider SHALL get the W3C active element and rect, require at least 50% overlap of the smaller rect, optionally clear for replace, and send one value payload; iOS uses `{text}`, while Android uses explicit `replace:true` to avoid UiAutomator2 hint-triggered loss of the previous value
- **AND** it MUST NOT echo text, retry a partial write, or choose another element when verification fails

#### Scenario: Provider may have partially mutated text

- **WHEN** clear or send-keys has been dispatched and a later step fails or is cancelled
- **THEN** provider SHALL return a stable error carrying an internal may-have-mutated marker
- **AND** error/log output MUST NOT include text, element id, request body or raw Appium response

#### Scenario: Provider manages an authorized app

- **WHEN** core supplies an owned-session app target and activate/terminate operation
- **THEN** provider SHALL query state, use the official platform app-management endpoint, and query after-state
- **AND** activate SHALL end in foreground while terminate SHALL end not-running, without installing/removing/clearing data

#### Scenario: iOS activates an app that is not running

- **WHEN** XCUITest reports an authorized target as installed but not running
- **THEN** provider SHALL use only the official `mobile: launchApp` method with bundleId and no arguments/environment
- **AND** subsequent state MUST be foreground or the operation SHALL fail as may-have-mutated

#### Scenario: Agent captures while iOS MJPEG is live

- **WHEN** WDA MJPEG is live and the agent requests a fresh screenshot observation
- **THEN** the provider SHALL call the independent Appium screenshot endpoint and validate the returned PNG
- **AND** it MUST NOT return the most recently broadcast JPEG or configure `appium:mjpegScreenshotUrl`

#### Scenario: MJPEG settings fail after session creation

- **WHEN** applying bounded MJPEG framerate, scale, quality or orientation settings fails after an iOS session is usable
- **THEN** the media coordinator SHALL report fallback while screenshot and actions remain available
- **AND** the provider MUST NOT delete or recreate the usable session solely for this media failure

#### Scenario: Android append preserves existing text despite a hint
- **WHEN** Android append targets an approved focused ordinary input
- **THEN** the provider SHALL read bounded current text and hint, reject ambiguous hint-equal content or invalid/oversized combined text before mutation, recheck active-element identity, then send the combined value with explicit replacement
- **AND** it SHALL verify the resulting text and mark a post-dispatch mismatch as mutation-uncertain without retrying or exposing text in errors

## ADDED Requirements

### Requirement: iOS observation 焦点必须有稳定的活动元素依据

Appium provider SHALL 仅在 observation 显式请求时补充 iOS 输入焦点；源树 XML SHALL 保持可供既有工作台消费。系统 SHALL 将 SearchField 识别为 input，并在源树读取前后验证活动元素 id、平台类型和矩形；仅对未截断源树内唯一匹配的可见、启用、同类型输入标记 focused。边缘坐标舍入容差 MUST 不超过 1 个逻辑点。缺失、失败、移动、歧义或类型不符 MUST 不授予焦点，取消 MUST 传播。输入执行 MUST 继续使用既有 active-element/rect、敏感字段和 freshness 检查。

#### Scenario: WDA XML 未返回 focused
- **WHEN** iOS 返回 SearchField，且源树前后活动元素稳定并唯一匹配
- **THEN** observation SHALL 发布 role=input、focused=true，允许后续按原严格规则验证普通输入

#### Scenario: 焦点无法确认
- **WHEN** 活动元素缺失、发生变化、矩形/类型不匹配、结构截断或多个输入匹配
- **THEN** 系统 SHALL 保留结构但不得发布 focused=true，也不得向猜测节点输入

#### Scenario: 工作台读取源树
- **WHEN** 既有工作台请求默认 screenSource
- **THEN** provider SHALL 返回原始 XML，且不发出焦点补充请求
