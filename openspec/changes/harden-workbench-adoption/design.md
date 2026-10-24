## Context

基线：2026-09-24，dev@REDACTED_REVISION。已有 WorkbenchService/Suites、TestRunCoordinator、设备 claim、阶段计时、Fixture 真值验证和持久证据；不是从零实现测试引擎。当前 CLI 只 attach 已运行 Viewer，RunComparisonIdentity 中 App version/build 可 unknown，发布资产与源码能力需分别计证据。

本设计跨运行存储、生命周期、交付和兼容，必须先定公共契约。实施来源见 proposal；工作包 ID 和并行门禁见 [总览](../../../docs/roadmaps/workbench-productization.md)。

## Goals / Non-Goals

**Goals:** 支持范围内可独立安装、可无人值守执行、结论可信、异常可解释；给第二/三阶段提供可增量集成的契约。

**Non-Goals:** 更换 Appium/AppClaw、扩展宿主系统承诺、自动安装被测 App、云设备、任意代码沙箱、共享 daemon、自动修复签名/USB 授权、自动公开发布。

## Decisions

### C0：共享契约先行，不另造 Runner

由本阶段单一集成人维护类型/读写兼容 fixtures。沿用 runId、case/attempt、planDigest 和既有 verdict，增加独立 contractVersion；不将所有 manifest 强制迁移。其他阶段在自己的模块消费接口，通过小型集成 PR 接入 store/service。

| 契约 | 最小字段/语义 | 消费者 |
| --- | --- | --- |
| provenance | 字段值、source=observed/declared/unknown、捕获时间、摘要规则版本 | 比较、趋势、CI |
| verification | UI/business/visual/cleanup/evidence 的 required、status、evidenceRefs | 执行、报告、Agent |
| evidence lineage | 原件/派生件、私有来源关联、变换版本、hash、完整性及共享许可 | 视觉、导出、清理 |
| task status | taskId、kind、phase、progress、cancelRequested、started/completedAt、稳定 error code | 后台分析/导出/清理 |

verification 分项 status 为 not-performed/pass/fail/inconclusive，冲突/污染仍保留原顶层结论及诊断。不引入新的“总成功”字段替代 verdict。未知值与缺失值均不按成功处理，schema 用显式白名单；未知 contractVersion 拒绝写入/可信聚合，但允许安全元数据只读。

证据文件的 hash 只证明所见字节一致，不证明业务事实或脱敏完整。公开包不暴露低熵秘密的直接哈希，私有来源关联与公共随机分享 ID 分离。

替代方案：先做各功能后统一 schema 会产生历史迁移和口径冲突；一次全量重写存储风险过大。因此使用增量版本契约及 golden fixtures。

### A1：运行前冻结有来源的上下文

实现单一 provenance collector，在执行首个业务动作前记录平台、OS、驱动、Node/runtime、AppId/version/build、可获取的安装包摘要，以及可信配置声明的构建提交/后端环境别名/测试数据版本。无法可靠取得的字段为 unknown；声明值不可标 observed。凭据只用私有引用，环境摘要使用公开字段白名单，不采集完整 process.env、UDID 或主机绝对路径。

读取 App 元数据仍经已有 provider 的有界只读路径；对基础模式缺失信息发提示，不阻塞既有用例。用户启用 strict provenance 时，必需字段不足在设备写入前拒绝。版本 hash 不足以证明后台环境相同；报告同时显示数据 reset/prepare 契约版本。

运行身份不因新元数据变化而丢失历史关联；比较分别给出身份匹配与环境可比性。旧 unknown 不能被今天的设备信息回填。相比整机快照，此方案有界、可本地审计，且不假定可恢复完整系统环境。

### A2：attach 与 managed-job 的所有权

拟议 CLI：保留现有 test suite --url 路径；新增 test job <suiteId> --config <absolute-local-config> --report-dir <path>。路径仅本机 CLI 可信输入，Agent 工具仍只能传登记 ID。

managed-job 顺序：解析/校验配置和预算 → 只读预检 → 创建 loopback runtime → 获取显式设备 claim → 连接已安装 App → 受理已登记 suite → 等待/取消 → 保存报告 → 清理本次拥有的资源 → 持久 job summary → 退出。复用现有协调器、租约、worker 和 provider，不在 CLI 内执行第二套叶子动作。运行仍 session-retained，job 退出才执行资源清理；attach 退出不得停止外部 runtime。

