## Context

动机及基线见 [proposal.md](proposal.md)。`workbench-plan.ts` 已提供有界组合/源路径，`workbench-readiness.ts` 提供精确目标及轮询，`workbench-step-evidence.ts` 从 checkpoint XML 独立校验，`workbench-run-finalization.ts` 与 `workbench-contracts.ts` 负责终态及共享投影。可信扩展已支持 prepare/verify/cleanup，但 verify 主要在 UI 结束后执行。

实现必须基于最新 dev 核对这些边界；当前主工作区较旧且包含他人变更，本方案不更新 checkout 或覆盖旧 change。

## Goals / Non-Goals

**Goals:** 可复现的时间判定；重启前后显式验证；只读业务查询复用；有界设备/存储开销；在 Viewer、CLI 和 Agent 上保持一致事实。

**Non-Goals:** 连续视频真值、时序逻辑语言、任意 JS predicate、设备重启/重装、隐式副作用重试、自动学习预期、通用数据库插件。Mock 通过不代表真实 App 持久性或幂等性已验证。

## Decisions

### 1. 新语法与既有断言隔离

规划语法（尚未实现）：

```yaml
- assertEventually:
    predicate: { assert: { target: { id: order-status }, properties: { value: saved } } }
    withinMs: 10000
    pollMs: 500
    maxSampleGapMs: 2000
- assertStable:
    predicate: { assertVisible: { id: order-success } }
    durationMs: 3000
    pollMs: 500
    maxSampleGapMs: 1500
- restartApp: { timeoutMs: 15000 }
- assertEventually:
    predicate: { assert: { target: { id: order-status }, properties: { value: saved } } }
    withinMs: 10000
    pollMs: 500
    maxSampleGapMs: 2000
- assertBusiness:
    ref: orderByTestKey
    mode: eventually
    args: { testKey: "{{ params.testKey }}", expectedCount: 1 }
    withinMs: 10000
    pollMs: 1000
    maxSampleGapMs: 3000
```

predicate 白名单为既有 `assert/assertVisible/assertNotVisible/assertCount` 及 `assertReady` 的纯判定部分；后者不得嵌套 timeout。元素属性沿用当前已支持集合，不新增通用表达式。所有新字段严格解析，原 `waitUntil`/`assertReady` 不改语义。选择显式新节点而非修改既有重试行为，避免历史用例含义改变。

### 2. 一个有界采样引擎，两种时间语义

新增独立 temporal evaluator，输入结构化 predicate、受控 observe、单调 clock、signal、证据 sink。WorkbenchService 只编排，设备读取仍走现有 WorkbenchDevice/MirrorService 归属；不直接连接 ADB/Appium，不改 Worker v1 既有消息含义。

- `assertEventually`：执行入口开始预算；一次有效 true 且读取完成时间 <= deadline 即满足。有效 false 可继续；读取错误、歧义、父范围缺失、截断、会话漂移立即不确定。到期无 true，只有观测覆盖达标且截止附近末样本仍 false 才 fail，否则 inconclusive。
- `assertStable`：首样本也必须 true；首个有效样本开始 duration，执行入口起另有总截止。任一有效 false 立即 fail，不重置计时。首末覆盖 duration、至少两个样本、相邻读取完成间隔及单次采集宽度 <= maxSampleGapMs，才 pass。末样本必须在 duration 到达后且不超允许 gap。
- 两者采用采样事实而非连续证明；PNG/XML 顺序采集的时间跨度必须记录。禁止复用过期缓存来填补缺样。对 negative/count 的缺失证明依赖完整、范围正确的树。
- 使用注入单调时钟；墙钟仅用于展示。各调用均受剩余预算约束，迟到回调丢弃；不并行重叠读取。

初始限制：window 100–60000 ms；poll 100–5000 ms；gap >= poll 且 <=10000 ms；单断言 <=256 个样本、全 run <=1024；stable 总预算为 duration + 2×gap（首读与末读余量），且受 run 剩余预算约束。编译/准入时拒绝超过最坏样本预算的配置，不自动降采样。固定 sleep 会放过短暂失败，无限 retry 会隐藏缺陷，均不采用。

### 3. 样本与终态证据

采样材料作为原步骤下的版本化附件，不制造几百个 UI 步骤。每个样本保留完整性可核查的 XML/结构事实、来源步骤及身份、相对开始/结束时间、predicate digest 与结果；起点、首次匹配/反例、终点保留 PNG，原步骤 terminal PNG/XML 要求不变。校验器重新计算样本 predicate 和时间窗口，不能只相信样本 `passed` 字段。采样中间未保留 PNG 时不得宣称视觉连续正确。

每样本材料 <=1 MiB、单断言 <=16 MiB、全 run temporal 材料 <=64 MiB；沿用更严格的现有输入限制。开始前与每次提交前执行 256 MiB 余量/未知容量拒绝；达到预算标记不确定，不静默丢弃样本。附件纳入 reference registry、read lease、分享脱敏、保留治理、哈希校验。历史原 verdict 与当前证据可信度分离。

时间 UI 结果归入 ui，步骤业务结果归入 business；使用新特征的 run 写共同契约 v2、requiredFeatures 和 temporal evidence schemaVersion。v2 同时预留 health/performance 分项，未声明者 required=false/status=not-performed，不增加本方案的健康验证范围。详见同级 [health/performance 设计](../add-workbench-health-performance-gates/design.md) 第 5 节：该共享 schema 基础子任务只实现一次、可独立先行，不依赖任何 collector 或设备验收完成。旧 reader 必须对 v2/未知特征 fail closed，不能在 v1 里悄悄加字段。没有新特征的旧流程仍可输出原 v1。

