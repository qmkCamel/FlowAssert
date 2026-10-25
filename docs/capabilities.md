# FlowAssert 能力总表

文档对账：2026-10-25，FlowAssert `main@f508558`。本次核对源码、任务清单与已有报告，不是新一轮真机、模型或独立用户验收。源码为 `0.1.0-alpha.2` Developer Preview；当前使用 `main` 源码，历史包和迁移边界见[安装指南](beta-installation.md)与[兼容说明](workbench-compatibility.md)。

“已验”只指链接报告中明确的版本、设备和样本；迁移前 `dev` 的结果不自动归属于当前构建。未完成任务及计数统一见 [PRODUCT_TODO](../PRODUCT_TODO.md) 和各 change 的 tasks，避免在不同入口重复维护。

## 当前能力与验收入口

先按[采用指南](adoption-guide.md)判断试点范围。下表概括用途，后面的矩阵区分工程实现与验收边界；报告操作见[报告阅读与离线分享](report-reading-and-sharing.md)，受控业务示例见 [Fixture App + Server](business-test-fixture.md)。

| 你的诉求 | 当前提供什么 | 目前的边界 |
| --- | --- | --- |
| 在电脑准实时看手机 | 独立 Viewer；Android scrcpy、iOS WDA MJPEG，截图降级 | 真机基线在 macOS；更多设备、旋转和断线恢复仍需验证 |
| 固定流程、重复执行 | 可读 YAML；点击、滑动、等待、公开文字输入、UI 断言 | 支持类型参数、子流程、条件/循环和可信注册代码；DeepSeek 有限导航恢复双端 Fixture 各 36/36 已验，通用 App 与 SDK 对照仍待验 |
| 留证并确认结果 | 每步 PNG/XML、断言复核、日志、证据哈希；可选录像与显式登记的确定性像素断言 | 业务验证须显式配置独立 verifier；未声明视觉仍为 not-performed，像素比较不等于通用视觉理解 |
| 结果可回溯 | runId、YAML 快照、历史回看/重跑、v1–v4 归档导入与被动HTML阅读、视频回放与步骤近似定位；跨次比较、Diagnostic Context 与证据回钻 | v2/v4 派生结果不重验；安全分享仍需人工检查未遮蔽像素；Android/iOS Fixture 比较矩阵已验，不提供内置 AI 根因或 AI verdict |

## 模拟器连接（2026-10-09）

Viewer 已增加真机/模拟器选择；支持已启动的本机 Android Emulator 与 iOS Simulator，后者无需 Apple Team ID。复用现有 Appium 会话和工作台。使用与实测边界见[模拟器指南](simulators.md)及[验证记录](../openspec/changes/add-guided-simulator-support/tasks.md)，不改写真机验收等级。

## 报告回放与可选 Web 自检

报告已提供截图序列回放、步骤时间线和已记录动作的前后对照；回放不执行设备操作，缺失的旧动作位置不补造。具体操作与离线 HTML 的区别见[报告指南](report-reading-and-sharing.md)。

Web 自检为默认关闭的可选入口，仅运行登记的合成 Viewer 场景。取证完成默认仍需复核与独立 gate，不代表手机用例或通用网站测试通过；配置、工具前提和历史验证见 [Web 视觉验收](web-visual-acceptance.md)。

## 能力与验收矩阵

“已验”指链接报告中的设备和场景样本；不外推到所有 App、OEM、系统版本或账号。基础导航流程与 AI 文字业务流程分别验收。

