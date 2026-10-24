## Context

基线及动机见 [proposal.md](proposal.md)。当前 product contract v1 固定 ui/business/visual/cleanup/evidence，`runResultProjection` 是所有出口应复用的判定入口。已有动作耗时和趋势不等于成功端点门禁；MirrorService 保持唯一设备/会话/变更所有者，Worker v1 不应变成第二个采集或设备管理宿主。

## Goals / Non-Goals

**Goals:** 每信号明确可用性；无采集不通过；可复验健康窗口；单次关键路径时限；版本安全及可取消的资源生命周期。

**Non-Goals:** 一次性承诺 Android/iOS 全信号支持、生产 APM/SLO、FPS/CPU/内存、电量/网络性能分析、root/系统设置修改、自动启用 App 埋点、外部日志云服务、LLM 崩溃判断。

## Decisions

### 1. 显式声明而非给旧用例自动加门禁

拟定语法（尚未实现，放在现有 header/steps 对应位置）：

```yaml
# header 增量
runtimeGates:
  health:
    signals: [crash, anr]
    tailMs: 2000
---
# steps 中的一个片段
- measure:
    id: save-order
    maxElapsedMs: 5000
    steps:
      - tap: { id: save }
      - assertReady:
          target: { testId: order-success }
          state: visible
          timeoutMs: 4000
```

所有声明的 signal 和 measure 都是必需的，不提供 `required: false` 来隐藏坏结果。未声明者保持 not-performed。health signals 为按平台登记的枚举，首期 Android `crash/anr`；iOS `crash/hang` 只有各自探针通过才可用，`anr` 不作为 iOS 别名。

每 flow <=8 个 measure，ID 唯一、不嵌套，每块预算 100–60000 ms；展开后受既有 500 步和 run 总预算约束。循环中的每次调用使用源 ID + iteration 身份，所有实际实例均需通过；声明但完全跳过的块不确定。禁止任意用户 marker 开始/结束以免悬空和跨 attempt 配对。

### 2. 健康 collector 是 provider 内部的只读能力

抽象 capability/probe/start/stop-drain，形成版本化 source descriptor 与 capability reason。对象由现有 runtime/service 生命周期拥有，每个 active run/矩阵 slot 只绑定自己的 session/App；不能直接从 Viewer、Cordis 或 MCP 运行日志命令。具体接线修改 `types.ts`、`providers/appium-provider.ts` 与服务适配边界，添加相应 ADR；新模块承担解析/窗口归因，不能继续堆进 WorkbenchService。

Android 候选是授权 adb 的只读事件/崩溃来源加 App/进程事实；具体 OS/provider 是否提供可归因、可证明完整窗口的来源，必须先做 capability probe。不得把“logcat 进程没退出”当作无丢失证明。iOS 候选为已授权诊断来源；若没有可证明实时边界与迟到处理的能力，只提供诊断提示并返回 unsupported，不为了对称支持而解析人类文本冒充权威信号。

探针检查的硬条件：App/进程身份；窗口前后边界；可检测丢失/重置；来源格式/版本；事件时间映射及迟到界限；关闭排空行为。只实现 parser 或从缓存导入日志不足以声明支持。任何候选无法满足条件时保留 seam+unsupported，此组合的真实健康放行任务保持未完成。不以 root、自动安装 agent 或修改 App 换取通过。

选择 capability-gated 接入而非直接收所有日志，原因是“没发现”与“没能力发现”必须区分，且双平台来源不对称。

### 3. 窗口、身份与判定

顺序：固化配置/能力检查/容量准入 → collector ready boundary → prepare → UI/measure → verify → tail → collector close/drain → cleanup → 最终投影。清理永远执行其既有独立预算，collector 不可无限拖延；准备失败也终止采集并清理。健康只承诺窗口内的被测 App，不声称观察 cleanup 之后。

窗口包含 prepare 至 verify 和 tail，报告标出实际 start/end、source cursor/世代、主机单调时间范围及覆盖 gaps。tail 默认 2000 ms，范围 0–10000 ms；只控制额外观察时间，不代替来源的排空证明。ready/close 各 <=5000 ms，所需预算在任何写入前预留；健康监测窗口 <=现有 run deadline，且绝对上限 10 分钟。

