## Purpose

将显式健康和性能条件接入工作台的版本化可信结果及所有消费出口，让用户能够分辨未执行、失败、不确定与通过，同时保持历史记录、隐私、证据生命周期和长操作交互的一致性。

## ADDED Requirements

### Requirement: Versioned required runtime dimensions
新契约 SHALL 显式包含 health/performance 的 required、status、reason 和证据引用。未声明门禁 SHALL 为 not-performed 而非 pass；声明门禁任一必需条件未通过 MUST 阻止干净通过。旧记录 SHALL 保留原结论，不回填新维度；未知契约或必需特征 MUST 拒绝可信解释。

#### Scenario: Old run without runtime gates
- **WHEN** 读取旧版本通过记录
- **THEN** 保留其原版本语义，新门禁显示未执行，不称为已通过健康或性能验收

#### Scenario: Old consumer sees required new feature
- **WHEN** 不支持新契约或特征的消费者读取新运行
- **THEN** 明确 unsupported/inconclusive，不删除未知字段后返回通过

### Requirement: Shared outcome across all result consumers
Viewer、JSON、JUnit、CLI、MCP/DSH、套件、矩阵、趋势和变更验收 SHALL 使用相同的门禁事实与投影；所有声明门禁通过且既有条件成立才允许 clean pass/exit 0。recovered/flaky、取消、证据冲突和缺失 MUST 保留原规则。多个失败或不确定原因 SHALL 同时保留，不以一个总体枚举掩盖详情。

#### Scenario: UI passed but health failed
- **WHEN** UI 成功且 App 健康门禁确认崩溃
- **THEN** 所有出口均为非干净通过，JUnit 记录对应 failure，CLI 非零，验收对象不得变绿

#### Scenario: Missing required health in acceptance link
- **WHEN** 验收 coverage cell 要求 health 但关联旧运行未执行该维度
- **THEN** coverage 为 incomplete，不能借旧 pass 满足新要求

### Requirement: Evidence integrity and least disclosure
门禁材料 SHALL 参与证据引用/租约/保留和哈希验证；分享 SHALL 默认排除原始日志、路径、设备标识和凭据。导入或派生材料 MUST 保留未重新验证标记，不因有效哈希变成独立健康证明。

#### Scenario: Health evidence is corrupted
- **WHEN** 读取时健康材料哈希不符
- **THEN** 当前可信结果不确定，保留原 reported verdict，禁止发布干净通过摘要

### Requirement: Responsive runtime gate presentation
运行中的采样、测量、健康排空与取消 SHALL 遵守项目引用的 user-action-contract，展示局部阶段及真实覆盖状态；失败保留最后可用结果，结束刷新相关列表并使用领域结束时间。MUST NOT 为等待尾部事件提前显示最终通过。

#### Scenario: Slow drain while inspecting history
- **WHEN** 健康排空超过 800 ms，用户查看历史或切换主题
- **THEN** 交互可用，局部状态仍为排空中；直到门禁与清理结束才显示最终结果

### Requirement: Acceptance claims remain evidence-scoped
系统文档与报告 SHALL 分别标记工程/Mock、受控平台探针、真机和真实业务验收。信号能力只能在已验证来源及版本范围内开放；单次时限通过 MUST NOT 宣称生产 SLO 或未测试平台的健康保证。

#### Scenario: Synthetic crash fixture passes
- **WHEN** 离线事件解析测试通过但真实平台来源未验证
- **THEN** 只标记工程通过，该平台信号仍不可作为健康通过依据
