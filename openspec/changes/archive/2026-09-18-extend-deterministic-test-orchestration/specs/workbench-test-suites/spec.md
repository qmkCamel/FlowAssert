## Purpose

为连接的一台移动设备提供串行回归套件，将流程与数据行映射为独立用例并保留每次尝试、材料和清理结果，使本机用户与持续集成使用一致的可追溯判定。

## ADDED Requirements

### Requirement: Deterministic serial scheduling
系统 SHALL 在当前设备串行运行筛选后的已登记用例，每数据行独立记录；平台不匹配或零匹配 MUST 报错，套件与手动运行不得交错写设备。

#### Scenario: No matching cases
- **WHEN** 标签筛选后没有用例
- **THEN** 报告零匹配并以非零退出码结束，不产生通过结论

### Requirement: Safe explicit retry lineage
自动重试 SHALL 默认关闭，启用时最多一次且需要 retrySafe、成功重置、清理成功和已知设备状态；重试通过 MUST 保留原失败并标记 flaky，默认 CI 不通过。

#### Scenario: Retry succeeds
- **WHEN** 满足重试条件的用例第一次失败第二次通过
- **THEN** 两份 attempt 和证据可查看，套件标记 flaky 并返回非零

### Requirement: Portable truthful reporting
系统 SHALL 输出 JSON/JUnit 和 Viewer 历史，保存 suite/case/attempt 关联；只有全部选中用例干净通过才能返回 0，未执行、清理失败、必需证据缺失不得计为通过。

#### Scenario: Evidence missing
- **WHEN** 用例动作通过但必需截图缺失
- **THEN** 该用例不确定，报告链接已有材料，CI 非零

#### Scenario: Bounded AI recovery completes
- **WHEN** 显式恢复成功且原定验证及清理完整通过
- **THEN** 用例标记 recovered，与 flaky 分开、不自动重试，CI 退出 1，JUnit 输出 recovered failure；后续证据核验失败降为 inconclusive

### Requirement: Suite cancellation and restart
取消 SHALL 停止排队派发并取消当前运行、执行有界清理；中断后 MUST 保留已完成结果且不自动续跑。会话变化或动作未知 MUST 阻断队列。

#### Scenario: Cancel active suite
- **WHEN** 有一个运行中用例及多个排队用例时取消
- **THEN** 当前进入取消/清理，剩余标记未执行，历史可查看且不再发送动作

### Requirement: Responsive progress and historical compatibility
Viewer SHALL 展示阶段及 case/attempt 进度，长操作期间保留已有结果并允许媒体/历史查看；旧运行记录 MUST 按原语义读取。

#### Scenario: Slow cleanup
- **WHEN** 清理持续超过 300 ms
- **THEN** 显示清理进度，用户仍可查看历史，旧运行不会被升级成业务验证通过