`stopAndDrain` 必须证明已接收到声明边界内应有事件；来源若只能“等几秒也许够了”，不开放 clean health pass。host/device 墙钟不直接相减；无法确定事件是否落在窗口时记录 attribution-uncertain。

记录绑定 run/attempt/sessionGeneration/App/进程世代/设备槽位；PID 可变化且可能复用，不能只靠 PID；跨 App/旧事件排除，疑似属于目标但无法归因则不确定。显式 terminate 的 operation ID 只解释正常退出，不屏蔽真正 crash/anr/hang。没有事件却进程消失为 unexpected-exit 的诊断事实，不凭猜测写 crash。

判定：存在已验证归因违规 → health fail；否则能力/覆盖/排空/材料任一不完整 → inconclusive；全部完整且无违规 → pass。已确认违规与采集故障并存时保留 fail 和 coverage-gap 两个原因；顶层证据不可用仍按共享完整性规则降可信度。

### 4. 性能是用户流程的端到端时限

`measure` 独立 evaluator 使用注入 monotonic clock，在块内第一步派发前计时，直到所有块内步骤、至少一个实际执行成功断言及其必要证据完成。包括该块自动化往返、poll、截图/XML/证据开销；排除外部排队、块外 prepare/verify/cleanup、health tail。块内 `assertBusiness` 就作为端点的一部分；没有它时只能称 UI 响应路径，不能声称后台已完成。

elapsed <= budget 且全部端点有效才 pass；确定功能失败使相应功能维度 fail，性能为 inconclusive/endpoint-not-reached。完整计时链耗尽业务声明 budget 为 performance fail；provider I/O/观测/证据故障为 inconclusive，不把基础设施故障标为 App 慢。等于阈值算通过，但实际完成和证据提交都必须在期限内，不能以较早 UI callback 冻结绿灯。

块 deadline 与 run deadline 取最小；超时取消当前操作，禁止下一动作，保留 may-have-mutated 防护，不重试。新增 `performance-deadline` 必须在最终聚合中与用户 cancel/run 中断区分，不能被现有 abort 分支一律吞成取消或不确定。不把墙钟恢复后的时差当作 elapsed。

不使用历史最快一次/均值/p95 作为单 run 门禁，矩阵中每设备与每 attempt 保留各自输入环境和阈值。主机噪声是端到端指标的限制，报告命名为 `automation-observed-e2e`，不是原生 App 性能。

### 5. 两个 change 共用契约 v2 基础，不共建两套投影

本 change 与 temporal change 共享一次 v2 schema 基础提交；可先独立完成，不等待任何真实设备。v2 保留五个既有分项，新增 health/performance（未配置时 required=false/status=not-performed），以及 `requiredFeatures` 与各证据 schemaVersion；未知特征拒绝可信读取。temporal 的结果仍归 ui/business，但必须通过 requiredFeatures 声明样本/重启/业务端点验证要求。两侧不得分别占用 v2 表达不同 schema。

读端同时支持 legacy/v1/v2：旧记录按原版本解释，仅展示新门禁 not-performed；不得把旧 UI-only pass 满足新验收的 health/performance 必需条件。写端：无新特征仍可输出 v1 以保持冻结接口；使用新特征输出 v2。旧读端把 v2 识别为 unsupported，不能剥字段降级。若旧入口禁止新版本结构，使用已有版本协商/显式新版本入口返回，不改变冻结 v1 golden。

实现期同时更新 run/product/projection、step attachments、share/export/import、change acceptance requiredDimensions、suite/matrix/trends 和 JUnit。分享 envelope 与验收对象自身的严格 schema 需独立版本升级，不能只改 product version；新增维度移除或 required 降级不可让后续验收修订变绿。导入、派生、shared 仍不重新验证。

顶层保持既有取消/冲突/证据不可信规则；完整可信下任何确定必需门禁 fail → 非干净失败；无确定失败但任一 required 不完整 → inconclusive；只有全部完整成功才可能 pass，recovered/flaky 仍非干净。各分项失败都保留，不因顶层优先级丢掉事实。退出码沿用 0/1/2/130；JUnit 对确定违规为 failure、不确定为 error、取消保持已有取消表示。以 golden truth table 锁定全部出口，不靠各 UI 再推导一次。

