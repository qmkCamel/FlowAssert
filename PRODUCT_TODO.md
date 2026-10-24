# FlowAssert 产品 TODO

## 2026-10-19 历史脱敏

按维护者授权清洗全部远端分支和标签，移除历史个人身份与组织专属材料，并取消历史邮箱豁免。脱敏示例与原始验证的区别见[历史脱敏说明](docs/privacy-history-cleanup.md)。当前交付进度见下表。

## 2026-10-12 通用能力回迁

报告增加截图播放、步骤时间线、失败暂停及动作前后/坐标取证；引入默认关闭的 Web 视觉自检、独立复核、文档与安装包链接检查。保留模拟器工作区实现，不迁入组织专属信息。实施与本轮验证见[回迁任务](openspec/changes/port-report-playback-and-web-selftest/tasks.md)及[验收记录](openspec/changes/port-report-playback-and-web-selftest/implementation-validation.md)。

## 2026-10-09 模拟器连接

增加 Viewer 中显式选择 Android Emulator / iOS Simulator 的入口，独立发现与连接前重查，iOS 无签名接入。使用见[模拟器](docs/simulators.md)，验证进度见 [add-guided-simulator-support](openspec/changes/add-guided-simulator-support/tasks.md)。不替代现有真机验收。

## 2026-10-08 小范围内测准备

新增[dev 分支内测任务卡](docs/beta-start.md)和[反馈模板](docs/beta-feedback.md)，同步宣传长短版与默认自包含 Mock 演示。按用户确认直接使用分支，不维护独立内测包；反馈记录提交 SHA。详细交付见 [prepare-guided-beta-kit](openspec/changes/prepare-guided-beta-kit/tasks.md)。3–5 位非作者的真实体验及既有公开历史扫描问题保持待完成，不以作者自动化勾选采用门禁。下文任务数量保留其原日期快照。

更新：2026-10-07，核对远端 `dev@REDACTED_REVISION` 并补本轮真机续验。首期范围：本机、Android/iOS 真机、以自研 App 为主，可读 YAML 固定流程，必要时扩展代码。第三方 App用于第三方 App 样本，仓库 Fixture 用于可重复业务、编排与 AI 恢复验收。

这里维护优先级与完成边界；详细验收以 [OpenSpec](openspec/specs/) 和各 change 的 tasks 为准。研究与方案不等于实现，复选框完成不等于发布。能力状态集中在[能力总表](docs/capabilities.md)，对外素材见[宣传稿](docs/communications/product-introduction.zh-CN.md)。入口：[文档索引](docs/README.md) · [里程碑](docs/milestones.md) · [当前架构](docs/design/mobile-test-workbench-current.md)。

2026-09-26 规划入口：[三阶段产品化方案](docs/roadmaps/workbench-productization.md)。三个 OpenSpec change 已建立并在本地分包实施：阶段一公共契约/来源追踪/managed job，阶段二 Inspector/受控修复/显式视觉及跨出口结果投影，阶段三趋势/安全分享任务/引用感知清理均有工程实现。清理 move/restore/purge 与基线批准的 SIGKILL 切点、套件尝试历史 tombstone、分类容量扫描和运行/导入/导出/比较/基线/趋势/套件准入已加入；HTTP 五类路由、Viewer 分享/趋势/清理/基线/修复/比较状态与历史/结果事实已拆分，运行的原生 worker、业务 hook、终态/逐步取证与清理 journal 独立。跨版本同包、全部 ENOSPC/故障边界、余下运行/录像编排拆分及真机/外部采用门禁仍未完成，详细以各 change tasks 为准。

