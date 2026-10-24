# host-neutral-mcp-adapter Specification

## Purpose
定义 MCP 与 DeepSeek Harness 对同一本机设备运行时和工具契约的复用边界；两种宿主出口只交换有界控制及状态数据，不复制设备所有权或持续视频载荷。

## Requirements

### Requirement: DSH 与 MCP 必须复用唯一的 Local Device Runtime

系统 SHALL 提供宿主无关的 Local Device Runtime，统一拥有 `MirrorService`、provider、ObservationStore、ViewerServer、iOS WDA preflight 和关闭生命周期。DSH 与 MCP adapter MUST 通过该 runtime 和共享命令层执行设备操作，MUST NOT 直接调用 Appium endpoint、复制 provider/session 状态机或分别创建第二个 service。

#### Scenario: DSH 创建共享 runtime

- **WHEN** Cordis 启用 mobile-mirror plugin
- **THEN** plugin SHALL 在 documented effect 中创建并监听一个 Local Device Runtime
- **AND** effect dispose SHALL 关闭 Viewer 并按既有 ownership 规则释放该 runtime 的设备 session

#### Scenario: MCP 创建共享 runtime

- **WHEN** 任意 MCP 客户端通过 stdio 启动 server
- **THEN** server SHALL 创建同类型 Local Device Runtime 并通过共享命令层处理工具调用
- **AND** runtime MUST 继续使用现有 Mock/Appium provider、screen policy、revision、epoch、TTL 和坐标规则

#### Scenario: Viewer 与 agent adapter 并发使用

- **WHEN** Viewer 轮询 frame 且 DSH 或 MCP 正在捕获 observation
- **THEN** 两者 SHALL 访问同一个 `MirrorService` 实例
- **AND** observation 失败 SHALL 保留最后可用 Viewer frame，MUST NOT 创建第二条设备 session

### Requirement: MCP server 必须是宿主无关的 stdio 控制入口

系统 SHALL 提供可编程 export 和可执行 bin，以 MCP stdio server 暴露能力。server SHALL 只声明 tools capability，MUST NOT 依赖 Codex API、宿主名称或 DSH runtime，且 MUST NOT 启动 MCP HTTP/SSE/Streamable HTTP listener。

#### Scenario: 通用 MCP client 初始化

- **WHEN** 符合 MCP 协议的客户端通过 stdin/stdout 完成 initialize
- **THEN** server SHALL 返回稳定 server identity/version 与 tools capability
- **AND** 同一 command/args MUST 可被 Codex 及非 Codex MCP 客户端启动

#### Scenario: stdio 协议保持纯净

- **WHEN** server 启动、处理成功/失败请求或关闭
- **THEN** stdout MUST 只包含 MCP transport 写入的协议帧
- **AND** 脱敏诊断 SHALL 只写 stderr，MUST NOT 包含 config path/content、capabilities、UDID、原始 XML、图片或 stack

#### Scenario: 未支持的 MCP 表面

- **WHEN** 客户端请求 resources、prompts、sampling 或远程 transport
- **THEN** server SHALL 不声明对应能力并按 MCP 协议拒绝未支持请求
- **AND** MUST NOT 为 screenshot 创建可再次读取的 resource URI

### Requirement: MCP 结果必须同时提供结构化对象和文本回退

每个成功 MCP tool call SHALL 返回不含二进制的 `structuredContent` object，并在第一个 text content block 中返回语义相同的确定性 JSON。业务失败 SHALL 返回 `isError=true` 和脱敏的稳定错误 object；未知内部异常 MUST 映射为 `mobile_mirror_operation_failed` 而不是泄漏内部细节。

#### Scenario: 状态工具成功

- **WHEN** 客户端调用 list/preflight/start/status/action/stop 中任一工具且业务成功
- **THEN** `structuredContent` SHALL 满足该工具 output schema
- **AND** text fallback 解析后的 JSON SHALL 与 `structuredContent` 深度相等

#### Scenario: 已知 observation 错误