### 6. 有界资源、隐私与交互

每 collector 最多一个自有子进程、固定 argv 且无 shell；跨槽位不共享 mutable collector，不争抢设备变更队列。事件解析在有界 worker/子进程；每 run <=10000 个归一化事件、原始输入 <=16 MiB、公开归一化 <=2 MiB、排队 <=256 事件。超限或反压丢失即 coverage incomplete；不静默截断后健康通过。进程不退出不得释放槽位；宿主重启以持久 journal 标记中断，不自动重建窗口。

沿用 256 MiB 空闲余量及未知容量拒绝。原始日志独立私有目录、最小权限、默认不进分享/JUnit/tool；普通报告只显示信号类型、相对时间、原因、受控 App 标签和证据引用，不暴露设备 ID/PID/主机路径/凭据。主动过滤其他 App 数据，明确无法保证任意日志天然无敏感信息。journal/证据纳入已有 reference registry 和 retention，失败保留已完整提交材料。

UI 行为引用全局 `user-action-contract`；项目新增阶段为 health preparing/observing/draining、measure running/deadline、cancel draining。健康排空结束前不显示最终绿灯。E2E 延迟 >=800 ms 时查看历史/切换主题，检查取消、旧数据保留、完成刷新与领域时间；保留并人工检查截图。

### 7. 开发依赖与分阶段放行

| 阶段 | 内容 | 依赖与并行关系 | 完成证据 |
|---|---|---|---|
| H0 | v2 契约、能力接口、判定表、ADR | 与 temporal 共同冻结；只做一次 | schema/golden/未知版本测试 |
| H1a | measure 与 deadline | H0；可与 H1b 并行 | fake clock/Mock/故障注入 |
| H1b | collector 框架与 Android/iOS 只读来源探针 | H0；不依赖 temporal engine | mock collector/来源能力报告 |
| H2 | 结果消费者、隐私/资源治理、Viewer | H1a/H1b 的稳定 schema；共享文件串行整合 | 全出口/打包/E2E 四项门禁 |
| H3 | 受控崩溃/ANR及正常场景、真实时限正反例 | 相应设备/授权 Fixture；业务端点依赖 temporal 的 assertBusiness | 按平台逐项放行，不泛化 |

平台来源探针阻塞不阻塞 H1a、v2、Mock、UI 和文档。允许交付明确标注的 performance-only 工程版本，但整个 change 不能因此标记真实健康验收完成。

## Risks / Trade-offs

- [平台日志不能证明完整覆盖] → 默认 unsupported/inconclusive；探针是能力放行门，不绕过它。
- [ANR/hang 来源和延迟不一致] → 分信号 capability 和来源版本范围，禁止双平台同义映射。
- [采集/证据扰动测量] → 指标明确含自动化开销；最小收集、隔离处理，不宣称原生性能。
- [新维度被旧导出或验收吞掉] → 显式版本、requiredFeatures、全出口 golden；禁止默默降级。
- [隐私日志泄漏] → 私有原始材料、最小归一化摘要与导出 allowlist，真实样本需授权并审查。

## Migration Plan

1. 从最新 dev 整合；先统一 v2 和 ADR，再并行实现核心模块。不改历史 manifest。
2. Fake/Mock 做完整矩阵，再验证打包 runtime 与所有出口；源探针可单独运行但不自动修改设备设置。
3. Android/iOS 分别用授权 Fixture 验证正常、崩溃、权限丢失、进程重启、掉线和迟到；不支持的信号保留禁用，相关放行任务不勾选。
4. 回滚仅停止接收新特征，保留 v2 只读支持和私有证据，不把新数据改成 v1。所有任务及具体阻塞核对后再归档。

## Open Questions

- 哪些 OS/driver/source 组合能够满足完整性条件，由只读探针给出名单；方案不预先假设某个命令即可做到。
- 真实业务端点的时限由用例负责人批准；默认不根据本次运行结果自动校准阈值。
