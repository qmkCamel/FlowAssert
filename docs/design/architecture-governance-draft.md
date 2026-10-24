# 工作台架构治理草稿

2026-10-01 第四轮实施：[ADR 0014](../decisions/0014-worker-and-builtin-reference-governance.md)补齐剩余 Worker 实际退出与内置 suite/baseline/Agent/pin/child 引用发布、退休和失败重试。旧记录保守适配保留，不批量改写；以下早期评估不是最新待办清单。生产性能预算与完整多引擎协议仍独立推进，真机按用户要求暂缓。

2026-09-29 后续实施：[插件友好模块架构](../plugin-friendly-runtime.md)和 [ADR 0011](../decisions/0011-plugin-friendly-application-runtime.md)落地了共享组装、关闭链、领域类型、引用兼容适配和分诊扩展点。本草稿保留原评估；G2 历史消费者全部迁移、G3 完整多引擎协议和 G4 查询基准仍不是本轮完成项。

状态：**Draft / 待评审**。记录日期：2026-09-26。评估基线：已提交的 `dev@REDACTED_REVISION`。本文记录后续治理方向与可执行的验收切口，不代表功能已实现、ADR 已接受或 OpenSpec 任务已完成。行为要求以 `openspec/specs/` 和活动 change 为准；修改设备、宿主或持久化边界时，再更新相应 ADR。

2026-09-29 第二轮实施：[ADR 0012](../decisions/0012-evidence-consumer-and-executor-boundaries.md)迁移了新 comparison/share 的引用发布与退休，加固执行消息版本/时序，并完成 100/1,000/10,000 条轻量记录的查询基准。G2 其余生产者、G3 完整多引擎和 G4 大媒体/生产预算仍未完成；下文为历史评估，不应将其旧代码描述当作当前状态。

## 目标与现状

2026-09-29 第三轮实施：[ADR 0013](../decisions/0013-comparison-lifecycle-and-graph-boundaries.md)补 comparison 关闭与退出确认，落实递归 src 依赖图、传递越界和运行时环检查。其他 Worker 异常终止边界单列在[生命周期审计](../runtime-lifecycle-validation.md)，没有将局部修复算作全局完成。

保持本机模块化单体：`MirrorService` 统一设备会话、控制与租约；Appium 提供语义操作，连续媒体走本机 Viewer 路径，DSH/MCP 传递离散控制和状态。原始执行结果、证据当前可用性和对外可信投影分别记录。优先降低新增一种运行入口或证据消费者时，需要同时修改 Viewer、执行器和清理器的次数。

当前已有的拆分应直接复用：`viewer-workbench-*-http.ts` 承接五类 HTTP 路由，`workbench-native-execution.ts`、`workbench-run-hooks.ts`、`workbench-step-evidence.ts`、`workbench-run-finalization.ts` 分担执行阶段；Viewer 的历史/结果/分享/清理/趋势等状态已有独立模块；`WorkbenchStore` 已有单进程 owner、mutation gate、读租约和容量准入。`src/workbench-contracts.ts` 是结果与来源契约的真相源。详见[当前架构](mobile-test-workbench-current.md)、[ADR 0010](../decisions/0010-workbench-product-contract-boundary.md)和[离线工程状态](../workbench-offline-engineering-status.md)。

仍值得治理的接缝（均为待验证的维护风险，不宣称现有实现有数据损坏）：

| 接缝 | 当前证据 | 目标边界 |
| --- | --- | --- |
| 服务组装 | `LocalDeviceRuntime` 组装共享服务；`ViewerServer` 仍可单独构造 `MirrorService`，并惰性构造 Workbench、suite、comparison、share 和 retention | 由单一应用运行时声明实例所有权及关闭顺序；HTTP/MCP/DSH/CLI 只调用已注入的应用服务。保留独立 Viewer 的显式组装入口 |
| 证据引用 | `WorkbenchReferences` 已存在，但 `WorkbenchRetention.#references()` 仍读取 suite、comparison、share、baseline、Agent journal 等各自格式 | 消费者在统一接口发布/退休引用；清理读取统一的有效引用快照。迁移期间保留旧记录扫描与 fail-closed 行为 |
| 领域类型 | `TestRun`、`RunStep`、`Verdict` 定义在 `workbench-store.ts`，多个领域模块从存储模块导入类型 | 领域类型与版本化产品契约独立于文件存储；store 只负责读写、原子提交、恢复和兼容投影 |
| 执行引擎 | 原生 worker 阶段已抽出，但 `WorkbenchService`、`WorkbenchDevice` 和 `workbench-plan.ts` 仍直接理解 AppClaw parser/selector 与执行事件 | 在既有抽取上定义窄的执行事件/选择器适配接口；AppClaw 特殊回退防护留在适配层，所有设备写入仍经过当前 facade 与 `MirrorService` |
| 查询负载 | `status()` 可返回轻量状态，`get()` 会逐项复验已完成运行的证据；历史列表与详情共享部分读取路径 | 明确摘要、详情、完整性复验三种读取成本与可信度；有测量数据后再决定索引/缓存方案 |

