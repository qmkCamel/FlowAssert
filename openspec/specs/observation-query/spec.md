# observation-query Specification

## Purpose
定义针对指定 Agent observation 的只读规范化结构查询、身份校验和有效期边界；查询不得重新采集屏幕、发起设备动作，或把过期观察误认为当前可执行目标。

## Requirements

### Requirement: 查询必须只读取指定 observation 的已规范化结构

系统 SHALL 提供 `mobile_mirror_query_screen`，要求显式 observationId 与 find/get/subtree 操作。查询 MUST 只读取当前 session 的 Agent ObservationStore 中仍保留的规范化结构，不调用 provider、创建图片/attachment、发布 observation、更新 revision/epoch/TTL、改变条目逐出顺序或触发动作。查询 MUST 复核当前 Agent 结构分享策略，不接受 Viewer inspectionId。

#### Scenario: 多次查询复用一次采集

- **WHEN** Agent 完成一次含结构的 observation，随后使用相同 ID 执行 find、get 和 subtree
- **THEN** 三次查询 SHALL 保留原 ID、nodeId、捕获时间、revision 和 expiresAt
- **AND** provider 请求数和 attachment 数 MUST 均不增加

#### Scenario: 无结构或不属于 Agent store 的身份

- **WHEN** 调用者查询仅含图片的 observation 或提交 Viewer inspectionId
- **THEN** 仅图片 observation SHALL 返回 `screen_structure_unavailable`，不属于 Agent store 的身份 SHALL 按现有 stale/session 错误规则拒绝
- **AND** 系统 MUST NOT 重捕获、查询 Viewer 内存或退化为 latest observation

#### Scenario: 物理屏幕分享默认关闭

- **WHEN** Appium session 的策略为 mock-only，即使本机 Viewer Inspector 可见
- **THEN** Agent query MUST 返回 `screen_observation_disabled`
- **AND** MUST NOT 返回本机 Inspector 中的结构或图片

### Requirement: 查询字段与分支必须严格验证

共同字段 observationId SHALL 为非空且最多 128 字符，op SHALL 为 find/get/subtree。find SHALL 接受 text、textMatch、caseSensitive、identifier、role、region、visibleOnly、actionableOnly、offset、limit；get SHALL 仅接受必填 nodeId；subtree SHALL 接受必填 nodeId、depth、offset、limit。非空 nodeId SHALL 最多 128 字符。查询文本 SHALL 最多 128 Unicode code points 与 512 UTF-8 bytes，不含控制字符；系统 MUST NOT 静默 trim、截断输入或接受未知键。

#### Scenario: 默认分页与有限深度

- **WHEN** find/subtree 未显式传入分页参数
- **THEN** offset SHALL 为 0、limit SHALL 为 20；limit 只接受 1–100 整数、offset 只接受 0–500 整数
- **AND** subtree 的 depth SHALL 默认为 2，仅接受 0–8 整数，0 只包含根

#### Scenario: 分支参数冲突

- **WHEN** get 携带 text/limit、find 携带 nodeId，或未提供 text 却提供 textMatch/caseSensitive
- **THEN** shared parser MUST 返回 `mobile_mirror_invalid_arguments`
- **AND** DSH、MCP 与浏览器纯查询入口 MUST 对同样输入执行等价规则

#### Scenario: 非法或超限参数

- **WHEN** 参数包含非有限数、负 offset、超范围 limit/depth、未知枚举、regex 对象或超限字符串
- **THEN** 系统 MUST 在读取 store 或访问 provider 前拒绝
- **AND** 错误 MUST NOT 回显查询串或原始参数

### Requirement: 筛选必须是确定性的严格匹配

find 的不同过滤条件 MUST 为 AND。text SHALL 在已脱敏 name/text/value 的任一字段进行字面 exact/contains，默认 contains、caseSensitive=false；不区分大小写时 SHALL 使用 Unicode toLowerCase，不使用 locale、正则、归一化或评分。identifier MUST 始终精确且大小写敏感。role SHALL 使用现有规范化 role 枚举。结果 MUST 保持 observation 原数组顺序，不自动选择或操作第一项。

#### Scenario: 同时指定文字与角色

- **WHEN** find 使用 text=登录、textMatch=exact、role=button
- **THEN** 系统 SHALL 只返回文字字段完整匹配且 role 为 button 的节点
- **AND** 仅文字匹配的 text 节点或仅 role 匹配的其他按钮 MUST 被排除

#### Scenario: 多个候选与无条件浏览

- **WHEN** 多个节点满足过滤，或 find 未提供文字/标识等显式过滤
- **THEN** 系统 SHALL 按默认可见性与稳定顺序返回有界列表
- **AND** MUST NOT 使用得分或唯一结果数量触发设备动作

#### Scenario: 匹配与摘要截断分开

- **WHEN** 文字命中规范化字段的第 128 个 code point 之后
- **THEN** 节点 SHALL 仍被匹配，展示摘要 SHALL 标记 fieldsTruncated
- **AND** MUST NOT 使用缩略文字执行 exact/contains 匹配

### Requirement: 可见性和区域不得猜测未知值

visibleOnly SHALL 默认为 true，要求 visible=true、有限正 bounds 与 viewport 有正面积交集；false 不进行该过滤。actionableOnly SHALL 默认为 false；true 要求上述可见性、enabled=true 与 actionable=true。缺失属性 MUST 保持未知。region SHALL 使用节点与 viewport 交集中心，归一化 u/v；左/上为 [0,1/3)，右/下为 [2/3,1)，center 为两个中间三分区的交集，四角为对应横纵区域交集。

#### Scenario: 未知可见性与部分越界

