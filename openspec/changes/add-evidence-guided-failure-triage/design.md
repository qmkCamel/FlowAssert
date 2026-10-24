## Context

动机见 [proposal.md](proposal.md)。本设计依据已提交 `dev@REDACTED_REVISION`，不把规划时工作区并发修改视为已经交付。

已有能力及复用点：

| 已有模块/规范 | 本方案如何使用 | 不在本方案重做的部分 |
| --- | --- | --- |
| `RunDiagnostic`、步骤、verifier、视觉结果 | 作为带来源的失败事实；原始 domain 不是根因 | 执行器、断言、verdict 聚合 |
| `WorkbenchComparisonService` / Diagnostic Context v1 | 消费用户已选择的比较、首分歧、限制与 evidence refs | 步骤对齐、图像差异、历史扫描和比较基线算法 |
| `runResultProjection` | 原结果与当前证据状态共用投影 | 新建另一套 pass/fail 表 |
| `workbench-repair.ts` | 复用纯选择器/页面锚点检查，提供独立修复入口链接 | 自动确认、改 YAML 或复跑 |
| store owner、refs、leases、mutation gate | 有界读取和派生报告原子发布 | 共享 daemon、第二设备 owner |
| 现有 Viewer/CLI/工具注册 | 增量分诊面板和薄适配器 | 新的 Agent 循环和通用 AI Analyzer |

现有比较 Context 必须有两条运行，且主要呈现结构化事实。单次失败、无基线、方向解释、建议检查及非作者盲测仍需要本次增量。已有 `tool-call-failed` 过于宽泛，不能根据 `device-driver` domain 直接得出设备故障。现有主规范要求“最早差异不是根因”，本方案延续此边界。

## Goals / Non-Goals

**Goals:**

- 默认不需要模型、设备或历史成功样本；使用已有归档给出有依据的检查方向。
- 将“记录的事实”“规则假设”“人工意见”“当前材料是否仍可信”分成独立字段。
- 同一输入/规则版本产生同一语义结果，不让语言、宿主或自由文本改变分类。
- 降低材料查找和错误归因成本；工程准确性、用户耗时、真机/同包采用分别验收。

**Non-Goals:**

- 不承诺自动根因、通过模型判定产品是否正确、自动修复/重试/报 bug/清理数据。
- 不添加 OCR、网络抓包、logcat/系统日志采集或实时环境探针；已有登记材料缺什么就说缺什么。
- 不做多设备调度、云端协作、组织权限系统、语料自动训练和全历史聚类。
- MVP 不允许 Agent 生成或更改报告：Agent 只读已由本地 Viewer/CLI 生成的报告。Agent 自动受理可单独提案。

## Decisions

### D1. 分诊是事实层上的派生视图，不是新的判定器

```text
结束的 Run + 当前结果投影 ─┐
                         ├→ 授权/lease/快照 → 事实规范化 → 保守规则 → 不可变 TriageReport
可选已完成比较 Context ───┘                                  │
                                         当前有效性投影 + 字段权限裁剪
                                                           │
                                              Viewer / CLI / MCP / DSH
```

不从截图或日志自由文字直接猜根因。采用模板化规则而非内置 LLM，原因是可重复、离线、可审计，且不引入图片外发和模型波动。Agent 可在自己的上下文解释报告，但其解释不写回报告、复核记录或原 verdict。

报告只针对一个结束 run/attempt；suite 详情导航到具体 attempt，不把多个尝试合并成一个“失败原因”。`recovered` 保留原失败步骤及恢复事实；纯 pass 为 not-applicable，用户取消为 cancelled 事实而非产品缺陷。取消后独立的清理失败仍单列。

### D2. 四类方向是多标签检查建议，不是互斥根因

