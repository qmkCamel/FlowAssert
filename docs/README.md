# 工程文档索引

历史资料已执行[隐私清洗](privacy-history-cleanup.md)。第三方 App 的名称、包名、版本和选择器为脱敏占位值；旧修订与被移除截图不再作为公开证据入口。

首次阅读：[试用 FAQ](https://github.com/qmkCamel/flowassert/blob/main/docs/faq.md) · [术语解释](glossary.md) · [通用技术介绍](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/technical-introduction.zh-CN.md)。

离线演示支持[显式导出的本机历史材料](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/local-recorded-demo.md)，不附带业务原件。

报告与自检：[截图回放和动作对照](report-reading-and-sharing.md) · [可选 Web 视觉自检](web-visual-acceptance.md) · [本轮回迁验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/port-report-playback-and-web-selftest/implementation-validation.md)。维护者参见[文档维护](documentation-maintenance.md)和[工作台维护](workbench-maintenance.md)。

模拟器接入：[Android Emulator / iOS Simulator 连接指南](simulators.md)。

首次内测：直接使用 dev 分支，[源码任务卡](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-start.md) · [反馈记录](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-feedback.md) · [离线 Mock 演示](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/mobile-mirror-demo.html) · [演示验证](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/beta-demo-validation.md)。

截图更新：[2026-10-08 文档截图刷新与验证](https://github.com/qmkCamel/flowassert/blob/main/docs/screenshot-refresh-2026-10-08.md)（20 张 Mock／合成／脱敏示例，不代表新增真机验收）。

最新：[真机续验与剩余缺口](physical-validation-2026-10-07.md) · [dev 整体文档核对](https://github.com/qmkCamel/flowassert/blob/main/docs/dev-documentation-audit-2026-10-07.md) · [DSH 0.2.0-rc.2 验证](dsh-020-validation.md) · [合并候选同包验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)。

更新：2026-10-07，核对基线 `dev@REDACTED_REVISION` 并补本轮真机续验。能力状态以[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)为集中入口，对外介绍见[宣传稿](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-introduction.zh-CN.md)。先看[当前架构](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-current.md)、[产品 TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)和[里程碑](milestones.md)，再按主题查证。当前默认方案以 [ADR 0006](decisions/0006-native-yaml-workbench.md) 为准；历史调研保留原日期和证据，不覆盖当前决策。

## 产品、使用与接入

新增：[按入口与操作的环境预检 / Doctor v2](environment-preflight.md)。Codex/MCP 不检查 DSH；报告和 Mock 不扫描手机。DSH 静态元数据与实际启用状态分开验证。

本轮整体核对与修订范围见[文档核对记录](https://github.com/qmkCamel/flowassert/blob/main/docs/dev-documentation-audit-2026-10-07.md)；[较早的同日记录](https://github.com/qmkCamel/flowassert/blob/main/docs/documentation-review-2026-10-07.md)保留旧基线结论。
**Preview（默认关闭，54/65）**（M1/M2 离线工程链已实现；M3 构建与 Mock 安装协议部分实现，真机/宿主验收待完成）：[双路径修复与统一验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-repair-loop/design.md) · [实施进度与证据](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-repair-loop/implementation.md) · [分阶段任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-repair-loop/tasks.md) · [ADR 0016](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0016-evidence-guided-repair-verification.md)。Mock 制品与安装回执不是签名、Appium 或真机修复证明。

本机使用与停用步骤见[证据驱动修复操作指南](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。

10-06 页面范围／自有转发安全修复和分层验证见[修复记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-repair-loop/safety-fixes-validation.md)：Android 10/10，真实上游转发工厂本机测试通过；当日 iPhone 会话因 Xcode Offline 未建立。10-07 已补 live iPhone 13/13 与真实 host forwarding loopback 检查，114 份证据重读；完整修复闭环仍未完成，见[续验对账](physical-validation-2026-10-07.md)。

真实业务验收对象：[Test Fixture App + Server](https://github.com/qmkCamel/flowassert/blob/main/docs/business-test-fixture.md)，包含双端源码、构建、独立 API 校验与清理流程。

| 文档 | 内容 |
| --- | --- |
| [采用指南与适用性评估](https://github.com/qmkCamel/flowassert/blob/main/docs/adoption-guide.md) | 围绕准实时观看、固定流程、可信留证和结果回溯判断是否适用，并给出分阶段采用与放行清单 |
| [能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md) | 当前能力、双端验收、限制与证据入口 |
| [六项迭代原路线图](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-change-acceptance-records/roadmap.md) | 10 月 3 日 89/103 历史快照；工程完成与真实验收分离，逐项列明真机、材料、独立人员和归档条件 |
| [10 月 5 日双端真机增量与 dev 合入](physical-validation-2026-10-05.md) | 当前六项关联任务 90/103；焦点修复、创作／业务／故障证据、30 次基准、合并门禁与未完成边界；原始材料不公开 |
| [10 月 7 日真机续验与全项目缺口对账](physical-validation-2026-10-07.md) | health live 探查、iPhone 13/13 修复导航/转发、分候选双端故障/恢复/录像及只读复验；真实业务与批准视觉/OCR 仍缺，私有原件不上传 |
| [宣传稿与演示提纲](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-introduction.zh-CN.md) | 长版/短版介绍、演示脚本及事实依据；未对外发布 |
| [产品形态](product-shape.md) | 双端设备桥接、工作台、Agent 与 Viewer 边界 |
| [工作台使用](test-workbench.md) | YAML、断言、运行/取消、证据、结果、历史与脱敏归档导入 |
| [报告阅读与离线分享](report-reading-and-sharing.md) · [实施验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/improve-report-reading-and-sharing/implementation-validation.md) | 报告目录、失败/图片阅读、历史趋势、画框遮蔽、冻结审查与被动 HTML；41/46，外部验收待补 |
| [运行时断言](runtime-assertions.md) · [验收与合并审计](runtime-gates-validation.md) · [ADR 0016](decisions/0016-bounded-runtime-gates.md) | 有界时间／重启／业务断言与端到端时间门禁；双端独立 Fixture 及 USB／自有宿主中断已验，iPhone 来源探查完成但健康/业务未放行；两项 OpenSpec 为 27/28、29/32 |
| [连续验收指南](guided-mobile-acceptance.md) | 首次引导、语义就绪、证据核查与关联复验 |
| [变更验收对象](change-acceptance-records.md) · [外部测试资产](external-test-assets.md) | 提交／制品覆盖、修订和摘要；报告／附件导入与逐项目授权，不执行外部 runner |
| [本机 OCR](local-region-ocr.md) · [双槽矩阵](local-device-matrix.md) | 候选预览、冻结评测与人工批准；独立子进程调度、取消／复跑／证据归并 |
| [六项集成工程证据](https://github.com/qmkCamel/flowassert/blob/main/artifacts/local-device-matrix/validation.md) | 747 测试、62 E2E、同包 20 工具及 DSH Native/PTC；与真实验收分开 |
| [六项合入 dev 验证](https://github.com/qmkCamel/flowassert/blob/main/docs/change-acceptance-dev-integration.md) | 合并治理能力后的 810 测试、64 E2E、应用与 MCP 探针；记录合并适配及真实验收边界 |
| [证据引导的失败分诊](evidence-guided-triage.md) | 实验入口、CLI/Agent 只读权限、人工复核与未完成验收 |
| [失败分析与跨次比较](run-comparison-analysis.md) · [验收](run-comparison-validation.md) | 确定性比较、Evidence Reduction、Viewer/DSH/MCP 共用 Diagnostic Context、Agent 回钻与 AI 边界；Android/iOS Fixture 已验 |
| [Agent 运行已登记测试](agent-test-run-control.md) · [验收](agent-test-run-control-validation.md) | 五工具、幂等受理、取消、证据权限、设备 owner 与宿主验证边界 |
| [独立 Viewer](local-viewer.md) | 本机启动、配置、连接 |
| [Beta 安装](beta-installation.md) | 当前源码候选与已发布包分开；alpha.2 不因文档/包版本存在而可下载，源码验证固定 DSH 0.2.0-rc.2，合并候选新前缀安装及 peer 检查通过；不外推任意环境 |
| [MCP 宿主](mcp-hosts.md) | Codex/通用 MCP 配置与权限 |
| [Android 真机](android-real-device.md) · [iPhone 真机](ios-real-device.md) | 平台依赖、签名、限制和操作说明 |
| [技术指南（中文）](technical-guide.zh-CN.md) · [English](technical-guide.md) | 工程与工具使用细节 |

## 调研、方案与架构图

| 文档 | 性质与阅读边界 |
| --- | --- |
| [失败分析与跨次比较](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-run-comparison-analysis/design.md) · [归档任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-run-comparison-analysis/tasks.md) | 已落地架构、双端真机验收及主 spec 同步；`Raw Runs → Alignment → Diff → Evidence Reduction → Diagnostic Context → Viewer/MCP/Any Agent`；AI 不参与事实或 verdict |
| [编排与套件使用](test-orchestration.md) · [验收](https://github.com/qmkCamel/flowassert/blob/main/docs/test-orchestration-validation.md) | 统一 YAML、注册代码扩展、单设备串行、报告与验证边界 |
| [确定性回归三阶段方案](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-extend-deterministic-test-orchestration/design.md) | 流程复用与数据驱动、代码校验与清理、串行套件；参考对象、缺口映射和归档验收 |
| [代码扩展与自然语言恢复](https://github.com/qmkCamel/flowassert/blob/main/docs/research/code-extensions-and-ai-recovery.md) | 历史调研；当前代码扩展与受控 AI 恢复已有实现，验收边界见下方 |
| [有限 AI 恢复](ai-recovery.md) / [验收](https://github.com/qmkCamel/flowassert/blob/main/docs/ai-recovery-validation.md) / [设计](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-bounded-ai-recovery/design.md) | DeepSeek 图片与 iOS 真机验证通过；Android 核心能力已有证据，稳定性与开源对照仍待完成 |
| [框架选型与决策演变](https://github.com/qmkCamel/flowassert/blob/main/docs/research/framework-decisions.md) | 当前组合、候选角色、为什么改变早期结论 |
| [ViewInspectKit 比较](https://github.com/qmkCamel/flowassert/blob/main/docs/research/viewinspectkit-comparison.md) | 本地源码快照比较；查询/Inspector 借鉴，不代表其公开授权 |
| [Maestro 与 Appium](https://github.com/qmkCamel/flowassert/blob/main/docs/research/maestro-vs-appium.md) | 2026-08-25 官方支持面快照；后来 PR 3100 fork 已实测 |
| [竞品全景](https://github.com/qmkCamel/flowassert/blob/main/docs/research/product-landscape.md) | 2026-08 调研；Appium MCP/Mobile MCP/Midscene 等，非最新上游状态 |
| [AppClaw 评估](https://github.com/qmkCamel/flowassert/blob/main/docs/design/appclaw-evaluation.md) | 2026-09-10 源码/独立 SDK PoC；后续采用有限 facade 路线 |
| [第三方 App iPhone 三路线对照](https://github.com/qmkCamel/flowassert/blob/main/docs/design/sampleapp-iphone-real-device-validation.md) | 2026-09-10 三条链路对照，不是最终工作台验收 |
| [当前工作台架构与时序图](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-current.md) | 2026-10-07 当前模块、共享应用服务、报告投影与 Mermaid 图 |
| [工作台架构治理草稿](https://github.com/qmkCamel/flowassert/blob/main/docs/design/architecture-governance-draft.md) | 基于已提交 dev 的待评审治理方向、迁移顺序和验收切口；不是已接受的 ADR 或交付状态 |
| [插件友好模块架构](https://github.com/qmkCamel/flowassert/blob/main/docs/plugin-friendly-runtime.md) · [ADR 0011](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0011-plugin-friendly-application-runtime.md) · [验收](https://github.com/qmkCamel/flowassert/blob/main/docs/plugin-friendly-runtime-validation.md) | 共享服务组装、可靠关闭、领域/引用边界和受信任分诊分析器扩展 |
| [证据与执行边界](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0012-evidence-consumer-and-executor-boundaries.md) · [验收与查询基准](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-runtime-boundaries-validation.md) | comparison/share 统一引用、退休与旧版保护，Worker v1 校验、规模测量和捕获时序回归 |
| [比较生命周期与依赖守卫](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0013-comparison-lifecycle-and-graph-boundaries.md) · [生命周期审计与验收](https://github.com/qmkCamel/flowassert/blob/main/docs/runtime-lifecycle-validation.md) | 比较关闭/终止失败/重启接管、全 src 依赖图及尚未统一的 Worker 回收边界 |
| [Worker 与内置引用治理](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0014-worker-and-builtin-reference-governance.md) · [验收](https://github.com/qmkCamel/flowassert/blob/main/docs/worker-reference-governance-validation.md) | 2026-10-01 补齐剩余 Worker 退出、suite/baseline/Agent/pin/child 发布与退休；真机暂缓 |
| [核心架构](architecture.md) | Runtime、adapter、provider 与媒体实现分层 |
| [完整目标设计](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench.md) | 2026-09-09/10 历史目标，含未实现的扩展；Maestro-first 已被 ADR 0006 调整 |
| [目标图 Mermaid](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-architecture.mmd) · [DOT](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-architecture.dot) · [SVG](https://raw.githubusercontent.com/qmkCamel/flowassert/main/docs/design/mobile-test-workbench-architecture.svg) · [PNG](https://raw.githubusercontent.com/qmkCamel/flowassert/main/docs/design/mobile-test-workbench-architecture.png) | 原目标架构的源文件与渲染，不是当前部署图 |
| [目标时序图](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-sequence.mmd) | 原目标架构对应时序 |
| [Inspector proposal](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/proposal.md) · [design](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/design.md) · [tasks](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/tasks.md) | 实现和验收 39/39，已归档；ADR 0007 已接受，含双端真机及打包宿主验证 |

## 架构决策 ADR

| 文档 | 决策 |
| --- | --- |
| [0001](decisions/0001-appium-core-local-viewer.md) | Appium 控制与本机 Viewer |
| [0002](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0002-host-neutral-stdio-mcp-adapter.md) | 宿主无关 stdio MCP adapter |
| [0003](decisions/0003-low-latency-viewer-media.md) | 低延迟媒体与离散感知分离 |
| [0004](decisions/0004-guided-beta-and-managed-appium.md) | 引导安装与 managed Appium |
| [0005](decisions/0005-semantic-agent-actions.md) | 语义动作、输入与应用管理边界 |
| [0006](decisions/0006-native-yaml-workbench.md) | AppClaw 原生 YAML、共享会话、证据与判定 |
| [0007](decisions/0007-observation-query-viewer-inspector.md) | observation 内查询与独立 Viewer Inspector |
| [0008](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0008-ptc-host-neutral-orchestration.md) | PTC/Codex 只编排，固定测试继续由 Workbench 执行 |
| [0010](decisions/0010-workbench-product-contract-boundary.md) | 工作台产品契约与边界 |
| [0011](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0011-plugin-friendly-application-runtime.md) | 插件友好共享应用 runtime |
| [0012](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0012-evidence-consumer-and-executor-boundaries.md) | 证据消费者与执行器边界 |
| [0013](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0013-comparison-lifecycle-and-graph-boundaries.md) | 比较生命周期与依赖守卫 |
| [0014](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0014-worker-and-builtin-reference-governance.md) | Worker 与内置引用治理 |
| [0015 · 创作](decisions/0015-shared-durable-authoring-acceptance.md) | 共享持久化创作与验收 |
| [0015 · 双槽](decisions/0015-local-device-matrix.md) | 本机双槽设备矩阵 |
| [0016](decisions/0016-bounded-runtime-gates.md) | 有界运行时断言与性能门禁 |

现有 ADR 目录没有 0009，且有两个 0015；本次按现有文件索引，不改编号或决策状态。

## 验证、发布与治理

| 文档 | 内容 |
| --- | --- |
| [Viewer 手动截图与录屏](viewer-capture-validation.md) | 浏览器真实导出/回放、Android 第三方 App并行录制及本机证据 |
| [iPhone 补充验收](ios-acceptance-2026-09-15.md) | 首次/快速连接、录屏、生命周期及输入修复后的真机验收 |
| [Observation 查询与 Viewer Inspector](inspector-validation.md) | 只读查询、本机冻结图/节点联动与独立验收边界 |
| [工作台视频历史](workbench-video-validation.md) | run 录像归档、哈希、重启回放、步骤定位与验证边界 |
| [Android 补充验收](https://github.com/qmkCamel/flowassert/blob/main/docs/android-acceptance-2026-09-16.md) | 向导、语义输入、视频归档及 ADB 稳定性限制 |
| [iOS 业务与 Codex 图片复验](https://github.com/qmkCamel/flowassert/blob/main/docs/ios-business-and-codex-vision-validation-2026-09-16.md) | 图片单场景通过；iOS 完整文字 YAML 仍失败，DSH 图片链路待验 |
| [打包与宿主验证](packaged-runtime-validation.md) | 2026-09-16 历史同包验证，DSH rc.1；当前 rc.2 见报告实施验证 |
| [Agent 运行入口验收](agent-test-run-control-validation.md) | 同 tarball MCP/DSH rc.2、崩溃恢复、Viewer 与待补真机/模型边界 |
| [整体验证](validation.md) | Mock、provider、宿主、媒体与已有验证层次 |
| [P0 稳定性与取证验证](workbench-p0-validation.md) | P0 三项完成：进程回收、阶段计时、故障/强杀恢复、双端三轮与样本预算 |
| [工作台双端真机验证](workbench-validation.md) | 正反例、runId、耗时、材料哈希、OEM/WDA 问题与边界 |
| [第三方 App AI 文字验收](sampleapp-ai-text-validation.md) | YAML 输入、Android 文字消息/回复/历史、故意失败与证据复验 |
| [iOS 输入修复与补验](https://github.com/qmkCamel/flowassert/blob/main/docs/sampleapp-ios-input-fix.md) | 同边界 TextView、焦点与追加语义修复；最终真机复验状态 |
| [录像生成 YAML 的 iOS 真机验证](https://github.com/qmkCamel/flowassert/blob/main/docs/sampleapp-video-yaml-ios-validation-2026-09-24.md) | 文字输入到历史列表前 11 步通过、历史标题可访问性失败，以及脱敏回归归档 |
| [安全边界](security.md) | 授权、脱敏、loopback、会话所有权 |
| [公开发布准备](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md) | 历史审计与公开面门禁 |
| [alpha.1 说明](releases/0.1.0-alpha.1.md) · [alpha.2 说明](releases/0.1.0-alpha.2.md) | 版本说明；文件存在不等于相应新 tag/资产已发布 |
| [PRODUCT_TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md) · [milestones](milestones.md) | 优先级、验收缺口、里程碑、active change 计数 |
| [主规格](https://github.com/qmkCamel/flowassert/blob/main/openspec/specs/) · [活动变更](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/) · [已归档变更](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/) | 行为真相、设计、详细任务与历史 |

脱敏汇总指标在 `artifacts/metrics/`；原始真机材料在被 Git 忽略的 `artifacts/physical-validation/` 或本机私有 runs 目录。历史报告用“仅本机”路径说明原始材料位置，全新 clone 不包含这些材料；公开报告、任务状态与本地原始材料分别管理。

维护约定：研究写明来源/版本/日期；当前决策写入 ADR；产品状态更新 TODO 和里程碑；详细验收更新 OpenSpec；真机结论写入验证文档并保留 runId。旧报告标记“历史”并链接新决策，不抹去结论演变。

交互宣传素材：[离线 HTML 演示](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/mobile-mirror-demo.html)（本机 Android 第三方 App证据回放 + 离线 Mock；原始素材不随仓库分发）。

PTC 升级评估：[最新 runtime、升级时机与 Codex 适配](https://github.com/qmkCamel/flowassert/blob/main/docs/research/ptc-architecture-and-codex-2026-09-17.md) · [ADR 0008（Proposed）](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0008-ptc-host-neutral-orchestration.md)。

技术分享素材：[Cordis 插件框架与 Harness 生命周期图](https://github.com/qmkCamel/flowassert/blob/main/artifacts/share/README.md)（概念示意，不是真机验收证据）。
