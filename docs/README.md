# 工程文档索引

从 [README 快速开始](../README.zh-CN.md#快速开始)或[内测任务卡](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-start.md)进入当前 `main` 源码。能力状态集中在[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)，优先级与活动任务计数集中在 [PRODUCT_TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)；本页只提供阅读导航。

历史报告保留原日期、版本与验收范围。迁移前的 `dev`、旧产品名和 `REDACTED_REVISION` 不代表当前 FlowAssert 已重新验收；脱敏占位值也不能直接用于真机。详见[历史资料说明](privacy-history-cleanup.md)与[发布准备](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md)。

## 产品、使用与接入

| 任务 | 阅读入口 |
| --- | --- |
| 首次体验、排障与反馈 | [内测任务卡](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-start.md) · [FAQ](https://github.com/qmkCamel/flowassert/blob/main/docs/faq.md) · [反馈模板](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-feedback.md) · [术语](glossary.md) |
| 判断适用性与能力边界 | [采用指南](https://github.com/qmkCamel/flowassert/blob/main/docs/adoption-guide.md) · [能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md) · [产品形态](product-shape.md) |
| 启动 Viewer、检查环境 | [本机 Viewer](local-viewer.md) · [环境预检 / Doctor](environment-preflight.md) |
| 连接设备 | [Android 真机](android-real-device.md) · [iPhone / WDA](ios-real-device.md) · [模拟器](simulators.md) |
| 编写与运行测试 | [工作台使用](test-workbench.md) · [编排与套件](test-orchestration.md) · [连续验收](guided-mobile-acceptance.md) |
| 接入业务验证 | [Fixture App + Server](https://github.com/qmkCamel/flowassert/blob/main/docs/business-test-fixture.md) · [HTTP 业务模板](workbench-business-template.md) · [运行时断言](runtime-assertions.md) |
| 阅读、回放、比较与分享结果 | [报告阅读与离线分享](report-reading-and-sharing.md) · [跨次比较](run-comparison-analysis.md) |
| 核对变更与导入报告 | [变更验收](change-acceptance-records.md) · [外部测试资产](external-test-assets.md) |
| 使用可选预览能力 | [本机 OCR](local-region-ocr.md) · [双槽矩阵](local-device-matrix.md) · [失败分诊](evidence-guided-triage.md) · [有限 AI 恢复](ai-recovery.md) · [修复操作](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md) |
| 接入 Agent 与无头执行 | [MCP 宿主](mcp-hosts.md) · [已登记测试执行](agent-test-run-control.md) · [Managed job](managed-job.md) |
| 配置 DSH 或候选包 | [安装与回滚](beta-installation.md) · [兼容边界](https://github.com/qmkCamel/flowassert/blob/main/docs/workbench-compatibility.md) |
| 开发、打包与维护 | [中文技术指南](technical-guide.zh-CN.md) · [English](technical-guide.md) · [工作台维护](workbench-maintenance.md) · [文档维护](documentation-maintenance.md) |
| 介绍与演示 | [46 秒产品视频](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-video/README.md) · [技术介绍](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/technical-introduction.zh-CN.md) · [内测介绍稿](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-introduction.zh-CN.md) · [离线 Mock 演示](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/mobile-mirror-demo.html) · [本机历史材料](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/local-recorded-demo.md) |

## 调研、方案与架构图

| 主题 | 阅读入口 |
| --- | --- |
| 当前架构与模块边界 | [核心架构](architecture.md) · [工作台架构与时序](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-current.md) · [插件友好 runtime](https://github.com/qmkCamel/flowassert/blob/main/docs/plugin-friendly-runtime.md) |
| 待评审方向 | [架构治理草稿](https://github.com/qmkCamel/flowassert/blob/main/docs/design/architecture-governance-draft.md) · [产品化路线图](https://github.com/qmkCamel/flowassert/blob/main/docs/roadmaps/workbench-productization.md) |
| 框架选择与历史调研 | [决策演变](https://github.com/qmkCamel/flowassert/blob/main/docs/research/framework-decisions.md) · [Maestro / Appium](https://github.com/qmkCamel/flowassert/blob/main/docs/research/maestro-vs-appium.md) · [竞品全景](https://github.com/qmkCamel/flowassert/blob/main/docs/research/product-landscape.md) · [ViewInspectKit](https://github.com/qmkCamel/flowassert/blob/main/docs/research/viewinspectkit-comparison.md) · [AppClaw](https://github.com/qmkCamel/flowassert/blob/main/docs/design/appclaw-evaluation.md) |
| 执行扩展与宿主编排 | [代码扩展 / AI 恢复](https://github.com/qmkCamel/flowassert/blob/main/docs/research/code-extensions-and-ai-recovery.md) · [PTC / Codex](https://github.com/qmkCamel/flowassert/blob/main/docs/research/ptc-architecture-and-codex-2026-09-17.md) |
| 历史目标设计与素材 | [原始设计](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench.md) · [架构源图](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-architecture.mmd) · [渲染图](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-architecture.svg) · [目标时序](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-sequence.mmd) · [Cordis / Harness 分享素材](https://github.com/qmkCamel/flowassert/blob/main/artifacts/share/README.md) |

调研按原日期阅读，不代表最新上游支持范围；目标设计与草稿不替代已接受的 ADR。原 Maestro-first 方向已由 ADR 0006 调整。

## 架构决策 ADR

| 文档 | 决策 |
| --- | --- |
| [0001](decisions/0001-appium-core-local-viewer.md) | Appium 控制与本机 Viewer |
| [0002](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0002-host-neutral-stdio-mcp-adapter.md) | 宿主无关 stdio MCP adapter |
| [0003](decisions/0003-low-latency-viewer-media.md) | 连续媒体与离散感知分离 |
| [0004](decisions/0004-guided-beta-and-managed-appium.md) | 引导安装与 managed Appium |
| [0005](decisions/0005-semantic-agent-actions.md) | 语义动作、输入与应用管理 |
| [0006](decisions/0006-native-yaml-workbench.md) | 原生 YAML、共享会话、证据与判定 |
| [0007](decisions/0007-observation-query-viewer-inspector.md) | Observation 查询与 Viewer Inspector |
| [0008](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0008-ptc-host-neutral-orchestration.md) | 宿主编排与固定测试执行分离 |
| [0010](decisions/0010-workbench-product-contract-boundary.md) | 工作台产品契约 |
| [0011](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0011-plugin-friendly-application-runtime.md) | 共享应用 runtime |
| [0012](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0012-evidence-consumer-and-executor-boundaries.md) | 证据消费者与执行器 |
| [0013](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0013-comparison-lifecycle-and-graph-boundaries.md) | 比较生命周期与依赖守卫 |
| [0014](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0014-worker-and-builtin-reference-governance.md) | Worker 与内置引用治理 |
| [0015 · 创作](decisions/0015-shared-durable-authoring-acceptance.md) | 持久化创作与验收 |
| [0015 · 双槽](decisions/0015-local-device-matrix.md) | 本机设备矩阵 |
| [0016 · 门禁](decisions/0016-bounded-runtime-gates.md) | 有界运行时断言与性能门禁 |
| [0016 · 修复](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0016-evidence-guided-repair-verification.md) | 双路径修复与独立验证 |
| [0028](https://github.com/qmkCamel/flowassert/blob/main/docs/decisions/0028-web-self-hosted-execution.md) | Web 自托管执行 |

沿用现有文件名；重复编号用主题区分，不在文档整理中改写决策身份或状态。

## 验证、发布与治理

| 要核对的证据 | 阅读入口 |
| --- | --- |
| 整体与物理设备 | [验证记录](validation.md) · [基础工作台](workbench-validation.md) · [10 月 5 日](physical-validation-2026-10-05.md) · [10 月 7 日续验](physical-validation-2026-10-07.md) |
| 平台与取证 | [Android](https://github.com/qmkCamel/flowassert/blob/main/docs/android-acceptance-2026-09-16.md) · [iPhone](ios-acceptance-2026-09-15.md) · [Inspector](inspector-validation.md) · [截图录屏](viewer-capture-validation.md) · [视频历史](workbench-video-validation.md) |
| 文字与业务场景 | [AI 文字](sampleapp-ai-text-validation.md) · [iOS 输入修复](https://github.com/qmkCamel/flowassert/blob/main/docs/sampleapp-ios-input-fix.md) · [iOS 业务 / Codex 图片](https://github.com/qmkCamel/flowassert/blob/main/docs/ios-business-and-codex-vision-validation-2026-09-16.md) · [录像生成 YAML](https://github.com/qmkCamel/flowassert/blob/main/docs/sampleapp-video-yaml-ios-validation-2026-09-24.md) |
| 执行、稳定性与采用 | [P0](workbench-p0-validation.md) · [可靠性矩阵](workbench-reliability-matrix.md) · [运行时门禁](runtime-gates-validation.md) · [编排](https://github.com/qmkCamel/flowassert/blob/main/docs/test-orchestration-validation.md) · [AI 恢复](https://github.com/qmkCamel/flowassert/blob/main/docs/ai-recovery-validation.md) · [比较](run-comparison-validation.md) · [采用](workbench-adoption-validation.md) |
| 包与宿主 | [历史包](packaged-runtime-validation.md) · [DSH rc.2](dsh-020-validation.md) · [DSH 合并候选](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md) · [Agent 运行入口](agent-test-run-control-validation.md) |
| 架构与集成 | [插件 runtime](https://github.com/qmkCamel/flowassert/blob/main/docs/plugin-friendly-runtime-validation.md) · [证据边界](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-runtime-boundaries-validation.md) · [生命周期](https://github.com/qmkCamel/flowassert/blob/main/docs/runtime-lifecycle-validation.md) · [Worker 治理](https://github.com/qmkCamel/flowassert/blob/main/docs/worker-reference-governance-validation.md) · [变更验收集成](https://github.com/qmkCamel/flowassert/blob/main/docs/change-acceptance-dev-integration.md) |
| 报告、演示与 Web 自检 | [报告实施验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/improve-report-reading-and-sharing/implementation-validation.md) · [回迁验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/port-report-playback-and-web-selftest/implementation-validation.md) · [演示验证](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/beta-demo-validation.md) · [截图记录](https://github.com/qmkCamel/flowassert/blob/main/docs/screenshot-refresh-2026-10-08.md) · [Web 视觉自检](web-visual-acceptance.md) |
| 安全与发布 | [安全模型](security.md) · [发布准备](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md) · [迁移审计](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-audit-2026-10-24.md) · [依赖修复](https://github.com/qmkCamel/flowassert/blob/main/docs/security-remediation-2026-10-24.md) · [alpha.1 历史说明](releases/0.1.0-alpha.1.md) · [alpha.2 候选说明](releases/0.1.0-alpha.2.md) |
| 进度与规范 | [PRODUCT_TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md) · [里程碑](milestones.md) · [主规格](https://github.com/qmkCamel/flowassert/tree/main/openspec/specs/) · [活动变更](https://github.com/qmkCamel/flowassert/tree/main/openspec/changes/) · [归档](https://github.com/qmkCamel/flowassert/tree/main/openspec/changes/archive/) |
| 历史文档核对 | [10 月 7 日整体核对](https://github.com/qmkCamel/flowassert/blob/main/docs/dev-documentation-audit-2026-10-07.md) · [同日较早记录](https://github.com/qmkCamel/flowassert/blob/main/docs/documentation-review-2026-10-07.md) |

脱敏汇总指标位于 `artifacts/metrics/`；原始真机材料保留在被忽略的本机目录，全新克隆不包含这些原件。版本说明、任务勾选和历史报告均不能单独证明当前安装、平台访问或真机验收。