### 4. 重启与持久性不混为一个布尔值

`restartApp` 不接受任意 appId，只取固化 header appId，并受现有 App 管理策略及授权约束。执行顺序为授权/能力/剩余预算检查 → 终止 → 确认已停止 → 启动 → 确认目标运行；终止/启动均经过同一设备锁和 mutation fence。每次变更使旧 observation 失效，不删除数据，不关闭外部 Appium，不重新 prepare。

重启有单独 operation ID 与前后状态；任何 may-have-mutated timeout 均停止后续操作。健康 change 可识别同一 operation ID 下正常显式终止，但不能把其他崩溃事件吞掉。预期必须来自固定数据或 prepare 的公开输出，而不是重启前任意读到什么就以什么为正确。

### 5. 业务查询与幂等性模板

扩展登记增加 opt-in `observation: { readOnly: true, repeatable: true }`；仍是可信本机模块，声明不是 OS 沙箱，必须审查模块没有写操作。模块/依赖/输入摘要固化。`assertBusiness` 的 mode 为 once（默认）或显式 eventually：once 在 withinMs 内只执行一次，拒绝 poll/gap 参数，合法不匹配立即失败；eventually 才接受 poll/gap 且仅对合法明确 mismatch 轮询。每次单独有界执行并回收，异常或不确定输出终止。现有 expected/actual/source/artifactRefs 输出保留，增加对查询范围/关联键的模板约束。

step verifier 不给后续 UI 注入新的动态指令；允许 params 与 prepare outputs，只读校验结果不作为任意代码输入。单次 <=10 s 且受剩余预算约束，单步骤总计 <=60 s，输出沿用 256 KiB 限制。轮询样本覆盖及迟到规则与 eventually 一致。所有步骤 verifier 与 header verifier 合取；若稳定唯一性需要多次读，模板必须检查整个声明的有界观察窗口，而非首个 count=1 就宣称永不重复。

提供两个已登记示例；第二个模板的 `orderUniqueOverWindow` 为经过审查的只读 verifier，以 mode=once 调用，在其有界执行内记录整个业务观察窗口的样本和首次反例，输出 samples/evidence；不能仅轮询到首个 count=1 就通过，也不能在稳定窗口失败后由外层 eventually 重新计时。登记时为该 verifier 限定 allowedModes=[once]。窗口 <=8 s、调用总预算 <=10 s，最少两个样本、最大间隔与缺样规则明确；更长后台一致性周期不属于首期模板支持范围，不缩短周期冒充通过。

示例流程：

1. 固定写入数据 → UI/业务确认 → 显式 restartApp → UI/业务再次确认 → cleanup。
2. prepare 隔离资源与同一业务键 → 明确第一次提交 → 明确第二次同键提交（最多两次）→ 查询该键的 count/amount/owner 等事实 → cleanup。不支持可关联业务键的第三方 App 不使用此模板。业务延迟窗口必须由该 App 的一致性契约约束；只证明观察期限内的唯一性。

两次写操作是用例原步骤，不是调度器 retry，安全条件和同意在运行前展示。suite retries 保持原 reset/retrySafe 与 flaky 规则，不通过跨 attempt 的清理重置来伪造唯一性。

### 6. 交付分工及交互

先冻结 predicate/sampling/evidence/版本 schema；随后 temporal engine、restart+业务模板、离线测试可并行开发；最后统一整合编译器、终态、Viewer/Agent/报告。与 health/performance 的共享文件整合一次串行完成，不能各自建立第二套结果投影。

UI 只引用全局 `user-action-contract`，本项目新增差异为“等待成立/稳定窗口/重启/业务查询”阶段、样本数/覆盖、取消中状态和最后领域完成时间。E2E 须在检查未结束时实际操作历史/主题，并验证失败保留旧结果。MCP/DSH 不增加独立采样工具，仅扩展已登记流程结果的有界摘要。

## Risks / Trade-offs

- [采样错过两次读取之间的闪烁] → 显示采样边界和最大实际间隔，不承诺连续正确。
- [同一测试键在后台最终一致且迟到写入] → 模板注明业务一致性窗口、覆盖期限与读源；无限期唯一性不在承诺内。
- [频繁 XML 读取扰动被测 App] → 最坏样本预算、实际间隔证据，平台探针校准后才能推荐参数。
- [可信 verifier 声明只读但实际写入] → 人工代码审查和受控接口测试；不宣传沙箱保证。
- [重启破坏当前用户状态] → 显式用例、仅授权 App、不清数据、UI 提示；未知动作结果不续跑。

## Migration Plan

1. 在最新 dev 上确认 active changes 与用户改动，冻结兼容性 fixtures 和新语法；不迁移历史 verdict。
2. 离线完成编译/evaluator/业务/生命周期故障注入与全出口测试；新功能默认不出现在旧流程中。
3. 验证 Mock 与打包产物，执行四项工程门禁；分别补 Android/iOS Fixture 真机正反例及受控业务接口证据。
4. 只有通过的平台组合开放文档推荐。回滚禁用新语法执行，但新记录仍只读可识别，不删除字段伪装 v1。工程完成和真机/业务验收分别记账，所有任务核对后再归档。

## Open Questions

- 平台默认 poll/gap 的推荐值由采集开销探针校准；不改变用户显式声明及上限，不能为通过样本而放宽已批准用例。
- 第一组真实业务模板的授权 App/测试环境待提供；缺少它们不阻塞离线实现，但阻塞相应真实业务验收。
