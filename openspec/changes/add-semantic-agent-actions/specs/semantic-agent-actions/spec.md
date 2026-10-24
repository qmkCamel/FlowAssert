## ADDED Requirements

### Requirement: 节点动作必须精确绑定 fresh observation

系统 SHALL 允许 `mobile_mirror_action(kind=tap_node)` 使用 `observationId` 和 observation-local `nodeId` 点击当前结构中的节点。调用 MUST 校验 session generation、最新 frame revision、screen epoch、store TTL、15 秒 action freshness、结构存在性、节点状态与 bounds；任何失败 MUST 在 provider 调用前拒绝，且 MUST NOT 按文本/identifier 重新定位或降级为 coordinate tap。

#### Scenario: 点击完整可见的可操作节点

- **WHEN** agent 引用最新 observation 中 `visible=true`、`enabled=true`、`actionable=true` 且 bounds 有效的节点
- **THEN** core SHALL 计算 node bounds 与 viewport 交集的中心并发送一个 W3C viewport tap
- **AND** 成功后 SHALL 递增 screen epoch，使该 observation 不能再次用于严格动作

#### Scenario: 点击部分进入 viewport 的节点

- **WHEN** 有效节点 bounds 只有一部分与 observation viewport 相交
- **THEN** core SHALL 点击正面积交集矩形的中心
- **AND** MUST NOT 点击 viewport 外坐标、静默 clamp 原始中心或滚动页面寻找节点

#### Scenario: 节点缺失或不可安全点击

- **WHEN** structure 缺失、nodeId 不存在、状态未知/false、bounds 无效或与 viewport 无正面积交集
- **THEN** 调用 MUST 返回稳定 `screen_node_not_found` 或 `screen_node_not_actionable`
- **AND** provider MUST NOT 收到 pointer、locator、source 或 fallback 请求

#### Scenario: Observation 在排队期间变陈旧

- **WHEN** tap_node 排队后被另一个成功动作、session 替换或更新 observation 使 revision/epoch 不再匹配
- **THEN** 执行到该操作时 MUST 返回既有 stale/session 错误
- **AND** MUST NOT 重新解释同名 nodeId 或执行点击

### Requirement: 普通文本输入必须聚焦、限界且不回显内容

配置 SHALL 提供 `agentTextInputPolicy=mock-only|non-sensitive` 并默认 `mock-only`。`mobile_mirror_action(kind=input_text)` SHALL 要求 fresh observation、精确 nodeId、`role=input`、`visible=true`、`enabled=true`、`focused=true`、非敏感节点、显式 `append|replace` mode 和有界普通文本。该 input_text 调用的 result、state、错误和插件日志 MUST NOT 回显 text payload；后续显式 structure observation 或 retained 屏幕证据 MAY 显示普通输入框当前值，因此真机验收只能使用预先声明的固定公开 marker。

#### Scenario: 向已聚焦普通输入框追加文本

- **WHEN** 策略允许、节点满足安全条件、text 非空且不超过 512 Unicode code points/4 KiB UTF-8
- **THEN** provider SHALL 复核 active element 与 node bounds 后以 element send keys 追加文本
- **AND** 成功结果 SHALL 只记录 kind、mode、code-point count 和新 screen epoch

#### Scenario: 替换普通输入框文本

- **WHEN** agent 对有效聚焦 input 使用 `mode=replace`
- **THEN** provider SHALL 先 clear 同一 active element，再向同一 element 发送 text
- **AND** 空 text SHALL 只允许在 replace mode 中表示显式清空

#### Scenario: 文本包含控制或提交字符

- **WHEN** text 包含 NUL、C0/C1 control、CR/LF、tab、Unicode line separator 或 paragraph separator，或超过长度/字节上限
- **THEN** parser/core MUST 返回 `screen_text_input_invalid`
- **AND** MUST NOT normalization、截断、拆分、发送部分文本或隐式 submit

#### Scenario: 输入节点尚未聚焦

- **WHEN** fresh structure 中目标 input 的 `focused` 不是 true
- **THEN** 调用 MUST 返回 `screen_text_input_not_focused`
- **AND** MUST NOT 隐式点击节点、选择第一个输入框或向当前 active element 发送文本

#### Scenario: Appium active element 与 observation 节点不一致

- **WHEN** active element 不存在、rect 无效，或与 observation node bounds 的交集不足较小矩形面积的 50%
- **THEN** 调用 MUST 返回 `screen_text_input_target_mismatch`
- **AND** clear/send-keys endpoint MUST NOT 被调用