| 能力 | Android | iPhone | 限制及证据 |
| --- | --- | --- | --- |
| 本机区域 OCR | 工程／合成与假识别器验证 | 同左 | Mac Vision，中英文合成实测不等于真实 App 准确率；候选默认关闭，指定 profile 须通过授权冻结评测并人工批准 |
| 双槽设备矩阵 | 伪 Appium 隔离验证，真机待验 | 双 Mock／进程／浏览器验证，真机待验 | 最多两槽，固定分配、独立 Store、显式取消／复跑；所有历史 attempt 保留，不宣称设备农场或两倍加速 |
| 连接向导、保存配置、重启快连 | 真机已验 | 真机已验 | iOS 只读检查只能确认本机签名前提；Xcode 账号需人工确认，WDA 启动需显式连接验证。既有真机记录不代表本次账号状态或所有设备已通过；[Android](android-acceptance-2026-09-16.md)、[iOS](ios-acceptance-2026-09-15.md)、[准备步骤](ios-real-device.md#预检) |
| 持续画面与截图降级 | scrcpy 真机已验 | WDA MJPEG 真机已验 | 媒体留在 Viewer，不连续塞入模型上下文；[媒体与整体记录](validation.md) |
| 手动截图、开始/结束录屏与下载 | 真机已验 | 真机已验 | 浏览器录屏、无音轨、有时长/大小限制；[截图录屏](viewer-capture-validation.md)、[iOS](ios-acceptance-2026-09-15.md) |
| YAML 基础固定流程 | 12/12 正例及故意失败反例已验 | 12/12 正例及故意失败反例已验 | 同一 session，逐步取证；[基础工作台](workbench-validation.md) |
| 有界时间、授权重启及步骤业务断言 | 独立 RuntimeFixture 时间／重启正反例及中断已验；真实业务待验 | 同左 | 显式启用，采样不是连续证明；业务只调用登记只读 verifier，持久性／幂等性模板需隔离 App／后端与真值查询；[用法](runtime-assertions.md) |
| 端到端时间门禁 | Fixture 正反例、取消、USB／自有宿主中断已验 | 同左 | `automation-observed-e2e` 含自动化、观测及证据开销，不是纯 App 性能或生产 SLO；基础设施故障判不确定；[审计](runtime-gates-validation.md) |
| App 健康门禁框架 | 工程预览；crash／ANR 来源完整性未证明，当前不支持 | 工程预览；crash／hang 授权实时来源缺失，当前不支持 | 必需能力缺失在副作用前拒绝；无日志不算健康。窗口、归因、丢失和排空及受控信号验收未完成，不宣称真实健康支持；[ADR 0016](decisions/0016-bounded-runtime-gates.md) |
| 替换、追加、清空普通文字 | 真机已验 | 真机已验 | 受控普通输入，拒绝密码/敏感字段与歧义；[Android](android-acceptance-2026-09-16.md)、[iOS 输入](sampleapp-ios-input-fix.md) |
| 第三方 App AI 消息、回复与历史业务正例 | UI 闭环已验 | **完整 YAML 未通过** | iOS 前 9 步通过，第 10 步正文断言失败；图片可见正文但 XML 不提供；[最新复验](ios-business-and-codex-vision-validation-2026-09-16.md) |
| Viewer Inspector 与 observation 查询 | 真机已验 | 真机已验 | 冻结图/树/搜索/属性；查询不重新截图，历史可读不代表可操作；[Inspector](inspector-validation.md) |
| Inspector 辅助 YAML 草稿 | Fixture 真机创作与复验已验 | Fixture 真机创作与复验已验 | Inspector→故意失败→新修订 pass，各 18 份材料核查；不等于两次真实构建变更或自动修复；[本候选证据](physical-validation-2026-10-05.md) |
| 首次验收助手与语义就绪 | Fixture 真机联合验收已验 | Fixture 真机联合验收已验；焦点丢失已修正 | UI 与独立业务正反例、child 核查、原 manifest 不变、慢校验交互；外部首次使用和独立研究仍待验；[证据](physical-validation-2026-10-05.md) |
| 受控故障与固定基准 | 进程故障恢复及 30 次基准已验 | 宿主／WDA／Appium／锁屏恢复及 30 次基准已验 | 采用故障矩阵中的双端USB项仍缺；10月6日RuntimeFixture时间门禁的协调USB中断已验，不代替前一矩阵；预算不是生产 SLO；[可靠性边界](workbench-reliability-matrix.md)与[原始范围摘要](physical-validation-2026-10-05.md) |
| 人工定位器修复草稿（原有能力） | Mock/浏览器自动化通过；两次真实构建变更待验 | 同左 | 仅同计划成功基线与失败证据唯一锚定的 `tap` ID 替换；需人工确认新草稿与复跑，保留原失败；[用法](test-workbench.md#受控定位器修复工程实现真实构建变更待验) |
| 双路径修复闭环（Preview，默认关闭） | M1/M2 软件链已验；Android 导航探针 10/10，不是完整修复验收 | 2026-10-07 实时导航/host forwarding 13/13 已验；完整修复待验 | 项目准入与 Agent 工具分开开关；可信本地源码补丁须人工批准；实际双宿主修复交接、独立验收未完成；普通导航样本见[10 月 7 日记录](physical-validation-2026-10-07.md)，[操作与等级](evidence-guided-repair-operations.md) |
| 修复构建与安装（Preview） | 构建/摘要/审批与 Mock 维护协议 | 同左；fixture 不证明真实开发签名 | Appium 安装适配、可信 reset/cleanup、两次移动端复验和冻结回归未完成，不可作为自动真机修复使用 |
| 显式确定性视觉断言 | Mock/Viewer 审批通过；真机反例待验 | Mock/Viewer 审批通过；真机反例待验 | 项目或干净成功运行图片的人工预览/不可变批准，独立有界 worker、同租约截图、区域/mask/阈值及 visual 分项；旧 YAML 不自动验证，模型实验关闭；[用法](test-workbench.md#显式确定性视觉断言工程实现双端真机待验) |
| 每步证据、故障保真、重启历史 | 真机及自动化已验 | 真机及自动化已验 | PNG/XML 分别取证，非原子快照；证据缺失不能 pass；[P0](workbench-p0-validation.md) |
| 运行归档导入与安全分享 | v1–v4 软件/包验证；双平台历史fixture图只读脱敏验证 | 同左 | JSON v1/v3 原始、v2/v4 派生；派生未重验，v1/v3不自动脱敏。HTML画框、完整预览/冻结下载已验；完整双端材料/健康信号/独立接收仍待验；[兼容](workbench-compatibility.md) · [报告阅读与离线分享](report-reading-and-sharing.md) |
| 报告目录、失败定位与历史趋势 | 软件/浏览器及历史fixture材料验证 | 同左 | 50条分页/10000条上限；原结果与当前材料状态分开；历史简单1000条摘要样本p95约250ms，完整材料与独立验收待补；[实施验证](../openspec/changes/improve-report-reading-and-sharing/implementation-validation.md) |
| 随运行录像归档、重启回放、步骤定位 | 真机已验 | 真机已验 | 录像状态独立于 UI verdict；浏览器关闭前未上传的 Blob 可能丢失；[视频历史](workbench-video-validation.md) |
| 清理、阶段计时与重复测量 | 样本已验，ADB 稳定性仍有缺口 | 正常断开 owned WDA 清理已验 | 只清理自己拥有的资源，不代表所有异常生命周期通过；[P0](workbench-p0-validation.md)、[ADB 限制](android-acceptance-2026-09-16.md) |
| 参数/子流程/分支/循环、串行套件 | PLA110 两组数据、分支/嵌套/循环/反例/取消已验 | iPhone 16 Plus 同等矩阵已验 | 各 50 份材料重启复验；[编排验收](test-orchestration-validation.md)22/22；新增双槽并行仅完成工程验证，真实并行验收单列 |
| 可信代码、独立业务验证与清理 | Fixture 真机正反例已验 | Fixture 真机正反例已验 | 各 36 份证据重启复验；[真实业务夹具](business-test-fixture.md)，另有[可复制 HTTP 模板](workbench-business-template.md)通过本机假服务测试，不代表外部业务已接入 |
| 有限 AI 导航恢复 | PLA110 36/36 符合预期 | 36/36 符合预期 | 各 402 份证据复验；[报告](ai-recovery-validation.md)，SDK 对照与真实浮层遮挡未完成 |
| 失败分析与跨次比较 | Fixture 真机正例/故意业务失败、重启复核已验 | Fixture 同等真机矩阵已验 | 确定性对齐/比较、Evidence Reduction、Viewer/DSH/MCP 共用 Diagnostic Context 与 evidence refs；Agent 推理不参与事实或 verdict；[使用](run-comparison-analysis.md) · [验收](run-comparison-validation.md) |
| 证据引导的失败分诊（实验） | Mock/浏览器及同包宿主探针通过；本候选真机待验 | 同左 | 显式从已结束运行生成四类可并存检查方向，人工复核与停用独立于原 verdict；无 60＋60 双标冻结语料及五人盲测，不宣称根因准确率或诊断收益；[使用与边界](evidence-guided-triage.md) |
| 本机趋势索引（阶段三进行中） | 软件/Mock 测试通过；真机统计待验 | 软件/Mock 测试通过；真机统计待验 | 计划用例分母、attempt/导入/派生/未知环境分列，generation 绑定分页、双 UTC 窗口与明确预算；信号仅描述阈值，不宣称统计显著性、根因或长期采用；[用法](test-workbench.md#本机趋势开发中) |
| 引用感知证据清理 | Mock/浏览器及隔离目录 SIGKILL 回归通过；真实历史待审查 | 同左 | dry-run、引用/lease/pin 保护、重验后移入隔离区、恢复与逐文件确认 purge；已完成单流程 Agent journal 独立保留，媒体清理后状态降级且 requestId 不重放，套件引用仍保护；自动清理默认关闭，移动不释放物理空间；[用法](test-workbench.md#安全分享与证据清理工程实现试点待验) |
| Agent 运行已登记测试 | Fixture 真机已验 | Fixture 真机已验 | 五工具、持久受理、幂等/取消、证据权限、跨进程 claim 及 MCP/DSH Native/PTC 已验；仅两宿主真实图片模型消费待补；[用法与边界](agent-test-run-control.md) |
| Agent 节点动作、受控输入、应用管理 | 真机样本已验 | 真机样本已验 | 显式策略、有效 observation 与 session 所有权限制；[ADR 0005](decisions/0005-semantic-agent-actions.md) |
| 版本化运行来源与严格模式 | Fixture 双端 observed/unknown 样本已验 | 同左 | observed/declared/unknown、App/环境/构建字段和执行前严格拒绝；[WorkBench 指南](test-workbench.md#运行来源与严格模式) |
| 无头 managed job | Mock 进程测试已验，真机待验 | Mock 进程测试已验，真机待验 | loopback/claim/取消/超时/JSON/JUnit 与 0/1/2/130；无浏览器录像；[Managed jobs](managed-job.md) |

## 宿主和模型：分别看待

[有限 AI 导航恢复](ai-recovery.md)已接入 recover 包装、受控候选、预算、原始失败与 recovered、Viewer/套件报告。DeepSeek Flash 真实图片对照及双端 Fixture 各 36/36 真机验证通过，各 402 份证据重启校验通过；开源对照与真实浮层遮挡仍待完成。不能用它覆盖业务断言失败，也不替代 DSH 图片附件链路验收。

| 入口 | 当前状态 | 证据边界 |
| --- | --- | --- |
| 独立 Viewer / YAML 工作台 | 可独立使用，不需要 DSH 或模型凭据 | 真机仍需平台依赖；[使用指南](test-workbench.md) |
| 通用 MCP / Codex | 默认集合为十项设备工具 + 五项默认关闭的已登记测试工具 + 比较诊断／分诊／验收记录／外部资产／矩阵五项只读工具；另有五项显式启用的 Preview 修复工具；设备/运行工具与派生事实共用本机 runtime | 比较 Context 的既有 Android 真机验证不等于本候选分诊真机验收；新工具受已登记执行与 sharedEvidence 约束；[分诊边界](evidence-guided-triage.md) |
| DeepSeek Harness | 精确 `0.2.0-rc.2`，Native/PTC 同包运行时与图片/文本模型目录边界已验 | **真实 provider 图片调用仍单独计证据**；Codex 的结果不能替代；[当前同包验证](../openspec/changes/upgrade-dsh-020-rc2/merge-validation.md) |
| Maestro fork | iPhone 真机对照 PoC 有证据 | 产品 adapter 未实现且已决策后置；仅在出现规模化既有 Maestro 资产、当前执行器关键语义缺口或外部明确要求时重评；[ADR 0006](decisions/0006-native-yaml-workbench.md#2026-09-18maestro-fork-adapter-暂缓) |

十项设备工具职责见[产品形态](product-shape.md)，新增五项测试工具见[Agent 运行指南](agent-test-run-control.md)。图片分享、文本输入、应用管理和历史证据分别受策略约束；显式真机 claim 阻止本工具的第二 runtime 竞争同一设备，不覆盖外部 ADB/Appium 客户端。

## 下一步与发布状态

全部活动 change、逐项缺口和归档状态以 [PRODUCT_TODO](../PRODUCT_TODO.md) 为准。已有 Fixture、历史真机与同包宿主样本不关闭真实业务、OCR 批准、双槽业务矩阵、完整修复或独立研究任务；待验条件不能统称为“等真机”。Maestro 执行 adapter、共享 daemon 与更大设备规模也不能由现有报告导入或双槽工程实现推导为已交付。

源码 MIT，package 为 private，未发布公共 npm。源码、通过验证的 tarball、GitHub Release 和生产就绪是不同状态；安装包能力以对应版本说明为准，不因本表更新自动宣告新版本发布。

## 维护规则

新增能力或真机结论时，先更新对应验收报告与 OpenSpec tasks，再同步本表。README 只保留摘要和入口；TODO 维护优先级；里程碑显示当前状态并保留历史日期；宣传稿引用本表及报告。历史调研、原始目标设计和旧验收报告不改写为“今天已通过”。
