## ADDED Requirements

### Requirement: Versioned compatible product contracts
系统 SHALL 为运行来源、验证分项、证据派生关系和后台任务提供版本化契约，复用现有 run/case/attempt/verdict 身份。旧记录 MUST 保持原语义，缺失字段标 unknown/not-performed，不回填今天的设备信息。未知版本 MUST 拒绝写入和可信聚合，保留安全的只读提示。

#### Scenario: Read legacy run
- **WHEN** 旧归档没有 provenance 或视觉分项
- **THEN** 系统保留原历史结果，并明确新维度未知或未执行，不升级为已验证

#### Scenario: Consumer sees future contract
- **WHEN** 报告或导入器收到不支持的 contractVersion
- **THEN** 明确拒绝可信解释或写回，不丢弃未知必需条件后返回 pass

### Requirement: Shared verification and evidence semantics
Viewer、CLI、MCP/DSH SHALL 使用同一结果投影，区分 required 验证与 not-performed。系统 MUST 保留 recovered/flaky 的非干净通过语义、原始失败及业务/清理/证据结果。证据 hash 仅证明字节完整性，派生件 MUST 与原件身份分离。

#### Scenario: Recovered run with complete evidence
- **WHEN** 导航恢复后声明条件通过且证据完整
- **THEN** 所有入口仍返回 recovered 与默认非零 CI，不显示干净 pass

#### Scenario: Derived artifact has valid hash
- **WHEN** 脱敏或视觉派生件通过 hash 校验
- **THEN** 系统只确认派生字节完整，不据此证明原始业务结果或隐私已全部移除

### Requirement: Responsive bounded product jobs
可能超过 300ms 的新用户任务 SHALL 异步执行并立即显示局部进度，只禁止不安全重复提交；失败保留最后可用数据，完成刷新受影响数据，时间显示使用领域完成时间。任务 SHALL 支持有界取消与重启中断标记，不在 Viewer 主线程执行重计算。

#### Scenario: Slow job and unrelated interaction
- **WHEN** 导出或分析运行超过 800ms 且用户切换主题/查看历史
- **THEN** 交互保持可用、进度可见；失败后旧结果仍在，成功后相关列表和完成时间更新

#### Scenario: Restart during background work
- **WHEN** 未完成 job 的宿主重启
- **THEN** 标记 interrupted，不自动重放有副作用任务或用渲染时间伪造完成时间
