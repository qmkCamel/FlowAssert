# 实施记录与分层验证

## 最新安全修复（2026-10-06，当前开发工作树）

已修复 v2 唯一页面锚点及明确容器归属，采集／准入／派发共用校验；旧 application 根登记只读兼容但拒绝执行。普通 recovery 的首次原定位器点击及 fallback 在持久化 intent 后复核 App／页面，错误页或变化不派发；not-dispatched intent 不再被终态事实误报 unknown。WDA 含糊超时不再被当成设备锁定确诊。自有 Managed Appium 随包 preload 仅对指纹审计的 XCUITest 10.19.1 转发工厂绑定 IPv4 loopback，不改全局依赖或 external Appium。

最终 `pnpm check --maxWorkers=2` 为 113 文件／958 测试通过，`pnpm test:e2e` 66/66，`pnpm build`、`pnpm pack:check`、`pnpm test:application:probe`、`pnpm test:mcp:probe` 全部通过；严格 OpenSpec 41/41。user-action-contract 的慢构建／安装交互 E2E 通过，最新构建中截图已检查；仍是合成浏览器证据。

Android 最新 10/10、93 份证据重启复读、重复 owner 拒绝与自有清理通过。真实上游工厂本机无设备验证确认 WDA/MJPEG 两个 loopback 监听及端口释放，全局源码未变。iPhone 08:06 历史失败结构在新规则下正确放行／拒绝，但本轮建立新会话前失败，Xcode Offline，13 场景实时复验仍待重连。详见 [修复记录与原始报告位置](safety-fixes-validation.md)。

本轮新增任务 12.1–12.5 完成，12.6 依赖设备重连；整体 **53/65**，未完成任务均在 checklist 保留具体依赖，不升级 device-verified。原历史段落中的 48/59、页面缺口和网络风险描述属于修复前状态。未同步主规格、归档、提交或推送；当前基线与远端 dev 的集成仍须单独授权及验证。

## 历史实施记录

首次记录：2026-10-03；最近更新：2026-10-06。工作分支：`docs/repair-verification-design`；原基线 `dev@REDACTED_REVISION`，远端 `dev` 已前进，尚未在新基线上完成集成验收。

## 当前范围

当前以 [tasks.md](tasks.md) 的复选框为准。M1 的本地定位器维护、Mock 软件复验和 Viewer/CLI 审批入口已接通；M2 的独立源码工作区、受限补丁、两次可信软件检查与 MCP/Cordis 同契约也已接通。M3 已实现可信登记构建、同卷容量合计预约、制品摘要、确切制品安装审批、Mock 设备维护与安装未知态只读核查；真实签名开发包、Appium 安装、移动端数据 reset/cleanup 与设备复验仍未完成。以下早期条目为按日期累积的实施历史，不代表当前状态；本记录不改变设计轮的 [review.md](review.md)。

### 2026-10-03 历史快照（当时 16/59）

- `workbench-repair-contracts.ts`：v1 严格契约、大小/预算限制、审批范围与结果等级校验；`test repair verify --id ... --url ... [--required-grade software|device]` 只读核查本地 case，默认 device；未完成或 software-only 不使默认 CI 变绿。
- `workbench-repair-project.ts` 与项目加载器：仅本地可信项目配置中的独立 repair 授权，默认关闭，项目输入/策略变化更新 revision；不继承 agentTestControl 的执行权限。
- `workbench-repair-store.ts`：不可变哈希修订日志、CAS、幂等请求、有限分页及可重建内存索引；`case.json` 为可丢弃缓存，日志为事实源。索引只扫描 repairs，不扫描整个运行历史。
- 引用/容量的存储层与内部执行门已接入：复用 Store 容量门禁、v3 `workbench:repair` 引用、先保护后发布、先退休再撤销、退休中断重试；Mock child 在引用持久化后才执行，发布失败不派发。容量未知/不足和发布中断均在副作用前拒绝。仅内部 Mock 路径已验证，不能外推到 Appium 安装或源码 runner。
- 兼容回归确认旧修复候选不获得新执行权限；新增架构守卫，禁止新领域契约反向依赖存储、设备及宿主入口。
- `workbench-tap-facts.ts` 与编译器：源文档 SHA、源步骤路径/AST SHA/行号、顶层/静态标记；合并 leaf 和 readiness 不再导致定位器候选映射错位，子流程保留所属文档身份，循环/动态绑定不具备自动维护资格。
- `workbench-recorded-tap.ts` 与 `WorkbenchDevice`：只截取本地 repair 登记、精确 flow 内容、顶层静态单字段导航 tap，其他步骤仍走 Worker。检查 App 前台、完整结构、唯一/可见/启用/非敏感/完整可见边界，派发前持久化 XML 和解析回执；实际派发复用原 journal，并再次核对页面、几何和取消信号。
- `workbench-repair-evidence.ts`：对本地终态事实、原始证据 SHA、源步骤、会话 generation、当前步骤未派发和未知副作用进行交叉核验；拒绝仅错误文本、历史缺字段和导入记录。该函数只检查事实，不授予执行权限。
- `workbench-repair-diff.ts`：用 YAML AST 只允许一个静态 `tap.id/accessibilityId` 值变化；字段切换、增加 index、参数插值及任何其他语义变化均拒绝。旧人工候选入口使用该守卫及源步骤身份，但不获得新自动执行权限。

