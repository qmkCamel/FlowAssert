## Context

状态：M1/M2 离线工程链与 Viewer/CLI 入口已接通；M3 已有构建、制品摘要、独立安装审批和 Mock 维护协议，Appium 真机闭环仍待验。逐项进度和证据边界见 [tasks.md](tasks.md) 与 [implementation.md](implementation.md)。原设计基线 `dev@REDACTED_REVISION`；工作树尚未重新集成最新 `origin/dev`。动机见 [proposal.md](proposal.md)。方案统一收敛到一个总变更，按 M1/M2/M3 交付，避免三个相互复制的权限和结果模型。

### 当前可复用能力与缺口

| 当前代码 | 已有能力 | 本方案补齐 |
| --- | --- | --- |
| `src/workbench-repair.ts` | 简单 tap 的 id/accessibilityId 替换、XML 哈希、唯一文字/角色锚点、确认时重算 digest | 明确故障码、未派发证明、导航允许名单、参数/环境/构建兼容及复验调度 |
| `src/viewer-workbench-runs-http.ts`、`workbench-service.ts` | 已确认草稿生成 child run，执行前校验 manifest 和 YAML | 私有登记候选的受控入口；不能用任意 YAML 绕过 Agent 的 registered-flow 限制 |
| `src/workbench-investigation.ts`、`workbench-triage-service.ts` | 结构化事实、只读建议、后续核查、报告权限 | 有预算且有授权的修复生命周期；建议仍不是根因 |
| `src/workbench-recovery.ts` | run 内有限导航恢复，原断言保留，recovered 非普通通过 | 本方案是 run 结束后的独立修复任务，不替代原恢复流程 |
| `src/workbench-application.ts`、`mirror-service.ts` | 统一组装与关闭，单设备租约与控制围栏 | 修复服务加入生命周期；安装能力仍必须经同一设备边界 |
| `src/workbench-references.ts`、`workbench-consumer-references.ts` | v3 引用、发布/退休、保守保护 | repair case、补丁和验证结果的持久消费记录及清理关系 |
| `src/workbench-change-acceptance.ts` | 不可变修订、明确验证维度 | 修复结果经用户确认生成新验收修订，不覆盖原结果 |

不能直接去掉当前“确认”按钮：相同文字/角色不足以证明安全导航，历史 XML 也不是当前页面的派发凭据。现有本地哈希只能证明材料一致性，不能证明外部报告真实性或源代码与 App 二进制的供应链关系。

## Goals / Non-Goals

**目标**：一次明确授权后，自动执行已冻结、有限、可取消的修复验证计划；失败时给出具体缺口，成功时给出原失败—补丁—制品—复验的可追溯证据。插件决定“允许做什么、实际做了什么、证明了什么”，不依赖宿主自报结果。

**非目标**：通用自主演化 Agent、任意 shell、自动签名配对、生产账号写入、未经审批的 test healing、无人合并发布、连续视频经 MCP、默认多设备修复。外部 JUnit/JSON 导入仍只作线索，不因接入修复任务升级为本地复验。

## Decisions

### D1. 用结构化事实分流，不用模型置信度直接派发

| 分类 | 必要事实 | 允许路径 | 拒绝或停止条件 |
| --- | --- | --- | --- |
| locator-drift | 已结束本地失败；明确 missing-target；目标动作未派发；同语义成功锚点 | locator-maintenance | 歧义、仅超时字符串、动作未知、非导航、构建/环境无法匹配 |
| readiness | 可核验隐藏/禁用/未稳定等事实 | 核查建议；批准预算内的既有 readiness 验证 | 不能自动增大超时、改性能阈值或改测试数据 |
| product-defect-candidate | 原业务/UI 断言失败、源码与构建映射可得 | product-code | 源码不可得、预期存在争议、无法定义独立验证 |
| environment | 结构化设备/驱动/网络故障 | 诊断后阻塞；人工恢复再创建尝试 | 不自动 kill 外部进程、配对、改签名或重装 |
| evidence-gap / unknown | 材料缺失、导入来源、完整性错误、未知副作用 | 补证/人工处理 | 不生成“已修复”结论 |

