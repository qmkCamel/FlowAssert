## Context

原方案已覆盖单次比较、Diagnostic Context、v1 导入、可信业务扩展和串行套件。本次修订以 `dev@REDACTED_REVISION`（2026-09-25）为准：已有分页趋势索引、performanceSignal 纯函数、v2 分享转换和请求内导出、带 generation 的清理计划与移动/恢复/purge。缺口是双窗口端到端接入、可恢复任务、完整基线引用及进程中断矩阵。依赖阶段一 C0/A1；不依赖第二阶段全部完成，但必须保护其已登记视觉基线。

## Goals / Non-Goals

**Goals:** 统计可解释、共享可审查、保留可控、长期使用与升级有证据。

**Non-Goals:** 云平台、多租户、自动上传、全能脱敏保证、默认录像分享、不可信扩展 sandbox、多设备并发调度、静默清空磁盘。

## Decisions

### C1：可重建索引与明确分母

先用本机派生索引（版本化分页 JSON 分片，原子切换 generation），不为首版引入数据库/常驻服务。原归档是事实来源；索引损坏可重建但不触碰原件。批量读取有并发/字节/条目预算，支持异步取消，默认每任务最多 10,000 条摘要，超限明确提示分时间窗，不静默截断成完整统计。

组键：project/case/input/profile + 环境指纹，保留规则版本。源码版本变化可作为对比维度，但环境不齐全组为 unknown，不能进入严格可比趋势。业务真值、视觉、清理分别统计，not-performed 不计成功。

计划用例为分母，attempt 为子项：首次 pass、确定失败、recovered、flaky、infra/inconclusive、cancelled、not-executed 分栏；失败分类可多标签，不能相加伪装互斥总数。导入/派生及无法恢复计划身份的损坏套件默认排除主回归率但单独显示计数和原因；计划身份仍可信但 attempt 材料损坏的项留在分母并记 inconclusive。分享 ID 不能当本地新执行次数。人工重跑是新执行且保留 lineage。

耗时按相同 case/input/证据策略/环境，且两比较窗口各至少 30 个有效样本，才展示统计变化提示；阈值由版本化项目预算明确配置。恢复、失败、取消耗时另列，不混入干净路径性能。提示不是根因或自动改 verdict；所有聚合可回钻 runId，原件移除后明确 unavailable/tombstone。

### C2a：原件与脱敏派生包彻底分离

本机用户显式选择已结束运行和材料类别 → 私有扫描/规则建议 → 可视预览 → 确认 → 独立导出 job。默认不含录像、原始凭据、cleanup token、绝对路径、受理 journal、设备标识。规则匹配不是隐私完整性证明；未知风险始终提示。PNG 使用像素替换并去元数据，不能用可撤销图层盖住；XML/日志/参数用字段白名单和遮罩。扫描/转换有界后台任务，取消/失败保留原件和上一成功导出。

v2 包沿用 mobile-mirror-run 名称、version=2，携带随机 shareId、source=derived、reportedVerdict、verification=not-revalidated、脱敏规则版本、已审查材料列表、变换说明、新 hash。来源 runId/hash 映射仅保存在本机私有 journal，不默认导出低熵输入摘要或能关联设备的指纹。原始结果仅为来源报告事实，不能因脱敏副本哈希正确而算完整原件证明。

导入 v1 行为保持；v2 生成新 imported run，来源报告单列，可信判定为 inconclusive/派生材料未复验，不重算 UI/业务成功、不作为自动通过基线。导出省略的材料显式列为 withheld，不造假文件满足引用。所有 included refs 必须解析且 hash 一致，无多余文件/路径/录像。默认继承 v1 的 64 文件、单文件 4 MiB、总 16 MiB 原始字节限制，序列化请求总量有独立上限；超出拒绝，不丢材料伪装完整。

相比试图把脱敏结果再塞进 v1，v2 避免修改证据后仍冒充原始 verdict 的语义混淆。v1 原件式导入能力不因此移除。

### C2b：先引用保护，再安全清理

本机引用索引保护 active run、读/比较/导出 lease、用户 pin、已批准 baseline、比较 report 和未完成受理。建立跨进程可识别的 lease/owner 校验，复用 store 单写边界；不能仅在 UI 把按钮禁用。

清理顺序：扫描容量 → 生成带 generation/hash/有效期的 dry-run plan → 显示材料/大小/保护原因 → 用户确认 → 在 store mutation gate 下重新校验引用和活跃状态 → 移入隔离 trash → 写 tombstone/索引 → 原子提交。对象变化时拒绝 stale plan，不能照旧删。默认自动清理关闭；启用必须先预览政策，仍不能删除受保护材料。存储不足且无安全候选时拒绝新任务，不驱逐活跃证据。