- **WHEN** screenshot 被策略拒绝、observation 过期/陈旧、坐标无效或图片超限
- **THEN** MCP 结果 SHALL 设置 `isError=true` 并保留对应稳定 error code
- **AND** 结果 MUST NOT 包含旧 observation、图片内容、stack 或 provider 原始响应

#### Scenario: 未知内部错误

- **WHEN** adapter 捕获未分类异常
- **THEN** MCP 结果 SHALL 使用 `mobile_mirror_operation_failed` 和安全通用消息
- **AND** server SHALL 继续服务后续 status/stop 请求而不是退出

### Requirement: 单帧图片必须通过当次 MCP image content 安全投递

`mobile_mirror_snapshot` 与 `mobile_mirror_inspect_screen(includeImage=true)` SHALL 调用 `MirrorService.observe` 获取 fresh observation，在成功结果中追加恰好一个 `image/png` content block，并把 `image.delivery` 标记为 `mcp-image-content`。协议要求的 Base64 MUST 只存在于该 image content block 及其协议序列化中；structuredContent、text fallback、日志、状态和错误 MUST NOT 包含 Base64、bytes、路径、URL 或 resource identifier。

#### Scenario: snapshot 返回一张图片

- **WHEN** Mock 或已授权 Appium session 成功执行 snapshot
- **THEN** 结果 SHALL 包含一个 observation summary text、等价 structuredContent 和恰好一个有效 PNG image block
- **AND** observationId、revision、epoch、viewport、图片尺寸和 capture window SHALL 来自同一个已发布 observation

#### Scenario: inspect 不请求图片

- **WHEN** 客户端调用 inspect_screen 且 `includeImage` 不是 true
- **THEN** 结果 SHALL 返回有界规范化结构且不包含 image content
- **AND** adapter MUST NOT 请求/编码/记录 screenshot bytes

#### Scenario: MCP 图片超过 adapter 限制

- **WHEN** observation PNG 超过配置的 MCP `maxImageBytes` 或核心 32 MiB 硬上限
- **THEN** 调用 MUST 返回 `screen_observation_too_large` 且不得报告图片已投递
- **AND** MUST NOT 通过 resource、路径、URL 或拆分多个 image block 绕过限制

#### Scenario: 客户端或模型不消费图片

- **WHEN** MCP transport 接收 image block 但宿主模型无法消费或理解图片
- **THEN** 协议验收与模型视觉验收 MUST 分开报告
- **AND** Viewer 可见、PNG magic bytes 正确或 structure 可用 MUST NOT 被报告为模型视觉验收通过

### Requirement: MCP 长操作必须支持进度、取消和并发状态控制

除纯读取 status 外，所有可能访问 host/provider 的 MCP 工具 SHALL 接收 MCP request cancellation signal。客户端提供 progress token 时，adapter SHALL 对 list devices、iOS preflight、start、snapshot/inspect、action 和 stop 发送开始、超过 300 ms 的 phase 和最终完成/失败通知；无 token 时，可用的核心 state 与 Viewer 仍 MUST 显示进度。status SHALL 在 observation 期间保持可响应，stop SHALL 能中止 observation 并完成 ownership 清理。

#### Scenario: 慢速 observation 带 progress token

- **WHEN** snapshot/inspect 超过 300 ms 且请求包含 progress token
- **THEN** server SHALL 在调用完成前发送当前 observation phase 的 progress notification
- **AND** `mobile_mirror_status` SHALL 同时报告主 lifecycle 仍为 streaming 和 observation 正在 capturing

#### Scenario: 客户端取消调用

- **WHEN** MCP 客户端取消正在进行的 start 或 observation
- **THEN** signal SHALL 传播到共享命令层/provider，未完成 observation MUST NOT 发布或投递 image
- **AND** server SHALL 继续接受 status/stop

#### Scenario: observation 期间停止

- **WHEN** MCP 客户端在 observation 捕获期间调用 stop
- **THEN** stop SHALL 中止捕获、等待操作静止并按 created/attached ownership 规则清理
- **AND** 被中止调用 MUST NOT 返回旧图片作为 fresh 成功

### Requirement: MCP 配置和进程生命周期必须默认安全且可回收

