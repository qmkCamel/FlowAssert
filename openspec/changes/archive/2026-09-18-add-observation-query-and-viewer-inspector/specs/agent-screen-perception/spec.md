## ADDED Requirements

### Requirement: 结构摘要投影必须向后兼容并保留完整核心观察

`mobile_mirror_inspect_screen` SHALL 接受可选 structureMode=full|summary，默认full。full MUST 保持旧输入与原结果形状；summary SHALL 保留相同 observation 元数据，输出 structureSummary 的 nodeCount/truncated/truncatedReason 而不输出 structure.nodes。核心 store MUST 仍保存同一次 fresh capture 的完整规范化结构。includeImage SHALL 与投影模式正交并继续受现有分享策略限制。

#### Scenario: 旧调用保持完整结果

- **WHEN** 调用者只传 includeImage 或使用空参数
- **THEN** inspect SHALL 使用full，返回原structure.nodes契约
- **AND** 原有图片、attachment、generation、revision和TTL规则 MUST 不变

#### Scenario: 摘要后查询具体节点

- **WHEN** inspect 使用summary且未请求图片，随后query引用其ID
- **THEN** 初次结果 SHALL 只有structureSummary而没有完整节点和图片
- **AND** query SHALL 从已保存的完整规范化结构读取，不再访问provider，不更新revision

#### Scenario: 摘要仍可显式附图

- **WHEN** includeImage=true、structureMode=summary且策略允许图片
- **THEN** adapter SHALL 按旧路径投递且仅投递一张当次图片，同时返回structureSummary
- **AND** core observation 的原始viewport/PNG尺寸 MUST 不被DSH attachment归一化尺寸替换

### Requirement: 本机 inspection 必须与 Agent 发布和资源配额隔离

Viewer inspection SHALL 使用专用核心入口，共享provider/normalizer/捕获互斥与取消，不调用Agent observation发布路径。它 MUST 不更新Agent frameRevision/latestObservationRevision、epoch、observation phase、TTL、四条条目限额或32MiB图片配额。Viewer本机查看 SHALL 不修改Agent screen policy，Agent工具 MUST 不可读取inspection身份或响应。

#### Scenario: Agent store 已满时本机检查

- **WHEN** 当前session的Agent store已经保留四个observation，Viewer请求一次检查
- **THEN** Viewer capture MUST 不逐出任何Agent observation或向其store写入新条目
- **AND** 原strict action的freshness和配额逐出规则 SHALL 保持不变

#### Scenario: 两个入口竞争捕获

- **WHEN** Agent observation或Viewer inspection正在捕获，另一个入口请求捕获
- **THEN** 第二个请求 MUST 立即返回screen_observation_in_progress
- **AND** 已保留Agent结构的query、status与Stop SHALL 保持可用

#### Scenario: session取消清理两条路径

- **WHEN** session stop、替换或dispose发生
- **THEN** Agent store SHALL 按原规则失效，未完成Viewer capture SHALL 被Abort并禁止发布
- **AND** owned/attached Appium清理语义 MUST 保持不变
