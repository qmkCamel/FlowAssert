# ADR 0016：双路径修复与统一独立验证

状态：**Preview（部分实施，默认关闭）**。日期：2026-10-03；状态核对：2026-10-07，`dev@REDACTED_REVISION` 加本轮续验。原设计基线 `dev@REDACTED_REVISION`，修复实现已通过 `REDACTED_REVISION` 合入 dev；不再处于待集成工作树。M1/M2 软件链已接通，M3 构建与 Mock 安装协议部分接通，真机闭环未完成；iPhone 导航/host forwarding 12.6 补验完成后任务为 54/65。继续沿用 MirrorService 单设备边界和 Worker v1 协议；见[实施记录](../../openspec/changes/add-evidence-guided-repair-loop/implementation.md)及[Preview 使用与升级门槛](../evidence-guided-repair-operations.md)。

自动维护候选另需本地登记的唯一页面与允许目标语义、原后置断言和跨运行环境/构建兼容；缺少范围时仅保留采集与人工草稿，不得靠同文案推定导航安全。

2026-10-05 Android 真机补证发现：当前页面登记只接受 `application` 角色，但 UiAutomator2 的页面标题为 text、布局为 FrameLayout/LinearLayout，因此正确页面也保守拒绝。普通 tap 采集与安全拒绝已实测，不代表自动维护正例通过。当时 TODO（设计/实现已由下述 10 月 6 日决策接续，完整真机验收仍待补）：可信页面锚点及容器归属，同步登记/准入/派发检查；不移除 scope 或伪造 application 节点。详见 [Android 真机记录](../../openspec/changes/add-evidence-guided-repair-loop/android-physical-validation.md)。设备/provider 所有权边界保持不变。

## 决策

以下真机缺陷描述保留修复前历史；v2 页面、首次 recovery 检查、转发 guard 与错误分类已实现，新旧证据及 10 月 6 日 iPhone 离线记录以 [10-06 修复记录](../../openspec/changes/add-evidence-guided-repair-loop/safety-fixes-validation.md) 为准，不把历史失败表格当成当前代码验收。

2026-10-06 修复决策：页面登记采用 v2 精确锚点＋祖先层数／平台类型容器，采集、候选准入与派发统一校验；旧 application-only 登记可读但拒绝执行，不迁移历史证据。普通 recovery 首次点击及 fallback 同样复核 page 授权和持久化之后的快照。自有 Managed Appium 子进程加载随包 hook，仅支持 XCUITest 10.19.1 及 SHA-256 `7b4c45e6145d37b6036f60d085f3182653551f2c32709a6573983671fef56657`，将共用 WDA/MJPEG 转发工厂的 listen 限定为 IPv4 loopback；未知版本或源码拒绝，外部 Appium 不修改、不授予相同安全声明。此版本固定是临时兼容边界，上游升级必须重新审计及双端门禁，不放宽 MirrorService 所有权。

2026-10-06 iPhone 修复前补证（以下 TODO/待迭代指当时状态，实现已由上述决策接续）：application 根范围仅约束 App，不约束页面；同 App 错误页面实际派发点击，正确页 text 标题仍不能匹配 application-only 登记。TODO 的可信页面锚点与容器归属必须覆盖双端，并在准入／派发处一致执行。12 个探针仅 10 个符合预期，112 份证据重启复读；没有真实修复闭环，不升级 ADR 状态。另记录上游 WDA/MJPEG host forwarding 的全网卡监听与含糊启动超时误分类，待安全传输与错误诊断迭代。详见 [iPhone 真机记录](../../openspec/changes/add-evidence-guided-repair-loop/ios-physical-validation.md)。

采用“测试维护／业务源码修复”双路径和共享 RepairCase、冻结 VerificationPlan、独立验证器。宿主负责生成候选，工作台负责授权、调度、证据与结果判定，不在插件内另建 Agent 循环。

定位器维护复用现有候选服务，但自动执行必须增加导航范围、未派发事实与兼容性检查；只读诊断保持只读。源码路径使用宿主无关交接协议与隔离工作区，原验证器和业务期望不允许随补丁修改。

代码生成授权与实际执行审批分开；构建后安装必须绑定确切制品摘要。MCP/DSH 不提供自我批准入口，默认不自动 commit/push/PR/merge。Viewer/CLI 发起的长操作遵循 user-action-contract。