MCP bin SHALL 使用与 DSH 相同的 Mirror Config 默认值/限制，并仅支持无参数默认配置或显式 `--config <json-file>`。配置文件 SHALL 限制为 64 KiB object，拒绝未知键和无效值；MCP 专属 `maxImageBytes` 默认 8 MiB、不得超过 32 MiB。stdin EOF、SIGINT、SIGTERM 和显式 server close MUST 汇合到幂等关闭路径。

#### Scenario: 无配置启动

- **WHEN** 客户端不提供配置文件启动 MCP server
- **THEN** server SHALL 使用 Mock、`agentScreenContentPolicy=mock-only`、禁用 host discovery/签名诊断/provisioning 变更和 loopback Viewer
- **AND** 启动 MUST NOT 探测物理设备或修改外部状态

#### Scenario: 配置文件无效

- **WHEN** 配置超过 64 KiB、不是 JSON object、包含未知键、非 loopback host 或超限图片值
- **THEN** bin SHALL 在打开 MCP transport 和设备 session 前 fail closed
- **AND** 错误 MUST NOT 回显配置内容或路径

#### Scenario: attached session 关闭

- **WHEN** MCP 通过 sessionId 附着外部 Appium session 后收到 EOF、signal 或 stop
- **THEN** runtime SHALL 与该 session 分离但不得发送删除 session 请求
- **AND** close 重入 MUST NOT 产生第二次清理副作用

#### Scenario: owned session 关闭

- **WHEN** MCP 通过 capabilities 创建 Appium session 后正常 EOF、signal 或 stop
- **THEN** runtime SHALL 删除其拥有的 session 并清空对应 observation
- **AND** Viewer listener SHALL 关闭且不留下可访问的 loopback 端口

### Requirement: 发布包与验证必须证明多宿主而非 Codex 绑定

package SHALL 保留 DSH 默认 export/bundle、MCP library export/可执行 bin、锁定 SDK 依赖和必要文档，并新增不依赖宿主 SDK 的 `flowassert` onboarding CLI。自动化 SHALL 使用通用 MCP SDK client 与真实子进程验证协议；Codex SHALL 作为至少一个真实宿主完成 Mock 图片理解闭环，但代码、doctor、配置 renderer 和工具语义 MUST 不依赖 Codex。

#### Scenario: packed artifact 可运行

- **WHEN** 对 `pnpm pack --dry-run` 产物执行 contract 检查
- **THEN** tarball SHALL 包含 DSH entry、MCP export/bin、onboarding CLI、Viewer、架构/安全/配置/发布/验证文档和所需 runtime dependencies
- **AND** MUST NOT 包含个人配置、Team ID、UDID、证书、真机 capabilities、临时 observation 图片或开发机生成的 host report

#### Scenario: 生成的 MCP 配置保持宿主无关

- **WHEN** onboarding CLI 生成 MCP JSON 或 Codex 注册命令
- **THEN** command/args SHALL 启动发布包中的同一个 stdio MCP bin，并通过同一 standalone config parser
- **AND** renderer 生产代码 MUST NOT 导入 Codex API、修改宿主配置或复制 Local Device Runtime

#### Scenario: 通用 MCP Mock 闭环

- **WHEN** SDK client 对 packed/compiled MCP server 执行 `list/start → snapshot/inspect → observation-bound action → re-observe → stop`
- **THEN** 工具 schema、PNG、结构、revision/epoch 变化、stale rejection 和清理 SHALL 全部通过
- **AND** 该结果 SHALL 标记为通用协议/Mock 验收而非物理设备验收

#### Scenario: Codex 视觉闭环

- **WHEN** Codex 通过同一 stdio command 注册 server 并消费 Mock snapshot
- **THEN** Codex SHALL 能描述图片中的可核对内容，执行 observation-bound safe action，并在 re-observe 中确认 action revision 变化后 stop
- **AND** Codex 配置 SHALL 只出现在文档/验收步骤中，生产代码 MUST 不导入或调用 Codex 专属 SDK

#### Scenario: 完整仓库门禁