- **WHEN** 一节点没有 visible 值，另一 visible=true 节点部分位于 viewport 内
- **THEN** visibleOnly=true SHALL 排除未知值节点，保留有正交集节点
- **AND** region SHALL 根据可见交集中心计算，不根据裁剪前矩形中心猜测

#### Scenario: 区域边界和非零 origin

- **WHEN** viewport origin 非零，交集中心归一化 u 恰为 1/3 或 2/3
- **THEN** 1/3 SHALL 不属于 left，2/3 SHALL 属于 right
- **AND** 缺失或无效 bounds MUST NOT 匹配任何 region

### Requirement: 节点与子树读取必须保留身份和截断边界

get SHALL 精确返回一个节点的完整规范化字段、parentAvailable 与 capturedChildCount，不附带无界 childId 数组；subtree SHALL 包含指定根，并按父子前序、同级原数组顺序遍历至 depth 上限。系统 MUST 保留原 nodeId 和 parentId，检测重复 ID/环；截断造成的缺失 parent SHALL 表示不可用，不虚构祖先。

#### Scenario: 不存在的根与损坏的层级

- **WHEN** get/subtree 的 nodeId 不存在，或捕获结构包含重复 ID/环
- **THEN** 不存在节点 SHALL 返回 `screen_node_not_found`，损坏结构 SHALL 返回 `screen_structure_invalid`
- **AND** MUST NOT 搜索其他 observation 的同名节点或按文本恢复

#### Scenario: 子树的深度限制

- **WHEN** depth=1 的根还有更深的已捕获后代
- **THEN** 返回范围 SHALL 只包含根和直接子节点，并标记 page.depthLimited=true
- **AND** 该标志 MUST 与 source.truncated 分别报告

### Requirement: 查询结果必须有界且分页不丢项

所有操作 SHALL 返回 design 中的 ScreenQueryResult envelope，包括原 observation 身份/时间、actionBinding、source 统计、nodes 和 page。find/subtree SHALL 使用 name/text 最多 128 code point 的简略投影并标记截断，get SHALL 返回完整已规范化详情。完整 JSON UTF-8 MUST 不超过 64 KiB；分页 SHALL 以完整节点切分，totalMatches 只统计本次已捕获查询范围。nextOffset SHALL 指向第一项尚未返回的匹配节点；limit/bytes/depth/source 四种限制不得合并成一个模糊布尔值。

#### Scenario: 字节预算提前截页

- **WHEN** 一页在到达 limit 前已不能容纳下一完整节点
- **THEN** 系统 SHALL 标记 limitedBy 包含 bytes 并给出下一条 offset
- **AND** 逐页读取 SHALL 无重复、无跳过，整个结果均满足 64 KiB

#### Scenario: 空页与单节点结果

- **WHEN** find/subtree 的 offset 超过 totalMatches
- **THEN** 系统 SHALL 成功返回 nodes=[]、returned=0、无 nextOffset
- **AND** get 成功时 SHALL 使用 offset=0、returned=1、totalMatches=1；若单节点不能完整装入预算 SHALL 返回 `screen_query_result_too_large`

#### Scenario: 源截断下没有匹配

- **WHEN** source.truncated=true 且查询没有匹配
- **THEN** 结果 SHALL 保留 source 的截断原因和 totalMatches=0
- **AND** 工具说明与 Viewer MUST 明确这不能证明完整设备页面不存在该元素

### Requirement: 读取有效期不得成为动作授权

query SHALL 允许同 session、未被逐出且 TTL 内的历史 observation 读取，不因新的 revision、screenEpoch 或 15 秒动作时限拒绝只读查询；它 MUST 返回 actionBinding，优先级为 screen-changed、superseded、action-expired、current，validUntil 为 captureEndedAt+15秒 与 expiresAt 的较小值。原带 observation 的 action MUST 继续执行最新 revision、epoch、generation、TTL、15秒及节点/策略检查。

#### Scenario: 十五秒后继续读详情

- **WHEN** observation 已过 15 秒但未过 60 秒且仍保留
- **THEN** get SHALL 成功并标记 action-expired
- **AND** 使用该 observation 的严格动作 MUST 继续拒绝 expired

#### Scenario: 页面变化后查看历史

- **WHEN** 原 observation 的 epoch 已落后但仍在同一 session 的 store
- **THEN** query SHALL 返回原数据和 screen-changed，不自动刷新或重写时间
- **AND** 其 nodeId MUST NOT 被解释为新画面的动作目标

#### Scenario: 过期、逐出或 session 替换

- **WHEN** observation TTL 到期、因容量逐出或 session 被停止/替换
- **THEN** query SHALL 使用现有 expired/stale/session_mismatch 规则拒绝
- **AND** 之前查询成功 MUST NOT 延长该 observation 的生存期

### Requirement: 查询核心必须可复用且不阻塞设备控制队列

筛选、分页、摘要、层级及几何规则 SHALL 位于不依赖 Node/DOM/DSH/MCP 的纯模块，供服务端和 browser build 复用。纯模块 SHALL 只接收结构、viewport与不含observationId的查询条件；Agent command SHALL 独立校验store身份并添加actionBinding，Viewer MUST 不因复用算法获得Agent store访问权。Agent query MUST 不等待 Appium exclusive queue，并执行取消/generation 检查；返回 text/name 等显式授权内容之外，诊断日志 MUST 只包含固定错误/耗时/数量，不记录查询串、原始 source 或页面内容。

#### Scenario: 设备捕获期间查询已有结构

- **WHEN** Viewer 或 Agent 正在进行慢捕获
- **THEN** 已有 observation 的查询与 status SHALL 保持可响应
- **AND** query MUST 不向 provider 插入请求，不改变捕获取消与 Stop 路径