## 拟议工作包与顺序

1. **G0：冻结现有契约。** 以当前 HTTP、CLI、MCP、DSH、套件、v1/v2 归档和结果投影的 golden fixtures 建立可比较基线。扩展依赖方向检查至完整模块图，防止入口/存储反向进入领域层。保留 `pass`、`recovered`、`flaky`、`inconclusive`、`evidence unavailable` 的现有 CI 语义。
2. **G1：收敛服务组装。** 从 `ViewerServer` 提取业务对象创建和关闭顺序，在 `LocalDeviceRuntime` 或单独 composition root 中显式注入服务。先覆盖独立 Viewer 和已有宿主，再删除重复构造路径；对连接、关闭、取消、attached/owned 会话做回归。
3. **G2：统一证据引用。** 定义消费方、目标 run/evidence、有效期或退休条件及 owner generation。baseline、suite、comparison、share、pin、child run 和 Agent journal 逐个迁入；旧记录继续由保守扫描保护。新引用与消费者记录须在同一 mutation gate 中提交或在失败时维持保护。读租约覆盖长读取；未知消费者、损坏索引与冲突一律阻止删除。
4. **G3：整理领域模型与执行适配。** 先移动类型与转换函数，再给 AppClaw worker 消息加版本化校验，最后收窄 `WorkbenchService` 对 parser/selector 的直接依赖。每一步都保持原 YAML、固定 AppClaw 版本、独占设备租约和“不确定写入不自动重放”的行为。
5. **G4：按实测优化查询。** 分别测历史列表、状态查询、详情和全量证据复验，在 100、1,000、10,000 条摘要及损坏/已清理材料上记录耗时与内存。仅当预算不达标时引入可重建读索引；原始 manifest、journal 与证据 hash 仍是事实来源。

G0 先固定契约；G1 与 G2 可按独立文件并行推进，G3 以稳定的设备/执行事件契约为前提。G4 可以在固定数据集上并行测量，优化动作由测量结果决定。上述编号用于评审，不替代现有 OpenSpec 编号或完成状态。

## 验收与回滚边界

- 同一候选包验证独立 Viewer、CLI、MCP、DSH Native/PTC 的运行、取消、退出和结果投影；真机/宿主结果按各自验收记录分开标注。
- 在旧记录、导入/派生、缺证据、失败清理、并发读、跨进程 owner、SIGKILL 与 ENOSPC 样本上，治理前后保持相同或更保守的结果与保护行为。不得通过放宽证据校验让测试变绿。
- 清理预览与执行分别复核引用；证明新增消费者、损坏或未知引用不会进入 trash/purge。历史 Agent requestId 与 suite attempt 摘要在媒体删除后仍可解释，重试不会重复设备动作。
- 每个工作包可独立回退代码，但不能让新格式覆盖旧读取器无法识别的文件；改变持久格式前提供兼容 fixtures 和对应 ADR。
- 每个后续实现变更跑项目要求的 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`；Viewer 改动留运行截图。没有设备或外部试点材料时，只报告软件门禁，不勾选真机/采用任务。

## 与现有计划的关系

先消费活动变更里已存在的任务：[阶段三 R0/R4/R6 与 13.x](../../openspec/changes/add-workbench-long-term-operations/tasks.md)、[阶段二 R1/R2 与 7.x](../../openspec/changes/add-workbench-authoring-and-visual-validation/tasks.md)、[阶段一 A4](../../openspec/changes/harden-workbench-adoption/tasks.md)。其中已勾选的模块抽取、容量准入、tombstone 和软件测试不重新立项。G1/G3 如在评审后形成新的行为边界，再用 OpenSpec 更新对应活动 change，并在落实时更新 ADR；本草稿只提供治理切口和排序。

当前没有证据支持立即引入微服务、共享设备 daemon、通用调度平台或替换整个存储引擎。继续保持一台设备一次独占执行；如规模和查询数据证实需要扩展，再提交独立选型。