- [x] **插件友好架构方案与实施**：共享 WorkbenchApplication、设备组装工厂、可靠关闭与准入竞态治理、领域类型抽取、统一引用快照/v3 扩展消费者、启动时可替换分诊分析器；见 [ADR 0011](docs/decisions/0011-plugin-friendly-application-runtime.md)和[扩展指南](docs/plugin-friendly-runtime.md)。工程验证见对应 OpenSpec 记录，不替代真机门禁。
- [x] **证据与执行边界治理**：新 comparison/share 统一引用发布、显式退休与历史保护；执行 Worker v1 消息/时序校验；100/1,000/10,000 查询基准及历史读取并发上限；decode-gap 截图回归。见 [ADR 0012](docs/decisions/0012-evidence-consumer-and-executor-boundaries.md)和[验收记录](docs/evidence-runtime-boundaries-validation.md)。
- [x] **比较生命周期与模块边界收口**：comparison 准入/关闭/Worker exit/读租约契约、写盘失败及重启恢复、全 src 依赖图与传递越界守卫；见 [ADR 0013](docs/decisions/0013-comparison-lifecycle-and-graph-boundaries.md)和[生命周期审计](docs/runtime-lifecycle-validation.md)。不等于全部 Worker 的异常终止语义已统一。
- [x] **Worker 与内置引用治理收口**：visual/share-image/native parser/native executor/analyzer 实际退出确认；suite/baseline/Agent/pin/child 统一发布与退休、旧记录保守保护、失败及重启回归。见 [ADR 0014](docs/decisions/0014-worker-and-builtin-reference-governance.md)和[验收](docs/worker-reference-governance-validation.md)。不包含自动清理保守孤儿引用或批量重写历史记录。
- [ ] **后续架构优化**：分诊索引/摘要分页的生产预算、完整多引擎协议；沿用[原治理草稿](docs/design/architecture-governance-draft.md)。动态插件市场/内部 Cordis 容器仍暂缓；2026-10-01 按用户要求暂缓本轮双端真机验证，不标为通过。

## 最新增量（与六项历史计数分开）

- 运行时两项：时间断言27/28、健康/性能29/32。iPhone live 诊断来源探查 6.3 完成，但 crash/hang 归档不证明窗口完整，健康放行及真实业务端点仍缺。RuntimeFixture 协调 USB/自有宿主中断有证据，采用完整故障矩阵仍不关闭。见[审计](docs/runtime-gates-validation.md)与[本轮逐项对账](docs/physical-validation-2026-10-07.md)。
- 报告阅读/离线分享：41/46，补真实双端归档/录像解码、子运行对照、副本缺图及报告刷新竞态回归；Safari 已补原生阅读/键盘/打印预览，完整离线/窄屏、脱敏接收材料、认可健康信号与5人研究仍缺。当前 iPhone 型号/OS 已探查，不倒填旧来源。见[使用](docs/report-reading-and-sharing.md)与[实施验证](openspec/changes/improve-report-reading-and-sharing/implementation-validation.md)。

## 六项产品迭代：工程完成，验收仍分层

`feat/change-acceptance-roadmap@REDACTED_REVISION` 已合入 `dev`：首次验收、创作维护、诊断复验、变更验收对象、外部测试资产、本机 OCR＋双槽矩阵的约定工程范围均已实现，并保留 dev 的架构治理。2026-10-05 再合入 `feat/physical-validation-oct@REDACTED_REVISION`；四个 OpenSpec change 现为 90/103，剩余 13 项。不是“六项全部验收完成”，也不代表正式发布。[原路线图](openspec/changes/add-change-acceptance-records/roadmap.md)为 10 月 3 日快照，当前边界见[真机验收与缺口](docs/physical-validation-2026-10-05.md)。

- [x] **本候选双端真机增量**：Inspector 创作／失败分析／新修订复验、provenance 样本、readiness／助手／业务 child 核查、受控进程故障及各 30 次固定基准；iOS 修复 provider-attested focus 丢失。合成 Fixture 不等于外部真实业务变更。
- [ ] **双端完整故障矩阵**：`harden-workbench-adoption` 4.4/4.5 仍缺当前候选的实际 USB 拔插，不用旧 iPhone 报告或进程终止替代。
- [ ] **外部报告完整兼容**：实际 Appium 客户端 runner 的 3 pass/1 fail/1 skip 报告链已有证据，Maestro、error 方言、缺附件与独立使用方门槛仍未齐；5.1/5.2 保持未完成。
- [ ] **剩余独立验收**：真实模型图片链路、OCR／视觉批准、两真实构建、双槽真机矩阵、独立语料／非作者研究及外部试点逐项完成；不随合并归档。

