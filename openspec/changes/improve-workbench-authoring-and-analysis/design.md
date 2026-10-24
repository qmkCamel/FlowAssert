## Context

规划日期：2026-10-03；基线 origin/dev@REDACTED_REVISION；状态：方案、共享受理和导航/分析布局已获用户确认；软件实现及证据见 implementation-validation.md，真机与独立用户验收暂缓。核心用户是假设中的测试工程师和需要自助验收的开发者，不假设他们已经熟悉 YAML、证据引用或模型配置。

### 现状与复用清单

| 能力 | dev 实际状态 | 本方案处理 |
| --- | --- | --- |
| Inspector | 冻结节点、定位候选、点击/断言/等待草稿、校验、复制/下载 | 串入首测流程；不重写捕获协议 |
| 执行 | 共享会话、独占设备控制、编译、取消、证据、结果投影 | 作为唯一执行通道 |
| 分析 | 步骤证据、比较、实验分诊、受控修复、录像、分享 | 重组呈现，不换算法、不升级为自动根因 |
| 本机项目 | 固定路径注册 flow/dataset/hook/suite 的配置快照 | 保持现有读取契约；初版用例库不自动写回项目 |
| 引导分支 | REDACTED_REVISION 有 acceptance/readiness/investigation 实现，但不在 dev 祖先链 | 先逐模块审查、适配，不整体盲合并，不继承旧验收结论 |

前轮体验走查是 mock 小样本，不代表真机性能或用户研究。主要问题：YAML/JSON 第一入口；草稿与执行交接断裂；同一长面板混合编辑、统计、管理、详情；分析期间右侧仍是实时设备；错误、状态 token 和长 hash 挤占摘要。

### 对标原则

