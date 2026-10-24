# M0 实施审计与待确认设计调整

日期：2026-10-03。首次审计完成任务 1.1 并因 D5 受理边界暂停；随后用户确认 D5a 调整，后端已开始实现。下面第 1–6 节保留首次审计事实，最新实现与验证见 `backend-validation.md`，不以旧暂停记录表示当前阻塞。

## 1. 当前基线

- 本次重新执行 `git fetch origin dev`；工作树 HEAD 与 `origin/dev` 均为 `REDACTED_REVISION`。
- 实施工作树：独立的 `workbench-usability-plan` worktree，分支 `docs/workbench-usability-plan`，不在原 dev 工作区实施。
- 规划 change 为已有未跟踪文件；未覆盖原 dev 工作树、截图或其他 change。
- 候选复用分支：`feat/guided-mobile-acceptance@REDACTED_REVISION`。`git merge-base --is-ancestor REDACTED_REVISION origin/dev` 返回 1：未进入当前 dev。
- 不复用旧测试通过数字作为本次集成验收；未执行设备操作、未修改宿主配置。

## 2. 逐模块复用决策

| 模块/契约 | 核对结果 | 实施处理 |
| --- | --- | --- |
| `workbench-acceptance.ts` 的 `exportAcceptanceProject` / `projectTar` | 编译自包含 flow，固定相对路径 tar；不复制原项目命令 | 选择性适配，增加本轮输入预算与导出预览测试 |
| 同文件 `exportBusinessTemplate` | 额外复制预审查的业务夹具文件 | 本 change 不需要，不能顺带引入 |
| `viewer/workbench-acceptance.js` | 有表单、局部进度、generation 防迟到、替换确认；运行按钮仅聚焦旧运行控件 | 复用交互逻辑，不把它当作服务端 receipt 或持久幂等已实现 |
| 老分支 Inspector 交接 | 显式接收草稿，可作为接线参考 | 扩充 append/new/replace；保留 dev 捕获 TTL、歧义、敏感与跨 session 检查 |
| `workbench-investigation.ts` | 只读事实建议、证据 lease、兼容 child 校验；不声明根因 | 选择性适配；结合当前证据投影、取消与预算回归验证 |
| `viewer/workbench-investigation.js` | 可复用检查方向及 follow-up 呈现 | 接入独立分析页，不继续叠进旧长面板 |
| `workbench-readiness.ts`、selector-adapter 及 device/flow/plan/service 的 readiness 分支 | 新增 tapReady/fillReady 等 DSL，改变执行路径 | 延期；本 change 只使用现有 DSL，不整分支合并 |
| `WorkbenchApplication` / `WorkbenchService` | 当前 dev 已拥有共享组装、执行、关闭与证据边界 | 保留；新增服务经 composition root 组装，不替换 Worker 生命周期 |
| `test-run-control.ts` | 幂等受理嵌在 Agent 权限/注册目标/私有 journal 中 | **不可直接用于未注册的 Viewer 草稿；见下一节** |
| `workbench-reference-snapshot.ts` / builtin references | Agent journal 的格式、consumer kind 与 tombstone 已被清理兼容读取器识别 | 不能把 Viewer 草稿伪装为 Agent journal；新消费者必须使用已有引用 ledger，不新增扫描分支 |
| 老分支 package/probe/截图/已勾选 tasks | 对应另一候选与旧结果 | 不直接覆盖、不继承完成状态；本候选重新构建测试 |

## 3. D5 的阻塞点：复用机制不等于调用 Agent API

可定位的代码事实：

1. `src/test-run-control.ts` 的 `TestRunStartInput` 只允许 `target: { kind: 'flow' | 'suite', id }`、`catalogRevision` 等字段，没有 YAML、receipt、local-evidence consent 或 case revision。
2. `start()` 首先要求 Agent 功能开启；`#prepare()` 要求目标位于 `allowedFlows` / `allowedSuites` 且存在于注册项目，并校验 App/平台权限。动态注册用户草稿会改变已有授权边界。
3. `ExecutionJournal` 固定 `source: 'agent'`；`#requestKey()` 绑定 Agent project identity。`#dispatch()` 以 Agent source 和 flow 身份派发；journal、恢复、串行化方法均为私有方法。
4. `#initialize()` 将未结束 journal 标为 interrupted，不重放设备动作；`#save()` 同时管理 `workbench:agent` 引用与 tombstone。不能只复制 requestId Map 就声称满足重启幂等。
5. `src/viewer-workbench-runs-http.ts` 的旧 `POST /api/runs` 直接调用 `workbench.start()`，没有 requestId journal。保持这个旧 API 不变不会自动让新 authoring/run 获得持久去重。
6. `WorkbenchApplication` 尚不拥有通用 durable acceptance 服务。将整个 `TestRunCoordinator` 放进应用层又会反向依赖它已经引用的 `WorkbenchApplication`。

