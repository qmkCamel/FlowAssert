## MODIFIED Requirements

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

### Requirement: MCP 长操作必须支持进度、取消和并发状态控制

除纯读取 status 外，所有可能访问 host/provider 的 MCP 工具 SHALL 接收 MCP request cancellation signal。客户端提供 progress token 时，adapter SHALL 对 list devices、iOS preflight、start、snapshot/inspect、action、manage_app 和 stop 发送开始、超过 300 ms 的 phase 和最终完成/失败通知；无 token 时，可用的核心 state 与 Viewer 仍 MUST 显示 observation/control 进度。status SHALL 在 observation/control 期间保持可响应，stop SHALL 能中止操作并完成 mutation-fence 与 ownership 清理。

#### Scenario: 慢速 observation 带 progress token

- **WHEN** snapshot/inspect 超过 300 ms 且请求包含 progress token
- **THEN** server SHALL 在调用完成前发送当前 observation phase 的 progress notification
- **AND** `mobile_mirror_status` SHALL 同时报告主 lifecycle 仍为 streaming 和 observation 正在 capturing

#### Scenario: 慢速文本或应用控制带 progress token

- **WHEN** input_text 或 manage_app 超过 300 ms 且请求包含 progress token
- **THEN** server SHALL 发送当前 control phase，且 structured/text progress MUST NOT 包含 text、node label、app id、element id 或原始 provider响应
- **AND** status/stop SHALL 保持可用

#### Scenario: 客户端取消调用

- **WHEN** MCP 客户端取消正在进行的 start、observation、input_text 或 manage_app
- **THEN** signal SHALL 传播到共享命令层/provider，未完成 observation MUST NOT 发布或投递 image
- **AND** 已发出 mutating request 的调用 SHALL 先按 may-have-mutated 递增 epoch，再返回稳定失败并继续接受 status/stop

#### Scenario: 操作期间停止

- **WHEN** MCP 客户端在 observation 或 control 操作期间调用 stop
- **THEN** stop SHALL 中止当前工作、等待操作静止并按 created/attached ownership 规则清理
- **AND** 被中止调用 MUST NOT 返回旧图片、旧 structure 或未验证 app state 作为 fresh 成功

#### Scenario: observation 期间停止

- **WHEN** MCP 客户端在 observation 捕获期间调用 stop
- **THEN** stop SHALL 中止捕获、等待操作静止并按 created/attached ownership 规则清理
- **AND** 被中止调用 MUST NOT 返回旧图片作为 fresh 成功