| route / 用户文案 | 可接受依据 | 不足以成立的证据 / 反例 | 登记的下一步检查 |
| --- | --- | --- | --- |
| `product-behavior` / 产品行为待核对 | 有效业务 verifier 返回 fail；或可回钻 UI/视觉断言的期望与实际不符 | 单纯像素 diff、tap 成功、超时、缺节点均不能确证产品 bug；测试数据与预期可能错误 | 核对期望与输入版本 → 查看业务/断言证据 → 核对 App 变更 |
| `locator-change` / 定位器变化待核对 | 同逻辑步骤、可对齐页面、旧选择器零命中、唯一非敏感文本/角色锚点指向新 ID | 多候选、缺树、树截断、未知遮挡、页面未打开、旧 ID 仍匹配、跨 App | 并排看旧新树 → 核对页面/构建 → 显式进入既有修复草稿流程 |
| `environment` / 环境或依赖故障 | 类型化、可追溯的会话/传输/签名/模型服务失败事件；已明确发生的 cleanup 失败单列 subcategory | 只有 `tool-call-failed`、`retryable=true` 或字符串“timeout”不够；模型 abstain/refusal 和策略拒绝不是服务故障 | 查看对应事件 → 阅读登记的连接/签名/服务排障说明 → 用户另行选择预检 |
| `evidence-gap` / 证据不足 | 需要的材料缺失/损坏/超预算/被权限隐藏；声明文本在结构中不可观察 | PNG/XML 不是原子快照；hash 正确不说明导入材料真实，也不说明 App 正确 | 查看缺口清单 → 查采集/权限原因 → 用户决定是否补采或修复可测试性 |

补充：`unknown` 表示不能安全选择具体方向；`not-applicable` 表示没有失败待分诊。模型主动放弃、策略阻止、用户取消保留准确的原始事实和 subcategory，不强塞环境故障。

规则每次输出 `supportFactIds`、`counterFactIds`、`missingRequirements`、`limitations`、`nextCheckIds`。事实的 `observed` 只代表“记录并复验了这个事件/值”，不叫 rootCauseConfirmed；方向只用 `supported`（方向有依据）、`hypothesis`（需核对）、`undetermined`，不用 0–100% 置信度。

规则运行先建立完整的事实/限制集合，再求各方向，最后排序，不用第一个错误覆盖全部结果。排序版本固定：影响本次判断的证据阻塞 → 最早已记录失败/已确认分歧 → 其他方向；相同优先级以稳定 stepKey、code、factId 排序。主卡片最多 4 项，全部结果仍可回钻。对不支持的并发时间顺序明确 unknown，不推导“先发生所以导致”。

跨构建：既有比较将构建变化标为 review-only，本方案不升级可比性。已批准视觉基线的 visual fail 可以是原运行事实；跨构建历史比较中的定位器差异至多为候选假设。视觉差异不能证明文字语义或替代业务 verifier。

### D3. 单运行起步，比较是显式补充

- targetRunId 必须是结束记录；失败、recovered、cancelled、inconclusive、证据冲突均可输入。
- 连接/签名失败若发生在运行记录创建之前，只能使用现有连接排障入口，本次不伪造一个 run 或从任意主机日志补造证据。需要分诊的环境事件必须已归档并能关联目标运行。
- 可选 comparisonId 必须已有终态报告且 candidate 指向目标 run；拒绝正在计算、失配、损坏报告。
- 首屏从单运行开始，不自动创建比较或扫描历史。已有“选择比较”流程继续负责基线选择，新增 UI 只提供入口。
- 无基线不报全局错误，明确 `no-baseline`；不产生定位器变化的强结论或首次跨运行分歧。
- 部分比较保留有效分项；存在前序缺口时只用“最早已观察差异”。单运行用“最早已记录失败”，不是“首次根因”。

### D4. TriageReport v1 与当前有效性分离

拟新增严格 schema，领域来源继续使用公共类型，而不复制 verdict/verification 定义：