`MirrorService` 继续是唯一设备所有权和副作用边界；受限安装/身份能力经同一 repair 维护租约与 provider 扩展，不让源码/构建适配器直接操作 ADB/Appium。当前只有 Mock 实现该扩展；Appium provider 缺少经真机核验的 install/identity/session-rebuild 能力时明确拒绝。Mock 安装成功不升级为 device-verified。

Mock 离线复验增加 `MirrorService.resetRepairFixture`：仅在修复任务独占且无 child run 时重建完整内存状态，返回新的 namespace 身份与初始状态摘要，并使旧页面观察失效。重置回执丢失后围栏后续控制。它只证明 Mock fixture 的软件级干净状态；Appium 未有可信的项目数据重置、清理确认和新 namespace 回执，不能从 `launchApp` 或 `resetContractVersion` 推定真机干净复验，也不能据此开放自动验证入口。

每次 reset 先在 repair journal 持久化 intent，再记录回执；只有原进程的未消费 intent 可提交回执。崩溃恢复只展示 prepared/unknown，不自动重置或补写成功。内部 Mock 协调器已将此协议接入定位器路径的原失败对照、两次候选与冻结回归，结果仅为软件等级；Viewer/CLI 审批入口已接通，Appium 真机 reset 未接通。

M3 的构建从可信 baseCommit 与受审补丁在独立验证副本启动，命令和身份检查器均为本地登记、无 shell 且摘要绑定；同卷构建/证据预算在 Store 门禁内合计预约。制品清单只说明本机字节与登记检查器输出一致，不是签名供应链认证。iOS 开发签名仍需要可信检查器和实际签名材料证明；测试中的伪 `.app` 只覆盖路径、摘要和状态协议。存在构建登记时，源码计划必须另行冻结真正的移动端 `regressionFlows`；源码 `regressionChecks` 只属于软件门禁，不能冒充设备回归。构建后进入 `awaiting-approval` 且 `resumePhase=installing`，不占设备租约；安装审批绑定 artifact digest、App 与目标设备，写入 intent 后才经 MirrorService 派发。回执不明只可只读核查，不重装或自动回滚。当前成功安装后仍以 `repair-dependency-unresolved` 阻止设备等级，因为尚无可信移动端数据 reset/cleanup 执行回执、原构建对照与候选复验调度。

## 取舍

2026-10-07 live iPhone 续验：v2 正确页通过，旧 App 根／同 App 错页／错误目标语义零派发，原断言失败保留；13 个合成导航正反例全部匹配，设备探针对应 `REDACTED_REVISION` 原代码。自有真实 Appium 会话的 WDA/MJPEG host forwarding 均为 127.0.0.1，结束后端口关闭；不将手机端 WDA helper、外部 Appium 或完整构建安装闭环纳入此声明。已签名制品隔离副本重试成功，首次 preinstalled 启动超时不改写为通过。ADR 维持 Preview／默认关闭，M3 与独立验收不放行，见 [续验对账](../physical-validation-2026-10-07.md)。

- 不直接引入代理式自愈平台，不增加数据库或第二套会话 owner。
- 不按模型置信度直接放行，不跳过测试、放宽断言或用重试变绿。
- worktree 不是安全沙箱；首版只接用户明确信任的本地仓库，要求隔离却无能力时拒绝。
- 结果区分候选、软件验证与设备验证；原失败不可变，后续通过不是原运行首遍通过，也不是发布批准。
- 延续 256 MiB 余量、v3 引用保守保护、实际退出确认与未知副作用围栏；不承诺跨进程副作用 exactly-once。

## 实施边界

M1 受审定位器闭环 → M2 双宿主源码补丁与软件验证 → M3 构建安装与双端复验。每阶段可独立报告工程状态，只有相应真实验收通过后才能宣传真实修复效果。

完整定义、风险、迁移和任务见 [OpenSpec 设计](../../openspec/changes/add-evidence-guided-repair-loop/design.md)、[规格](../../openspec/changes/add-evidence-guided-repair-loop/specs/)和[实施任务](../../openspec/changes/add-evidence-guided-repair-loop/tasks.md)。不修改既有三个恢复/诊断契约，不将其待验项目自动完成。