没有连接或操作真机、修改 Harness agent loop、改变 Worker 协议或替换旧修复入口；没有提交或推送。

## 已确认并实现的前置决定

原方案 D1/D6 要求普通顶层 `tap.id/accessibilityId` 的明确 missing-target 与未派发事实；任务 3.1 规划了分流/检查，但没有定义这一事实的生产协议。

前一轮核对代码发现以下缺口，本轮已据此补充 D6a、两项规格要求和三项任务：

1. `scripts/workbench-worker.mjs` 的普通步骤回调发送 `error` 文本；`src/workbench-worker-protocol.ts` 的严格 step schema 没有 typed failure 与 dispatch attestation。不能把文本 `target-not-found` 当成权威结构化事实，回归测试固定了这个边界。
2. `WorkbenchDevice.navigationTap()` 的 `TargetFailure` 属于已登记 recover 导航路径；`executeReady()` 的结构化错误属于 readiness 路径。它们不是当前方案支持的普通 tap 候选路径。
3. 原生执行器把连续 leaf 合并为 block，实际路径可为 `root/1/1`；旧 `WorkbenchRepair.suggest()` 只接受 `root/<数字>`。简单扩大正则会在合并 block、子流程和循环中错误映射 YAML 下标，必须使用编译出的源步骤身份，不能猜测。

用户已确认保持普通 tap 的语法范围；设计前置不再是阻塞。实施选择本地单 owner 的受限执行路径，不解析错误字符串，不扩充 Worker v1 协议，也不要求用户改为 readiness 语法。

### 当前执行边界

采集开关来自可信本地项目 `repair.enabled`，并同时检查 `allowedFlows/allowedPlatforms/allowedAppIds/navigation`。对应 flow 必须与实际运行 YAML 完全一致、唯一匹配，导航登记须指向后续结构化断言。仅启用采集不等于批准修复候选或补丁执行。

- 在现有单设备执行边界产生版本化 selector-resolution／dispatch 事实，绑定运行、编译步骤身份、会话 generation、观察身份和终止时机；Worker 文本只作展示。
- 受限本地路径使用现有 AppClaw selector 解析/匹配，额外对规范化原始节点交叉检查。解析器忽略零尺寸节点不被算作 missing-target；底层省略 visible/enabled 的默认值不能满足本地安全准入。页面和敏感性不通过时保守阻塞。
- 为普通顶层源步骤保留稳定身份，覆盖合并 block、前置 readiness 步骤、runFlow 和循环的拒绝场景；不以 runtime path 直接猜测 YAML 数组下标。
- 旧运行缺少新事实时保持可读、可生成人工草稿，但拒绝自动执行。补证必须创建明确授权的新运行，不能原地改旧失败。
- XML、解析回执和终态事实均按原始私有证据保存。XML/回执写入失败不得点击；终态事实写入失败不得生成可信修复资格；派发后失败保留 unknown，不能自动重放。
- 下一阶段仍需接通生命周期/引用执行门、审批、候选准入与冻结计划、原失败对照/两次干净复验/回归。相应任务不因本轮采集测试通过而勾选。