模型可以解释竞争假设、提出代码补丁；路由器与验证器不执行来自截图、XML、错误文本、源码注释中的指令。选择“无安全候选”是有效结果。

### D2. 保持模块化单体与宿主薄适配

```text
Viewer / CLI                         Codex MCP / DSH Cordis
      |                                   |
      +-------- 授权入口 / Repair API ------+
                          |
                  RepairCoordinator
                 /        |         \
      LocatorRepair   HostRepairBridge   VerificationService
         纯候选          请求/补丁交接       冻结计划独立判定
                          |                    |
                 宿主隔离编码工作区        CommandRunner / BuildAdapter
                                               |
                                WorkbenchService / MirrorService
                                               |
                                         现有 provider
```

拟新增 `workbench-repair-contracts.ts`（纯类型/校验）、`workbench-repair-workflow.ts`（状态机）、`workbench-repair-policy.ts`（准入/差异）、`workbench-repair-verification.ts`（判定）、`workbench-repair-store.ts`（journal/引用）。沿用现有 `workbench-repair.ts` 作为候选提供者，不把源代码修改塞入该类。

`host-repair-bridge.ts` 只交接；`repair-command-runner.ts` 只执行可信登记命令；`mobile-build-adapter.ts` 负责制品元数据及构建边界。领域模块不反向导入 Cordis/MCP/Viewer/LocalDeviceRuntime，新增边必须通过现有完整图守卫。Worker 退出复用既有 exit ownership，不把 terminate 的请求等同于退出确认。

对比：不选“每个宿主一套 repair loop”，避免结果与权限漂移；不选 Healenium 全套代理替换现有路径，避免额外状态基础设施和不透明 locator 改写；不引入第二个设备 owner。

### D3. 数据模型与不可变绑定

| 对象 | 核心字段（拟议 contractVersion=1） | 约束 |
| --- | --- | --- |
| RepairCase | id、projectIdentity/revision、sourceRunId/manifestHash、route、planId/digest、phase、outcome、revision | 原 run 不可改；revision 用于并发更新 |
| VerificationPlan | sourceSnapshot、protectedAssertionsDigest、dependencyDigest、requiredChecks、baselineBuild、platform/appId、params/environment/reset digests、预算 | 先于补丁冻结；任何语义变更生成新计划并重新审批 |
| RepairAttempt | caseId、attemptId、generation、parentAttemptId、patchDigest、requestDigest、childRunIds、commandReceipts、artifactRefs、终止原因 | 历史追加、不复用失败尝试身份 |
| RepairApproval | principal、caseId、planDigest、patchDigest、projectRevision、allowedOperations、targetDeviceBinding、有效期 | 精确范围；Agent 请求字段 reviewed=true 不等于人类审批 |
| HostRepairRequest | 协议版本、case/attempt/generation、baseCommit、允许/保护路径、证据引用、固定验收摘要、expiresAt | 不含密钥、签名配置、任意命令或完整录像 |
| PatchSubmission | requestDigest、baseCommit、受限 unified diff、补丁摘要、解释、宿主标识 | 宿主声称的检查结果只作附件，不参与正式判定 |
| VerificationRecord | plan/patch/artifact digests、对照与复验记录、维度结果、缺口、checkedAt、grade | 仅可信验证服务产生；不可被宿主覆盖 |

保护摘要覆盖 YAML 展开计划、用例参数、独立业务 verifier、视觉基线、OCR profile/approval、所有静态依赖和数据初始化/清理规则。仅比较 YAML 文本哈希不够。未知动态依赖默认不满足自动验证准入；允许人工提供新登记配置后重新冻结。

持久化布局拟为 `runsRoot/repairs/<caseId>/{case.json,plans/,attempts/,verification/,retired.json}`。物理路径只由本地登记生成，公开接口返回逻辑 ID；单对象 JSON 上限 1 MiB，单次分页最多 100 条。摘要索引可重建，journal/manifest/hash 为真相；不每次查询扫描所有 run。

### D4. 状态与结果分开

主流程：`planning → awaiting-approval → queued → preparing → patching → checking → [building → installing] → revalidating → regressing → finalizing → finished`。M1 跳过源码 patching/build/install，M2 在软件检查后 finalizing，缺设备不得伪造 revalidating。挂起使用 `blocked`；任何活跃阶段取消进入 `cancelling`，实际收尾后才 finished。