因此，原设计“复用既有受理”需要补充一个明确的抽取/兼容设计，再实施任务 2.6。此处不是放宽 receipt、取消 journal 或自动注册草稿的理由。

## 4. 建议调整（待用户确认，未实施）

推荐：抽取一个 host-neutral 的持久受理组件，由 `WorkbenchApplication` 管理其生命周期；它只管理请求身份、摘要、受理落盘、派发门、重启不重放和终态，不获得设备控制权。

- Agent 仍先执行既有 policy/catalog/注册目标授权，再调用共享机制；旧请求身份、journal 读取、工具 schema 和结果投影保持兼容。
- Viewer authoring 先查询同命名空间 requestId/digest 的已受理记录；仅新请求校验 receipt、目标、项目和留证确认，再使用同一受理机制。
- 显式区分 Agent 与 Viewer 的请求命名空间、来源与授权上下文；不互相授权或通过对方入口枚举记录。
- 老 Agent journal 保留兼容适配；Viewer 新格式的 schema/version/path/budget 和旧程序行为需写入 D5、ADR 与测试，不把新数据写进旧格式冒充 Agent。
- 真实设备执行仍唯一调用 `WorkbenchService` / `MirrorService`。受理组件不是第二执行器、调度器或设备 owner。
- 沿用 mutation gate、容量准入及已有引用 ledger；受理身份与媒体生命周期分离。禁止重启自动派发已受理但结果不明的动作。
- 先完成该组件及兼容探针，再推进向导运行接线；取消、关闭、保存失败必须保持 executeGate fail-closed。

需要新增/细化的任务：共享受理抽取、Agent 零行为变化适配、authoring namespace/schema、旧 journal 兼容和独立进程中断矩阵。它们不能作为任务 2.6 中未经说明的“直接复用”。

备选为 Viewer 独立 journal，但会产生第二套恢复/引用/取消维护面，不推荐。仅内存去重不满足 spec，不作为备选。

## 5. 验收条件与原任务覆盖关系

调整后至少验证：同请求响应丢失后复查；不同 digest 冲突；receipt 过期/重启后旧受理仍可查询；新请求重验；受理前、临时文件同步后、rename 后、引用发布后、开派发门前、完成写入前的故障；所有恢复零重复设备写入；跨入口权限隔离；关闭期间不新开设备动作；Agent 旧格式/旧工具 golden 不变。

相邻活动 change 保持原状态：

- `add-workbench-authoring-and-visual-validation`：2.1–2.5 Inspector 和 3.1–3.4 修复是本次复用基础；本轮 2.3/2.4/3.5 需新增集成证据，不重勾旧项。2.6、3.5 等真机条目仍待验。
- `add-evidence-guided-failure-triage`：本轮 3.2–3.8 使用已有结果与分诊能力；旧 4.x 的交互验收有覆盖关系，但不能用新页面存在代替旧语料、独立用户与真机验收。
- `add-agent-test-run-control`：兼容目标，不扩展 Agent 对任意 YAML 的权限。
- 其余当前活动 changes：`harden-workbench-adoption`、`add-workbench-text-input-acceptance`、`add-workbench-long-term-operations`、`add-semantic-agent-actions`、`add-bounded-ai-recovery`。本轮不改变其勾选状态或验收范围。

任务 1.2 golden 冻结、1.3 视觉方案审查、1.4 完整 requirement→模块→测试映射均尚未完成；本记录不替代它们。任务 6.1 真机和 6.2 非作者研究继续暂缓。

## 6. 本次实际验证

- 已核对本地/远端 SHA、祖先关系、活动 changes、关键调用与引用边界。
- 仅新增本审计记录并勾选已完成的 1.1；未修改运行代码。
- 四项软件门禁、候选包、浏览器长动作与截图验证尚未运行，不宣称产品实现完成。
- 未 commit、push、merge 或归档。