默认 trash 至少 7 天可恢复；同盘 trash 不会释放空间，UI 分别显示可恢复占用与实际释放字节。提前彻底删除需第二次明确确认；已选择到期 purge 政策后按期处理，也必须重验 lease/owner。到期仅表示符合该政策的候选，没有政策时不自动 purge，材料仍在则可恢复。恢复不能覆盖同 ID 对象，首版固定拒绝冲突，不自动改 ID。崩溃后按清理 journal 判定所在状态，不凭文件不存在认定成功。

永不随证据清理删除 requestId 幂等 tombstone；否则同请求可能再执行。仍被引用的 run 默认不可删，用户须先显式处理引用；仅清理缓存与派生索引不能破坏原基线。符号链接/任意目录/外部路径拒绝，禁用通用 shell 删除。

### C3：从试点提炼可信业务模板

HTTP prepare/verify/cleanup 模板执行在现有可信 worker 中；端点和 credentials 由本机配置登记，Agent 只选已批准用例。使用 run-scoped 测试命名空间、显式 correlation id、清理 token 私有 journal；超时结果未知不重放写入，cleanup 只清理当前任务所有资源。固定超时/响应体上限、脱敏预期/实际业务结果，不采集全量数据库或网络包。

给出普通 API、异步任务轮询、失败后幂等清理示例及 CI 报告接入。模板不是安全沙箱，不支持任意远端脚本/SQL。至少在两试点应用验证真实接口及取消/清理反例后才称可采用。

### C4：持续采用与发布

复用既有治理文件，增加脱敏 issue bundle 的明确授权流程、版本兼容矩阵、固定 Release 验收清单。每个发布候选关联源码 SHA/tarball SHA/支持矩阵/旧归档可读证据，至少验证前一支持版本升级及回退的只读兼容；新格式旧程序无法识别时明确拒绝，不破坏新记录。

采用目标：至少 3 个外部团队连续 4 周有实际回归，不依赖维护者每次陪跑；记录每周活跃团队、回归量、诊断与维护工时、求助次数。失败样本盲测至少 80% 可在 5 分钟正确分类并指向证据（不是要求自动根因）。没有试点即为 pending，不以社区 star 数替代。

### R0：统一引用、租约和任务基础契约

先锁定共享接口，再让 R1—R5 消费。仍是一 store 一个写 owner，复用现有 store 锁并补进程启动身份/nonce；另一进程拒绝写入/清理，不能只凭 PID 存活或过期时间夺锁。设备 claim 继续由现有设备服务持有，证据 job 没有设备动作能力。

| 契约 | 字段及所有权 |
| --- | --- |
| EvidenceReference v1 | refId、consumerKind、consumerId/revision、targetRunId、evidenceRefs、sourceHash；覆盖 baseline、comparison、suite、child、share-map、pin、未完成 Agent 受理 |
| EvidenceReadLease v1 | leaseId、ownerGeneration、runIds、operationId、acquiredAt；由当前 store owner 管理，在同一 gate 注册/检查/释放 |
| OperationRecord v1 | jobId、kind、requestDigest、ownerGeneration、phase、progress、createdAt/startedAt/finishedAt、stableError、resultRef；不含凭据或原始输入 |
| CleanupJournal v1 | operationId、runId、action、manifest/inventory hash、ownerGeneration、state、authorizedAt、purgeAfter、result；每个对象独立记录 |

硬引用来自原始登记记录，派生引用索引只做加速；索引损坏、未知消费者或无法完整遍历时保护相关对象并拒绝清理。引用的增删与清理确认在同一 mutation gate 内提交。lease 申请和材料读取必须先确保 store 初始化及 owner 已验证；包括下载流、比较、分享、视觉候选、历史重跑、趋势扫描，finally/流关闭/任务终态释放。长 CPU/I/O 在 gate 外执行，gate 只处理短期资格重验和发布，读 lease 覆盖 gate 外处理窗口。

运行完成后的 Agent journal 不应永久阻止媒体治理：只有在最小受理 tombstone（requestId 摘要、原 execution/runId、参数身份、终态、证据可用性）安全落盘且可重放读取后，才允许无其他硬引用的媒体清理。journal/tombstone 本身不随媒体删除。旧 journal 不支持该语义时继续保守保护，禁止用 schema 猜测放行。