| 事件 | 行为 |
| --- | --- |
| 同 requestId、同输入摘要重复提交 | 返回原任务；不同摘要返回 request-conflict，不启动第二轮 |
| 未审批或摘要/权限变化 | 停在 awaiting-approval 或 blocked，任何已发审批失效 |
| 验证失败且剩余预算 | 持久化失败尝试，下一候选使用新 attempt/generation，再审批新 patch |
| 取消与迟到成功竞争 | 取消持久化后成功不生效；拒绝后续命令、安装、设备动作 |
| 原 owner 仍未退出或设备写入未知 | 保持 blocked/cancelling、保留围栏和原因，不能宣称安全取消完成 |
| 重启发现非终态 | 只恢复展示和核对；不自动重放命令/安装/测试；未知动作标 inconclusive 并要求确认 |
| 写盘失败 | 不发布成功；已产生的副作用与持久化缺口明确保留，不用重试掩盖 |

`outcome`：`candidate-only`、`software-verified`、`device-verified`、`not-fixed`、`blocked`、`inconclusive`、`cancelled`、`budget-exhausted`。`device-verified` 仅表示冻结范围通过，不表示人工 review、合并或发布。

独立 CLI `repair verify --required-grade`：默认要求 device，只有达到所需等级且所有 required checks/cleanup/evidence 通过时退出 0；不满足或未修复退出 1，运行/协议错误 2，取消 130。既有 run/CI/JUnit 的 pass/recovered 行为不变；修复摘要包含原失败链接，不能把原 failing test 从报告中删除。

### D5. 两段审批和有限预算

先审批“可共享的证据、可进入的仓库、可生成候选”；候选产生后再批准具体 patch 与验证计划。执行级审批可覆盖已展示的软件检查与构建，但尚未生成的产物不能提前取得“确切制品已批准”的身份。构建完成后追加绑定 artifact digest、目标设备、reset 和回归的安装确认；已存在的可信制品可一次批准后续计划。不必每条命令弹窗，但替换候选、构建环境或扩大范围必须重新批准。这里是两级授权，不保证全流程只有两次弹窗；等待追加确认时进入 awaiting-approval，保存 resumePhase=installing 且不持有设备租约。

首版只能在本机 Viewer 或交互式 CLI 由人确认；服务器生成一次性审批 nonce，经现有 same-origin 与本地会话检查消费，MCP/DSH 不暴露 approve 工具。服务端不信任 caller 自填 principal。首版不提供按置信度的无人审批模式。

建议默认预算：每 case 最多 2 个补丁尝试；每尝试至多 1 次基线复现和 2 次干净复验，加 1 次冻结的关联回归套件，套件内部自动 retry 禁用并限制最多 20 case。M1 总执行 10 分钟；M2/M3 30 分钟；审批等待不占执行时长，但审批 30 分钟过期，case 24 小时后需重建/重新核验。重启不重置已花费次数和期限。以上为可调工程预算，不是速度承诺；调整只允许本地可信登记，并使旧审批失效。

每进程/Store 最多 1 个活跃修复执行、同仓库与同设备同时仅一个写 owner；第二个返回 busy，不建无界队列。每次派发都重新检查项目授权、摘要、新鲜度、取消和资源准入。纯候选分析不占设备租约。

### D6. 测试维护路径

1. 原失败必须来自本地已结束 run；被导入、分享派生、证据不完整、cleanup 失败或含未知写入的运行不能自动复跑。
2. 使用现有修复候选，但新增 missing-target 与未派发事实检查；只接收顶层单字段 `tap.id/accessibilityId` 的变化。导航范围需可信配置和原计划中的确定性后置断言，文字“下一步”本身不是安全声明。
3. 基线必须为无恢复的成功原运行，App/platform、测试参数、后端环境、语言及数据模板兼容；若跨 build 取锚点，只允许已登记的 fromBuild/toBuild 对，且把差异展示给审批人。
4. 对 AST 差异实施允许名单：仅允许该 locator 替换；同一次维护不能改等待、参数、prepare、verify、cleanup、断言、视觉/OCR 期望或目标 App。
5. 批准后的候选登记为 case 私有不可变版本，与原 registered-flow 和项目 revision 绑定；受控执行入口只接受 candidateId+digest，不接受宿主任意 YAML，不修改原 flow 文件。
6. 复验在当前目标 build 的干净测试数据上先重现原失败，再运行候选。页面/目标在派发前重新检查；不从旧截图 nodeId 直接点击，不重放前序业务写入。
7. 原断言与必要业务核验/cleanup/证据全部通过才 device-verified。否则保留失败；候选中途触发 AI 导航恢复仍为 recovered，不是干净修复成功。测试库正式采用候选由后续人工修改/审查，不自动覆盖。

