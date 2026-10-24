## Purpose

提供可解释的本机回归统计，固定计划执行和尝试的身份、环境与时间窗，报告完整覆盖范围及证据可用性，并通过明确的样本门槛和版本化预算提示耗时变化。

## ADDED Requirements

### Requirement: Rebuildable bounded local trends
系统 SHALL 从归档构建可重建、版本化的本机摘要索引，按用例/输入/证据策略及已知环境分组；索引不是事实来源。单任务 SHALL 有条目/并发/字节预算，默认最多 10,000 摘要，超限说明覆盖范围并要求缩小时间窗，不默默输出完整结论。

#### Scenario: Corrupt index
- **WHEN** 索引损坏或 schema 变化
- **THEN** 从原件有界重建，不重写原 verdict；重建时旧可用结果保留且无关 UI 可操作

### Requirement: Honest denominators and lineage
统计 SHALL 以计划用例执行为主分母、attempt 为子项，分别显示首次通过、失败、recovered、flaky、基础设施/不确定、取消、未执行；分类多标签不能当互斥总数相加。导入/派生及无法恢复计划身份的损坏套件默认不进入本地通过率，但显示数量及排除原因；计划身份仍可信但 attempt 材料损坏的项必须留在分母并记 inconclusive。

#### Scenario: Retry and imported copy
- **WHEN** 同一用例两次 attempt 后通过，且另有其导入副本
- **THEN** 本地统计为一条 flaky 执行并保留两次尝试，不因导入增加成功执行次数

#### Scenario: Unknown environment
- **WHEN** 一组记录缺失 App build 或必要环境
- **THEN** 显示 unknown 组，不与已知环境合并作严格回归结论

### Requirement: Evidence-backed performance signals
统计变化提示 SHALL 要求同口径两窗口各至少 30 个有效样本和明确版本化预算；不足样本只展示事实。失败/取消/恢复路径耗时单列。聚合必须可回钻运行与证据，原件已删除时显示不可用，不推断根因或修改 verdict。

#### Scenario: Small noisy sample
- **WHEN** 两次运行耗时差异很大但未达到样本门槛
- **THEN** 展示原值与样本不足，不称统计性能回归

### Requirement: Versioned outcome and denominator rules
完成计划执行 SHALL 按 suiteRunId/plannedCaseId 唯一计数，有序 attempt 去重；未完成套件单列 active/pending，不进入完成窗口通过率。完成项 SHALL 按 not-executed、材料/契约不完整的 inconclusive、终次 recovered、一次 clean pass 的 first-pass、多次后 clean pass 的 flaky、其余 fail/cancelled/inconclusive 规则分类。首次通过率 MUST 为 first-pass/planned，最终干净通过率为 (first-pass+flaky)/planned，recovered 不进入通过分子。导入/派生/无计划运行及损坏套件分别统计并说明，所有覆盖计数使用相同时间窗。

#### Scenario: Retry includes a recovery
- **WHEN** 一次计划执行的终次 attempt 为 recovered，之前有失败
- **THEN** SHALL 计一条 recovered 而非 flaky 或多次执行，并保留所有 attempt 及失败原因

#### Scenario: Imported records outside the query window
- **WHEN** 本机另有不在查询时间窗内的 imported 或 unplanned 记录
- **THEN** 它们 MUST NOT 混入当前窗口覆盖计数，界面明确各类归属时间字段

### Requirement: Explicit comparable windows and performance budgets
双窗口 SHALL 使用 UTC 非空、不重叠的半开区间，计划执行按启动时间归属。比较必须固定 case/plan/input/证据策略与已知环境，跨构建需显式选择 A/B 维度并固定其余条件。两窗口各至少 30 个完整可比 first-pass 样本且有同一版本预算后，才 SHALL 用中位耗时发出预算提示。绝对差和相对差都严格超阈值才提示变慢；等于阈值不触发。零基线相对比例不可用，当前值为正且绝对差严格超限时可提示并明确零基线规则。无预算、样本不足和不可比不得默认为 within-budget。提示 MUST NOT 声称统计显著性、根因或改写 run verdict。

#### Scenario: Sample count crosses threshold
- **WHEN** 任一窗口仅有 29 个有效样本，或两者均达到 30 个
- **THEN** 前者 SHALL 返回 insufficient-samples，后者仅在预算与可比性也通过后计算预算状态；排除样本及原因可回钻

#### Scenario: Equal threshold or zero baseline
- **WHEN** 变化恰等于阈值，或上一窗口中位数为零
- **THEN** 相等情况 SHALL 不触发超限；零基线按明确绝对差规则处理，不输出 Infinity/NaN 或伪造相对比例

#### Scenario: Invalid windows or incompatible environments
- **WHEN** 区间重叠/为空、关键环境 unknown，或未声明构建比较维度
- **THEN** 系统 SHALL 明确拒绝区间或报告 not-comparable，不输出性能通过/回归结论

### Requirement: Stable generations and historical evidence availability
索引查询及分页 SHALL 绑定同一 generation，重建失败/取消保留旧完整结果。重建不得静默截断超预算数据。有效清理 tombstone 中保留的已校验终态摘要 SHALL 可作为历史报告事实，显示 trashed/purged 与无法即时复验；没有合法 tombstone 的材料缺失/损坏须标缺口，旧缓存不能充当事实证明。

#### Scenario: Rebuild occurs between pages
- **WHEN** 用户翻页期间新索引 generation 发布
- **THEN** 旧游标 SHALL 继续原代或明确 stale，不能混合两代数据或改变分母而不说明

#### Scenario: Intentional purge versus unexplained loss
- **WHEN** 一份材料有合法 purge tombstone，另一份材料无故丢失
- **THEN** 前者 SHALL 保留可审计历史摘要并标证据已清理；后者显示缺口/无法确认，不把两者都默认为成功或从分母消失

#### Scenario: Rebuild exceeds coverage budget
- **WHEN** 所选窗口超过 10,000 摘要或目录发现达到独立扫描预算
- **THEN** 系统 SHALL 报告未完成覆盖和可采取措施，上一成功 generation 保持可用，不发布貌似完整的新统计