### R3：有界预览与导出任务

保留既有接口兼容：新增 opt-in job 模式返回 202/jobId，旧同步请求仍从同一转换服务等待有界结果；不能直接把现有客户端期望的 archive JSON 改成 job 状态。Viewer 改用 submit/status/cancel/result；这些请求均 same-origin、loopback 且返回脱敏状态。每个 store 同时最多 1 个分享转换任务、队列最多 2 个，超额明确 busy；相同 requestId+digest 返回同一任务，不同 digest 拒绝重放。

任务阶段为 queued → preparing → transforming → awaiting-review（预览）或 committing（已审查导出）→ succeeded；另有 cancelling/cancelled/failed/interrupted。预览成功时产生 10 分钟有效的 review token，绑定来源 manifest、精确文件集合、遮罩、规则版本及输出 hash；编辑任何选择/遮罩立即失效。实际导出重新验证 token 与同一字节输出，保留读 lease，不能让两次转换之间的变更绕过审查。

一次任务处理墙钟预算 30 秒（不计独立受限的排队和人工审阅等待；人工审阅仍受 token 的 10 分钟有效期限制）、输入最多 64 文件、单文件 4 MiB、总解码前文件 16 MiB、序列化归档最多 24 MiB；PNG 单图最多 4096×4096，图像并发 1，worker 内存 256 MiB，队列等待最多 30 秒。预算在读取/解码前后和写临时件前检查；平台无法提供对应 worker 限制时用可终止子进程并记录相同超限状态。慢转换必须可被终止，不能靠主事件循环的 AbortSignal 伪装抢占同步像素计算。

产物写到私有临时目录，计算文件清单和归档 hash，来源映射与归档一起以提交 manifest 发布；下载只认已提交 manifest。进入 committing 后取消回复“正在完成提交”，由提交结果决定 succeeded 或 failed，不回报已取消却发布了新文件。提交前取消删除本任务临时件并释放 lease；原运行和上一成功产物不受影响。重启把未提交任务标 interrupted，不自动重做转换/导出；提交存在时复核后恢复结果入口。任务状态至少保留 24 小时，已提交分享映射在显式处理其引用前不自动丢弃。默认仍不分享录像。

### R4：清理的中断收敛与容量准入

先补保护门禁，再扩大清理可用范围。每次移动前写 move-intent，fsync 后同盘 rename，再写 trashed 提交；恢复先写 restore-intent，rename 后写 restored；purge 先持久化独立确认与精确 inventory，再删除并写 purged。发布目录和 journal 均执行原子替换/目录 fsync。跨盘 rename 拒绝，不自动变成复制后删除。多对象清理不是整批事务：逐对象提交，返回 moved/failed/pending 清单；取消仅阻止下一个对象，已移动对象可恢复。

| 已持久化意图与重启时文件状态 | 收敛规则 |
| --- | --- |
| move-intent，live 有、trash 无 | 原件保留，记录移动未提交；不自动重做用户动作 |
| move-intent，live 无、trash 有且 manifest/inventory 一致 | 补记 trashed，计隔离区占用和实际释放 0 |
| restore-intent，live 有、trash 无且身份一致 | 补记 restored，重新建立可用性索引 |
| restore-intent，live 无、trash 有 | 恢复未提交，保留可恢复入口 |
| 任一移动/恢复意图，两处都有、两处都无或 hash 不同 | 标 recovery-required，不覆盖、不假定成功，保护对象并提供定位信息 |
| purge-intent，目标残留 | 标 purge-interrupted，显示已删除/待处理清单，剩余删除需新确认；不能承诺回滚或无损恢复 |
| purge-intent，登记对象均已不存在 | 在确认意图及 tombstone 完整时补记 purged；没有意图不能从“不存在”推导成功 |

启动恢复完成前不接受新的破坏性清理；只读历史显示实际可用性。10 分钟清理计划绑定 owner generation、引用 generation、来源清单和 hash，重启后全部失效。确认中新增 baseline/share/comparison/pin 或 lease 必须使候选受保护；路径逐级校验真实根，拒绝 symlink、跨根和未知目录项。

扫描设置版本化预算：最多 100,000 个目录项、深度 8、读取元数据/清单总计 128 MiB、30 秒；超限返回 coverage incomplete，不能据局部扫描执行删除。受保护大小计入容量。run、trash、export、baseline、派生索引分别展示占用，移动不算释放；purge 返回实际移除的登记字节和是否完整。