离线 reset：Mock provider 在修复独占范围内重建全部内存模型，由 `MirrorService` 返回不同 namespace 身份和初始状态摘要；它只能支撑 Mock 软件级复验。内部协调器已在每项检查前持久化 reset intent/回执，核对权限与冻结计划，并在 child 引用保护后开放执行门；重启不重放 prepared intent。Appium 项目不能以 `launchApp` 或声明的 `resetContractVersion` 替代可执行且可核验的数据重置，缺少适配器时保持 blocked，真机等级不可用。

### D6a. 普通 tap 的本地事实生产与源步骤映射（已确认前置）

编译器为 leaf 中每个原始 YAML 步骤保留 v1 源身份：源文档摘要、原步骤路径、原步骤 AST 摘要、源行及顶层标记。运行路径仅描述执行位置，不能被解析成 YAML 下标；连续 leaf 合并、前置 readiness、子流程及循环均通过编译元数据映射。自动维护只接受当前根文档的静态顶层单字段 tap，嵌套/循环/绑定步骤不自动升级为可维护。

只有可信项目显式启用 repair，且执行的是完全匹配登记 flow 的导航允许名单步骤，才采用 `WorkbenchDevice` 内的受限本地 tap 路径。普通 YAML 语法不变；该步骤从 native block 中按源映射拆分执行，其余步骤沿用既有 Worker，不改变 Worker v1 消息格式，不解析其 error 文本。原 locator 使用现有 selector adapter 的解析语义，增加明确 foreground、完整结构、唯一、可见、启用、非敏感及边界检查；因此仅 opt-in 范围采用更保守的执行准入，默认行为不变。

自动候选准入还要求每个导航登记明确 `page`（唯一可见的应用页范围）与 `allowedTarget`（目标角色/文字）。原基线和当前失败观察中，定位器对应目标均须为该页面的唯一非敏感后代；缺少配置只保留普通 tap 采集与人工草稿。准入再核对原后置断言、原运行冻结项目快照、已知的 App/平台/参数/环境/数据/重置版本与构建；跨构建仅接受登记的观测二进制摘要对。此约束防止仅凭相同文字把另一页面按钮当成原导航目标。

冻结计划必须从可信项目登记中选出至少一个 `regressionFlows`；其静态依赖摘要覆盖全项目的流程、数据、扩展源码、视觉与 OCR 配置和 repair 策略。出现未解析的运行时输出绑定、环境插值或扩展密钥依赖时阻塞自动验证。原定位器值在受保护断言摘要中以固定占位符表达，允许唯一的已批准 locator 替换；其余验收输入变化使旧计划与审批失效。

事实包含 run/源步骤/会话 generation/观察摘要/selector 摘要、解析结果与匹配数、派发区间、开始/结束时间。解析原始 XML 和解析回执在设备动作前持久化；设备写入仍通过既有 dispatch journal。终态事实与实际派发记录绑定，missing-target 仅能在本地解析为零匹配且没有该步骤派发时产生。写盘失败、取消、观察截断、已派发后失败和未知返回均不得冒充 missing-target。缺目标只证明本次解析未命中，不证明业务根因是 locator drift。

候选服务从完整性已核验的事实及源身份定位源 YAML，使用原始解析观察作为失败锚点；当前页面在后续执行前重新观察。旧记录仍可读、仍可按原规则生成仅人工草稿，但没有新事实不得自动执行。不能修改旧 manifest 来补证；新证据必须来自新授权运行。测试必须包含真实 WorkbenchService/Mock 执行，而不是仅手工拼装 manifest。

