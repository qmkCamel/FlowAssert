## Purpose

提供与确定性移动验收相结合的单次端到端时间门禁，明确测量起止点、主机开销和失败边界，保证快速失败不会被记为性能通过，并避免将单次测试耗时误称为生产性能指标。

## ADDED Requirements

### Requirement: Explicit bounded measurement block
`measure` SHALL 具有唯一 ID、显式 `maxElapsedMs` 和有界步骤集合；首期 MUST 拒绝嵌套测量块、跨尝试测量以及没有实际成功断言的路径。系统 SHALL 在动作前校验预算和必需断言；未执行的声明测量 MUST NOT 视为通过。

#### Scenario: No assertion in selected path
- **WHEN** 实际分支跳过测量块内全部成功断言
- **THEN** performance 不确定，即使执行耗时很短

### Requirement: Monotonic end-to-end timing
测量 SHALL 从块内第一步派发前开始，到块内步骤及最后成功断言的必要证据完成为止，采用同一主机单调时钟。报告 SHALL 明示包含自动化、观测及证据开销，排除块外 prepare/cleanup 和健康尾部排空。MUST NOT 混用设备墙钟或把该指标称为纯 App 渲染耗时、FPS 或生产 SLO。

#### Scenario: Host wall clock changes
- **WHEN** 测量期间系统墙钟跳变
- **THEN** elapsed 和 deadline 不受影响，展示时间与判定时间分开

### Requirement: Success and time bound jointly gate pass
performance SHALL 仅在全部块内步骤/必需断言有效成功、计时及证据完整且 elapsed <= maxElapsedMs 时通过。明确时限耗尽且观测/计时链完整 SHALL 为 fail；观测故障、缺证据、宿主中断或无法确定端点 SHALL 为 inconclusive。功能断言失败 SHALL 保留功能失败，不因执行快而产生性能通过。

#### Scenario: Fast functional failure
- **WHEN** UI 在 200 ms 时得到明确失败断言，预算为 2000 ms
- **THEN** UI 失败，performance 不是 pass，报告标记成功端点未达到

#### Scenario: Deadline exceeded
- **WHEN** 健康的执行与观测链在声明截止前未完成成功端点
- **THEN** performance 失败，停止后续块步骤，有界取消当前调用并执行清理

#### Scenario: Read hangs rather than app running slowly
- **WHEN** 设备读取故障使成功端点无法观测
- **THEN** performance 不确定，不把工具连接故障归因于 App 过慢

### Requirement: Attempt identity and immutable thresholds
每个 measure SHALL 绑定 run/case/attempt、源步骤、输入/构建/环境及阈值摘要，重试和矩阵设备各自计时。系统 MUST 保留失败尝试，不以最快一次或运行后放宽阈值覆盖原结果；趋势统计 MUST 区分未校准样本与正式 SLO。

#### Scenario: Fast retry after slow first attempt
- **WHEN** 第一次超时，第二次满足阈值
- **THEN** 两次测量均保留，既有 flaky 规则仍生效，不能整体干净通过

### Requirement: Bounded cancellation and honest interruption
测量 SHALL 受运行总预算约束，取消 MUST 阻止后续派发，未知写入结果不得自动重试。宿主恢复 SHALL 标记未结束测量为 interrupted/inconclusive，不拼接两次进程的单调时间。

#### Scenario: Restart during measured action
- **WHEN** 宿主在测量块内退出并重启
- **THEN** 已有事实保留，测量不确定且不自动续跑剩余动作
