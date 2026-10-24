## Purpose

为本机可信代码提供可追溯的数据准备、独立业务验证和资源清理能力，明确未验证、失败和不确定之间的边界，避免将界面成功或脚本退出成功误认为业务正确。

## ADDED Requirements

### Requirement: Registered trusted extensions
系统 SHALL 只执行本机登记的可信 JS 或预编译 TS 扩展，固化其产物和依赖哈希，校验输入输出；YAML MUST NOT 通过任意路径或 eval 加载代码。

#### Scenario: Unregistered extension
- **WHEN** 流程引用不存在的扩展名
- **THEN** 预检失败且不执行设备动作或扩展

### Requirement: Preparation and compensating cleanup
系统 SHALL 记录准备过程中登记的资源，按逆序在通过、失败和取消后尝试有界清理，清理失败 MUST 单独保留并阻止干净通过。

#### Scenario: Partial preparation failure
- **WHEN** 创建资源登记后 prepare 抛错
- **THEN** 后续 UI 不执行，已登记资源进入清理，报告保留准备错误和清理结果

### Requirement: Independent business verdict
业务验证 SHALL 记录 expected、actual、source 和材料引用；明确不符为 fail，超时或无效输出为 inconclusive，未执行为 not-performed；任何必选验证未通过 MUST 阻止 pass。

#### Scenario: Business timeout
- **WHEN** UI 断言通过但必选业务查询超时
- **THEN** UI 分项保留通过，业务为 inconclusive，总体不通过

### Requirement: Bounded cancellation and private credentials
系统 SHALL 对扩展设时间和输出限制，取消后回收执行进程并忽略迟到结果；凭据 MUST 按注册引用注入且不进入普通快照/报告，首期不支持敏感 UI 输入。

#### Scenario: Late verifier result
- **WHEN** 验证超时终止后出现迟到 pass
- **THEN** 迟到结果不得覆盖超时结果或触发新动作

### Requirement: Interrupted cleanup visibility
系统 SHALL 将强杀中断记录为不确定和清理待处理，MUST NOT 在重启后自动重放可能有副作用的准备或清理。

#### Scenario: Restart interrupted preparation
- **WHEN** 准备阶段宿主被强杀后重新启动
- **THEN** 显示已登记资源和待处理清理信息，不自动重放写入