写入准入在共享 store admission 下原子预留空间：默认安全余量 256 MiB，加当前运行/任务既有上限估算的剩余证据预算，失败给出 storage-insufficient 或 storage-capacity-unknown；读取与释放空间入口继续可用。空间估计不能预防外部程序同时写满磁盘，故每个持久化阶段仍测试 ENOSPC，已有记录保留且失败运行不可 pass。释放预留只在任务终态/可确认的 owner 恢复后进行，不靠超时猜测任务死亡。

### R5：趋势身份、覆盖范围与双窗口比较

统计规则提升到独立版本，不复用界面渲染版本。主分母为 `(suiteRunId, plannedCaseId)`；同 case 的有序 attempt 去重，独立人工重跑是新计划执行。缺少 plannedCase 身份的单次运行放 unplanned，import/derived 放 imported，损坏套件单列，不能虚构分母。计划已接受但套件仍在运行的项显示 active/pending，不进入完成窗口通过率。

完成计划执行的互斥 outcome：无 attempt 为 not-executed；缺失/损坏 attempt 或不支持契约为 inconclusive；终次为 recovered 就为 recovered；终次 clean pass 且仅一次为 first-pass，多次为 flaky；其余分别 fail/cancelled/inconclusive。失败原因可多标签，不能与 outcome 相加。通过率明确为 `first-pass/planned`，另给 `(first-pass+flaky)/planned` 的最终干净通过率；recovered 不进入任一分子。

有意清理与材料损坏必须区分：tombstone 保存的已校验终态摘要可继续作为历史报告事实和计划分母，另标 evidenceStatus=trashed/purged，关闭实时证据入口且不声称仍可复验；无合法 tombstone 的缺失/坏文件降为 inconclusive 并计入缺口。旧索引不可单独证明历史事实。引用保护正常仍阻止套件消费者未释放时的清理，此规则也覆盖显式解除引用后的历史摘要。

组键冻结 project/registered case、plan/input digest、证据策略、平台/provider/OS/runtime、viewport、App ID/build、视觉规则范围和统计版本。unknown 单列为不可比。跨构建比较只能显式选择 A/B 构建维度，固定其余组键；不能因组键含 build 而禁止所有升级对照，也不能悄悄忽略 build。

双窗口使用 UTC 半开区间 `[from,to)`，按计划启动时间归属，必须非空、不重叠。每个相同组的两窗口各至少 30 个完整且可比的 first-pass 样本，并有同一版本预算，才显示变化提示；flaky/recovered/fail/cancelled/inconclusive 的时长单列。中位耗时为唯一首版告警统计量，单位毫秒。仅当 `currentMedian - previousMedian > absoluteMs` 且相对变化 `> ratio` 时提示 slower-than-budget；等于阈值不触发。previousMedian=0 时相对比例为 unavailable，只有绝对差严格超限且 currentMedian>0 才触发并说明零基线规则。无预算、样本不足、环境不符、非法区间分别返回明确状态，不能默认为 within-budget。

索引仍为派生 JSON generation。每次读取和游标固定一个 generation；页间重建后旧游标只能继续同一代或提示 stale，不混两代。取消/失败不发布新 pointer。查询返回 UTC 区间、规则/预算版本、完整覆盖范围、样本/排除原因及 run refs；同一时窗也应用于 imported/unplanned 计数。范围筛选先于所选数据的 10,000 摘要上限；目录发现也受独立扫描预算，超限明确无法完成，不能谎称缩小时窗必能绕过所有物理扫描成本。耗时提示为描述性预算信号，不声称统计显著性或自动根因。

### R6：模块边界与文档收敛

采用原包内渐进抽取，不拆 npm 包、不换执行器、不引入共享服务。依赖方向固定为入口适配器 → 应用用例 → 领域契约 → 存储/provider 接口，领域层不反向 import HTTP、DOM、Cordis 或 MCP SDK。

| 现有热点 | 抽取职责 | 必须保留的行为 |
| --- | --- | --- |
| viewer-server | 按 runs、baseline、sharing、retention、trends 分 handler；公共 Origin/body/error 层 | 原 URL/方法/授权/错误码，新增 job 需显式模式 |
| workbench-service | 预检/执行调度、检查点取证、终态聚合拆为可测组件；共享投影由 R2 持有 | 原租约、mutation fence、取消与 session 清理顺序 |
| workbench-store | 原件存储、引用/lease、生命周期 journal 和派生索引分接口 | 一写 owner、原子提交、历史读取和幂等事实 |
| viewer/workbench.js 与 app.js | 先抽历史/结果、分享、清理、趋势面板及 action 状态；app.js 仅抽对应生命周期接缝 | 草稿/选择/最近结果保持，局部 busy、取消、迟到结果隔离 |
| mirror-service | 只补边界测试，避免在本轮重写设备状态机 | 仍是唯一设备服务；不新增 input/provider owner |

