本delta的前驱为active `add-semantic-agent-actions` 的完整九工具delta；当前main的八工具要求应先应用前驱再应用本delta。同步前必须演练名称与完整场景合并，不提前归档前驱的未完成真机工作。

## RENAMED Requirements

- FROM: `### Requirement: MCP 必须暴露与 DSH 一致的九项工具契约`
- TO: `### Requirement: MCP 必须暴露与 DSH 一致的工具契约`

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

## ADDED Requirements

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
