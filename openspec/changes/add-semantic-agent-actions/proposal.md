## Why

当前 agent 虽然能读取 observation 中的 `nodeId`、bounds、role 和 focused 状态，但只能盲发 `tap`、`swipe`、`back` 坐标动作，无法安全地点击已观察节点、向明确聚焦的非敏感输入框输入文本，也无法在受控策略下切换或终止应用。这使真实任务仍依赖模型重复换算坐标和人工接管，且文本、密码框与应用生命周期缺少独立的权限和审计边界。

## What Changes

- 在现有 `mobile_mirror_action` 中新增 `tap_node` 与 `input_text`：两者必须引用 fresh `observationId` 和 observation-local `nodeId`，继续执行 generation、revision、epoch、TTL 与 15 秒 freshness 校验。
- `tap_node` 只解析 observation 中已存在、可见、启用、可操作且具有有效 viewport bounds 的节点；不按文本/identifier 重新查找，也不在节点缺失时降级为坐标点击。
- `input_text` 要求 fresh structure 中的非敏感、可见、启用、已聚焦 input 节点，并通过 Appium active-element/rect 复核后执行显式 `append|replace`；限制长度与控制字符，任何公共结果、状态、错误和插件日志不得回显文本。
- 扩展结构规范化，识别 Android password 属性和 iOS secure text field，输出 `sensitive=true` 但删除其 `text`/`value`；本 change 对敏感输入框硬拒绝，不提供 secret 参数旁路。
- 新增第九个独立高风险工具 `mobile_mirror_manage_app`，仅在显式 `agentAppControlPolicy` 授权、Appium/Mock owned session 和 session target/精确 allowlist 范围内执行 `activate|terminate`；attached session、未授权 app id、安装/删除/清数据/deep link 均拒绝。
- 对多步骤文本输入和应用生命周期增加“可能已改变屏幕”的失败语义：一旦 mutating request 已发出，即使后续验证失败也递增 screen epoch，使旧 observation 失效。
- 增加通用 control progress、稳定错误码、DSH/MCP 等价 schema/annotations、Viewer 可见状态，以及 Mock、Appium fake server、DSH `0.1.2-rc.1` clean-profile、built MCP、Android/iOS 真机验收。
- 保持原有 `tap`、`swipe`、`back` 输入与行为兼容；不改变 Viewer 连续媒体、session ownership 或 DeepSeek Harness agent loop。

## Capabilities

### New Capabilities

- `semantic-agent-actions`: 定义 observation-bound 节点点击、非敏感文本输入、应用生命周期策略、进度、失败失效和跨平台验收契约。

### Modified Capabilities

- `agent-screen-perception`: 扩展规范化节点的敏感字段处理，并把 observation stale protection 应用于 node/text 动作。
- `appium-provider`: 增加 active element 复核、W3C clear/send-keys、应用状态查询/激活/终止以及 may-have-mutated 失败边界。
- `flowassert`: DSH `0.1.2-rc.1` Native/PTC registry 从八项工具扩展为九项，并保持 alpha prerelease 安装契约。
- `host-neutral-mcp-adapter`: DSH/MCP 共享工具集合扩展为九项，对应用生命周期工具使用保守高风险 annotations，并覆盖 progress/cancellation。
- `local-mirror-viewer`: 在 agent 文本输入或应用管理超过 300 ms 时显示独立 control progress，保留 stop/status/theme 与最后可用画面。

## Impact

- 主要影响共享类型与 tool contracts、`MobileMirrorCommands`、`MirrorService`、`ObservationStore`、screen normalizer、Mock/Appium provider、Viewer state 投影、DSH adapter、MCP server 和 runtime probes。
- 配置新增默认 `mock-only` 的文本输入策略，以及默认 `disabled` 的应用控制策略/有界 app allowlist；现有用户不配置时不会获得新的物理设备写权限。
- Android 以 UiAutomator2/W3C active element、clear/send keys 和 Appium app-management API 验收；iOS 以 XCUITest/WDA 对应 API 验收。平台 API 失败不得退化为 ADB input、剪贴板、shell、任意 execute script 或坐标猜测。
- `add-guided-installable-beta` 已完成并发布 alpha.1，但仍应先归档；本 change 的 DSH 安装 delta 保留其 prerelease/checksum 语义并在其基础上把工具数升级为九项。
- 不新增运行时依赖，不传输连续视频，不安装/卸载应用，不处理密码/验证码/API key，不新增远程 transport。

Android 实测补充：修复 UiAutomator2 hint 导致追加丢失原值；只扩展现有 provider 输入路径，保持公开工具和权限契约。
