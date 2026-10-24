# ViewInspectKit 与 FlowAssert：比较与借鉴方案

> 当前状态入口：[能力总表](../capabilities.md)。本文保留原日期的调研/验收快照；截至 2026-09-16，Inspector 十工具与打包宿主已验收 39/39，历史工具数和阶段失败记录不代表当前状态。

整理日期：2026-09-14。ViewInspectKit 证据来自本机源码快照 `20bf1271c8f9706c135970e3cdfb1bdc825c473f` 的 `README.md`（Basic MCP、多设备运行契约）及 CLI/GUI 目录；不据此声明其已公开发布或允许复制源码。本文只保存行为比较，不纳入原项目代码、内部仓库地址或资源。

FlowAssert 对照基线为 `REDACTED_REVISION` 已实现工作台，以及当时尚未实现、现已归档的 [Inspector proposal](../../openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/proposal.md)。

## 适用边界与优劣

| 维度 | ViewInspectKit 快照 | FlowAssert 当前实现 | 取舍 |
| --- | --- | --- | --- |
| 数据来源 | 接入 App 内 runtime；iOS Peertalk、Android/HarmonyOS 对应端侧监听与 host 转发 | Appium accessibility 源树和截图，UiAutomator2 / XCUITest | 前者适合已接入 App 的内部检查；后者可测试现有第三方 App，但不能给出任意私有视图属性 |
| 检查交互 | CLI 的 hierarchy/find/search/element/attributes，加 macOS Lookin GUI 相关实现 | 已有 bounded inspect、截图和节点动作；Viewer 尚无节点树 Inspector | 借鉴树—截图—详情联动，但先明确可读取字段，不承诺颜色/字号/约束 |
| Agent 查询 | 提供按需查询、详情入口 | 当前默认返回有界整树；计划增加指定 observation 的 find/get/subtree 和 summary | 本地 observation 内查询可减少重复输出，数据也可能过期；必须显式重新 observe 才获得新画面 |
| 多目标与所有权 | host daemon 维护 client 默认 target；跨 target 并行，同 target 有序；读共享、写租约；Capture Window 有独立 hold | 一个 runtime 的会话所有权、短期 observation、工作台运行租约；未提供跨进程共享 daemon | 借鉴身份/租约边界；目前不扩张成多设备守护进程 |
| 失效保护 | OID 内部绑定 targetId、targetGeneration、rawOid；重连拒绝 stale_oid，错目标拒绝 target_mismatch | observation/node 与 session、revision/epoch、TTL 绑定；不确定动作封锁后续控制 | 都需要对象身份与生命周期绑定；读有效不等于仍可执行动作 |
| 媒体与捕获 | 完整 CLI 包含录屏/Capture Window；Basic MCP 明确不暴露这些完整能力 | scrcpy / WDA MJPEG 本机媒体；工作台逐步 PNG/XML 留证，无录像 | 不把其 CLI 的全部能力算作 MCP 能力；录屏要另设计媒体订阅和证据关联 |
| 测试闭环 | 检查/控制/捕获能力可供工作流使用；本次未验证它具备等价 YAML/最终判定/历史闭环 | AppClaw 原生 YAML + MirrorService + EvidenceStore，双端第三方 App样本已验证 | 不以“能检查或点击”代替“能重复判定测试并保存完整证据” |

这些是按本项目四项诉求作出的工程取舍，不是完整产品排行榜，也不包含 ViewInspectKit 的本次真机性能测试。

## 已落实到设计的借鉴

1. **按需查询**：`mobile_mirror_query_screen` 在指定仍保留的 Agent observation 上查询；AND 条件、稳定分页、明确截断、有限响应预算。不能读 provider、续 TTL、生成截图或恢复旧动作权限。
2. **冻结检查视图**：用户显式捕获图片与树后，用同一份检查材料高亮节点、搜索、查看属性/父子/几何；避免将旧节点框叠到持续变化的视频上。
3. **分离身份与授权**：Viewer inspection 独立于 Agent observation store，不消耗或逐出 Agent 配额，不更新 Agent revision，不产生 attachment，不扩大 Agent 分享授权。
4. **明确数据能力**：首期只使用规范化 accessibility 字段。未知属性显示为未知，几何包含不等于真实 hit-test，矩形间距不宣称 CSS padding。
5. **生命周期可见**：检查捕获有进度、取消、错误与失效状态，慢操作时仍可操作其他控件；停止/切换 session 后不能继续使用旧身份。

完整设计与验收归档：[design](../../openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/design.md)、[tasks](../../openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/tasks.md)、[observation-query spec](../../openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/specs/observation-query/spec.md)、[viewer-node-inspector spec](../../openspec/changes/archive/2026-09-18-add-observation-query-and-viewer-inspector/specs/viewer-node-inspector/spec.md)。此处“0/39、九工具”是调研当时的历史状态，不代表当前实现。

## 为什么先做这部分

相比接入另一套端侧 SDK，这个方案直接复用已有 Appium、结构规范化、坐标、脱敏与会话边界；第三方 App 也能在其公开的无障碍结构范围内使用。代价是无法取得真正白盒属性，也不会自动补全 App 未暴露的元素。

相比实时刷新整棵树，冻结 observation 更容易保证查询、截图和身份的可解释性，但用户需要主动重新捕获。相比完整多目标 daemon，runtime 内租约较简单，但不能阻止另一独立进程控制同一设备；该问题列入 [TODO](../../PRODUCT_TODO.md)，不假装已经解决。