### D6b. 真机页面契约与本机转发修复

登记 `page.version=2`，anchor 精确匹配角色与至少一个 identifier/name/text 字段，必须唯一、可见、非敏感且有正面积；container 指定 1–8 层祖先距离、平台类型及可选 identifier。容器不得为 Application/Window/hierarchy 或结构根，目标必须属于该容器，锚点与目标几何范围须被容器包围；目标不能充当自身页面授权锚点。Android TextView＋LinearLayout 和 iOS StaticText＋Other 分别登记，不伪造 application 节点。隐藏同身份副本、截断、重复 nodeId、路径循环、跨容器目标均拒绝。记录与候选准入共用纯校验器；派发在证据／intent 持久化之后重新观察、确认 App 与页面、几何和快照未变。历史 application-only 登记仍可解析，但自动点击及准入保守拒绝；重新登记会改变 revision，使旧审批失效。

既有 recovery 原定位器即使存在也必须匹配 policy.page；fallback 和首次点击均重新检查 durable intent 后的页面，不增加模型或设备权限。页面不符为 inconclusive，不冒充 locator missing 或业务失败。

自有 Managed Appium 子进程通过 NODE_OPTIONS 加载本地 ESM hook，只对 XCUITest 10.19.1 的已审计 device-connections-factory 指纹修改单个 listen 调用为 127.0.0.1；同一工厂覆盖 WDA 和 MJPEG USB host forwarding。未知版本、指纹变化或重复匹配 fail closed。不改全局安装文件、不覆盖 net.Server、不处理外部 Appium。hook 随包分发、随 owned descendants 继承，保留现有进程所有权与取消语义。实测端口绑定与清理单列，手机端 WDA 自身监听和完整构建安装闭环不在本机转发修复的证明范围。

### D7. 业务源码路径与 Codex/DSH 交接

本机可信 `RepairProjectRegistration` 登记 repositoryId、canonical realpath、base-ref 获取方式、平台/App、可写路径、受保护路径、验证命令、reset、构建配置、证据外发范围。登记不从页面、报告、候选分支或 MCP 参数学习。运行中登记 revision 变化使审批失效。

宿主能力协商：`protocolVersion=1`、支持候选生成/取消/回执、宿主及插件版本。Codex 通过普通 MCP 工具交接，DSH 通过已登记 Cordis tools/effects；不假设任何未公开的“启动 Agent”API。默认由当前宿主 Agent 读取请求并工作，插件不后台启动另一模型循环。宿主不能执行时交付待人工处理的请求，不伪造自动闭环。DSH 首次实现需明确记录实际测试版本，现有 0.1.5-rc.2 只是仓库已验证的历史基线。

生成侧使用登记源码基线的独立 worktree；主工作区 dirty 不复制、不 stash、不重置。接收方忽略宿主工作区路径，按 baseCommit 在验证侧重新构建独立工作区，仅重放通过策略检查的补丁。

首批补丁为 UTF-8 文本 unified diff，最多 20 文件/512 KiB；拒绝绝对路径、路径穿越、symlink/submodule、文件 mode 更改、二进制和受保护路径。允许新增普通源码/辅助单测，但验收计划及既有独立 oracle 不可修改。patch摘要、源码树摘要和执行目录每次运行前后复核；发生额外修改则 invalid-patch。`.git` hooks、包管理配置、lockfile、构建脚本、验证配置默认受保护。

可信 Runner 使用独立注册 `executable + argv + cwdPolicy + envAllowlist + timeout + outputLimit`，shell=false；不从补丁/报告拼接 shell。验证 harness 从基线只读副本取得，产物从验证侧构建。进程结果必须保存命令身份、exit code、stdout/stderr 摘要、开始结束时间与输入 tree digest；单命令日志 10 MiB，超限停止并标明截断，不能仅丢弃关键失败。

worktree 不是沙箱。首版只支持用户明确信任的本地仓库和工具链；强制网络/文件系统隔离是独立 runner 能力。项目策略要求隔离而宿主做不到时 blocked，不能以 env 过滤宣称已安全隔离。依赖准备为人工预置步骤，不自动安装任意依赖；不承诺保护同一 OS 用户下的恶意宿主。独立业务 oracle 与人工代码审查用于防止应用源码针对测试作弊，技术检查不是正确性证明。