借鉴 [Maestro Studio](https://docs.maestro.dev/maestro-studio/run-tests-with-maestro-studio) 和 [Mobilewright](https://github.com/mobile-next/mobilewright) 的点选编写路径；借鉴 [Playwright Codegen](https://playwright.dev/docs/codegen) 的显式断言与 [Trace Viewer](https://playwright.dev/docs/trace-viewer) 的步骤联动；借鉴 [Allure](https://allurereport.org/docs/history-and-retries/) 的用例身份/历史重试；[Playwright Agents](https://playwright.dev/docs/test-agents) 和 [Midscene](https://midscenejs.com/) 仅指导后续“计划、生成、验证分离”。资料来自 2026-10-03 官方文档研究，不代表竞品实测；不承诺原生端具备 Web DOM/network trace。

## Goals / Non-Goals

**Goals:**

- 设备已就绪后，用户通过表单和 Inspector 创建带至少一条明确检查的用例，不必手写 YAML。
- 一份可版本管理的用例输入贯穿编辑、校验、执行；展示“静态校验”与“业务通过”差别。
- 失败运行有独立、可深链定位的分析页，在第一屏解释首失败与证据范围。
- 复用已验证执行和证据治理边界；中英文、键盘和窄屏可操作。
- 软件验收先独立交付；真机和非开发用户成效指标保留待验，不阻止无设备工作的推进。

**Non-Goals:**

- 本 change 不实现完整操作录制、自然语言模型请求、PRD 上传、多设备调度、云报告、多人协作、自动修复执行或任意主机路径写入。
- 不为 UI 改造引入 React/通用状态框架/数据库/内部 Cordis；不新增第二设备 owner。
- 不要求所有历史用例迁移；不清除旧 localStorage 草稿或改写历史归档；不把已录屏当作验证视觉或业务正确。

## Decisions

### D1. 信息架构与路由

采用现有原生 JS 模块，新增轻量路由和页面状态管理。首版使用 hash 路由，避免改变静态服务器 fallback：

| 页面 | 路由示例 | 主任务和默认内容 |
| --- | --- | --- |
| 用例库 | #/cases | 新建、搜索/标签、打开、复制、归档；空态只突出“创建第一条用例” |
| 用例编辑 | #/cases/new 或 #/cases/<uuid>/edit | 响应式目标/步骤表单、步骤卡、折叠 YAML；设备/Inspector 显式交接 |
| 运行记录 | #/runs | 状态/时间/App/设备/用例筛选，清楚区分独立 run 和 suite attempt |
| 运行分析 | #/runs/<uuid>?step=<index>&tab=evidence | 摘要、步骤列表、归档证据、详细上下文；默认首个失败，否则第一个可用步骤 |
| 设备 | #/devices | 复用当前连接、诊断与实时预览 |
| 管理 | #/manage | 现有容量/保留、视觉基线、趋势等操作分区 |

没有 hash 时显示用例入口与连接状态；旧工作台入口映射到新入口。只接受白名单路由、合法 UUID/步骤整数；URL 不放 YAML、公开参数、截图或凭据。深链是本机定位，不等于跨机器分享地址。

浏览器前进/后退恢复选中的 run、步骤和 tab；会替换编辑内容的导航明确保存/放弃/取消。临时查看历史或设备时，编辑器保持挂载和原稿，返回不重新加载；关闭网页使用未保存提醒。页面切换不取消正在执行的运行；全局状态条给出“运行中/前往查看/取消”，关闭 Viewer 的现有语义不变。

理由：按任务拆视图比在原侧栏继续堆折叠面板更清晰。2026-10-03 用户已确认沿用现有视觉样式、四项导航、桌面分析三栏与窄屏页签。实际截图检查见实施记录。

### D2. 首测向导：四步与一个反馈环

| 步骤 | 用户输入 | 默认行为 | 阻塞/提示 |
| --- | --- | --- | --- |
| 1 选择目标 | 当前设备、平台、App ID/可用 App 候选 | 复用当前会话；App ID 可人工填写 | 无设备时可保存草稿，不允许运行；不为填表启动额外 Appium |
| 2 描述检查 | 名称、步骤、预期结果、公开参数 | 默认空检查模板；可显式载入 mock 演示，不混同真实 App 模板 | 无断言时提示“仅动作流程”；允许保存，但首测完成标准不算带验证用例 |
| 3 校验与审查 | 查看编译/lint、目标/数据/留证范围 | 自动展示修改后的“需重新校验”；显式发起校验 | 语法错误、缺参数、未注册 hook 等阻止执行；未知项不猜测 |
| 4 运行并留证 | 确认本机原图/结构/日志；录像独立选择 | 准确修订版本执行；显示 accepted/runId | 重复点击去重；失败不丢草稿；校验通过不等于设备状态已验证 |

完成后提供“查看分析”“再次编辑”“导出可复用项目”。“第一次试跑通过”绑定具体修订、参数/项目摘要、App/平台和验证范围，不提供永久的“本用例已验证”徽章。

草稿状态不与运行结果混成一条枚举：编辑状态 dirty/saved，校验状态 stale/valid/invalid，运行状态引用既有 phase/verdict；“已纳入回归”仅在项目导出后由用户确认使用或有真实 suite 注册证据，不凭下载自动标记。

### D3. Inspector 和步骤编辑：不损失原 YAML

- 复用 REDACTED_REVISION 的显式交接与 revision 校验设计；选择性移植所需模块，优先保留 dev 的 Worker 与引用治理。readiness 扩展语法不作为本 change 依赖，现有 selectors 足够交付首版。
- Inspector 提供“追加到当前用例”“作为新用例”，替换非空草稿二次确认。追加后标记校验失效；旧捕获、跨 session、多个匹配、敏感节点不得偷偷变成坐标点击。
- 首版可视化编辑支持现有 tap、type、assertVisible/assertNotVisible、waitUntil/waitUntilGone、launchApp 与受限等待，字段映射必须使用既有 compiler 支持的语法。复杂条件、循环、hook、visual 等显示只读高级步骤卡，跳到 YAML 编辑，不做有损转换。
- 以 YAML 文档（含注释/原文本）为唯一可执行事实，步骤卡是解析视图；只修改支持节点的字段，编辑后重解析。源区间和 UI stepId 只用于修订内定位，不作为跨 run 恒定语义身份。无法无损更新时进入源码模式，不重新序列化整份文档丢注释。
- 输入使用公开测试值；敏感值只引用项目已注册参数/机制，首版不创建新的凭据仓库。不能保证自动识别所有秘密，需明确提示并拒绝已标记敏感节点的采集。
- 有效断言不自动从录制轨迹推断。“tap 已执行”不是“登录成功”；建议预期结果由用户确认。

### D4. 本机用例库与持久化契约

新增 `WorkbenchCaseLibrary`，由 WorkbenchApplication 组装，只管理应用自有 root/cases，不操作用户任意目录。新目录必须纳入 store 枚举安全白名单，但不能被识别成 run/trash；不改变 ledger 或 source manifest 的事实地位。

| 对象 | 建议字段 | 关键规则 |
| --- | --- | --- |
| CaseRecord v1 | caseId、name、tags、platform、appId、headRevision、archivedAt、createdAt、updatedAt | UUID 路径；名称不是文件路径；归档可恢复，不删除历史 |
| CaseRevision v1 | revisionId、caseId、yaml、publicParams、projectDigest、contentDigest、createdAt、origin | 不可变；重复保存相同规范化输入复用 revision；含外部项目依赖须显式注明 |
| ValidationReceipt | token、revisionDigest、paramsDigest、projectDigest、compilerVersion、targetBinding、expiresAt、issues | 服务端持有，10 分钟有效且只在当前 runtime 有效；任何绑定变化都要求重验 |
| Run authoring origin | 可选 caseId、revisionId、inputDigest | 新运行复制已冻结输入；不读取“用例最新版本”重解释旧 run |

保存协议：mutation gate + 容量准入 → 写新 revision（原子/fsync）→ CAS 更新 head。expectedRevision 不匹配返回 409，保留本地编辑，提供另存副本；更新中断至多留下无 head 的 revision，不自动 GC。读取错误显式呈现，不用默认空库覆盖损坏数据。草稿不形成 run 引用，删除/归档用例不删除 run；修复派生的真正证据依赖继续走原 repair/child 引用链。

首版预算：库 1,000 个 case、每 case 100 个 revision、请求 80 KiB/YAML 64 KiB、列表每页 50 条、名称 160 字符/最多 10 个标签（每个 32 字符）。到限明确拒绝新增并允许导出/查看，不静默截断或自动删除。预算可后续实测调整，不宣传无限规模。

参数持久化必须由用户确认属于公开测试数据；localStorage 旧草稿仅提供“恢复到新用例”提示，不后台迁移。注册项目的 flow 仍只读引用；导出固定相对路径的 YAML、suite 配置和 README，显示预览与文件清单，不携带注册命令、凭据或原始证据。依赖外部 hook/profile/dataset 时展示缺失清单，不能伪称可独立执行。

### D5. 应用与接口边界

以下新增契约已有 schema/契约测试；实际接口和证据见 requirement-map 与 implementation-validation。

| 接口 | 输入/输出 | 安全与并发 |
| --- | --- | --- |
| GET /api/workbench/cases | filter、cursor → 摘要页 | 有界、无 YAML；generation 变化返回重新载入提示 |
| POST /api/workbench/cases | 创建输入 → case/revision | requestId+digest 幂等，冲突 409；不执行设备动作 |
| GET /api/workbench/cases/:id | 固定 head 摘要与修订索引 | 有界；内容读取另选 revision |
| GET /api/workbench/cases/:id/revisions/:revision | 完整修订 | 不可变版本，不能通过路径绕出自有目录 |
| POST /api/workbench/cases/:id/revisions | expectedRevision+内容+requestId → 新 head | CAS、同 gate；冲突不覆盖 |
| POST /api/workbench/cases/:id/archive | expectedRevision+archived → 状态 | 仅用例库软归档，不动 run/evidence |
| POST /api/workbench/authoring/validate | YAML/params/目标 → issues+receipt | 只读编译，不调用设备；显式绑定 project/target |
| POST /api/workbench/authoring/run | receipt+inputDigest+consent+requestId（M3 可选 caseRevision）→ runId | 服务端取得 receipt 绑定的冻结输入并重验项目/会话；复用既有幂等受理与取消机制，不能只靠按钮禁用 |
| 导出入口 | 固定修订 → 有界下载 | 复用/适配已有 acceptance export；不接受客户端任意路径 |

所有 mutation 复用 ViewerServer 同源/JSON/body 检查；越权、预算、CAS、过期和 busy 返回稳定 code 与本地化说明，日志不包含输入秘密。authoring/run 的持久 requestId journal 沿用现有受理恢复语义：先查已受理的同身份/同 digest 请求，再对新受理检查 receipt；因此重启后已受理重试返回原受理/中断/明确未知，不因 receipt 过期丢失查询路径，新请求仍须重验。任何情况不自动重放设备写入。

#### D5a. 共享持久受理（2026-10-03 用户确认）

审计见 `implementation-audit.md`：Agent coordinator 的 journal 与注册目标、policy、source 和引用保护耦合，不能直接用来执行 Viewer 任意草稿。先抽取 `WorkbenchAcceptance`，由 `WorkbenchApplication` 组装并关闭；服务只拥有受理身份、持久写入、串行去重、恢复及关闭协调，不拥有 provider/设备，不新增通用调度器。

- 公共机制以受限 channel 接收已授权的受理描述；同 channel/requestKey/digest 重试返回原记录，冲突拒绝；prepare 仅对新请求调用。受理 fsync 成功后才能进入原 `WorkbenchService.start` / executeGate，失败不打开派发门。
- Agent adapter 保留原启用开关、catalog/flow/suite/App/平台校验、project identity、requestKey/hash、错误码和工具 schema；保留 `agent-executions` v1 格式及 `workbench:agent` 引用/tombstone。不动态注册草稿，不因 Viewer 本地授权扩大 Agent 权限。
- Viewer 使用 `authoring-executions` v1 与 `workbench:authoring` consumer，记录 executionId、requestId、requestKey、requestHash、runId、phase、acceptedAt/endedAt 及有界状态摘要；不在 journal 持久化 YAML/参数/receipt 原文。以应用 store owner 为请求域，与 Agent 身份隔离；HTTP 不暴露 Agent journal 或接受客户端 namespace。
- Viewer digest 绑定 receipt token、inputDigest、localEvidence、video 和可选 case/revision 身份。对已受理的重试先查 journal，再检查 receipt；新请求严格重验 10 分钟期限、runtime、项目/target/input。请求预算 80 KiB，单 journal 256 KiB、每 Viewer channel 10000 条，到限明确拒绝新受理，仍可查询，不自动驱逐幂等 tombstone。
- 各 channel 的持久恢复只把非终态标为 interrupted/inconclusive；即使落盘成功但响应丢失，也不重放。落盘结果不明时保留 identity 并禁止再次派发，要求查询或重启恢复，不用新 requestId 自动重试。
- 文件原子替换/fsync、目录与文件 symlink 拒绝、store mutation gate、容量准入和发布前引用规则共享；新消费者走已有 ledger，不在 retention 添加专属目录扫描。关闭先停止新受理、等待正在受理的请求，再取消/排空原执行 owner，最后关闭 store。
- 新格式用独立目录，不改写旧 Agent journal 为新版本。回滚保留新 journal；旧版本需对新目录/ledger 安全只读或拒绝清理，不能删除未知对象。以独立进程故障和前一版本探针证明，不以类型检查替代。

实施顺序改为：旧契约 golden → 共享受理抽取与 Agent 兼容 → Viewer receipt/authoring 接线 → UI。必须覆盖受理前、临时文件 sync 后、rename 后、引用发布后、开派发门前、终态发布前的故障，以及重启零重复设备写入、跨 channel 隔离与关闭竞态。

旧 POST /api/runs、CLI、MCP、DSH 保持现状；不为首版 UI 扩张工具数。新服务保持 host-neutral，未来宿主只能通过同一应用服务调用；DSH 不改 agent loop。

### D6. 运行分析页：摘要先行、原始事实不变

顶部显示用例名称、运行结果、当前证据可用性、App/设备/时间及验证范围。首失败摘要由已有结果投影和结构事实确定性生成；分诊仍显式发起，是假设或检查方向，不把建议写成根因。

示例：第 2 步未找到“订单成功”；预期元素可见，实际匹配 0 个；截图和结构已登记；业务数据未验证；建议查看现场或比较同版本最近成功运行。若材料当前损坏，摘要改为“原记录断言失败；当前截图无法复验”，不继续显示“证据已验证”。

| 区域 | 内容 | 默认交互 |
| --- | --- | --- |
| 左侧 | 步骤索引、类型、通过/失败/跳过状态 | 首失败自动选中；Tab/Enter/上下箭头可导航，颜色不是唯一状态表达 |
| 中间 | 已归档截图、按需原始结构、录像定位（存在时） | 标记历史 run/step/time；绝不拿实时画面补缺失证据 |
| 右侧 | 预期/实际、定位器、源码行、失败事实和下一步 | 技术标识/原始 JSON 折叠，保留复制能力 |
| 次级页签 | 比较、分诊、原始材料、来源、人工复核 | 按需加载，打开报告不自动外发模型或改变运行结果 |

分析模式默认不显示实时手机；用户可显式切到设备页。窄屏使用“摘要/步骤/证据/详情”页签，不挤成三列；桌面允许折叠列表。录像定位清楚标注近似偏差，未采集就提示“该运行未录制”；不声称拥有 before/after 快照、网络请求或崩溃日志等未采集材料。

第一版复用 run/detail/artifact/comparison/triage HTTP；只新增轻量路由状态，不新建可篡改的“分析真相表”。懒加载登记证据，使用现有校验和读 lease；切换 run/step 取消旧请求并以 epoch/runId/stepId 检查迟到返回。单次预览上限沿用证据端点预算，禁止全量预载所有图片/XML/视频。

### D7. 比较、修复和复验闭环

- 推荐基线必须匹配 App、平台与输入/项目身份，并依据已有 comparability 规则；同名用例不同 revision 不默认可比，未知环境明确显示原因。用户显式确认，最近成功不等于天然可比。
- 修复建议只进入新草稿，展示差异、来源及限制；不自动删断言、改预期或执行。沿用已验证 repair digest，不绕开其授权。
- “载入此用例编辑”和“按原快照复跑”说明不同：前者新修订，后者固定输入。两者都创建新运行、保留原 verdict；复跑是否通过不是自动根因确认。
- 选定 child run 后并列原失败与复验事实、参数/修订差异；不相干 App/平台/parent 的 run 不允许作为复验关联。可适配 REDACTED_REVISION investigation 的契约，不把其新 readiness 语法顺带带入。
- 用例历史按 caseId 分组但逐条显示 revision/params/build；旧 run 没有 caseId 时保持独立运行，不能靠名称猜历史身份。

### D8. 所有长动作的统一交互规则

校验、保存、导出、执行、证据加载、比较、分诊都遵循：局部进度、起始控件去重、成功刷新、失败保留上一可用结果、取消/迟到不覆盖新状态。导航和阅读其他历史可用；设备捕获若与执行互斥，应显示“设备由当前运行占用，可在结束后重试”，不要笼统“检查失败”。

校验请求取消不取消执行；关闭分析页不取消运行；取消运行使用已有生命周期等待，不能把“已发送取消”显示成“已取消”。updatedAt/checkedAt 使用对应领域事件时间，不因切换 tab 更新时间。

中英文文案将 verified/not-performed/no-baseline 转成“证据已复验/未执行/尚无成功基线”，技术 token 在详情中可查。焦点进入页面标题/错误摘要，进度 aria-live=polite，危险操作有文本标签，Tab 顺序连贯，支持 200% 缩放；深链恢复不强制把键盘焦点反复抢回。

### D9. 后续生成方案（不属于本 change 的实现任务）

**操作录制：** 只能记录通过本产品控制入口派发并已确认的操作；不承诺捕获用户在实体手机上的所有触摸。草稿中区分操作与断言，语义 locator 优先，敏感值参数化，等待转条件需审查；失败/未知派发不重试。需独立授权与 OpenSpec，因为从只读选点变成设备写入。

**自然语言/PRD：** 输入需求→输出场景/前置条件/预期的计划→用户审查→与当前屏幕绑定→生成现有支持 DSL→静态校验→明确执行→冻结修订。输出带来源和待补项；模型未知 locator/业务真值时必须 abstain。默认只发需求和已审查结构，截图/App 内容外发另行授权；预算、模型、超时、取消、费用、模型版本可见，页面文字作为不可信资料而非指令。

模型只输出草稿，不拥有 device lease、主机命令或放宽断言权限。生成接口与 repair/executor 分离，界面依旧落到本次 CaseRevision/ValidationReceipt；人工编辑和 AI 草稿走同一执行门。评估包括首跑成功率、人工修改量、错误通过率、有效断言覆盖及总成本，禁止仅用“生成行数”衡量。

**问题报告/团队：** 先复用本地安全派生包；后续再做经过预览的 issue 模板、失败聚类和团队存储。深链不当作可公网访问链接，不引入默认云上传。

### D10. 实施阶段与验收口径

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| M0 复用审计 | REDACTED_REVISION 模块/契约对照、冲突清单、UI 流程与视觉审查 | 确认哪些直接适配、哪些延期，旧行为 golden fixtures 可比 |
| M1 第一条用例 | 导航、向导、Inspector 交接、修订校验、明确执行与导出 | mock 正反例闭环；过期/冲突/取消/故障不派发或不丢稿 |
| M2 看懂失败 | 独立分析、首失败摘要、步骤/证据/源码/录像联动 | 缺图、损坏、不可比、迟到响应仍呈现可信事实；旧结果兼容 |
| M3 可复用资产 | 自有用例库、修订、归档、搜索和历史关联 | 重启保存、CAS、容量/断电切点、旧读取器安全拒绝或只读兼容 |
| M4 完整软件验收 | 同包 Viewer/CLI/MCP/DSH、规范与用户指南 | 四项门禁、探针、截图和新旧输入矩阵通过；设备/用户成效仍单列 |

M1 允许先临时草稿+导出，不虚构已保存库；M3 接入持久化后向导才展示“保存到用例库”。M2 可在 M1 后独立交付，不等待 AI。全部阶段实现前更新任务记录，不能只勾选 UI 可见。

确定性验收：至少覆盖无断言/有效断言、正反例、目标切换、过期 token、编辑后迟到校验、双窗口 CAS、请求重试、重启恢复、ENOSPC、损坏/缺失/旧/导入/派生证据、比较不可比、修复与复验不改原件、public参数及路径攻击、旧宿主工具契约。Slow stub ≥500ms 验证每个长动作期间导航/阅读可用、失败保留、完成刷新；桌面 1440×900、窄屏 390×844、200% zoom、键盘完整走查并留运行截图。

建议的用户研究目标（不是已达成绩效，也不是软件 Mock 能证明）：5 名非开发参与者中至少 4 名，在设备已就绪且 fixture 已准备条件下，10 分钟内生成一条带有效断言的用例；至少 4 名在 30 秒内指出失败步骤、2 次操作内看到关键证据；明确区分“UI 通过”和“业务未验证”。安装/签名时间另记，不排除失败用户或人工帮助时间。真机/用户研究按要求暂缓，不伪造替代结论。

## Risks / Trade-offs

- 老分支覆盖新治理 → 逐模块适配并先建立边界回归；不直接整分支覆盖 service/application。
- 导航重构造成状态分叉 → 每个操作保留单一 owner；路由只持选择/草稿状态，业务状态仍来自应用服务。
- 可视化编辑损坏复杂 YAML → 支持集合明确，保留原文；未知节点只读卡/源码编辑，不降级静默删除。
- 用例库成为第二运行真相源 → run 固定输入快照；case 只负责编写历史，不能改 verdict 或替代证据引用。
- 只读分析频繁复验造成卡顿 → 摘要先呈现为待复验，当前已验证状态必须绑定实际检查；按需取材、可取消，不用缓存冒充已校验。
- 错误信息简化过度 → 自然语言摘要保留适用范围，原始 code/hash 可展开，自动根因明确不做。
- 用户研究/真机延期 → 分别标记工程完成、设备待验、采用待验，禁止统一“已完成”徽章。

## Migration Plan

1. 冻结 dev 的四项门禁、同包工具/结果投影及旧归档 fixtures；记下新旧能力覆盖。
2. 先适配 branch 中不改变设备写入语义的 acceptance/investigation 模块，再做本 change 的 UI 导航与分析；任何 parser/readiness 变化独立评审，不顺带移植。
3. 新 UI 以开发期开关并行验证，确认深链/导航/旧入口可达后切默认；用例库仅新建自有目录，不自动导入/改写用户项目。
4. 新可选 run origin schema 需要旧读取器 fixtures；旧版本拒读不得修改字段绕过，新版读取旧 run 不强行关联 case。
5. 回滚 UI 开关不删除新 case/revision/journal；执行会话按既有关闭流程结束。任何旧程序处理新目录必须经兼容探针证明安全，不能拿“可读 JSON”替代契约验证。
6. 交付时更新相关 ADR（用户输入/持久化边界）、主规范与文档；保持历史未验 tasks 原状态，仅建立对应关系，不批量勾选。

## Open Questions

已确认视觉样式/导航/分析布局，复用审计见 implementation-audit；首批真实业务样例及参数字段待真机验收恢复后确认。当前默认桌面优先、原生 JS、应用自有用例库、固定目录下载导出、无外部模型。

需新授权/新 change 才推进：直接写用户项目、实体设备操作录制、云模型/截图外发、多人共享或付费服务。本文只设计后续方向，不把它们作为已批准实施范围。

## 实施边界补充（2026-10-03）

- catalog 32 MiB、单修订 128 KiB、变更请求回执 10000 条；孤立的已发布修订也计入预算，不自动清除。1000×100 元数据测试是合成 catalog，不是十万文件的性能基准。用例库六个写入切点采用异常注入；真实子进程 SIGKILL 属于共享受理，不混称断电实测。
- 源码按登记 sourceLine 高亮，结构保留原文和匹配诊断，不依据当前屏幕猜历史节点框。首版未实现截图节点覆盖高亮、数字快捷键或桌面列表折叠；这些不是两份 delta 的软件退出条件，可后续改善。
- 修复从分析页交接既有高级编辑器，保留 repair digest/parentRunId 授权链，不以普通向导草稿绕过原限制。旧高级入口为 `#/legacy`。
- 初版步骤编辑器使用响应式表单，而非另建一套内嵌实时设备组件；Inspector 经设备页显式交接。真实设备及 5 人研究仍需独立验收。