该段记录的是前轮本地采集阶段；现已加入 Viewer 只读 case 查询和 CLI 等级核查，但未开放创建/审批/执行的远程变更入口。仍不自动覆盖原 flow、原失败或基线。

## 后续实施增量（2026-10-04）

工作树仍在 `docs/repair-verification-design@REDACTED_REVISION`，未提交/推送；核查时 `origin/dev@REDACTED_REVISION` 已前进两笔 authoring 提交，且与 Viewer/Application/Workbench 有交叉。下一次集成须先保护本工作树，再对新 `dev` 做冲突审查与完整回归，不能把本轮门禁当作新 `dev` 的验证。

- 结构化分流将未派发 missing-target 与 assertion、readiness、环境及证据缺口分开；候选准入必须核对唯一可见页面、目标角色/文字、原后置断言、冻结项目、参数、平台/App、运行环境和构建。错误字符串不能授权。
- 普通 opt-in tap 在派发前的本地观察也检查已登记页面与目标语义；相似目标在其他页面或被替换成危险文案时阻断，测试证明没有设备动作。缺少页面/目标配置的旧 opt-in 仅采集事实，仍不能进入自动候选。
- 冻结计划包含原失败对照、两次候选、至少一次登记回归，绑定全项目静态依赖、测试数据/重置版本、环境、构建、参数及设备会话。新动态依赖或项目变化使旧计划失效。当前 Appium 会话缺少可信真机类型证明，保守归为 simulator；不得据此获得 device-verified。
- 持久日志加入候选、审批、尝试与验证记录的镜像约束；`WorkbenchRepairCoordinator.create` 经过真实 Mock run 验证请求幂等、重启索引重建、原 manifest 不变。预执行取消可持久完成；活跃执行取消仍待实现。
- 协调器已加本机内存一次性审批 challenge：范围审批先行，执行审批绑定具体 plan/patch/device/project revision；重放、过期和撤权均拒绝。**尚未接入由人操作的 Viewer/交互 CLI 审批入口，也未派发已批准任务**，因此任务 4.1 不勾选。
- Suite 子运行准备钩子在执行门开启前运行；注入 owner 引用发布失败时，已准备的子运行未执行任何步骤并被取消。尚未把 repair 调度接入该钩子，因此 2.3 仍未勾选。
- MirrorService 增加同一修复任务跨 child run 的独占 reservation，普通 Viewer/Workbench 控制在运行间隙也不能插入；子运行实际退出前释放会被拒绝。它尚未与完整 repair 尝试调度绑定，也不提供 reset/namespace 证明，不能据此声称 2.4 或 3.6 完成。
- 纯验证判定器拒绝缺失/跳过检查、恢复通过、清理失败、证据缺口、重复 namespace、原失败未复现、身份不符。它尚未连接可信 child run 回执和真实 reset adapter，**不能将合成回执测试当作成功复验**。
- 应用关闭先排空候选创建再关闭 suites/workbench；Viewer 只读 `GET /api/workbench/repairs/<id>` 沿用同源保护；CLI 通过该状态判定退出码。没有新修复操作按钮；`user-action-contract` 的慢操作 UI 验收仍待执行。
- 离线专项测试已覆盖候选准入、冻结计划、私有候选、存储日志、结果投影、CLI 默认等级和跨 child 设备独占；最终 `pnpm check` 通过（101 文件、881 项），`pnpm build`、`pnpm test:e2e --workers=2`（64 项）、`pnpm pack:check`、`openspec validate --all --strict`（41 项）、应用/MCP 探针及 `git diff --check` 均通过。MCP 默认仍为 20 工具。检查了 E2E 运行截图，测试改写的 30 个已跟踪截图已从本轮运行前备份恢复。未连接真机或实际双宿主。

### 暂停边界

原暂停时，现有项目只登记 `resetContractVersion`，没有可执行且可核验的清理/新 namespace 回执；Mock 的 `launchApp` 也不清除动作计数。后续已经补上 Mock-only reset 与内部软件复验，解除该离线阻塞，但 **Appium 真机仍无可信项目 reset/namespace 适配器**，Viewer/CLI 尚未开放人类审批写入口，M2/M3 与真实验收也未完成。真机、宿主运行及独立参与者验收需要授权资源。