### D8. 构建、安装与复验

构建配置固定工具链、入口、输出路径和摘要；Android 首批单 APK，iOS 首批已签名开发 `.app`／适配器明确支持的开发包，拆分包和商店分发默认 unsupported。不自动创建证书、注册设备、解锁钥匙串、卸载旧 App 或清除个人数据。

`BuildArtifact` 记录 baseCommit、patch/tree digest、工具链身份、配置摘要、artifact sha256、包标识、版本和构建时间。即使宿主上传同名包，也必须经登记输出根内的普通文件/目录检查、大小预算和哈希校验；目录产物采用确定性文件清单，拒绝逃逸链接。本轮结论称“本机可追溯构建”，不是签名供应链认证。

安装必须由 `MirrorService` 的新维护租约串行调度，provider 扩展受限 install/identity 能力；构建适配器不能自行调用 ADB/Appium/devicectl 控制设备。现有 provider 不支持时阻塞。安装租约与测试租约互斥，安装后会话/观察缓存失效，再建立明确绑定的测试会话。不得删除外部 owner 的会话。

安装后读取 App 身份并结合 App 自带 build marker 或可信平台回执确认制品；仅 appId/version 不足以证明 binary digest。不能确认时 `installedIdentity=unverified`，可保留软件结果，但不能宣称该补丁真机复验通过。

原构建在独立数据 namespace 中复现失败；候选构建在同平台/设备类别、后端版本、语言、参数和 reset 规则下运行原测试，再运行冻结回归。系统权限或后端数据无法还原时停止，不通过改用 Mock 代替原 required check。自动复跑前必须证明旧尝试 cleanup 已结束并使用新 namespace；订单/支付等场景只能使用授权测试环境。

设备安装是不可事务回滚的副作用。失败/取消不能偷偷装回旧包；记录“最后已知安装状态”，设备进入待核查围栏，需要用户显式恢复批准。进程被杀或安装结果未知时，只允许只读身份核对，不自动重试安装。

### D9. 冻结验证与结论

验证级别分别为 proposal / software / device，不与原 run verdict 混用。每个检查项记录 `pass|fail|inconclusive|not-performed`，并标明 Mock、模拟器或真机。首版的 device-verified 专指冻结目标真机上的核验；Mock/模拟器只能支撑软件级或单列的模拟执行证据，不能满足默认真机等级。前后控制差异必须显式列出。

- 测试维护：当前构建下原 locator 失败 → 仅 locator 改动后原断言通过 → 冻结回归通过。
- 业务源码：原源码/构建下原测试失败 → 补丁后软件检查 → 本机新构建及安装身份核验 → 原测试在干净数据上连续两次通过 → 冻结回归通过。
- 原问题不能稳定复现：结果为 inconclusive/待人工判读，不凭候选偶然通过推断因果。两次通过只是工程门禁，不能据此声称统计稳定性。
- required check 跳过、日志/证据截断影响判定、cleanup 失败、recovered、未知构建/设备身份均禁止 device-verified。
- M2 只能给 software-verified；即使所有软件测试通过，没有设备结果也不能把 required-grade=device 的 CI 变绿。

“接入变更验收”是独立显式操作：建议新的 acceptance input，把失败历史与实际通过的 child run 一起关联，沿用验收对象权限和制品声明边界；用户发布新修订，不把 repair grade 直接映射成旧 acceptance pass。

### D10. 持久化、容量、引用和关闭

先预留空间和持久化 request/intent，再派发有副作用的操作；finish 结果及证据持久化成功后才发布终态。更新按 case revision CAS 串行化；崩溃恢复不推断 exactly-once 外部副作用，只提供请求幂等和未知状态隔离。

使用 v3 `workbench:repair` 消费者保护 source、baseline、child run；沿用先保护引用再发布消费者、先退休 marker 再撤引用的协议。活跃任务读 lease 与长期引用分开；验证附件也是 repair 自身资产，退休不改原 run。损坏、未知格式或未完成 journal 阻止危险清理，不自动 GC 孤儿。