| 字段 | 内容与边界 |
| --- | --- |
| identity | schemaVersion、rulesVersion、reportId、targetRunId、可选 comparisonId、createdAt、completedAt |
| input | manifest hash、comparison hash、options digest、实际读取 evidence hash、source origin/信任限制 |
| resultFacts | 经公共投影得到的原始 reportedVerdict、生成时 effective verdict、verification 分项 |
| focus | 最早已记录失败或比较首分歧的类型、stepKey/path/phase；前序缺口单列 |
| facts | 稳定 factId、原 domain/code、模板 key、受限参数、stepRef、evidenceRefs；没有自由日志正文 |
| routes | direction、basis、support/counter facts、限制、最多三条 nextCheckIds |
| coverage | required/present/missing/withheld/truncated、比较限制与未评估部分 |
| drillDown | 已登记 metadata/evidence 引用，不含本机路径、秘密、媒体或默认图片 URL |
| integrity | 报告 digest、完成状态 complete/partial；完整≠根因确认 |

读取包装层另加 `availability=verified|partial|stale|unavailable|not-revalidated|unsupported` 与 `checkedAt`。不回写不可变报告去伪装最新检查。取消/失败/中断为任务状态，不生成伪完成报告。

factId 使用规则版本及源 manifest/事件索引、stepKey、code 的规范化摘要，避免不同规则共享同一标识。语义结果摘要排除 UUID/墙钟时间；同输入规则的事实、路线、排序、建议必须一致。未知版本只读元信息/原 JSON，不按当前规则解释、不原地升级。

来源区分本机原始、导入原始、脱敏派生、旧格式未知。导入原始即使哈希一致也显示真实性未经外部验证；派生材料维持 not-revalidated，其 withheld 不能当“没有发生”。

### D5. 接口增量与权限

拟定接口（实施先补公共契约 golden；路径前缀遵循当前 `/api/workbench`）：

| 接口 | 行为 |
| --- | --- |
| `POST /api/workbench/triage-jobs` | `{requestId,targetRunId,comparisonId?}`，202 返回 jobId；仅本机显式生成 |
| `GET /api/workbench/triage-jobs/:jobId` | 状态、进度、错误码、完成 reportId |
| `POST /api/workbench/triage-jobs/:jobId/cancel` | 幂等取消；commit 已开始则显示 committing，不谎称回滚 |
| `GET /api/workbench/triage-reports/:reportId` | 受权摘要与当前有效性，读取不产生新报告 |
| `GET /api/workbench/triage-reports/:reportId/evidence/:ref` | 受权证据元数据；本机媒体仍走已有受权读取 |
| `POST /api/workbench/triage-reports/:reportId/reviews` | 本机显式人工复核，digest/revision 乐观并发校验 |
| `POST /api/workbench/triage-reports/:reportId/retire` | 本机显式停用；保留摘要/复核，原子撤销本报告源保护引用，不删除原件 |

生成不接受任意 options/路径/命令；规则版本由服务端候选版本固定。重复 requestId 同 digest 返回原 job（含失败/中断）；不同内容 409。新生成需新 requestId。常用错误码：`run-not-final`、`comparison-mismatch`、`unsupported-contract`、`queue-full`、`stale-input`、`not-authorized`、`budget-exceeded`。受权者获得具体对象状态；未授权与不存在统一不泄露响应。

CLI 增加 `test triage start|get|cancel`，通过既有 attach runtime 访问，不偷起第二 owner；不新增 standalone store 写者。start 默认输出受理，`--wait` 轮询并响应 SIGINT。命令退出码表示分诊操作本身（完成含 partial 为 0、错误/超限为 2、调用者取消为 130）；原测试 verdict/退出语义在报告独立字段显示，绝不能拿分诊成功给 CI 放行。

新增 `mobile_mirror_run_triage`，输入为 `reportId` 和可选 `evidenceRef`，只读/幂等/非破坏，不具备 start、cancel、review、retire。MCP 和 DSH 通过现有工具合同/命令层注册，不改变旧 `mobile_mirror_run_diagnostic_context`。名称、schema 和新增工具数在 Native/PTC/打包测例同时更新。

