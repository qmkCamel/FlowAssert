> 2026-09-15 实施更新：源码与本地门禁完成 36/39；十工具、summary/query 和本机 Inspector 已实现。剩余同 tarball 宿主安装与双端真机验收分别受阻，见 docs/inspector-validation.md。下文保留原提案背景。

> 2026-09-14 整理：方案已完成，实现任务 0/39；当前仍为九工具。下文保留最初设计基线；新增工作台已占用 ADR 0006，因此 Inspector 边界记录改为拟议 ADR 0007。实施时需与工作台运行租约共同校验，不得绕过现有控制与捕获协调。

## Why

Agent 当前只能取得整份有界 UI 结构，再自行寻找目标；Viewer 也只能展示画面，无法把某个可见区域与 observation 内的节点、父子关系和几何边界对应起来。需要在现有 Appium 感知能力上增加按需查询和只读节点检查，同时避免查询产生新 revision、Viewer 抢占 Agent observation 或旧节点叠加到新视频帧。

## What Changes

- 新增 `mobile_mirror_query_screen`，在指定、仍保留的 Agent observation 内执行严格筛选、节点详情和子树查询；不调用 provider、不重新截图、不续期、不触发动作。
- 为 `mobile_mirror_inspect_screen` 增加默认兼容的 `structureMode=full|summary`。summary 只缩减宿主输出，完整的规范化结构仍保留在原 store，供后续查询，避免先发整棵树再声称节省上下文。
- Viewer 新增“检查界面”入口：显式获取一份仅供本机查看的图片与结构，展示冻结截图、节点树/搜索、选中高亮、属性和父子导航。画面点击只选择节点，首期不增加节点点击设备、文本输入或属性编辑。
- Viewer 检查捕获与 Agent observation 使用不同身份和发布路径；共享 provider 捕获协调与规范化，不进入 Agent store、不更新 Agent latest revision、不生成 attachment，也不占用或逐出 Agent 的四条 observation 配额。
- 查询和 Viewer 共用纯查询/几何规则；定义 AND 匹配、稳定分页、截断语义、未知属性、坐标映射及错误/取消/失效行为。
- 保留 Appium 为唯一控制与 session 所有权栈；保持 continuous media 在 loopback Viewer。本 change 不接入 ViewInspectKit SDK、白盒属性、第二套控制 provider、多设备 daemon 或录屏。

## Capabilities

### New Capabilities

- `observation-query`：指定 observation 内的只读、限界、可分页查询及读取有效期与动作有效期的区别。
- `viewer-node-inspector`：独立的本机检查捕获、冻结画面、节点选择、关系/几何检查及其状态与资源生命周期。

### Modified Capabilities

- `agent-screen-perception`：增加 summary 投影，明确 Viewer 检查不改变 Agent observation 身份、freshness 与资源限额。
- `local-mirror-viewer`：增加检查模式与既有连续媒体、缩放、语言、进度、安全路由的集成要求。
- `flowassert`：在现有九工具上兼容增加第十项查询工具，summary/query 不产生额外图片上下文。
- `host-neutral-mcp-adapter`：同步十工具契约及结构查询结果，保留既有图片、取消、所有权和宿主无关性。

## Impact

- 基线：本地 `REDACTED_REVISION`，Node `24.19.0`，DSH `0.1.2-rc.1` Native/PTC；本次产物是方案，不代表新增功能已经实现或通过真机验收。
- 平台：Mock、Android/UiAutomator2、iOS/XCUITest 使用同一规范化结构；不增加 HarmonyOS。无障碍结构缺失的视觉元素不承诺可检查，颜色、字号、约束和真实命中测试不属于首期。
- 核心涉及 `types.ts`、`observation-store.ts`、`mirror-service.ts`、共享 command/contract 和新的纯查询模块；Viewer 涉及 HTTP adapter、页面状态、布局、国际化和查询模块的浏览器构建入口。
- 边界：Agent 查询继续受 `agentScreenContentPolicy` 限制；本机 Inspector 由用户显式进入，仅同源获取、短期内存保存，不修改 Agent 的分享授权。敏感节点沿用规范化脱敏，错误和日志不得回显页面文本。
- 兼容：旧九工具及 `inspect_screen` 默认 full 结果保持兼容；工具总数、宿主探针、打包清单与当前文档需同步。精确的 wire contract、资源预算和验收矩阵见 `design.md`。
- 与 active changes 的关系：本设计承接 `add-semantic-agent-actions` 已实现的九工具，以及已有 zoom/localization/connection assistant；不代替它们尚未完成的真机任务。DSH/MCP delta 以该 active change 的九工具要求为前驱，规格同步时必须按前驱再本 change 的顺序合并；不能逆序覆盖为九工具。
- 计划随实现补充 proposed ADR-0007，记录 Agent observation 与本机 inspection 的数据/transport 隔离；本轮不改既有 Accepted ADR 或业务代码。
