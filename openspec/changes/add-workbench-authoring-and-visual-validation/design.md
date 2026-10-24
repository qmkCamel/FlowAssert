## Context

原方案基线为 dev@REDACTED_REVISION；本次工程细化基线更新为 `dev@REDACTED_REVISION`（2026-09-25）。Inspector 草稿、定位器检查/修复、项目文件登记 visual profile 和同租约像素比较已存在。当前批准人/时间由配置提供，尚无候选审批事务和成功运行来源登记；Viewer 与 Agent 部分字段已显示 visual，尚未完成所有出口的等价性矩阵。有限 AI 导航恢复与用例修复、视觉验证仍是不同能力。

依赖 harden-workbench-adoption 的 C0；视觉上线还依赖 A1 环境身份，B1/B2 不必等 A4 外部采用完成。

## Goals / Non-Goals

**Goals:** 降低编写、审查、版本升级维护的总成本；覆盖明确声明的视觉条件；保留确定性和失败证据。

**Non-Goals:** 录制全部用户操作、无人监督探索、任意代码生成执行、敏感文字输入、默认视觉兜底、AI 修改期望直到通过、替换现有有限导航恢复。

## Decisions

### B1：只读候选到独立草稿

新增纯 selector-adapter 模块，消费 normalizer 已脱敏的节点，输出候选 selector、当前 matchCount、支持的平台类型及风险理由。优先 accessibilityId/id，再文本/关系；无稳定唯一候选时明确要求用户修正，不自动退回坐标。Android role 映射在共享模块解决。

Inspector 点击仍只选择。单独“添加到草稿”操作仅复制受支持的公开字段，不复制原始 source、整张图、敏感值、临时 nodeId、inspectionId 或授权。沿用 TTL；过期/历史快照允许保留已有草稿，但新候选须重取当前检查。生成草稿不延长快照寿命。

草稿放独立 editor，默认不写项目文件；用户可下载/复制。应用内保存仅限明确登记目标、显式确认且校验原文件摘要，不接受 Agent 任意路径写入。初版优先下载/复制，文件写回后置。动作/等待/结构断言模板使用现有 parser/plan 校验；执行必须单独明确发起。

替代录制器：完整录制涉及敏感输入、设备动作来源和不可重放状态，先不承担。替代纯 AI 生成：确定性模板可即时校验且不需要上传页面。

### B2：检查、建议、确认、复跑

检查输出 error/warning + source path/line + reason。未知命令、敏感目标、无结构化 UI 断言是阻断错误；易变文案、固定长 wait、未知初始状态为建议，不误称一定错误。

修复候选包含 originalPlanDigest、失败证据 refs、原 selector、新 selector、断言/步骤范围 diff 与置信边界。初版规则式候选，不依赖模型。任何删断言、放宽业务期望、跳过步骤、改 App/目标范围的建议均不可作为自动修复接受，需用户另行编辑重新审查。文件或计划变动使建议 stale。

用户确认仅产生新草稿/计划；复跑生成新 runId，保留 previous run 和修复记录。候选在新页面唯一不是业务正确的证明，必须按原要求重新验证。当前版本确有功能缺陷时可以不给修复。

### B3a：独立视觉断言，不改变历史比较

已有包装节点 assertVisual 引用本机项目登记的 profile/baseline；基础 UI 结构断言仍至少一个。它是工作台扩展，不伪装成 AppClaw 上游原生命令；执行器外层持有原租约并复用当步截图，禁止第二设备连接。

profile 固定规则版本、区域、mask、阈值、App/平台/构建适用范围、方向/尺寸/主题。区域用源图像素坐标并绑定原始尺寸；尺寸或方向不符不自动缩放，只返回 inconclusive。差异算法选确定性区域像素差与可配置容差，CPU 工作有界且不占 Viewer 主线程；不引入未验证模型依赖。

基线来自完整证据的干净成功运行或显式登记参考图。登记参考图只代表经人审核的期望，不冒充测试通过；保存批准人本机别名/时间/规则 hash。运行不得自己更新基线，failed/recovered/flaky 不自动推荐。图像来源、区域、遮罩和审批改变都产生新 revision；基线引用计入第三阶段保护。

所有声明的视觉断言均是 required；未声明则 not-performed。完整图但视觉条件不满足记 visual fail、最终 fail；缺图/不匹配/超时/无法确认则 inconclusive，保留证据冲突/污染等现有优先结果。任何分项不能抹去其他失败；有 AI 导航恢复时仍不变为干净 pass。纯历史图像比较始终不修改原 verdict。

### B3b：隔离的实验评测，不隐式承诺生产支持

先做离线 OCR/语义视觉与真实浮层数据集，含正常动态变化、空文本、相似目标、遮挡、旋转、主题、图中提示注入。数据按 App/页面划分开发集与冻结验收集，防止同图调参后自测。