#### Scenario: 宿主持久化 tool input

- **WHEN** DSH、MCP、Codex 或其他宿主记录 `input_text` 的调用参数
- **THEN** 文档 MUST 明确插件无法从宿主历史删除该文本
- **AND** 本能力 MUST 禁止密码、验证码、token、API key 与其他秘密输入

#### Scenario: 后续 observation 验证普通输入结果

- **WHEN** agent 在 input_text 成功后显式捕获新的 structure observation
- **THEN** 普通输入框 value MAY 按既有 screen content policy 返回，用于验证输入结果
- **AND** retained 真机截图/JSON MUST 只使用文档声明的公开 marker，不得包含用户真实输入或秘密

### Requirement: 敏感输入节点必须被识别、清除内容并拒绝写入

规范化结构 SHALL 为 Android password input 和 iOS secure text field 标记 `sensitive=true`，并在结构进入 ObservationStore 前删除该节点的 `text` 与 `value`。`input_text` 对 sensitive 节点 MUST 无条件返回 `screen_text_input_sensitive`，MUST NOT 提供 request flag、配置或 provider fallback 绕过。

#### Scenario: Android password 节点包含原始 value

- **WHEN** UiAutomator2 source 把 `password=true` 的节点连同 text/value 返回
- **THEN** normalized node SHALL 保留 `sensitive=true` 和非内容状态/geometry
- **AND** observation summary、DSH/MCP result 与日志 MUST NOT 包含原始或掩码 text/value

#### Scenario: iOS secure text field

- **WHEN** XCUITest source 返回 `XCUIElementTypeSecureTextField`
- **THEN** normalizer SHALL 标记 sensitive 并删除 text/value
- **AND** agent 对该 nodeId 调用 input_text MUST 在 active-element 请求前失败

#### Scenario: Agent 声称文本不是秘密

- **WHEN** sensitive node 的调用包含任意附加确认、未知参数或普通文本
- **THEN** parser SHALL 拒绝未知参数或 core SHALL 拒绝 sensitive node
- **AND** MUST NOT 把模型声明当作秘密输入授权

### Requirement: 应用生命周期必须使用独立高风险工具和核心 allow policy

系统 SHALL 新增 `mobile_mirror_manage_app(operation=activate|terminate, appId?)`。配置 SHALL 提供 `agentAppControlPolicy=disabled|session-app|allowlist` 并默认 disabled，以及最多 32 个精确、规范有界的 `agentAllowedAppIds`。应用管理只允许 Mock 或 runtime-created owned Appium session；MCP annotations/宿主审批 MUST NOT 替代核心 policy、exact target 和 ownership 校验。

#### Scenario: 默认策略拒绝应用管理

- **WHEN** 用户保持 `agentAppControlPolicy=disabled`
- **THEN** manage_app MUST 返回 `app_control_disabled`
- **AND** MUST NOT query、activate、launch 或 terminate 任何应用

#### Scenario: 管理 owned session target

- **WHEN** policy 为 session-app，owned provider 已记录 session target，且 appId 省略或与 target 完全一致
- **THEN** core SHALL 允许对应 operation
- **AND** 结果 MUST 只报告 target scope，不回显内部 app id/capabilities

#### Scenario: 精确 allowlist 应用

- **WHEN** policy 为 allowlist，agent 提供的 appId 精确命中最多 32 项的有界 allowlist
- **THEN** core SHALL 允许该 owned session 管理该 target
- **AND** glob、前缀、大小写折叠、URL、slash、空白或未命中值 MUST NOT 被接受

#### Scenario: Attached session 请求应用管理

- **WHEN** runtime 附着外部 Appium session 后调用 manage_app
- **THEN** 调用 MUST 返回 `app_control_attached_session_forbidden`
- **AND** MUST NOT query 或改变外部 session 的应用进程

#### Scenario: 应用激活或启动

- **WHEN** target 已授权且已安装，agent 调用 activate
- **THEN** provider SHALL 将 running/background app 置于 foreground，并在平台需要时以官方无参数 launch API 启动 not-running app
- **AND** after-state 必须为 foreground；不得传递 intent、deep link、arguments、environment 或 arbitrary execute script

#### Scenario: 终止应用但不清数据

- **WHEN** target 已授权且 agent 调用 terminate
- **THEN** provider SHALL 使用官方 bounded terminate API 并验证 after-state 为 not-running，已停止时返回稳定 no-op success
- **AND** MUST NOT uninstall、remove、clear data、kill unrelated process 或删除 session

### Requirement: 可能已经改变设备的失败必须使旧 observation 失效

