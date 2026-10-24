# 共享受理与校验后端阶段记录

基线：`origin/dev@REDACTED_REVISION`。本记录只覆盖后端基础，不代表整个 change 完成。

这是共享受理阶段的历史记录。后续向导/用例库/分析和新候选包的验收见 [implementation-validation.md](implementation-validation.md)，不得将本页旧 tarball hash 当作新 UI 的同包证明。

## 当前实现

- `WorkbenchAcceptance`：应用拥有、固定 namespace、串行 identity/digest 查询、原子/fsync journal、容量准入、symlink/预算校验、落盘结果不明的重复派发隔离、重启不重放及关闭协调。
- Agent adapter：保持原注册目标和授权、v1 journal、requestKey、公开工具及引用/tombstone；通过共享组件持久化和恢复。
- `WorkbenchAuthoring`：原文/参数/项目/compiler/target 绑定的 10 分钟凭据，新请求明确留证确认、原受理优先查询、会话变更拒绝与执行前目标重验。
- Viewer 后端：新增 validate/run/status/cancel；同源、JSON 类型和 80 KiB 限制。旧运行及旧草稿校验端点不变。
- 新 journal 不持久化 YAML、参数或 receipt token；使用已有 ledger 的 `workbench:authoring` 引用，不增加设备 owner。
- ADR：`docs/decisions/0015-shared-durable-authoring-acceptance.md`。

## 验证进度

- Agent/组装/引用第一轮回归：36 项通过。
- authoring 专项：15 项通过，含 5 个真实子进程 SIGKILL 切点、恢复零重复 Mock 设备写入，以及刚落盘即关闭的零派发竞态。
- 首次 `pnpm check`：708 通过，1 失败；发布检查发现审计文档含本机绝对目录，已改为不含个人目录的工作树描述。修正后完整重跑 81 文件、709 项通过。
- 补充关闭竞态测试后，全集一轮出现 5 个既有 Worker 启动/取消/比较测试的等待超时（705 通过）；涉及 comparison、managed-job、orchestration、workbench 四个测试文件。新受理测试仍通过；这四个文件以 `--maxWorkers=1` 单独复跑 70/70 通过。未修改生产逻辑或放宽断言；超时根因尚未确认，不能据此断言只是环境波动。
- 最终 `pnpm check` 全集重跑：**81 文件、710/710 通过**（44.29 秒）。保留上述失败历史，不以最终通过抹去间歇性时序风险。
- `pnpm test:e2e --workers=1`：57/57 通过（2.6 分钟）；覆盖旧 UI 慢捕获/文本输入/比较/录像/准备期间无关控件可用、失败保留与取消。不是尚未实现的新向导长动作验收。
- `pnpm build`、`pnpm pack:check`：通过。基于此构建的同一个候选包 SHA256：`704defa9e10249c7ee0ae15955cfcbbaa3a28b4d73ff76d2781174763dda8a54`。
- 同包 application probe：Mock 执行、来源 hash 不变、comparison 排空、store 重开、child/pin 引用均通过。
- 同包 MCP probe：17 工具、catalog/flow/suite/cancel/evidence/triage、打包 YAML、图像边界、Viewer 本地化与信号清理通过；同一探针还验证打包 CLI 的 `test triage get` 和 `test triage start --wait` 成功且退出码为 0，不代表所有 CLI 命令或错误退出码均已验证。
- 同包 DSH **0.1.5-rc.2** clean profile：Native/PTC、Agent 测试、图像投影及完整生命周期通过；未改 agent loop。
- 旧版本兼容：另建干净 detached `REDACTED_REVISION` checkout 并按原锁文件构建；candidate/previous probe 证明新 `workbench:authoring` 保护性 orphan fixture 在旧读器仍受保护、journal/manifest hash 不变、当前版本重开不重放。
- 兼容探针首次失败的原因：把“终态取消”错误等同于“必须继续保护媒体”；已冻结且证据通过的取消结果可以依法释放引用。修正为明确的“引用已发布、journal 未提交”保护性 orphan fixture，未修改生产逻辑来迎合探针。
- OpenSpec strict 和 diff whitespace 检查通过。

### 安装边界（未消除的上游问题）

独立 `npm install --ignore-scripts` 候选包失败：npm 为 dsh-tools rc.2 的 prerelease peer 自动选择 dsh-agent rc.3，后者要求 dsh-llm rc.3，与包固定的 rc.2 冲突。本轮没有改发布依赖，也没有用 force/legacy-peer-deps 冒充默认安装成功。

application/MCP/旧版本探针使用**候选 tarball 解包内容 + 干净旧基线 pnpm 锁定依赖**，没有运行源码来冒充打包产物；DSH probe 则通过真实 rc.2 clean profile 安装该候选包。故这些结果证明锁定环境/目标宿主兼容，不证明任意 npm 最新解析安装成功。

### 界面回归证据

本轮重新生成并目检旧 Viewer 桌面 `artifacts/screenshots/mobile-mirror-workbench-evidence.png` 和窄屏 `artifacts/screenshots/mobile-mirror-inspector-narrow.png`，桌面旧结果面板与设备区域可读，窄屏控件顺序保持；这仍是旧侧栏布局，不是新分析页交付。其他 E2E 重生成截图留在隔离工作树，原用户 dev 工作区未修改。

## 未交付项

UI 视觉布局确认、页面导航、向导接线、Inspector 交接、步骤卡、独立分析页、本机版本化用例库，以及新 UI 慢操作/无障碍/截图验收仍未完成。正式 UI 实现前的布局确认已向用户提出，不能用后端通过替代。

Android/iPhone 真机、非作者用户研究继续暂缓。未提交、推送或合并；旧活动 change 的未验任务保持不变。

当前清单 8/38 完成，仅完成复用/契约/映射和共享受理、校验、后端运行等基础项。1.3 视觉方案确认未完成；导航、向导、分析、库及完整软件阶段退出项保持未勾选，不归档。
