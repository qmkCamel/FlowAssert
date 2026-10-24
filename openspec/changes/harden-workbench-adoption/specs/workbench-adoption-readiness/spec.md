## ADDED Requirements

### Requirement: Reproducible package readiness
候选版本 SHALL 关联源码 SHA、tarball SHA、依赖/设备支持矩阵及安装验收；在仓库外干净前缀验证 Mock/standalone/MCP/DSH Native/PTC，并验证旧归档与升级回退。真实设备或模型未验能力 MUST 单列，不自动宣称发布。

#### Scenario: Source ahead of release
- **WHEN** dev 新能力已验而 Release 仍是旧版本
- **THEN** 能力清单分别显示源码与发布资产范围，不以新文档替代安装包验证

### Requirement: Repeatable fault and performance matrix
验收 SHALL 覆盖设备/驱动故障、单侧取证失败、磁盘/manifest 故障、各阶段取消和重启，检查 verdict、后续动作、证据及 owner。性能 SHALL 同环境双端分别至少 30 次测量后设版本化预算，所有失败/排除原因保留。

#### Scenario: Replacement device passes
- **WHEN** 替代设备通过而原设备故障未复验
- **THEN** 支持矩阵分别记载，不把原故障标已修复

#### Scenario: Missing evidence after successful action
- **WHEN** 故障注入使必需 PNG 或 XML 无法保存
- **THEN** 保留另一侧材料且最终不通过，无后续不安全派发

### Requirement: Measured independent adoption
阶段采用验收 SHALL 区分工程完成和真实采用：5 名非开发用户至少 4 名在依赖就绪后 15 分钟完成首次测试；至少 2 个自研 App 覆盖双端共 20 条流程、7 天至少 100 次计划运行；非产品故障目标 <1%，保留基础设施/取消/未执行分母；至少 100 个故意失败样本观察到错误通过为 0。缺少人员/设备/接口 MUST 标 pending，不用 Fixture 代替。

#### Scenario: External app unavailable
- **WHEN** 内部工程门禁通过但没有真实试点应用
- **THEN** 允许记录候选版本工程就绪，采用门槛保持未完成，不宣称外部生产稳定

#### Scenario: Published failure metric
- **WHEN** 生成试点稳定性报告
- **THEN** 同时显示计划/执行/未执行和故障分类、样本与环境，不隐去基础设施失败或把有限样本等同普遍零风险
