## Why

截至 2026-10-06，远端 `dev@REDACTED_REVISION` 已具备独立运行分析、首失败定位、证据联动、历史趋势与审查后派生导出，但查找、扫读、比较和交接仍要求用户理解内部状态、文件名及遮蔽坐标。需要把这些能力组织为可直接回答“结果如何、哪里失败、与上次相比怎样、如何交给别人”的本机报告中心。

## What Changes

- 报告入口继续使用“运行记录”，增加结构化筛选、清晰结果行、结果统计、稳定分页和返回位置恢复；趋势复用已有统计口径，并明确样本与分母。
- 分析页优先呈现结果、失败位置、预期/实际和证据；支持上/下一个失败、步骤内检索、截图缩放和同屏上下文。详细验证范围可展开，但缺证据、派生未重验证和必需门禁失败不得隐藏。
- 对齐当前 runtime v2 结果契约，展示时间断言、健康/性能门禁的已声明结果及未支持原因，不把缺字段解释为通过。
- 将比较、历史、分诊和子运行复验接成有上下文的操作；可比性由现有领域规则决定，用户明确选基线。
- 截图脱敏改为画框、拖动、缩放和键盘编辑，数字坐标保留为精确编辑方式；沿用真实像素转换和有时效的人工预览确认。
- 增加无需安装 FlowAssert、无需服务或网络的单文件只读 HTML 报告。报告只消费审查后的派生材料，独立于用于机器导入的 JSON 归档；默认不含录像、源码、完整日志或私有标识。
- 按 P0 阅读与定位、P1 比较与导出、P2 历史趋势和用户验收分阶段交付。每阶段都有软件门禁；真机材料与独立参与者指标单列。

## Capabilities

### New Capabilities

- `workbench-report-catalog`: 有界的报告筛选、结果统计、可扫读目录、历史导航和趋势呈现。
- `workbench-offline-report`: 交互式遮蔽、绑定审查的离线 HTML 报告、内容预算、无网络阅读与派生来源说明。

### Modified Capabilities

- `workbench-run-analysis`: 在现有结果语义和导航契约上加强信息层级、失败间导航、历史关联、runtime 范围说明和可访问性。

## Impact

- 规划基于上述远端提交；当前主目录仍在 `REDACTED_REVISION`。本提案新增到主目录供审阅；实施必须从包含基线的干净 dev/worktree 开始，不在旧代码上直接套用。`workbench-run-analysis` 主规范已存在于基线，旧主目录暂缺不代表新能力。
- Viewer 重点为 `journey.js`、`journey-analysis.js`、`workbench-results.js`、`workbench-share.js`、`workbench-comparisons.js`、`workbench-trends.js` 及样式；按目录、分析、遮蔽和报告渲染拆职责。
- Core 复用 WorkbenchApplication、结果投影、authoring history、comparison、share jobs、引用账本与存储预算；增量增加摘要读模型和仅接收派生数据的 HTML 渲染器，不新增执行引擎或设备连接。
- 新查询采用独立版本化 HTTP 契约；旧 `/api/runs`、历史查询、run 深链、原始记录和 JSON 归档继续兼容。当前 runtime 分享可能输出 v4，不能把分享格式固定为 v2。
- 支持本机 macOS Viewer 读取 Android/iOS/Mock/导入记录；报告读取不要求连接设备。桌面与 390px 窄屏、中文与英文、键盘及 200% 缩放均纳入验收。
- 默认 loopback；无自动上传、远程托管、账号/权限系统、外部模型分析或 Agent 权限扩张。DSH 固定兼容验证 `0.1.5-rc.2`，适配器保持薄层，MCP/DSH 只传状态与引用。
- 复用 `improve-workbench-authoring-and-analysis`、`add-workbench-long-term-operations`、失败分诊及 runtime gates 的已实现契约；不替它们勾选未完成验收。本轮只交付方案，不修改运行代码。