2026-10-04 继续实施：已在 `MirrorService` 的修复独占范围内加入 **Mock-only** `resetRepairFixture`，Mock provider 重建完整内存模型，返回新的 namespace ID 与初始状态摘要；正在运行的 child 不允许重置，重置回执未知时围栏后续控制。`WorkbenchRepairStore` 增加版本化 reset intent/receipt 日志、case/generation/check 绑定与 namespace 去重；只有同进程已持久准备的 intent 能完成，重启后的 prepared 保持未知，不能伪造自动完成。

内部 `verifyMock` 接通已批准私有候选、repair 独占 reservation、64 MiB 证据预约、每次重置、受保护 child 执行门及真实本地运行回执。验证端从原始 run 和 child 证据重建检查结果，而非接受宿主自述；Mock 正例为 `software-verified`，默认 device CLI 仍非零。原失败不复现、reset 回执丢失、引用发布失败、容量不足、取消与设备动作竞态均被保守处理；取消直到已派发动作实际收尾才终结。`recordVerification` 的通用写入仍不能自报 verified，只有内部 Mock 证据构造器能产生软件等级。

定向回归 `tests/workbench-recorded-tap.test.ts`、`tests/workbench-repair-store.test.ts`、`tests/workbench-repair-verification.test.ts` 共 67 项通过；随后增加逐项阶段/预算落盘、活跃取消和关闭等待用例。最终 `pnpm check --maxWorkers=2` 通过（101 文件、893 项），`pnpm build`、`pnpm test:e2e --workers=2`（64 项）、`pnpm pack:check`、严格 OpenSpec（41 项）和 `git diff --check` 均通过。E2E 生成的既有跟踪截图已恢复。任务 2.2、2.3、3.5、3.6 据离线实现与反例测试勾选，整体 **16/59**。Appium 真机 reset、Viewer/CLI 写入口、跨进程状态/预算和完整重启切点仍待完成。