沿用 Store 写入准入及 256 MiB 安全余量，容量未知/不足时无新设备动作或已发布结果。证据预算默认每 case 64 MiB；源码/构建缓存由独立登记根和所有者预算管理，不能把 GB 级产物塞进 Store 的小额 reservation。构建根默认预留 2 GiB（项目可调整），产物默认最大 1 GiB；根目录同卷时必须按 filesystem identity 汇总 reservation，不能重复计算可用空间。host 不提供可核验容量时 blocked。

关闭顺序：停止 repair 准入 → 取消/排空交接、命令、构建和设备任务 → 确认子进程/Worker 实际退出与设备调用终止 → 持久化收尾 → 释放租约/预约 → 关闭相关 workbench 服务。不得因有期限就伪造资源已释放；卡住时返回明确 shutdown blocker。临时 worktree 仅在确认无运行进程且属于本 case 后由用户显式清理，失败保留现场。

### D11. API、权限与 UI（拟议，尚不可调用）

工具仅在 `repair.enabled` 与新权限启用后注册：

| MCP/DSH 工具 | 含义 | 授权 |
| --- | --- | --- |
| `mobile_mirror_repair_plan` | 根据受权 run 与登记项目创建只读候选任务，返回审批缺口 | repair.plan + 原运行读取权 |
| `mobile_mirror_repair_get` | 有界状态、证据引用、当前可执行的 host request | case/project 权限及证据共享交集 |
| `mobile_mirror_repair_submit` | 提交与当前 request 绑定的受限补丁，不执行 | repair.submit + generation/摘要绑定 |
| `mobile_mirror_repair_verify` | 消费已存在且未过期的人类批准，启动精确验证计划 | repair.verify + 原 flow/platform/app 权限 |
| `mobile_mirror_repair_cancel` | 取消当前主体可控制的 case，等待真实收尾 | case owner/显式管理员权限 |

未启用时默认仍为原 20 工具；启用时增加上述五个工具，M1 无源码能力时 submit 固定返回 repair-capability-unavailable，不能把它当 shell。各宿主共用参数 schema、错误码、结果投影与契约测试；能力协商明确列出 `locator`、`codePatch`、`buildInstall`，不能静默降级。

Viewer/CLI 本地入口拟为 `/api/workbench/repairs` 下的 create/get/approve/verify/cancel/retire，异步受理返回 202、caseId、revision、phase。变更请求带 requestId、expectedRevision、planDigest；审批额外绑定 patchDigest。批准、安装和退休均为独立操作，HTTP 沿用 loopback、same-origin、body 预算，审批 nonce 不写日志。

常见机器码：repair-evidence-unavailable、repair-ineligible、repair-project-changed、repair-approval-required、repair-stale-approval、repair-invalid-patch、repair-capability-unavailable、repair-not-reproduced、repair-install-identity-unverified、repair-unknown-mutation、repair-storage-insufficient、repair-budget-exhausted。未授权对象统一 not-found，避免枚举。

Viewer 展示原失败、分类与竞争假设、候选 diff、验证计划、审批范围、时间线及历史尝试。超过 300ms 的操作仅禁用相冲突按钮；历史、证据、语言/主题仍可用。阶段更新来自持久任务事件，不用随机百分比；checkedAt 仅在实际核查结束时改变。取消/失败保留上次完整结果，并显示新失败原因。默认不展示自动“合并代码”按钮。

### D12. 三阶段交付与判定门槛

| 阶段 | 可交付闭环 | 不依赖真机的门禁 | 必须另行完成 |
| --- | --- | --- | --- |
| M1 | 人工确认定位器补丁后，自动原失败对照/候选复验/回归，留存 case | 状态机、审批、证据、AST 允许名单、Mock run、UI、故障切点 | 双端真实导航变化与非作者判读 |
| M2 | 宿主生成业务补丁，独立重放补丁及软件验证 | Fixture 源码库、两宿主协议、路径攻击、伪造报告、命令失败/取消、权限撤回 | 两宿主真实运行兼容；没有设备仅报告 software |
| M3 | 构建/安装绑定后，原测试与回归复验 | 假平台适配器、制品篡改、安装未知结果、租约冲突、重启/容量注入 | Android/iOS 真机构建安装业务闭环及外部使用者 |