- [ ] **证据驱动修复与统一复验（Preview，默认关闭；54/65）**：M1 定位器审批与 Mock 软件复验、M2 可信本地源码补丁交接及双次独立检查已实现；M3 已有隔离构建、容量合计预约、确切制品审批、Mock 安装/身份与未知回执只读核查。签名开发包证明、Appium 安装、可信真机 reset/cleanup、实际双宿主运行和独立验收尚缺。见 [实施记录](openspec/changes/add-evidence-guided-repair-loop/implementation.md)、[逐项任务](openspec/changes/add-evidence-guided-repair-loop/tasks.md) 与 [ADR 0016](docs/decisions/0016-evidence-guided-repair-verification.md)。不得把软件/Mock 结果外推为真机修复。
  - 已实现 v2 页面锚点／明确容器归属，Android 新探针 10/10、正确页通过且错页零派发；完整受审修复正例仍缺旧构建、精确审批及可信 reset/复验，见 [修复记录](openspec/changes/add-evidence-guided-repair-loop/safety-fixes-validation.md)。
  - iPhone 历史 12 场景中的两处页面缺陷、普通 recovery 首次点击漏查、WDA 含糊超时误分类及自有 WDA/MJPEG host forwarding 全网卡监听已修复。10 月 7 日 live 13/13 场景、114 份证据重读及真实 host forwarding loopback 检查通过，12.6 完成；首个 WDA 启动超时保留，设备后来 Offline 也不改写此前事实。不把普通导航通过升级为真机修复闭环，见[本轮对账](docs/physical-validation-2026-10-07.md)。
  - [ ] **统一运行时总开关与 Viewer 用户开关**：当前只有宿主工具可见性与项目修复准入，默认关闭；隐藏 Agent 工具不等于关闭 Viewer/CLI。总开关、界面切换及活跃任务排空策略尚待实现，见[停用说明](docs/evidence-guided-repair-operations.md#停用与恢复演练)。

- 需要真机：双端真实业务、实际文字正反断言、双槽 20 轮及故障／取消／复跑对照。
- 可离线但缺真实材料：授权截图及标签的冻结评测、实际 Maestro／Appium runner 报告和附件的兼容验证。
- 可离线但需独立参与者：语料标注、摘要判读、外部资产迁移；首次验收／维护实操仍按外部项目准备设备与环境。
- 归档依赖全部前置验收；状态文档同步不需要真机，不勾选尚未执行的验收。

10 月 5 日验收候选工程证据为 848 项测试、73 项 E2E、构建／打包及 strict OpenSpec 43/43，合并门禁另见[本次记录](docs/physical-validation-2026-10-05.md)。原同包 MCP／DSH Native/PTC 与 Vision 合成识别是[历史证据](artifacts/local-device-matrix/validation.md)，本次不冒充重跑。第五项是报告／附件接入，不是外部执行器；第六项的生产 OCR 仍须真实评测与逐 profile 批准。

## 四项诉求的交付状态

| 诉求 | 已交付 | 剩余差距 |
| --- | --- | --- |
| 在电脑准实时看手机 | Android scrcpy、iOS WDA MJPEG、截图降级；用例运行时继续观看 | 更广设备矩阵、旋转/断线恢复；iOS 浏览器绘制指标尚不完整 |
| 固定流程、快、模拟手动操作 | AppClaw 2.7.0 YAML、类型参数/子流程/分支/循环、可信代码扩展、串行套件；双端编排矩阵已验，常规步骤不调用模型 | 扩大实际项目及设备覆盖、进一步缩短取证耗时；有限 AI 导航恢复双端 Fixture 已验 |
| 保留证据、自动确认结果 | 每步 PNG/XML、UI 断言、独立业务 verifier 与清理；双端 Fixture UI→SQLite 真值闭环已验 | 外部业务需接入自己的 verifier；通用视觉与未知遮挡检测未完成 |
| 结果可回溯 | runId、输入快照、哈希、历史/重跑、视频与步骤定位；case/attempt、JSON/JUnit、双端 Fixture 跨次比较与 Diagnostic Context | Allure 等额外报告格式、完整 App 构建来源与更强崩溃恢复 |

## 已完成的最小闭环

- [x] **工作台视频历史**：可选随运行录像、独立原子归档与哈希、重启回放/下载和步骤近似定位；部分/失败单独标注。浏览器、磁盘及双端真机归档、重启回放与步骤定位已验；见[记录](docs/workbench-video-validation.md)。
- [x] Viewer 手动截图/录屏：工具栏 PNG、开始/结束、计时与下载；Android 第三方 App并行运行 12/12、实际视频解码已验。仅当前页面手动导出，runId 视频归档见工作台视频历史；见[验收记录](docs/viewer-capture-validation.md)。
- [x] 独立本机 Viewer：私有配置、显式设备检查、连接、实时画面、停止。
- [x] YAML 预检 → worker 执行 → 共享会话租约 → 每步取证 → 最终判定 → 历史回看/重跑。
- [x] 同一 runtime 中阻止其他入口插入控制，保留媒体与独立 UI 交互；取消等待已派发请求收敛。
- [x] Android 第三方 App正例 12/12 和故意失败反例；iPhone 第三方 App同等正反例；重启后证据哈希复验。见[真机记录](docs/workbench-validation.md)。
- [x] 固定 DSH `0.2.0-rc.2` Native/PTC 兼容，验证图片/文本模型目录边界；DSH/MCP 当前共 20 项默认工具，另有 5 项 opt-in Preview 修复工具，其中十项为设备工具；未修改 Harness agent loop。

`pass` 要求已声明 UI 条件、必选业务 verifier、清理和必需证据均满足；未配置业务验证仍为 `businessVerification: not-performed`，通用视觉验证仍未执行。AI 恢复成功单列 `recovered`，默认 CI 非零，不覆盖原失败。设备操作取消不回滚；测试终态保留会话，断开时才释放会话资源。

## P0：让现有闭环稳定、可重复、可计时

- [x] **WDA 子进程自动清理**：已实现 managed 谱系/继承标记、身份复核、detached 后代清理与失败重试。iPhone 实测发现并修复 Apple 进程环境不可见问题；三轮正例及反例自动停止成功，最终宿主/手机 runner/端口独立核验无残留。external/attached 仍归外部 owner，更多系统与异常生命周期矩阵另验。
- [x] **执行与取证性能**：阶段计时、检查点同步、无关几何请求消除、Viewer 展示与三轮测量入口已实现；每步仍保留新 PNG/XML。Mock 中慢操作交互/取消已验；iPhone 三轮通过（28,484 / 35,806 / 29,452 ms），样本校准预算 42,968 ms；Android 同策略三轮通过（54,023 / 45,061 / 42,515 ms），样本校准预算 64,828 ms；两端均验证每步证据、媒体、交互、历史与清理，未声明生产 SLO。
- [x] **取证故障保真**：独立保存 PNG/XML，原子发布与恢复未登记/临时材料；截图、源树、磁盘、manifest、真实 worker 终止和宿主 SIGKILL 均有测试。部分/恢复材料不判 pass；保留各自时间窗，不称原子快照。

实现与详细验收见 [harden-local-test-workbench](openspec/changes/archive/2026-09-18-harden-local-test-workbench/tasks.md) 和 [P0 验证记录](docs/workbench-p0-validation.md)。P0 三项已完成，双端真机与自动化验收齐全；本 change tasks 为 10/10，已归档。

## P1：已设计功能与已有实现的验收缺口

- [x] **Observation 查询 + Viewer Inspector**：实现及验收完成，[任务 39/39](openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/tasks.md)；已接入十工具、summary/find/get/subtree、冻结图/树/详情与 ADR 0007。Android/iPhone 真机及同 tarball MCP/DSH Native/PTC 干净安装均通过，change 已归档，见[记录](docs/inspector-validation.md)。
- [x] **第三方 App AI 文字 UI 验收闭环**：YAML type 支持替换、追加、清空；Android 真机通过入口、消息、回复正文/操作栏和历史再打开，故意失败反例与运行历史哈希复验通过。见[记录](docs/sampleapp-ai-text-validation.md)。不等同于独立后端持久化校验，iOS 业务流程未验收。
- [x] **连接向导真机验收**：Android 10.8 与既有 iPhone 两项均已通过，任务 66/66；首次保存、重启快连、设置页、scrcpy 和最终清理见 [Android 报告](docs/android-acceptance-2026-09-16.md)。ADB 稳定性单列。
- [x] **语义动作真机验收**：Android 11.2/11.7 完成 replace/append/clear 并修复 hint 追加丢字；iOS 输入/敏感拒绝/生命周期已有实测。详见 [Android 报告](docs/android-acceptance-2026-09-16.md)。
- [ ] **Android ADB 稳定性**：无 Appium 的 10 轮只读基线已复现：枚举 10/10 成功，echo/API 读取各 3 次超时后自行恢复。已定位到命令通道层，线材/接口/手机端仍需单变量对照；[排查方法和证据](docs/android-link-diagnostics.md)。不将功能样本通过等同于稳定性问题已解决。
- [x] **Codex + MCP 真机图片单场景**：2026-09-16 看图定位第三方 App AI 入口、点击并交叉核对面板展开；[报告](docs/ios-business-and-codex-vision-validation-2026-09-16.md)。DSH 图片链路仍独立待验。
- [ ] **DSH 0.2.0-rc.2 真实图片模型复验**：当前 `0.2.0-rc.2` package/runtime 与模型目录边界已验；真实 provider 图片消费仍需独立验证。工作台直接调用 DeepSeek 的 AI 恢复证据不替代 DSH 附件链路验收。
- [x] **已完成 change 的交付状态收敛**：2026-09-18 已将 17 个完成的 change 同步到主 specs 并归档；当时4个仍有任务的change保持active；当前数量见本文末尾快照。语义动作任务 12.7（推送与 CI）、12.8（明确授权后的新版本发布）保持未完成，不能用本地提交替代。
- [x] **OpenSpec 文档变更校验口径**：2026-09-16 使用与 CI 相同的 `@fission-ai/openspec@1.9.0 validate --all --strict --no-interactive`，24/24 通过，支持既有 `skip_specs: true` 文档变更；无需虚构运行时 delta。

## P2：能力扩展，尚未承诺排期

前三项能力建设已形成[统一方案](openspec/changes/archive/2026-09-18-extend-deterministic-test-orchestration/design.md)与[实施任务](openspec/changes/archive/2026-09-18-extend-deterministic-test-orchestration/tasks.md)，流程复用/数据驱动、代码校验/环境清理、单设备串行套件已实现，声明的双端编排与 Fixture 业务验收完成，change 已归档；验收边界见[报告](docs/test-orchestration-validation.md)。

- [x] **流程复用与数据驱动（代码与自动化）**：直接扩展当前 YAML，无 version: 2 门槛；类型参数、JSON 数据行、条件、有界循环和注册子流程，保留原始步骤证据映射。
- [x] **套件与 CI（本机串行）**：单设备串行队列、标签筛选、安全重试、case/attempt 历史及 JSON/JUnit；多设备并行另立方案。

- [x] **可信注册代码与业务验证器（受控 API 验证）**：已补[开源调研与接入建议](docs/research/code-extensions-and-ai-recovery.md)，可信注册实现已加入工作区；独立读取业务状态，定义权限、超时、数据清理和失败语义；先针对自研 App 形成可重复样例。
- [x] **自研测试 App 双端业务闭环**：[Test Fixture App + Server](docs/business-test-fixture.md) 的 Android/iOS 真机 UI→SQLite 独立校验→清理正反例通过，各 36 份材料重启复验，双端慢请求交互通过；夹具 change 7/7、原编排 4.5 完成。
- [x] **双端编排矩阵补验**：2026-09-18 Android PLA110 与 iPhone 16 Plus 均通过多数据、真假分支、嵌套子流程、循环、故意失败和取消队列，各 50 份证据重启复验；原编排 4.4 完成，change 22/22。见[报告](docs/test-orchestration-validation.md)；旧手机 ADB 根因独立保留。
- [x] **有限 AI 导航恢复闭环（已验范围）**：受控候选、YAML recover、证据、recovered/CI、Viewer 与历史已接入；DeepSeek Flash 图片对照及 iOS、Android PLA110 各 36/36、各 402 份证据重启复验通过，状态栏误拒绝已修复。见[用法](docs/ai-recovery.md)与[验收](docs/ai-recovery-validation.md)。
- [ ] **AI 恢复扩展验收**：AppClaw/Midscene 对照、真实浮层遮挡与跨 backend 成本对照仍待完成；[完整 change 16/21](openspec/changes/add-bounded-ai-recovery/tasks.md)不因当前闭环通过而整体关闭。旧手机 ADB 根因单列，生成用例与通用 AI 步骤继续后置。
- [ ] **视觉与遮挡验证**：在声明 blocker 之外评估图像检查与未知遮挡；先测误报/漏报，再决定能否作为必需门禁。
- [x] **失败分析与跨次比较**：确定性 comparison、Evidence Reduction、Viewer/DSH/MCP 共用 Diagnostic Context、稳定 evidence refs 与历史聚合已实现；Android/iOS Fixture 均完成两次正常运行、故意业务失败、严格/复核比较、Viewer、证据回钻与重启哈希复核，Codex 受控消费已验，change 已归档。旧记录不迁移；不做内置通用 AI Analyzer、AI 根因或 verdict、视觉门禁。见[使用](docs/run-comparison-analysis.md)、[验收](docs/run-comparison-validation.md)和[归档任务](openspec/changes/archive/2026-09-18-add-run-comparison-analysis/tasks.md)。
- [x] **脱敏运行归档导入**：`mobile-mirror-run` v1 JSON 经过完成态、大小、引用、字节数和 SHA-256 校验后分配新 runId；Viewer 可在无设备时回看失败步骤。iOS 历史标题缺口已提炼为不含真实设备/会话/截图的仓库 fixture，并用于 Web 回归；不自动脱敏、不接受任意目录或录像。
- [ ] **其他历史增强**：跨片段时间线、Allure 等额外报告格式与完整 App 构建来源；JSON/JUnit、case/attempt 关系及运行输入快照已实现，原始敏感材料保持本机。
- [x] **Maestro fork adapter 决策收口（功能未实现）**：暂不立项或排期；当前没有需要迁移的 Maestro YAML 用例库，现有 AppClaw YAML + MirrorService/Appium 已覆盖近期固定回归目标。只有出现规模化既有 Maestro 资产、当前执行器无法覆盖的已确认关键语义，或外部明确要求原生 Maestro 输入时才重评；届时先建立独立 OpenSpec，并验证固定 fork、双端真机和唯一设备 owner。见 [ADR 0006](docs/decisions/0006-native-yaml-workbench.md#2026-09-18maestro-fork-adapter-暂缓)。
- [x] **显式真机跨进程所有权**：新 Appium 会话按平台/设备 ID 使用固定机器目录 claim，验证两个进程竞争、PID 启动身份与 nonce 释放；只约束本工具内置 runtime，不覆盖外部 ADB/Appium，也不等同于多设备调度或共享 daemon。
- [ ] **PTC / Codex 宿主无关运行入口**：五项共享工具、持久幂等受理、取消、证据权限、Viewer 来源和受理崩溃恢复已实现；历史同 tarball MCP、DSH 0.1.5-rc.2 Native/PTC 与 Android/iPhone Fixture 验收通过；新 0.2.0-rc.2 合并候选同包宿主验证另见[记录](openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)，未重跑真机，dispose 遗留 device claim 已由真机复验发现并修复。剩余真实模型图片消费；见[用法](docs/agent-test-run-control.md)、[验收](docs/agent-test-run-control-validation.md)、[调研](docs/research/ptc-architecture-and-codex-2026-09-17.md)和 [ADR 0008](docs/decisions/0008-ptc-host-neutral-orchestration.md)。默认不做历史兼容，需要时先询问。
- [ ] **设备与恢复矩阵**：更多 Android OEM/版本/TCP、至少两个 iOS 大版本及免费开发者账号、锁屏/旋转/断线/信任变化/权限弹窗；Android 音频另验。
- [ ] **发布与生产化**：SBOM、依赖升级矩阵、诊断包、稳定版支持策略；旧候选的新前缀 peer 冲突已由固定 DSH 0.2.0-rc.2 的新候选通过干净前缀安装及 peer 检查收口，见[合并验证](openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)；这不等于公开发布或任意环境兼容。远程设备网格和公共 npm 仅在明确需求后推进。

## OpenSpec 活动任务快照（2026-10-12）

原发布检查发现的历史绝对路径已纳入本轮全历史清洗。旧[文档审计](docs/dev-documentation-audit-2026-10-07.md)保留当时结论，本轮结果单独记录，不添加扫描豁免。

下表按当前活动 change 的 tasks 逐项统计，由文档检查核对覆盖与计数。计数仅表示复选框，不替代证据审阅；DSH 升级尚未归档，历史验收报告保留当时日期，归档记录见[archive](openspec/changes/archive/)。

| Change | 完成/总数 | 当前边界 |
| --- | --- | --- |
| [sanitize-published-history](openspec/changes/sanitize-published-history/tasks.md) | 5/5 | 远端全引用清洗、新克隆复查和本地切换完成；平台缓存删除仍待支持中心处理 |
| [add-context-aware-environment-preflight](openspec/changes/add-context-aware-environment-preflight/tasks.md) | 28/29 | 已有入口预检实现；真实环境验收按原任务保留 |
| [add-guided-simulator-support](openspec/changes/add-guided-simulator-support/tasks.md) | 5/6 | 保留本地模拟器实现与证据，不代表真机验收 |
| [port-report-playback-and-web-selftest](openspec/changes/port-report-playback-and-web-selftest/tasks.md) | 13/13 | 已交付 dev；当时历史门禁阻塞由后续历史脱敏任务处理，未发布 |
| [prepare-guided-beta-kit](openspec/changes/prepare-guided-beta-kit/tasks.md) | 8/10 | 内测材料已完成，独立用户体验待补 |
| [add-agent-test-run-control](openspec/changes/add-agent-test-run-control/tasks.md) | 15/16 | 同包/Fixture已验；两宿主真实图片模型消费待补 |
| [add-bounded-ai-recovery](openspec/changes/add-bounded-ai-recovery/tasks.md) | 16/21 | 双端有限恢复已验；SDK对照/真实遮挡/旧设备链路待补 |
| [add-change-acceptance-records](openspec/changes/add-change-acceptance-records/tasks.md) | 21/24 | 对象/覆盖/修订已实现；真实变更与独立评审待补 |
| [add-evidence-guided-failure-triage](openspec/changes/add-evidence-guided-failure-triage/tasks.md) | 12/53 | 实验实现存在；完整契约/故障/语料/独立诊断验收按清单补证 |
| [add-evidence-guided-repair-loop](openspec/changes/add-evidence-guided-repair-loop/tasks.md) | 54/65 | Preview 默认关闭；iPhone 导航/host forwarding 复验完成，真实修复闭环及独立验收待补 |
| [add-external-test-assets](openspec/changes/add-external-test-assets/tasks.md) | 21/24 | 报告/附件接入已实现；方言/缺材料/外部使用者待补 |
| [add-guided-mobile-acceptance](openspec/changes/add-guided-mobile-acceptance/tasks.md) | 15/16 | 双端Fixture联合已验；独立首测研究待补 |
| [add-local-ocr-and-device-matrix](openspec/changes/add-local-ocr-and-device-matrix/tasks.md) | 33/39 | 冻结评测/批准和矩阵工程已验；真实质量/双槽/迁移待补 |
| [add-semantic-agent-actions](openspec/changes/add-semantic-agent-actions/tasks.md) | 74/76 | 双端样本已验；CI/明确授权发布任务仍未关闭 |
| [add-workbench-authoring-and-visual-validation](openspec/changes/add-workbench-authoring-and-visual-validation/tasks.md) | 22/45 | 创作/视觉/公共投影已实现；完整同包/真实变更/收益待补 |
| [add-workbench-health-performance-gates](openspec/changes/add-workbench-health-performance-gates/tasks.md) | 29/32 | iPhone live 来源探查完成；可信健康放行和真实业务端点待补 |
| [add-workbench-long-term-operations](openspec/changes/add-workbench-long-term-operations/tasks.md) | 33/68 | 趋势/分享/清理已实现；剩余故障/兼容/外部长期采用待补 |
| [add-workbench-temporal-assertions](openspec/changes/add-workbench-temporal-assertions/tasks.md) | 27/28 | 双端RuntimeFixture已验；真实业务持久性/幂等性待补 |
| [add-workbench-text-input-acceptance](openspec/changes/add-workbench-text-input-acceptance/tasks.md) | 9/10 | Android已验；iOS完整文字场景受可访问文本缺口限制 |
| [harden-workbench-adoption](openspec/changes/harden-workbench-adoption/tasks.md) | 28/36 | 来源/CLI/基准已有证据；完整故障/升级和试点仍缺 |
| [improve-report-reading-and-sharing](openspec/changes/improve-report-reading-and-sharing/tasks.md) | 41/46 | Safari 部分阅读及双端材料增量已验；完整离线/脱敏材料/健康来源/五人研究待补 |
| [improve-workbench-authoring-and-analysis](openspec/changes/improve-workbench-authoring-and-analysis/tasks.md) | 37/38 | 创作用例/分析工程及既有Fixture证据；五人独立研究待补 |
| [upgrade-dsh-020-rc2](openspec/changes/upgrade-dsh-020-rc2/tasks.md) | 11/11 | 精确 0.2.0-rc.2 同包/四组合宿主验证已通过，尚未归档；不含真实模型/真机新验收 |

维护规则：新增结论先记录来源与日期；架构边界变化更新 ADR；实现勾选必须带验证入口；新真机结果更新验证文档而不覆盖旧 run；里程碑按验收证据关闭，不按计划日期关闭。