## 前一轮基础层验证（保留历史结果）

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run tests/workbench-repair-contracts.test.ts tests/workbench-repair-store.test.ts tests/workbench-repair.test.ts tests/workbench-investigation.test.ts tests/workbench-recovery.test.ts --maxWorkers=2` | 5 个文件、54 项专项/兼容测试通过 |
| `pnpm check --maxWorkers=2` | 类型、契约、架构检查通过；99 个文件、830 项测试通过（较基线增加 20 项） |
| `pnpm build` | 通过 |
| `pnpm pack:check` | 通过 |
| `pnpm test:e2e --workers=2` | 64 项通过，构建后单独运行 |
| `openspec validate --all --strict` | 41 项通过 |
| `git diff --check` | 通过 |

开发过程中修正了 Zod 默认值输入/输出的泛型类型推断，最终完整类型检查通过。没有放宽测试断言或超时。测试生成的既有跟踪截图恢复至本轮开始版本，不混入基础层改动。

没有 Viewer 实现改动；没有新修复界面可以做运行时交互验收，任务 4.4 保持未完成。上述结果验证本轮基础层及既有功能的回归，不代表 M1/M2/M3 修复闭环、实际宿主或真机验收完成。

## 本轮本地采集与差异守卫验证

- `pnpm exec vitest run tests/workbench-recorded-tap.test.ts tests/workbench-repair.test.ts tests/architecture-graph.test.ts --maxWorkers=2`：3 个文件、37 项通过，其中新增 29 项。
- 覆盖真实 WorkbenchService/Mock 的成功、零匹配、歧义、截断、隐藏、禁用、零尺寸、敏感目标、取消、三处 ENOSPC 注入、派发后未知，及功能关闭、readiness 前缀、真实基线到失败候选生成与原 manifest 不变。
- 编译测试覆盖循环、子流程与动态绑定标记；AST 反例覆盖断言、等待、App/平台、prepare/verify、参数和选择器约束修改；旧历史人工草稿与 Worker 伪造字段测试继续通过。
- 本机本轮日志目录：`/tmp/mobile-mirror-tap-facts.sCIne3`（临时路径，不随仓库分发），E2E 截图另存 `artifacts-after/`；恢复了 31 个测试生成的既有跟踪截图，不混入代码变更。Mock 不构成真机或修复闭环验收。

| 完整门禁 | 本轮结果 |
| --- | --- |
| `pnpm check --maxWorkers=2` | 类型、契约及架构通过；100 文件、859 测试通过 |
| `pnpm build` | 通过 |
| `pnpm test:e2e --workers=2` | 64 项通过 |
| `pnpm pack:check` | 通过 |
| `openspec validate --all --strict` | 41 项通过 |
| `git diff --check` | 通过 |

开发时发现并修复了敏感标记在 Mock XML 转换中丢失、底层解析器忽略零尺寸控件的问题。候选测试使用稳定导航文字，未把会随动作计数变化的按钮文字当作跨运行语义锚点。没有降低测试断言或扩大自动权限。

## 2026-10-05：M1/M2 完成后的 M3 离线底座

本段是当前工作树证据，不覆盖上方历史快照。M1 的安全语料为 20 漂移／20 产品缺陷／20 反例，Mock 软件与慢操作 Viewer 截图已检查。M2 的 10 种源码 bug、恶意补丁、主工作区 dirty 保留、两次独立 checkout 软件核验已跑通；MCP 与 Cordis 使用同一受限 schema，但未在实际 Codex 与完整 DSH 宿主分别运行，因此 7.6 仍待验。此前 M2 全量门禁曾通过 107 文件／917 单测、65 浏览器 E2E、构建、打包、应用和 MCP 探针；这只证明当时本工作树的离线实现。

新增 M3 工程能力：

| 层 | 已实现且已验证 | 不能外推 |
| --- | --- | --- |
| 构建 | 本地登记平台/App、命令、身份检查器、输出根、制品类型与预算；只从 baseCommit+受审补丁重建副本构建，哈希绑定工具链、源码树、oracle 与配置；命令回执保留有界首尾日志和全量输出摘要 | `trusted-local` 不是安全沙箱；登记检查器的正确性由项目所有者负责，未有真实签名开发包样本 |
| 制品 | 单 APK 与 `.app` 的根内路径、普通文件/目录、大小、内容摘要及替换复查；`.app` 拒绝任何逃逸链接；同卷构建/证据容量合计预约 | 测试中假 `.app` 的 `signatureVerified` 输出只用于协议 fixture，不证明 Apple 开发签名或可装真机；APK fixture 不证明真实 APK 打包 |
| 审批 | 两次源码软件检查通过后记录制品，`awaiting-approval + resumePhase=installing`；本机 Viewer/交互式 CLI 对确切 artifact digest、App 与目标绑定单独确认，等待时不持设备租约 | Agent 不能批准；制品变化或项目登记变化拒绝安装 |
| 设备边界 | `MirrorService` 独占修复维护租约、suite 跨 child 运行组所有权（独立 matrix 沿用设备 claim）、Mock provider 安装/身份协议、安装后会话重建及旧观察失效；安装 intent 先写盘，回执丢失/取消进入未知围栏，只读核查不触发重装 | Appium provider 尚未实现经真机核验的安装/身份/会话重建；即便 Mock 身份匹配，case 仍停在 `inconclusive / repair-dependency-unresolved`，保留原 software verification |

专项测试已运行：`tests/workbench-repair-build.test.ts`、`tests/workbench-storage-admission.test.ts` 共 14 项通过；`tests/workbench-repair-build.test.ts`、`tests/mirror-repair-maintenance.test.ts` 共 5 项通过；`tests/workbench-code-build-install.test.ts` 的完整本地 case 流程通过，包含制品篡改拒绝、安装摘要审批、Mock 身份核验、派发后回执丢失与只读核查。以上测试中的 Mock/假制品只验证软件协议。

未完成的非设备边界按 [tasks.md](tasks.md) 保留未勾选：实际 Codex/DSH 宿主运行；移动端原构建对照、两次干净候选与冻结回归的独立调度和可信 reset/cleanup；Appium install/identity；真实 iOS 开发签名与 Android APK；制品/设备结果进入验收候选。`freezeCodePlan` 已把本地软件 `regressionChecks` 与移动端 `regressionFlows` 分开；有构建登记却没有后者时创建 case 即拒绝，但仅冻结计划不证明设备复验。安装协议故障矩阵已增加派发后断连、取消、回执丢失及 `after-intent`/`after-dispatch`/`after-identity` 三个真实 SIGKILL 切点，重启不重放且只读核查。真机 reset/cleanup、真实材料、双端设备和非作者参与者仍是明确外部依赖。未做 OpenSpec 主规格同步或归档，也未提交/推送本工作树。

停用演练：`tests/workbench-code-repair.test.ts` 在源码命令仍运行时关闭准入并调用 `close()`，确认进程实际排空、case 终态和旧证据可读；`tests/workbench-code-build-install.test.ts` 在未知安装后关闭准入、重启 coordinator，确认未知 intent 和制品摘要仍在，旧安装不得重放。旧修复入口、默认 20 工具、功能关闭和历史 reader 的回归分别由 `workbench-repair.test.ts`、`repair-tool-visibility.test.ts`、`workbench-repair-store.test.ts` 及既有引用治理测试覆盖。

已按四份 delta spec 的 55 个 Scenario 建立[场景级证据矩阵](acceptance-audit.md)，分别记录软件证据与尚缺的宿主、真机或独立验收。该预审不满足任务 11.4 的“全部前置验收完成”条件，因此不提前同步主规格或归档。

最终离线门禁：串行执行 `pnpm check --maxWorkers=2`（111 文件、931 测试）、`pnpm test:e2e`（66/66）、`pnpm build`、`pnpm pack:check`、`pnpm test:application:probe`、`pnpm test:mcp:probe`（默认 20 工具）均通过；`pnpm dlx @fission-ai/openspec@1.9.0 validate --all --strict --no-interactive` 为 41/41。`tests/e2e/workbench-repair.spec.ts` 新增构建中历史/证据/语言交互和确切制品安装中交互；已人工检查 `artifacts/repair-case/repair-build-running-desktop.png`、`repair-install-running-desktop.png`、`repair-install-blocked-narrow.png`。在同时运行单测和 E2E 的首次门禁中，既有 workbench 等待用例与 matrix 临时目录清理各出现一次时序失败；两项单跑通过，随后全套串行通过，故不把首次并行结果算作通过证据。上述仍只是软件/Mock 与本机打包证据。

## iPhone 真机补证（2026-10-06）

本工作树独立 iPhone 探针已执行 12 个场景、10 个符合预期、2 个页面范围失败；112 份证据重启复读、重复 owner 拒绝与自有清理通过。正确页面标题登记被误拒绝；同 App 错误页面在 application 根登记下却实际点击，不能以应用容器代替当前页面。另记录 WDA 启动分类误导和上游转发全网卡监听限制。未实施授权契约修复、候选构建安装、可信 reset 或人工审批；不授予 device-verified，整体仍 48/59。完整结果、复现与剩余任务前置见 [iPhone 真机记录](ios-physical-validation.md)。

## Android 真机补证（2026-10-05）

后续经用户授权使用独立连接的 Android，与 iPhone 聊天隔离工作树、设备与端口完成 10 个普通导航/安全拒绝探针，88 份证据复读、同设备重复 owner 拒绝与自有会话清理。没有构建安装、源码修复或人类审批冒充，不能升级为 device-verified。**正确页面的 application-only scope 在 Android 层级仍阻塞**，是实际适配缺口，不是设备缺失。相似目标不误点不替代危险同文案反例；普通导航两次通过不替代冻结原构建对照与两次干净修复复验。完整实测、未完成任务对账和后续方案见 [Android 真机记录](android-physical-validation.md)；5.3、10.3 仅补部分证据，整体仍为 48/59，未同步/归档或提交推送。

## 2026-10-07：合入最新 dev 的集成验证

本轮以远端 dev `REDACTED_REVISION` 为基线，在独立集成工作树合并修复分支 `REDACTED_REVISION`。原主工作区与修复工作树的未提交截图、未跟踪文件均未清理、复制或覆盖。

- 解决 10 个文件的合并冲突，保留 dev 的创作/验收/案例、报告、时间断言与健康/性能门禁，以及修复分支的受控 tap、设备维护租约、修复协调器、CLI/HTTP 和可选工具。
- `measure`、子流程、分支和循环同时传递源文档身份与 measure 上下文；原生片段及受控 tap 使用当前 walk 的取消信号，不退回根信号。新增 3 个编译集成回归，证明子流程摘要正确、跨子流程禁止嵌套 measure、顶层 tap 身份与时间断言共存。
- 首次全量检查为 123 文件通过、1 文件失败，原因是冻结基线尚未登记修复新增的 CLI/工具契约文件摘要。逐项审查 5 个文件后新增独立修复集成基线，未整体刷新旧基线；默认 20 个工具、旧 HTTP run 路由和历史结果 golden 继续冻结。最终重跑全套通过。
- 修复 Viewer 浏览器样本补齐必须的 `route` 字段，避免截图显示无效的 `undefined`；修复界面 4 项再跑通过。保留并检查本轮 7 张合成修复桌面/窄屏截图，覆盖执行、失败保留、源码检查、构建及安装。无真机截图被替换成 Mock 验收。

| 本轮验证 | 结果与范围 |
| --- | --- |
| `pnpm check --maxWorkers=2` | 类型/契约及 125 文件、1095 单测通过 |
| `pnpm test:e2e --workers=2` | 82 通过，1 项 opt-in 性能基准按默认策略跳过 |
| `REPORT_PERFORMANCE=1 pnpm test:e2e tests/e2e/report-reading.spec.ts --grep '1000-summary' --workers=1` | 独立性能基准通过；1000 记录，冷页/刷新各 30 样本，P95 355.4 / 250.7 ms，目标 2000 ms；未清空文件系统缓存，不宣称磁盘冷启动 |
| `pnpm test:e2e tests/e2e/workbench-repair.spec.ts --workers=2` | 4 项通过，已补齐定位器样本 route；慢操作期间历史、证据及语言交互可用，失败保留旧详情 |
| `pnpm typecheck` | 浏览器样本补齐后再次通过 |
| `pnpm build` / `pnpm pack:check` | 通过，包包含本机转发守卫及修复 Viewer 代码 |
| `pnpm test:application:probe` | 构建入口、Mock、关闭排空及重启只读通过 |
| `pnpm test:mcp:probe --launcher <本工作树的显式 launcher 路径>` | 默认 20 工具、Mock 语义动作、CLI/MCP matrix 与 SIGTERM 清理通过；不是实际 Codex/DSH 宿主修复交接验收 |
| OpenSpec 1.9.0 `validate --all --strict --no-interactive` | 49/49 通过；规格完整性不替代未勾选验收 |
| `pnpm public:check` / `git diff --cached --check` | 最终公开检查 1133 文件、94 个可达提交通过；暂存差异无空白错误 |

MCP 默认探针在本轮先失败两次：既有默认 launcher 用 `URL.pathname`，目录中的不间断空格成为 `%C2%A0`，进而连接关闭。显式 `--launcher` 使用真实文件系统路径后通过；未改冻结的探针源码。TODO：独立修复默认路径解码并增加空格/Unicode 路径回归。

公开检查在 E2E 前通过；E2E 后发现已有公开截图 `mobile-mirror-streaming.png` 被测试重生成、与既定公开摘要不同。本轮在独立集成工作树恢复该图的既有基线，不刷新允许名单或公开截图摘要；本轮 7 张修复截图独立保留。其余测试生成的旧截图不纳入合并提交。

本轮没有连接或控制真机，清单仍 **53/65**，12 个待验任务不勾选，也不提前同步主规格或归档。宿主 `repairToolsEnabled` 与项目 `repair.enabled` 默认关闭、独立生效；前者只控制 Agent 工具，不能代表停用 Viewer/CLI。统一运行时总开关与 Viewer 用户开关尚未实现，已在 README、停用指南和 PRODUCT_TODO 明确保留缺口。
# 2026-10-07 续验补充

实现已合入 dev@REDACTED_REVISION；对应新 iPhone 13 场景全部预期匹配，114 份证据重启复读，真实自有 WDA/MJPEG 转发限定 loopback，关闭后无监听。12.6 完成，最新 54/65；其余 11 项仍需真实制品/可信 reset/审批、双宿主实际交接或独立参与者，不用普通导航成功替代。续验分支随后本地更新至 dev@REDACTED_REVISION，DSH 0.2.0-rc.2 适配不倒填为设备新运行。未归档、同步或发布，见 [本轮对账](../../../docs/physical-validation-2026-10-07.md)。