文件行数只定位热点，不作为完成指标。每次抽取以 HTTP/CLI/工具契约 golden、状态机/取消测试及必要 E2E 证明等价；功能补齐和机械抽取分提交。文档以 `docs/capabilities.md` 和具名验收记录为能力入口，架构图反映实际模块，TODO 记录下一步，roadmap/tasks 区分计划、实现、Mock、真机和采用；更新日期/源码 SHA/DSH 与 AppClaw 版本，不改写历史验收。

### 工作包依赖、交付顺序与回退

| 包 | 所属与硬前置 | 验收结束条件 |
| --- | --- | --- |
| R0 共享契约 | 本阶段，C0/A1；先冻结接口 | 所有读写消费者登记、跨进程 owner 与引用竞态 fixtures 通过 |
| R1 基线批准 | 阶段二，R0；可并行 R2/R3/R5 | 审批原子性/不可变 revision/成功来源与权限矩阵通过 |
| R2 结果出口 | 阶段二，C0；与 R0 同步字段 | 同一 tarball 六类出口的固定结果矩阵等价 |
| R3 有界分享 | 本阶段，R0 | 任务预算/取消/重启/旧接口/新 job 及敏感 fixtures 通过 |
| R4 生命周期 | 本阶段，R0；集成须 R1/R3 引用注册 | 全部持久化切点、并发读取、幂等与容量准入通过 |
| R5 趋势统计 | 本阶段，R0/R2 的摘要与 tombstone 契约 | 精确分母/分组、29/30 边界、双窗口/预算/generation 测试通过 |
| R6 模块与文档 | 本阶段，契约稳定；按功能包小步抽取 | 外部契约等价、实际 UI、文档链接与能力对应检查通过 |

推荐顺序：R0 → R1/R2/R3/R5 分支实现 → R4 故障矩阵 → R6 集成验收。并行指独立工程工作包，不允许同时修改 store/contracts 同一共享接口；单人按该顺序分提交。工程包可各自交付但父 change 在剩余 B3b、真机、C3/C4 采用任务完成前保持 active。

每包禁用入口后仍能读取已提交数据；不回退或覆盖新 schema。回退版本对未知新记录明确只读拒绝。新导出保留旧同步响应模式；审批记录增加独立版本；清理旧 journal 读兼容，不确定状态保护；趋势旧缓存重建，无需改原始 run。完成后按同一 tarball 做运行→视觉→比较→分享→导入→隔离→重启→恢复/purge→requestId 重试集成链；只在临时数据集执行破坏性反例。

## Risks / Trade-offs

- [脱敏漏报] → 人工预览、默认少分享、明确非完整保证、已知秘密 fixtures 零泄露门禁。
- [索引陈旧造成误删] → 确认时重验 generation/引用/lease，文件系统与 journal 原子状态恢复测试。
- [频率被误解为根因] → 多标签事实、分母和环境显示，结论只读。
- [trash 占满磁盘] → 分开统计逻辑清理与物理释放，不偷偷 purge。
- [数据删除后破坏幂等] → 最小受理 tombstone 与证据生命周期分离，删除后重复 requestId 回归。
- [模板越权写业务] → 可信配置/任务命名空间/显式清理所有权，未知结果不自动重放。

## Migration Plan

C1 与 C2a 可在 C0 后开发；C1 正式统计需 A1。C2b 必须等引用/lease 保护测试通过才接删除；C3 依赖 A4 试点信息。第二阶段视觉模块可选，登记 baseline 后即受统一保护，不存在模块则没有该类引用。

索引随时可丢弃重建；禁用自动清理不恢复已确认 purge 的内容，必须在启用前说明。v1/v2 双读、新导出 v2，旧安装只读旧格式，新格式拒绝；回退不写新格式目录。更新 ADR 0006 的归档边界及需要变化的 owner ADR，不用本轮规划把其状态改 Accepted。

## Open Questions

无阻塞方案定稿的范围问题。实际外部项目/账号、团队周期、容量分布需实施采集；初期 10,000 摘要与归档大小是有界默认，不代表性能承诺。若真实项目超限，应独立评估扩容而非直接取消限制。
