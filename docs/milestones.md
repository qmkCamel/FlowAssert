# 产品里程碑

## 2026-10-08 小范围内测材料

统一[dev 分支内测入口](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-start.md)、提交 SHA、首轮任务和反馈；重写[宣传稿](https://github.com/qmkCamel/flowassert/blob/main/docs/communications/product-introduction.zh-CN.md)，演示默认不依赖私人媒体，增加失败→新记录复验→模拟报告分享。按用户确认取消独立内测包分发，既有包验证仅保留为历史。邀请 3–5 位非作者为下一步外部验收，未伪造参与者成绩；分支内测不是正式发布，历史扫描仍按实际结果保留。

## 2026-10-07 真机续验：证据增量完成，完整验收仍待补

本轮验证分候选记账：live iPhone 修复导航 13/13、114 份证据复读及自有 WDA/MJPEG host forwarding loopback 检查完成，repair 为 54/65；iPhone live 诊断来源探查完成，health 为 29/32，但 crash/hang 来源不放行。双端受控故障、录像和历史材料复验新增证据；冻结 `REDACTED_REVISION` 候选的 Android 9 项、旋转/driver/server/host 中断及录像另行复跑通过。普通 Fixture 导航不等于 M3 构建安装/可信 reset/受审修复闭环。

报告刷新竞态已修复，慢读取保留原结果、局部进度和独立控件交互有回归及截图。完整代码门禁 1117 通过/1 历史公共检查失败，E2E 83 通过/1 条件跳过（性能另验通过），build/pack 通过；不能宣称全绿。用户暂无真实业务两构建、后端与批准视觉/OCR profile，独立参与者和当前候选人工中断仍缺。交付准备基线更新为 `REDACTED_REVISION`，其新增文档不改变已冻结运行代码；见[逐项证据、源码指纹和具体阻塞](physical-validation-2026-10-07.md)。

## 2026-10-07 修复 Preview 与 DSH 升级已合入 dev

修复通过 `REDACTED_REVISION` 合入，53/65，默认关闭；M1/M2 软件链和 M3 Mock 协议不代表真机修复闭环。DSH 升级通过 `REDACTED_REVISION` 合入，精确 `0.2.0-rc.2`，11/11；合并候选 1099 项测试、82 项 E2E 通过/1 项跳过、构建/打包及 50 项 strict OpenSpec 通过，四组合真实宿主 clean-profile 验证通过。上述为各合并候选原记录，不是本轮真机或真实模型新验收。见[修复使用范围](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)、[DSH 合并验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)与[本轮文档核对](https://github.com/qmkCamel/flowassert/blob/main/docs/dev-documentation-audit-2026-10-07.md)。

当前任务快照：2026-10-07，`dev@REDACTED_REVISION` 加本轮续验。活动 change 为 18 项（17 项未完成，DSH 升级 11/11 待归档），逐项计数见[产品TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)；下列合并记录与里程碑注明各自日期和基线，不把历史待办直接当作当前未实现。

## 2026-10-07 报告阅读与离线分享：软件/同包已验，独立验收待补

目录摘要/50条分页、失败导航/图片阅读、用例历史/趋势、画框遮蔽与冻结HTML预览/下载已交付。944测试、80E2E及构建/打包通过；简单1000条摘要30冷/30热p95约250ms。实际Safari、完整真实材料/健康信号及5人研究未完成，41/46保持active。见[指南](report-reading-and-sharing.md)与[实施记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/improve-report-reading-and-sharing/implementation-validation.md)。

## 2026-10-06 运行时门禁合入dev：Fixture已验，健康/真实业务待补

合并基线a0b1652，时间断言27/28、健康/性能28/32。Android/iPhone独立RuntimeFixture时间/重启/性能正反例、取消、协调USB中断与自有宿主暂停有证据；这是特定窗口/用途验收，不关闭采用change的完整故障矩阵。可信crash/ANR/hang来源、真实持久性/幂等性/性能端点与独立采用仍待补。见[运行时审计](runtime-gates-validation.md)。

## 2026-10-05 双端真机增量合入 dev：完整验收仍待补

来源 `feat/physical-validation-oct@REDACTED_REVISION`，目标基线 `dev@REDACTED_REVISION`。合入 iOS provider-attested focus 修复、双端验证探针、冻结基准与证据摘要；不改 provider/transport 边界或 Harness agent loop。各平台固定 30 次通过、各 510 份材料校验；预算 Android 11715/iPhone 10821 ms 仅用于后续回归校准。

Inspector→失败→新修订复验、provenance、readiness／助手／业务 child 核查和受控故障片段有双端证据。前三项 5.1 完成后，六项关联的四个 change 为 15/16、21/24、21/24、33/39，合计 **90/103**。实际 Appium 客户端报告仅部分推进外部资产门槛，不勾选 Maestro 等完整任务。

仍缺当前候选双端 USB 拔插、真实模型图片消费、OCR／视觉批准、两真实构建、双槽真机矩阵、独立用户及外部试点。不发布、不归档，原始手机材料仅留本机。合并工程回归及逐项缺口见[2026-10-05 验收记录](physical-validation-2026-10-05.md)。下文日期均为历史快照。

## 2026-10-03 六项产品迭代：工程完成，真实与独立验收待补

首次验收引导、创作维护、失败诊断复验、变更验收对象、外部测试资产、本机 OCR＋双槽矩阵均有工程实现。四个 change 为 14/16、21/24、21/24、33/39，合计 89/103；余下 14 项分别依赖真机、授权真实材料、独立使用者及前置验收，不全依赖手机。`feat/change-acceptance-roadmap@REDACTED_REVISION` 已合入 `dev`，保留 `dev@REDACTED_REVISION` 的治理能力；合入不等于完成归档或正式发布。

工程证据包括 747 项检查、62 E2E、同包 20 工具 MCP／DSH 0.1.5-rc.2 Native/PTC、实际 Vision 中英文合成识别和双 Mock。完整边界见[六项状态](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-change-acceptance-records/roadmap.md)及[验证记录](https://github.com/qmkCamel/flowassert/blob/main/artifacts/local-device-matrix/validation.md)。下文保留各日期的历史里程碑，不将当时“未实现”改写为历史已通过。

## 2026-09-17 有限 AI 恢复：双端 Fixture 真实模型矩阵通过

recover 包装、同一设备租约、一次导航动作预算、原失败留存、独立后置断言、recovered/CI、Viewer 与历史哈希验证已有代码和自动化证据。DeepSeek Flash 图片对照、iOS 与 Android PLA110 真机各 36/36、各 402 份证据重启校验已通过。旧 Android 的 ADB 故障保留，开源对照 PoC 与真实浮层遮挡仍待完成，详见[状态与用法](ai-recovery.md)。

更新：2026-09-17。保留 M0–M12 编号，编号不是执行顺序。P0、Inspector、双端向导、录像归档、Fixture 业务闭环和有限 AI 导航恢复已验收；更广编排矩阵、iOS 第三方 App完整文字业务、旧 Android ADB 根因、DSH 图片链路及交付缺口分别跟踪。状态见[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)，优先级见 [PRODUCT_TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)。未来阶段未承诺日期。

## M0 — 调研与决策记录：基线完成，持续维护

2026-09-17 补充：仓库[真实业务验收夹具](https://github.com/qmkCamel/flowassert/blob/main/docs/business-test-fixture.md) 已完成 Android/iOS 准备→手机提交→持久化独立查询→清理正反例，各 36 份材料重启复验，双端慢请求进度、Help 交互和失败保留成功结果通过；夹具 change 7/7。Android 稳定性和更广编排矩阵仍待验收，历史超时保留为不确定。

- 已形成 Appium/Maestro、竞品、AppClaw、ViewInspectKit 比较，以及控制/媒体/宿主边界 ADR。
- Maestro PR 3100 真机 fork 已纳入且有同机 PoC；不能继续以旧官方支持面判定“不能用 iPhone”。
- 当前采用 AppClaw 原生执行器 + MirrorService，共享 Appium 会话；Maestro adapter 为候选。
- 出口证据：[文档索引](https://github.com/qmkCamel/flowassert/blob/main/docs/README.md)、[决策演变](https://github.com/qmkCamel/flowassert/blob/main/docs/research/framework-decisions.md)、[ADR 0006](decisions/0006-native-yaml-workbench.md)。新结论注明版本、证据和替代关系。

## M1 — DSH MVP：完成

- 可安装 bundle、schema 配置、Mock/Appium provider、loopback Viewer、长动作反馈与生命周期闭环。
- 出口证据：[归档 MVP](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-08-19-implement-dsh-mobile-mirror-mvp/tasks.md)、[验证说明](validation.md)：安装/config、Mock、fake W3C、Viewer 交互、打包等分层验证。

## M2 — Android 真机 Beta：单机基线完成，矩阵待扩展

- Android 14 USB 截图/源树/动作/owned session 清理已验证；scrcpy 4.1 连续媒体与降级已有记录。
- 2026-09-14 OnePlus 8T 第三方 App工作台正反例完成。首次受 OEM 后台冻结/Toast 源树问题阻塞，用户放开后台限制后通过；不泛化为所有 OEM 稳定。
- P0 补验：当前代码三轮正例与反例完成，阶段计时、样本预算、证据哈希、历史恢复与实际 instrumentation/scrcpy/转发清理通过。
- 待完成：更多 OEM/版本、TCP、锁屏/旋转/断线恢复、多设备冲突、输入限制与可选音频。
- 出口证据：[Android 指南](android-real-device.md)、[工作台真机报告](workbench-validation.md)；矩阵未关闭。

## M3 — iPhone 真机 Beta：单机基线与正常断开清理完成，矩阵待完善

- 签名/preflight、真实 PNG/源树/动作、WDA MJPEG 和截图降级已有基线；当前优先使用 WDA MJPEG 默认 9100，冲突时按既有策略降级，不承诺随机端口一定生效。
- 2026-09-14 iPhone 16 Plus / iOS 26.2.1 第三方 App工作台正反例完成。
- P0 补验：修复 macOS 不显示 xcodebuild 环境导致的清理失败，三轮正例与反例均自动回收，独立确认宿主/手机 runner/端口无残留。待完成：至少两个 iOS 大版本、免费开发者账号、信任变化/重连/系统权限边界；旧报告手工清理事实保留。
- 出口证据：[iPhone 指南](ios-real-device.md)、[工作台真机报告](workbench-validation.md)；不能以“session 已删除”关闭进程清理项。

## M4 — Agent 感知与共享 MCP：核心完成，rc.2 DSH 真模型复验待补

- 十工具共用 Runtime、provider、observation 与权限；MCP 离散图片/结构、DSH attachment、TTL/epoch、取消与 owned/attached 语义已实现。
- 真实 Codex MCP 与双端 Settings 页面闭环已有证据；DSH `0.1.5-rc.2` packed Native/PTC 与图片/文本模型目录边界已通过。
- 待完成：rc.2 `deepseek-flash` 真实 provider 图片消费；历史 rc.8 图片理解与当前 runtime 兼容分开记录，目录声明不算视觉验收。
- 出口证据：[验证说明](validation.md)、[MCP 接入](mcp-hosts.md)。

## M5 — 可安装 Beta 与独立 Viewer：核心与双端向导真机验收完成

- alpha.1 发布门禁已有历史闭环；private package、onboarding、显式 managed Appium、独立 Viewer、私有配置、中英文与缩放已实现。
- 2026-09-14 补充 Viewer 手动 PNG 截图和无音轨录屏，录制时工作台继续执行；Android 第三方 App 12/12、导出视频完整解码通过，见[验收记录](viewer-capture-validation.md)。工作台视频归档已于 M11 接入。
- 当前默认查看设备当前画面，Settings 为可选诊断；首次初始化可能切换前台，不承诺原画面完全保持。
- [连接向导任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-guided-device-connection-assistant/tasks.md) 66/66，已归档：iPhone 首次保存/快连见[记录](ios-acceptance-2026-09-15.md)，Android 同等验收见[记录](https://github.com/qmkCamel/flowassert/blob/main/docs/android-acceptance-2026-09-16.md)。ADB 稳定性仍单列待办。
- 新版本发布单独完成精确 tag、workflow、资产哈希和 clean install 门禁；不覆盖 alpha.1。

## M6 — 语义动作 alpha：实现与双端真机样本完成，交付任务待关闭

- `tap_node`、受控普通输入、secure 拒绝、active-element rect 验证、mutation fence、批准应用生命周期已实现；Mock/fake/adapter/Viewer 层已覆盖。
- [语义动作任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-semantic-agent-actions/tasks.md) 74/76；双端输入/敏感拒绝/应用生命周期有独立证据，Android hint 追加修复已验。12.7（推送与 CI）、12.8（授权发布）仍待验收关闭；本次已推送不替代 CI 和发布证明。
- 出口必须是对应场景真机证据与交付证明；工作台 Tab 点击不替代 replace/append/clear 或 terminate 验收。

## M7 — 生产化：规划中

- 范围候选：签名发布/SBOM、依赖升级、诊断与恢复指标、可访问性、多设备/多 session、跨进程控制所有权。
- 远程网格涉及认证/TLS/凭据与新威胁模型；稳定版兼容承诺、公共 npm 需另行决定。
- 出口：逐项形成 OpenSpec、故障与容量矩阵及可验证发布流程；当前不声明生产就绪。

## M8 — 本机 YAML 测试工作台：最小闭环与 P0 补强完成

- 已交付：严格原生 YAML → AppClaw worker → 共享 MirrorService 租约 → 步骤 PNG/XML → 断言复核 → 哈希/manifest → 历史/重跑；取消和媒体并行保持独立。
- 双端第三方 App：各 12/12 正例与第 3 步故意失败反例；重启历史与哈希复验通过。正例 Android 54,496 ms、iOS 45,948 ms，不宣称“快速回归”目标已达成。
- M8 最小闭环的 `pass` 限于声明 UI 条件和材料完整；后续 M12 已加入可选独立业务 verifier 与清理约束，未配置仍为 not-performed。blockers 仅覆盖声明条件。会话在运行后保留，取消不回滚。
- 出口证据：[工作台归档 change 11/11](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-local-test-workbench/tasks.md)、[使用说明](test-workbench.md)、[真机报告](workbench-validation.md)、[当前架构图](https://github.com/qmkCamel/flowassert/blob/main/docs/design/mobile-test-workbench-current.md)。
- P0 已实现 managed 后代清理、阶段计时/无关请求消除、部分证据和强杀恢复；自动化证明见 [P0 记录](workbench-p0-validation.md)。iPhone 新版本三轮中位数 29,452 ms、样本预算 42,968 ms，正常断开 WDA 清理已补验；Android 新版本三轮中位数 45,061 ms、样本预算 64,828 ms，正反例/证据/历史/媒体/交互和实际 instrumentation/scrcpy/转发清理已通过。P0 三项与 tasks 10/10 完成，不以旧耗时替代。runId 视频归档已于 M11 接入；代码验证器、Maestro adapter、报告导出仍属于扩展。

## M9 — Observation 查询与 Viewer Inspector：实现与验收完成

- [归档 tasks 39/39](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/tasks.md)，第十工具已接入，ADR 0007 已接受；冻结图、树、搜索和属性联动已实现。
- Android/iPhone 真机及同 tarball MCP/Viewer/YAML、DSH rc.1 Native/PTC 干净安装通过。见[Inspector](inspector-validation.md)和[打包验证](packaged-runtime-validation.md)。
- 2026-09-15 曾为 38/39，安装依赖阻塞；2026-09-16 已修复并补验。历史报告保留。范围不含 App SDK、白盒属性编辑和多目标 daemon。

## M10 — 公开文字与业务 UI 验收：Android 完成，iOS 完整正例未通过

YAML type 已支持替换、追加与清空。Android 完成消息、回复正文/操作栏、历史再打开及故意失败反例。iOS 2026-09-16 复验前 9 步通过，第 10 步消息正文断言失败：PNG 可见正文，XML 气泡无正文/子节点。Codex 图片核对及历史返回另有证据，不能关闭完整 YAML 正例。见[文字验收](sampleapp-ai-text-validation.md)、[最新 iOS 报告](https://github.com/qmkCamel/flowassert/blob/main/docs/ios-business-and-codex-vision-validation-2026-09-16.md)。独立后端持久化校验尚未实现。

## M11 — 工作台视频历史：实现、浏览器与双端真机归档验收完成

可选随运行录像、run 归档与哈希、重启回放/下载、步骤近似定位已实现。iPhone 设置页七步流程、42.640 秒录像；Android 设置页七步流程、11.4 秒录像，两端归档/重启回放/步骤定位均已补验。见[视频历史](workbench-video-validation.md)。

“部分/未收到”录像状态与 UI verdict 分开，关闭页面前未上传的 Blob 仍可能丢失。旧报告中“Android 待连接”的结论是当天补验前状态，不再作为当前里程碑状态。

## 2026-09-16 历史交付边界（由 9 月 17 日状态补充）

- P0、双端向导、Inspector 及双端视频归档验收完成；Android ADB 间歇超时仍待定位。
- Codex + MCP 真机图片单场景通过；DSH rc.1 真实图片模型仍待复验。
- iOS 完整文字业务 YAML 未通过；通用视觉/业务验证器及更广设备恢复矩阵尚未完成。
- 源码提交与推送不等于 CI 已通过或新版本已发布。当前能力集中见[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)，优先级见 [TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)。

## M12 — 确定性回归编排：双端业务闭环与声明的编排矩阵已验

- 当前 YAML 直接支持类型参数、JSON 数据行、注册子流程、条件和有界重复，不要求 version: 2。
- 可信注册 JS/预编译 TS 扩展提供 prepare/verify/cleanup，私有资源 journal、取消/强杀语义及分项证据。
- 本阶段交付单设备串行套件、标签筛选、显式安全重试、case/attempt 历史、CLI JSON/JUnit；后续双槽并行工程于 2026-10-02 完成，真实矩阵验收仍待补，见本页最新状态。
- 双端 Fixture UI→SQLite 独立验证→清理正反例已验，各 36 份材料重启复验通过；原任务 4.5 完成。详细证据见[业务夹具](https://github.com/qmkCamel/flowassert/blob/main/docs/business-test-fixture.md)。
- 当前任务 22/22，已同步三个主 spec 并归档，尚未发布；见[编排验收](https://github.com/qmkCamel/flowassert/blob/main/docs/test-orchestration-validation.md)与[归档 OpenSpec](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-extend-deterministic-test-orchestration/tasks.md)。
- 2026-09-18 补验：Android PLA110 与 iPhone 16 Plus 多数据/真假分支/嵌套/循环/故意失败与循环内取消均通过，各 50 份证据重启复验，4.4 完成。旧设备 ADB 根因及更广设备矩阵独立跟踪。

## M13 — 失败分析与跨次比较：实现与双端真机验收完成

- 目标架构为 `Raw Runs → Run Alignment → Diff Engine → Evidence Reduction → Diagnostic Context → Viewer/MCP/Any Agent`。比较层以 case/flow/attempt、业务验证、断言、设备/平台和 artifact 关系确定性对齐与过滤噪声，保留可回钻 evidence refs。
- 比较事实、规则分类、first divergence、downstream differences、历史聚合、Viewer 与 MCP-friendly Context 已实现；原 verdict 不变，旧记录不迁移。
- 任意上层 Agent 可以读取 Context 做解释；FlowAssert 不内置通用 AI Analyzer，AI 不参与事实、基线选择或 verdict。未来 Viewer AI 解读仅为可选便利功能。
- Android 与 iOS Fixture 均完成两次正例、故意业务失败、严格/复核比较、Viewer、Diagnostic Context、证据回钻和重启哈希复核；change 24/24，已同步主 spec 并归档。出口证据：[使用](run-comparison-analysis.md)、[验收](run-comparison-validation.md)、[归档详细设计](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-run-comparison-analysis/design.md)、[归档任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-run-comparison-analysis/tasks.md)。不包含 AI 根因、视觉门禁、统计性能回归、视频差异或 Allure。

## M14 — 证据引导的失败分诊：实验链路通过，验收未关闭

- 2026-09-26 在隔离分支 `feat/evidence-guided-failure-triage`、基线 `dev@REDACTED_REVISION` 上实现明确发起的四方向分诊、人工复核、报告停用及 MCP/DSH 受权只读入口；尚未合并当日 `dev@REDACTED_REVISION`。旧 Diagnostic Context 不改，分诊不改原 verdict、不宣称自动根因。
- 功能分支门禁：554 单元/契约测试、55 浏览器 E2E、构建、打包及 OpenSpec strict 通过；同包干净安装 Viewer/CLI/MCP 17 工具和 DSH `0.1.5-rc.2` Native/PTC Mock 探针通过。与 `dev@REDACTED_REVISION` 的集成候选额外通过 602 单元/契约测试和 55 浏览器 E2E；集成候选的打包宿主门禁单独记录。合入开发分支不等于 Release，包哈希与最终记录以[OpenSpec 任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-failure-triage/tasks.md)为准。
- 出口仍需全路径容量/超时及独立进程故障矩阵、双人标注 60＋60 冻结语料与指标、Android/iPhone 本候选真机矩阵、至少五名非作者的平衡对照。此前 M13 真机记录不能自动继承为分诊真机验收；未通过前保留实验入口。
- [使用和回退](evidence-guided-triage.md) · [ADR 0010](decisions/0010-workbench-product-contract-boundary.md) · [OpenSpec](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-failure-triage/tasks.md)。