冻结安全语料至少 60 例：20 可修定位漂移、20 必须保留的产品缺陷、20 歧义/环境/证据/权限反例；另有不少于 10 个隔离源码 Fixture bug（包含假修复和修改 oracle 的攻击）。门禁要求安全反例零越权、零断言放宽、零错误 device-verified；正例按可修范围报告成功/弃权/失败，不用总通过率包装。真实采用记录至少 10 条业务流程、两次构建变化、双端与至少 3 名非作者，分别报告误修、人工修改量和端到端耗时；少样本不宣称泛化准确率。

### D13. 方案依据与取舍

延续本任务 2026-10-03 的官方资料调研；这些是参考能力，不是本项目已接入或对竞品做过性能实测：

- [Playwright Healer](https://playwright.dev/docs/test-agents)：借鉴失败回放、候选修改、重跑与停止条件；不采纳“认为功能损坏即可跳过测试”作为验收通过。
- [mabl Auto-heal](https://help.mabl.com/hc/en-us/articles/19078583792404-How-auto-heal-works)：借鉴历史锚点、环境隔离和整体通过后才更新模型；不把元素匹配当业务正确。
- [Testim Auto Improve](https://docs.tricentis.com/testim/content/test-management/locators-auto-improve.htm)：借鉴可审查修订，首版不自动改主分支测试库。
- [Healenium-Appium](https://github.com/healenium/healenium-appium)：保留为开源对照，不引入代理和数据库作为首期依赖。
- [Maestro retry](https://docs.maestro.dev/reference/commands-available/retry)：借鉴有界重试；重试不等于修复，不能掩盖不稳定。
- [Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)：借鉴隔离修改、运行检查、审查代码的分工；移动构建与设备验证需独立补齐。

## Risks / Trade-offs

- [文字/角色相似但语义不同] → 限定导航、唯一目标、页面/App 校验、原后置断言与人工审批；覆盖率让位于误修控制。
- [补丁只针对测试作弊] → 冻结外部 oracle、拒绝保护路径修改、独立验证工作区与人工 review；不承诺数学意义正确。
- [真实故障不稳定] → 对照失败未复现即 inconclusive；两次通过不作为稳定性统计。
- [宿主取消不及时] → 丢弃过期 generation，验证端不接受迟到补丁；设备执行由本地 coordinator 独立封锁。
- [移动平台无法证明已安装包摘要] → 要求可信回执或 App build marker；否则只保留较低验证等级，不能用版本名替代。
- [源码/构建命令有副作用] → 可信仓库、允许名单与能力明确的隔离 runner；权限不满足就阻塞，不暗中放宽。
- [先完整实现会拖长反馈周期] → M1 独立可用；M2/M3 显式能力开关，不给前阶段增加假成功路径。

## Migration Plan

1. 保持旧 repair/triage/recovery 入口不变；先加入新 case schema、存储、只读面板和确定性 Fixture，不批量改写旧证据。
2. M1 默认关闭，按项目启用与人工批准；新增 v3 repair 引用必须让旧读者保守保护。关闭开关只停止新任务，历史仍可读与审计。
3. M2 使用同一协议接入两种宿主，先跑同一契约语料；权限集合不能从旧 agentTestControl 自动升级。
4. M3 在登记的测试设备上逐平台开放；每个平台验收独立记录，不以 Android 通过代替 iOS。
5. 回滚时先停止准入并真实排空，保留 case/引用/未知动作围栏；不自动撤销已安装包。不能理解新格式的版本只读或拒读，不删除字段绕过。
6. 改动前后均运行仓库要求的 check、E2E、build、pack 与严格 OpenSpec；Viewer 留截图。真机/独立验收未完成时 tasks 保持未勾选，不能归档整个变更。

## Open Questions

架构与安全默认值已确定。可在对应阶段准备时补齐、且不改变契约的信息：首个授权业务仓库及其登记值、测试设备与签名制品、外部评估人员与冻结材料。缺少时仅执行离线任务，对应接入/真实验收标 blocked；不因此自动扩大权限。首版不依赖尚未确认的宿主后台 Agent API。