候选 backend 只做只读分析，不能点击设备、改 baseline 或执行图片文字中的指令。外发需历史图片/App 范围许可和独立模型端点配置，默认关闭；拟议单检查 10s、最多一次请求、2 MiB 图片，整运行仍受原总预算，超限不自动降级。指标分别是错误通过、错误失败、无法确认、耗时、调用成本；不把拒绝从分母移除。

本阶段必须交付评测与 go/no-go 记录；只有冻结反例集无观察到错误通过、输出可核验且授权/预算门禁通过，才可实验启用选定 backend。未达标则保留功能关闭并给负面结果，不阻塞 B1/B2/B3a 的发布。生产 OCR/语义能力需要单独范围确认，不以完成 PoC 宣称通用视觉支持。

### B4：真实维护成本

同团队、相近复杂度的流程记录手工与辅助方式的编写/修复总时间，包括审查和误建议返工；至少 10 条流程、两次实际 App 构建变更、双端各有样本。建议目标中位总耗时下降 ≥30%，无错误通过增加；报告样本限制。若不足，工程功能可存在但采用结论仍 pending。

指南要求稳定 ID、可观测状态、独立业务 verifier、隔离数据及 cleanup。复用阶段一试点，不新造一个为了产品演示才存在的假业务真值。

### R1：把基线批准变成可恢复的本机事务

工作流为“选择已登记来源 → 预览原图、区域/mask、适用环境与差异 → 明确批准 → 发布新 revision”。候选不是可执行基线，普通测试执行和 Agent 只读入口不能批准或更新它。Viewer 批准沿用 loopback/same-origin 授权；批准人是本机审阅别名，不声称完成账号认证。

| 记录 | 必需字段与约束 |
| --- | --- |
| BaselineCandidate v1 | candidateId、profileId、expectedRevision、sourceKind、来源 manifest/evidence hash、规则 hash、预览 digest、createdAt/expiresAt；有效期 10 分钟；批准请求携带 approvalRequestId 与该候选 digest |
| ApprovedBaseline v1 | baselineId/revision、sourceKind、不可变 PNG hash、rulesVersion/rulesHash、App/平台/环境适用范围、approvedBy/approvedAt、原候选 digest |
| 来源引用 | 成功 run 的 runId/evidenceRef/manifest hash，或已登记项目参考图的标识/hash；原始绝对路径不出现在 Agent/共享结果 |

成功运行来源必须为本地原始、已结束且重新验过全部必需证据的干净 pass；failed/recovered/flaky/import/derived、不支持契约和缺图记录不可作为该来源。参考图来源必须来自已登记项目内的有界 PNG，界面明确“人工期望图，未证明运行通过”。选中来源后持读 lease；批准提交在第三阶段 R0 的同一 mutation gate 内重新核对 source hash、profile revision、规则和 owner。先写私有临时记录/图像并 fsync，再以 manifest 提交；引用保护与批准可见性属于同一次提交。失败只留下待回收临时件，不能出现已批准但无保护的记录。重启仅恢复已提交 revision，所有旧候选失效。

revision 单调递增且不可覆盖；同一批准请求重复提交返回同一 revision，内容不同的重放拒绝。retire 只取消新运行默认选用，已被历史 run 或批准记录引用的材料继续保护；另行解除引用须先显示消费者，不能通过 retire 绕过保留策略。现有项目文件 profile 继续作为显式登记参考图兼容入口，冻结其 hash 和配置快照，不自动给旧记录补一条伪造审批。

环境规则区分 `sourceBuild` 与 `allowedTargetBuilds`：默认仅源构建精确匹配；跨构建比较须人工增加已知构建到允许集合，形成新 revision。禁止隐式 wildcard 或把 unknown 当匹配；主题 any 仍须显式选择。尺寸/方向和其他声明条件不符为不可比，禁止自动缩放。预执行冻结批准 revision，运行中再批准基线不会改变已受理计划；基线文件丢失/篡改在动作前发现则拒绝，运行中发现则 inconclusive 并保留取证。

图像限制沿用 4 MiB、4096×4096、区域和 mask 各最多 20；比较在隔离 worker 执行，单检查最多 10 秒且受运行剩余时间约束，1 个比较并发、取消后丢弃迟到输出并释放 lease。零可比较像素、超时、解码失败均不能 pass。worker 不持设备连接，也不写基线。

### R2：一次领域判定，多个只读出口

由 `workbench-contracts` 的公共结果投影返回契约版本、run/case/attempt 身份、UI/business/visual/cleanup/evidence 各分项、required、原因码、evidence refs、原 verdict 与证据可用性。`WorkbenchService` 负责终态聚合；Viewer、suite JSON/JUnit、managed-job CLI、MCP/DSH 只序列化该事实，禁止各自在缺字段时推算“通过”。终态后证据损坏只影响读取时完整性投影及当前可信状态，不篡改原始声明结果。