所有 Agent 读取要求既有 Agent test control 开启，并核对已登记项目/flow/suite、App、平台、运行身份、sharedEvidence；报告 ID 不是授权凭证。摘要事实若派生自被禁止证据，其参数/类别也不能旁路泄露，应显示 withheld。元数据工具不发可绕过权限的下载 URL；原始图片消费继续走既有显式授权入口。

本机 mutations 保持 Origin/loopback 检查；反向代理/任意远程访问不在本次支持范围。错误信息与备注按数据转义；不在 CLI/HTML 执行任何归档里的建议或链接。报告导出仅是显式下载受限 JSON；不新建外发通道，公开分享仍走现有审核流程。

### D6. 任务、资源、引用与回退

初始公开预算 v1（测量后如需更改应更新规则/预算版本与边界测试）：

| 项目 | 上限与超限处理 |
| --- | --- |
| 单次范围 | 一个目标 run，加比较时最多一个 baseline；不枚举全历史 |
| 输入 | manifest 各 4 MiB、比较 8 MiB；最多 2,000 步、5,000 事件、64 个选定材料；总读取 64 MiB |
| 单材料 | XML/JSON/text 各 2 MiB，PNG 16 MiB；不解码录像、不进行新像素 diff |
| 执行 | 一运行＋两排队；执行墙钟 10 秒，排队最多 30 秒；取消请求后目标 1 秒内确认状态、2 秒内结束可终止 worker |
| 输出 | 报告 128 KiB；Agent 摘要 24 KiB、48 facts/64 refs、每方向最多三条检查；超限明确 partial 和省略计数 |
| 复核 | reviewer alias 80 字符、说明 2,000 字符、最多 16 个 refs；本机私有 |

输入元数据超限直接稳定拒绝；单材料不可读/超限则该维度缺证，独立有效事实可保留。未能完整求值的方向必须标为 undetermined，不能因只看了前 N 项输出排他结论。禁止静默截断；昂贵解析/规则计算在有界 worker，宿主只做异步 I/O，DTD/外部实体、路径逃逸和 symlink 遵循已有拒绝策略。

`queued → preparing → transforming → committing → succeeded` 复用公共 phase；取消/失败/中断沿用既有语义。旧公共 `OperationRecord v1.kind`、`EvidenceReference v1.consumerKind` 当前不含 triage，不伪装成 comparison。新增中心化 v2 联合 schema 支持 triage/review 引用；旧记录保持 v1，读者双读，写者只为新 kind 写 v2。兼容测试必须证明旧程序对未知引用 fail closed，不能误清理；如旧版 reader 无法安全拒绝，则禁止打开这个新 store 做写操作并要求候选包恢复，不降级覆盖。

派生任务位于独立 triage 命名空间，报告/复核与请求 journal 不进入 run 媒体目录。计算前获得源 run lease；准备临时产物并核对输入和 owner generation，短 mutation gate 内发布报告及对应持久引用。中断后只有完整提交可恢复为 succeeded；未完成任务 interrupted，不自动重做。旧结果不因新任务失败丢失。

活报告保护被引用原运行；当前 MVP 不自动清理报告。用户确认 retire 后记录 tombstone 并撤销本报告引用，不影响 baseline/comparison/pin/Agent 等其他消费者。停用报告仍可看历史摘要，按当前材料状态显示有效性；retire 不改原 verdict，也不删除媒体。持久请求 journal 保留原受理，不随 retire 删除。原始运行 owner/设备租约继续由原实现管理，分诊从不申请设备。

### D7. 面向非作者的界面信息结构

```text
运行详情 / 失败分析                      [生成分诊] [已有比较…]
原结果 fail  · 当前材料 partial          分析于… / 校验于…
┌ 优先检查：证据不足；同时存在环境故障 ─────────────────┐
│ 已知：设备会话中断（步骤 8，查看事件）                │
│ 缺口：步骤 8 截图未获取，不能判断当时页面             │
│ 下一步：查看连接事件 → 核对 WDA 排障说明              │
│ 不能据此判断：断线前业务是否已提交                   │
└─────────────────────────────────────────────────────┘
[依据与反证] [步骤/首分歧] [证据与缺口] [人工复核]
```

