# workbench-reliability Specification

## Purpose
定义测试工作台的检查点取证、失败保真、重启恢复和运行耗时边界；部分 PNG/XML 材料应独立保存，异常中断不得补造成功结果，历史可回看性必须与当前设备状态区分。

## Requirements

### Requirement: Independently retained checkpoint evidence
系统 SHALL 为每一步依次获取新的 PNG 与 XML，各自成功后立即保存；另一采集或落盘失败 MUST 保留已成功材料并阻止最终 pass。截图/树 SHALL 各有捕获时间窗，不声称原子一致。
#### Scenario: Source fails after screenshot
- **WHEN** PNG 已取得但 XML 获取失败
- **THEN** 历史仍可读取 PNG，记录失败阶段，最终 inconclusive，后续设备动作不派发。
#### Scenario: Screenshot fails but source succeeds
- **WHEN** PNG 获取或保存失败而源树仍可获取
- **THEN** 独立保留源树，展示部分证据与错误，不生成 pass。

### Requirement: Durable recovery without fabricated success
系统 SHALL 原子发布不可覆盖证据并持久化 manifest，重启时发现已落盘未登记材料和中断/损坏记录，保留原始字节并以 inconclusive 呈现恢复材料。符号链接和越界文件 MUST 不被读取，恢复不能证明原业务断言。
#### Scenario: Host interruption between evidence and manifest
- **WHEN** 宿主在材料提交后、manifest 更新前退出
- **THEN** 重启列出该材料、计算恢复哈希并标记 recovered/unverified，而不是隐藏材料或恢复为通过。
#### Scenario: Disk failure
- **WHEN** 写入中途或最终 manifest 提交失败
- **THEN** 当前结果不通过，先前材料可回看；重启发现残留材料但不把半文件当原始完整证据。

### Requirement: Explainable run timing
系统 SHALL 用单调时钟记录设备动作、定位源树、等待、PNG/XML、持久化与复核耗时，并在步骤详情显示。纯源树读取和检查点 SHALL 不执行不需要的几何查询；点击的边界验证 MUST 使用新几何，必需证据不得复用旧采集。
#### Scenario: Repeated benchmark
- **WHEN** 同设备、同 YAML、同证据策略重复运行
- **THEN** 报告包含各次 run、阶段统计、材料完整性和媒体/交互证明；设备平台和不同指标口径不混作性能排名。
#### Scenario: Slow capture and cancellation
- **WHEN** 取证耗时超过 300ms 或用户取消
- **THEN** 本机显示当前阶段，主题/历史保持可操作，排空已派发调用后释放租约，保留完成的材料，不执行后续动作。