| 固定样本 | 对所有出口的共同要求 |
| --- | --- |
| 旧 YAML 无视觉声明 | visual=not-performed；无视觉/模型调用，保留旧判定 |
| UI pass + visual fail | 独立分项，最终 fail；JUnit failure，CLI 非零 |
| 必需视觉缺图/超时/不可比 | visual=inconclusive；JUnit error，CLI 基础设施/无法确认码 |
| UI/业务 fail + visual pass | 仍失败，不能被视觉通过覆盖 |
| 已有 evidence-conflict/contaminated | 保留既有优先级和原因；视觉结果仅补充事实 |
| 恢复后各分项通过 | recovered 独立；默认 CI 非零 |
| 用户取消 | 明确 cancelled；CLI/managed job 保持 130，JUnit skipped 并附取消原因 |
| v2 reported pass | 来源报告与 not-revalidated 并列，当前 inconclusive；不得进入通过基线 |

JUnit 保持一个计划 case 一个 testcase，attempt 与 visual revision/原因/refs 放有界 properties/system-out，不能因每个视觉步骤新增 testcase 改分母。0/1/2/130 的进程退出语义沿用既有契约；不支持单独数值退出码的适配器仍必须投影相同取消/失败状态。图片读取继续走现有证据权限，不把图片/base64塞进状态 JSON。旧 v1 导入的兼容规则保留，不对历史补算视觉结论。

### 实施顺序、文件边界与工程门禁

R0 由第三阶段负责共用引用接口与故障测试接缝；R1 与 R2 在该接口确定后可并行编写。R1 发布审批记录须等 R0 引用保护验收；R2 固定结果 fixtures 无需等待审批 UI。R6 抽取视觉 worker/结果 serializer 时保留这些契约，不为重构更换 provider 或扩大工具权限。

增量范围：R1 主要落 `workbench-visual/project/store` 与独立基线领域模块；R2 主要落 `workbench-contracts/suites/managed-job/test-run-control` 和 Viewer 结果展示。共享 `store/contracts` 串行集成，每包先合契约测试再接 UI。变更 ADR 0006/0010 中基线持久化和结果投影边界。

| 门禁 | 可重复验证与证据 |
| --- | --- |
| R1 身份与授权 | stale hash/revision、重复批准、参考图与成功 run、import/recovered 拒绝；断言设备调用数为零 |
| R1 持久性 | 审批写入/提交前后 kill 独立进程，重启后 revision 和保护引用一致；并发清理不能移走候选/批准来源 |
| R1 执行 | 新旧 revision 并存、跨构建显式允许、不可比/全部遮罩/坏图/超时/取消和迟到 worker |
| R2 等价性 | 上表 fixtures 通过同一 tarball 的 Viewer HTTP、JSON、JUnit、CLI、MCP 与 DSH Native/PTC，按语义比较而非文案字节相同 |
| UI | 注入 ≥1 秒审批/比较延迟时切换主题、查看历史；失败保留旧批准/结果，成功使用领域时间刷新；保留桌面/窄屏截图并目检 |

工程通过不依赖外部试点，不代勾 2.6/3.5/4.7/B4。B3b 实验评测单列，不能借 R1/R2 通过宣告模型视觉验收。

## Risks / Trade-offs

- [脆弱候选看起来可靠] → 显示当前唯一与跨版本稳定的区别，实际执行重新定位。
- [修复掩盖缺陷] → 不自动放宽断言，保留 diff/旧运行与独立复跑。
- [像素基线受渲染噪声影响] → 固定环境与审批 mask，不用泛化视觉解释取代确定规则。
- [图片包含秘密或提示注入] → 本机优先、独立外发授权、只读分析、无法确认失败关闭。
- [新增视觉 verdict 不兼容] → C0 先行、旧用例 golden 测试、单一结果聚合实现。

## Migration Plan

先 B1→B2；B3a 在 C0/A1 与领域结果契约后接入，B3b 的离线试验可提前。新 YAML 节点只在启用对应 capability 时接受，旧版本遇到明确拒绝而非静默忽略。关闭视觉功能时带必需视觉声明的用例拒绝执行，不能跳过视觉后通过。旧记录继续 visual not-performed；新增报告保留基础字段和扩展版本。

与第三阶段只在 local-test-workbench 文件有不同 requirement 的 delta，集成时逐项检查不整文件覆盖。ADR 0006 记录新增包装节点与视觉边界；DSH/MCP 仍薄适配。

## Open Questions

待评测选择 OCR/语义候选 backend；当前默认是不启用，非阻塞确定性方案的产品歧义。外部页面和两次真实构建由试点方提供；没有样本不能伪造维护成本收益。