core/provider SHALL 区分 mutating request 发送前失败与 `mayHaveMutated` 失败。clear、send keys、activate、launch 或 terminate request 一旦发出，后续 timeout、取消、网络错误或 after-state 验证失败 MUST 标记为 may-have-mutated；`MirrorService` MUST 递增 screen epoch 并拒绝复用旧 observation，同时向调用方返回真实失败。

#### Scenario: Replace 在 clear 后发送文本失败

- **WHEN** element clear 成功但 send keys 失败
- **THEN** 调用 SHALL 返回 `screen_text_input_partial`
- **AND** screen epoch SHALL 递增，旧 observation SHALL stale，插件 MUST NOT 自动重试或声称原值仍存在

#### Scenario: Activate 响应丢失但应用可能已切换

- **WHEN** activate/launch request 发出后网络超时或 after-state 无法验证
- **THEN** 调用 SHALL 返回 `app_activate_failed` 或 `app_state_unverified`
- **AND** screen epoch SHALL 递增，用户/agent 必须重新 status/observe

#### Scenario: 请求前策略校验失败

- **WHEN** policy、ownership、freshness、node、text 或 allowlist 校验在任何 mutating request 前失败
- **THEN** screen epoch SHALL 保持不变
- **AND** provider/host MUST NOT 收到副作用请求

### Requirement: 新控制操作必须串行、可取消且进度可见

MirrorState SHALL 提供不含 text/node label/app id 的 control phase、开始时间、最后完成时间和稳定错误码。node/text/app 操作 MUST 与 observation 和现有 action 串行；status/stop 在操作期间保持可响应，stop/dispose SHALL 传播取消并等待操作静止。Viewer 和 MCP MUST 对超过 300 ms 的操作显示/发送独立进度，同时保留最后可用画面和安全控制。

#### Scenario: 慢速文本输入

- **WHEN** active-element 或 send-keys 操作超过 300 ms
- **THEN** state/Viewer SHALL 显示 control acting，MCP progress token SHALL 收到进行中 phase
- **AND** status、theme 和 stop SHALL 保持可用，结果不得包含文本

#### Scenario: 慢速应用管理

- **WHEN** activate/terminate 与 after-state 验证超过 300 ms
- **THEN** state/Viewer SHALL 显示 managing-app 且主 lifecycle 保持 streaming
- **AND** 同一 runtime MUST NOT 并发发送第二个 control mutation

#### Scenario: Stop 取消应用管理

- **WHEN** stop 在应用管理期间发生
- **THEN** session signal SHALL 取消剩余请求并等待 may-have-mutated 处理完成
- **AND** runtime SHALL 继续按 Viewer/media/provider/managed-Appium ownership 顺序清理

### Requirement: 验收必须覆盖确定性契约、真实宿主和双平台物理设备

实现 SHALL 使用 Mock、Appium fake server、Viewer E2E、built/packed MCP、DeepSeek Harness `0.1.2-rc.1` clean profile 和 Android/iOS 物理设备分层证明 semantic actions。DSH clean profile SHALL 覆盖 Native/PTC；Mock/fake server/宿主 schema 成功 MUST NOT 被报告为真机输入、真实图片模型或应用生命周期证明；真机验证 MUST 只使用用户批准的普通文本和非关键 app，并在结束时恢复/清理 session。

#### Scenario: Mock 完整语义动作闭环

- **WHEN** runtime probe 执行 inspect、tap_node、re-inspect、replace、append、secure rejection、manage_app、re-observe 和 stop
- **THEN** node/focus/text/app state、revision/epoch/stale 与 cleanup SHALL 按共享模型确定性变化
- **AND** DSH Native/PTC 与 MCP SHALL 暴露相同九项工具和结果语义

#### Scenario: Android/iOS 普通文本真机验收

- **WHEN** 每个平台在已解锁、用户批准的普通输入框中执行 node focus、replace、append、re-observe 和 clear/restore
- **THEN** fresh structure SHALL 证明目标与结果，旧 observation SHALL 被拒绝，stop SHALL 清理 owned session
- **AND** 验收证据 MUST NOT 记录输入文本以外的屏幕秘密、element/session/device id 或 raw source

#### Scenario: Android/iOS 应用管理真机验收

- **WHEN** 每个平台对显式批准的 target 执行 query、activate/launch、query、terminate、query
- **THEN** before/after app state、screen epoch、session 可用性和最终清理 SHALL 通过
- **AND** 任一平台 API 不可用时该平台状态 MUST 保持未通过，不得以手工切换或旧结果替代
