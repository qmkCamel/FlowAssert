## ADDED Requirements

### Requirement: Frozen attributed run provenance
系统 SHALL 在首个业务动作前冻结可获取的 App/构建、OS/驱动/执行器及可信项目数据版本，逐字段标 observed/declared/unknown、采集时间和摘要规则版本。未取得值 MUST 为 unknown；配置声明不得标为设备实测。

#### Scenario: Build declared but not observed
- **WHEN** CI 提供构建提交但 provider 不能读出 App build
- **THEN** 提交标 declared、App build 标 unknown，不暗示二者已经核对一致

### Requirement: Private collection and explicit strictness
收集器 SHALL 只通过有界只读路径及公开字段白名单采集，不输出密钥、完整环境变量、UDID 或主机绝对路径。严格模式要求的 provenance 缺失 MUST 在设备写入前拒绝；默认模式 SHALL 保留已有执行行为并提示缺口。

#### Scenario: Required provenance unavailable
- **WHEN** 用户启用严格模式且必需 App 版本无法取得
- **THEN** 执行前返回稳定缺失错误，没有业务动作或 prepare 写入

#### Scenario: Configuration contains secrets
- **WHEN** runtime 环境包含凭据及用户目录
- **THEN** 运行公开摘要和 Agent 结果不包含原文或可关联秘密的直接摘要

### Requirement: Provenance-aware comparability
比较与趋势 SHALL 分别显示用例身份和环境可比性，不以标题、unknown 相等或来源声明推断完全相同环境；历史记录不得用当前采集值修补。

#### Scenario: App build changes
- **WHEN** 同一用例运行在两个不同或未知的 App build
- **THEN** 保留用例关联但显示差异/未知，不默认为严格同环境回归