- **WHEN** change 实现完成
- **THEN** `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 和 `git diff --check` SHALL 通过
- **AND** release candidate SHALL 额外通过临时 tarball 安装、onboarding CLI、managed Appium、MCP built-bin 和精确 DSH `0.2.0-rc.2` Native/PTC clean-profile probes
- **AND** Viewer 有改动时 MUST 留存并人工检查运行时截图，Android/iOS 真机与模型验收缺口 SHALL 单独报告

### Requirement: MCP 必须暴露与 DSH 一致的工具契约

MCP adapter SHALL 暴露mobile_mirror_list_devices、mobile_mirror_ios_preflight、mobile_mirror_start、mobile_mirror_status、mobile_mirror_snapshot、mobile_mirror_inspect_screen、mobile_mirror_query_screen、mobile_mirror_action、mobile_mirror_manage_app和mobile_mirror_stop共十工具。名称、描述、输入字段、action/query分支、枚举、parser与业务调用 MUST 来自同一contract层；旧九工具行为 MUST 保持兼容。MCP SHALL 用object-root oneOf表达action/query分支；DSH SHALL 用0.1.2-rc.1的扁平ParameterSchemaSpec投影字段，并由共享parser验证分支必填/冲突/unknown字段。annotations MUST 不替代核心screen/text/app policy或ownership。

#### Scenario: 工具发现一致

- **WHEN** 读取DSH registry与MCP tools/list
- **THEN** 两者 SHALL 暴露相同十工具和等价输入约束
- **AND** MCP output schema SHALL 覆盖实际structuredContent，包括inspect的full/summary和query结果

#### Scenario: DSH 与 MCP 投影条件 action schema

- **WHEN** action含tap/swipe/back/tap_node/input_text，query含find/get/subtree
- **THEN** MCP SHALL 使用object-root oneOf，DSH SHALL 保持action kind及query op/observationId必填的扁平参数表
- **AND** 同一组正负样例 MUST 在两个adapter产生相同接受/拒绝结果

#### Scenario: 启动与动作输入只解析一次

- **WHEN** DSH/MCP调用start/action/manage_app/inspect/query
- **THEN** 原capabilities、坐标、文本、app id以及新增structureMode和query分支参数 SHALL 都由共享parser验证
- **AND** 非法或未知输入 MUST 在provider调用前失败，query错误 MUST 不回显查询串

#### Scenario: DSH 兼容性

- **WHEN** 旧DSH probe用原参数执行原九工具
- **THEN** 原canonical JSON、图片投递、session ownership与错误 SHALL 保持兼容
- **AND** DSH adapter MUST 不引入MCP content/result类型

#### Scenario: 宿主读取工具风险提示

- **WHEN** MCP client列出工具
- **THEN** list/preflight/status/snapshot/inspect/query SHALL 标为read-only，start/action/manage_app/stop SHALL 标为可能改变或清理状态
- **AND** query SHALL 为destructive=false、idempotent=false、openWorld=false；manage_app SHALL 继续保守destructive/open-world/non-idempotent
- **AND** 宿主审批显示 MUST 不改变核心policy、provisioning opt-in与ownership

### Requirement: MCP 查询结果不得引入图片或截图资源表面

query成功 SHALL 同时提供语义相同的首个JSON text content与structuredContent，满足64KiB业务结果预算，不提供image block、resource URI、本机文件路径或Viewer inspection数据。失败 SHALL 使用isError=true和原稳定错误投影。query SHALL 检查request取消且不等待provider队列；原长工具的progress/Stop/取消契约 MUST 保持不变。

#### Scenario: 查询期间没有图片上下文

- **WHEN** MCP client在一次summary inspect后连续查询多个节点
- **THEN** query结果 SHALL 只有JSON text和structuredContent，不产生image、resource或Viewer地址
- **AND** query次数 MUST 不增加provider截图/source请求或旧observation的TTL

#### Scenario: 取消纯查询与旧观察错误

- **WHEN** query在开始前被取消，或其observation已过期/属于旧session
- **THEN** server SHALL 稳定拒绝且不重新抓取，不输出图片或旧结果作为fresh成功
- **AND** 并发status/Stop与原长操作进度 SHALL 保持可用