第一屏使用中文/英文模板，不展示未经裁剪的异常栈；默认最多四方向卡片。点击事实进入当步已保存证据，始终带 run/step/来源标识；无材料时保留引用并解释 missing/withheld，不落到其他运行的同名文件。

慢操作按 `user-action-contract`：原摘要保留、按钮防重、局部 analyzing/checking/saving、可取消、无关历史/主题可交互、请求绑定 runId+generation 防迟到覆盖。完成分别刷新报告列表、摘要和对应领域时间。窄屏用纵向卡片；分类不能仅靠颜色，键盘可进入卡片/证据，状态用可读文本反馈。

复核用多选方向、原因说明、证据 refs 和 reviewer alias；保存独立 append-only revision，修订通过 supersedes 指向旧记录。review digest 不匹配拒绝，系统与人工意见分歧并列显示。不要“确认这是 bug”的单按钮伪装实际验证，不提供自动学习开关。

### D8. 实施分层与依赖所有权

拟新增 `workbench-triage-contracts.ts`、`workbench-triage-rules.ts`、`workbench-triage-service.ts`，Viewer triage handler/panel、golden corpus 与离线评测脚本；名称可在实现时随现有目录惯例收敛。纯规则无 provider/host I/O 依赖；只有服务读取 store/comparison，适配器不写独立分类逻辑。共享 schema 仍归 `workbench-contracts.ts` / `workbench-evidence-contracts.ts`，不是复制到新模块。

| 相邻 change | 依赖/分工 | 本 change 的验收边界 |
| --- | --- | --- |
| harden-workbench-adoption | provenance、结果投影、包/宿主生命周期 | 不修 Harness agent loop；使用通过验收的公共接口；同包失败则宿主项保持未验 |
| authoring-and-visual-validation | visual 结果、批准 revision、受控修复候选 | 只读其事实，不实现新的基线或定位器修复 |
| long-term-operations R0/R4 | refs/lease/owner、保留与中断接口 | 新 kind/version 注册和 triage 专项竞态归本 change；不复刻清理引擎或容量框架 |
| long-term-operations C4 | 三团队四周＋五分钟诊断采用 | 提供专项盲测报告引用，原任务由其 owner 审核，不自动转移完成状态 |

实施前冻结依赖 SHA 和契约 fixtures。如果共同接口仍在修改，可先做纯规则与模拟适配器；没有真实集成验收不得公开启用持久报告。开发独立推进与跨 change 验收不混淆。

### D9. 评测协议：同时限制误导与无用的保守