SIGINT/SIGTERM/总超时停止新派发，发取消并等待在途操作收敛。拟议默认启动预算 120s、退出清理预算 60s，均通过本机配置在文档范围内调整并纳入身份记录；不得无界等待或强杀不属于本任务的进程。SIGKILL 无法保证取消，重启只报告 interrupted 和待处理 owner，不自动重放/接管。

退出码：0=全部干净通过且报告/退出清理完成，1=确定测试失败/recovered/flaky，2=启动/基础设施/报告/退出清理失败或结果未知，130=用户取消且完成有界收尾；取消后收尾失败优先 2。jobExitCode 单独记录，不改写已完成 suite 的原 verdict/exitCode。失败诊断保留原测试结论和所有错误，而非只留最终一项。

默认不需要浏览器进程；因此不能假定浏览器录像可用，不伪造无头视频。业务 verifier 仍须显式登记，job 不自动提升其授权。

### A3：可执行可靠性矩阵

以固定 case/环境/初态运行故障矩阵：USB/锁屏/方向变化、ADB/WDA/Appium 故障、PNG/XML 单侧失败、磁盘/manifest 故障、取消各阶段、宿主终止及重启。每项记录预期 verdict、未执行动作、已有材料、资源 owner 与可恢复步骤。

在支持设备双端分别跑至少 30 次固定基准，报告阶段分布、样本数、p50/p95、失败和排除原因；不混用不同 App/平台做速度排名。性能预算由样本确定后冻结，不能边跑边放宽预算。必需 PNG/XML 独立取证及时间窗语义不变。

旧 OnePlus ADB 问题留在原恢复 change；支持矩阵可明确不支持该组合，不能用替代设备 pass 勾掉原问题。故障注入测试不是制造真实用户数据丢失，使用隔离 runsDir 和 Fixture。

### A4：安装与试点双门槛

工程可用门槛：同一 tarball/SHA 在干净临时前缀完成 standalone/Mock、MCP、DSH 0.1.5-rc.2 Native/PTC smoke，升级/回退后旧归档仍可读；真机支持另列。生成版本能力清单时校验包内文档/示例可达，不复制旧验收结论为新版本证据。

采用门槛：5 名非开发参与者中至少 4 名在平台依赖已就绪后 15 分钟内完成首次测试并解释结果；完整依赖安装时间另计。至少 2 个自研应用覆盖 Android/iOS、共至少 20 条关键流程，受控代码/数据连续 7 天累积至少 100 次计划运行；首次非产品故障比例目标 <1%，展示全部计划、实际执行和未执行分母，不通过删除基础设施失败美化指标。至少 100 个故意失败样本观察到错误通过为 0；有限样本不意味着普遍零风险。

工程完成与采用完成分开：无外部项目/人员/签名时登记阻塞，允许候选构建但不能声称阶段采用完成。真实模型消费沿用原 active change，附件返回不替代模型理解；未验宿主能力必须明确限用。

## Risks / Trade-offs

- [元数据含秘密] → 公开字段白名单、私有凭据引用、分享投影单测。
- [取消无法撤回已派发设备操作] → 停止新派发、等待收敛、未知状态阻断下一任务，不承诺回滚。
- [资源回收误杀外部实例] → nonce/进程启动身份/owner 三者检查，attach 不转 ownership。
- [试点样本与性能指标失真] → 固定分母和环境，缺样本标 pending，不当作失败后可随意调整的目标。
- [并行修改共享 types/store] → C0 单一集成入口，跨包消费者契约测试。

## Migration Plan

先合并 C0 类型/兼容测试，再 A1；A2 与 A3 可并行，A4 从准备阶段即开展。关闭 managed-job 后仍可 attach；新字段的旧读取行为必须用固定版本 tarball验证。回退不删除归档/journal，不尝试把不认识的记录重写成旧版本。部署只生成候选包；tag/Release 需另行授权。变更 owner/lifecycle 边界时更新 ADR 0008 或新增对应 ADR，不修改历史验收快照。

## Open Questions

无阻塞方案创建的产品范围问题。实施前需要：外部试点 App/账号/业务接口、签名、验收设备可用时间与非开发试用者。由用户/项目方提供，未提供前保持采用任务未完成。具体性能预算须按 A3 测量后填写，不在规划阶段编造。