1. **语料**：开发 60＋冻结 60，按 App/页面/故障模板族隔离，不拆同一次运行进两组。冻结集四单方向＋unknown/不适用＋混合各 10 例；每例登记完整可接受 route 集合、依据、禁止结论和限制。至少两名不参加盲测的人员独立标注并裁决分歧；真因不可知的例子 gold 应为 unknown，不强造答案。
2. **软件**：所有禁止归因/权限/副作用样本零违反；对非 unknown gold 标签计算微平均 precision≥95%、recall≥80%，覆盖每组混淆、abstain、partial 统计。无预测的 precision 是 N/A 不是 100%；开发集调参、冻结集仅验收，调过冻结集需换独立集。
3. **人员**：至少五名非样本作者/非规则实现者/非 gold 标注者。使用开发集之外独立练习例完成相同 10 分钟引导，不讲解冻结答案。
4. **分配**：60 个冻结例，每例现有 Viewer（control）一次、新面板（treatment）一次，共 120 个任务。五人各 24 题、每条件各 12，分多场完成；同一人不看同例/同模板族两次，条件顺序和难度分层平衡。control 固定 `REDACTED_REVISION` 既有运行详情＋比较功能，treatment 仅增加分诊；对照不隐藏已有有用工具。
5. **计时与成功**：从打开运行详情开始，包含生成/等待/比较/找材料时间。成功必须同时选对完整方向、定位 gold 关键证据、说明关键限制，并≤300秒；截图猜答案不算。错误回答、超时和放弃都按失败及 300秒计入有上限耗时，防止快速猜错看起来更高效；个人完成全部任务后才揭示答案。
6. **门槛**：treatment 至少 48/60 成功，且成功率不低于 control；有上限端到端完成耗时中位数下降≥30%。同时报告组别/平台/参与者分布、错误归因和求助，避免掩盖局部退化。小样本不能声称统计显著性或全行业优势。
7. **真机**：Android/iPhone 各覆盖四方向、无基线与混合缺证；使用 Fixture 两构建受控 ID 变化/业务失败，记录已知干预，不破坏真实账号/签名。无法安全产生签名失败等样本用录制/合成并标来源，不能冒充实机注入。
8. **收益与长期采用分离**：软件门禁可先完成；没有五名参与者、授权 App 或真机样本则对应项 pending。专项盲测不替代 C4 三外部团队四周记录。评测材料仅本机，脱敏/授权后才能提交公共仓库。

## Risks / Trade-offs

- [分类被误解为根因] → 假设文案、反证/限制和来源强制展示；错误归因负例零容忍，人工意见独立。
- [规则太保守导致全 unknown] → 同时约束 precision/recall 与五分钟证据定位，不用低错误数掩盖无用输出。
- [旧运行只有自由错误文字] → 输出 unknown，列所缺类型化事件；只在现有事件边界补精确 code，不新增环境采集来猜。
- [材料中的恶意指令或秘密传播] → 规则不执行正文，摘要模板白名单，源权限裁剪和注入/脱敏测试。
- [新持久引用影响旧版清理] → 版本化注册、未知 fail closed、同包升级/回退测试；禁止静默改旧文件。
- [多个 active change 同时改共享模块] → 先冻结契约/责任与依赖 SHA；新纯模块先行，共享修改集中集成，不覆盖工作区已有更改。
- [额外取证检查拖慢诊断] → 不扫历史/不重做 diff，按预算读取、共享已验证快照、局部任务；真实耗时计入盲测。
- [人工意见包含敏感信息] → 私有 append-only、转义、默认不进入 Agent/导出，不自动训练。
- [使用者熟悉样本导致收益虚高] → 样本族隔离、非作者参与、平衡顺序、原始计时和超时全计入。

## Migration Plan

1. T0 冻结依赖与契约；先新增 v1 分诊 schema/规则和 v2 共享新 kind 读取能力，不重写 run/comparison。
2. T1 在显式实验入口启用 Viewer/CLI；旧流程照常可用，新分诊失败不能影响执行或历史查看。
3. T2 补 MCP/DSH 只读投影与人工复核/retire；通过权限、异步、故障注入和同包兼容门禁。
4. T3 完成双端样本与非作者盲测后再将分诊入口提升到常规位置；能力文档分别记录工程、真机、采用状态。
5. 回退关闭入口/工具，保留 triage/journal/引用文件；不自动删除引用或清理原件。旧程序不理解 v2 引用时禁止 store 写入，使用受支持版本管理已有数据。

阶段交付物均需源码/包/规则/语料 SHA。需要更新 ADR 0010 的派生分诊、引用版本和结果投影边界，但不改变 provider/transport。实施中若确需改变旧比较协议，应暂停并另行明确兼容方案，不能顺带破坏 v1。

## Open Questions

- 独立盲测参与者和两版授权 App 的具体名单/排期：不影响契约与工程开发，缺失时真实采用任务保持 pending。
- 首批支持设备/OS 的具体版本：以执行时登记清单为准，只影响验收覆盖，不扩大已承诺支持范围。
