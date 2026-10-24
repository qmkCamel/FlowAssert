## Why

当前工作台已经提供结构化失败事件、跨次比较和 Diagnostic Context，但非用例作者仍需自行选择材料、理解原始错误并判断该找谁处理，无法稳定地在五分钟内区分产品行为异常、定位器变化、环境故障和证据不足。需要在现有事实层之上增加保守、可回钻的失败分诊流程，而不是再造比较引擎或让模型替测试下结论。

## What Changes

- 增加单次运行优先、历史比较可选的只读分诊：没有成功基线也能查看失败阶段、已确认事实、证据缺口及下一步检查。
- 输出四类处理方向（产品行为待核对、定位器变化待核对、环境/依赖故障、证据不足），允许多标签、unknown 和不适用；严格区分失败事实、原因假设与人工复核意见。
- 增加版本化 TriageReport、确定性规则、稳定证据引用、输入指纹和当前有效性检查；不修改 run verdict、既有 Diagnostic Context v1 或历史原件。
- Viewer 提供“失败摘要 → 分类依据与反证 → 首个可检查步骤 → 建议检查 → 证据详情”的渐进工作流；新只读 Agent 工具及 CLI 消费同一摘要，不默认发送图片或调用模型。
- 分析任务有界、可取消、可恢复查看；复用 store owner、引用/lease、现有任务状态和权限边界，不新建设备连接或共享 daemon。
- 建立确定性正反例语料与非作者盲测协议，分别验证误导风险、分类覆盖、五分钟定位成功率及相比现有 Viewer 的诊断耗时。
- 仅生成规划材料；实施分为契约/规则、交互/入口、故障与真实采用验收三段，所有新增任务保持未完成。

## Capabilities

### New Capabilities

- `workbench-failure-triage`: 单运行与可选比较的确定性分诊、四类处理方向、事实/假设/反证、证据有效性、有界派生任务与安全检查建议。
- `workbench-triage-experience`: 面向非作者的摘要和证据导航、局部异步交互、CLI/MCP/DSH 一致消费以及独立人工复核记录。
- `workbench-triage-evaluation`: 脱敏正反例语料、冻结评测、非作者对照盲测、真机与同包兼容门禁、可追溯验收报告。

### Modified Capabilities

无。复用 `run-comparison-analysis`、现有结果投影和证据生命周期的公共接口；不更改比较 v1 的要求、设备控制或执行判定。现有 `add-workbench-long-term-operations` 的 C4 五分钟分诊目标由本 change 提供专项测量材料，但其三团队四周采用门槛仍独立验收，不自动勾选或归档。

## Impact

- 基线：已提交 `dev@REDACTED_REVISION`；规划时工作区存在其他采用/生命周期改动，不将其视为已验收依赖，也不在本次覆盖。
- 拟新增纯规则/分诊服务、Viewer 分诊面板和薄 HTTP handler；复用 `workbench-comparison.ts`、`workbench-contracts.ts`、`workbench-evidence-contracts.ts`、store refs/leases、工具权限与本机任务设施。
- 新增显式的 HTTP/CLI 与单一只读 Agent 分诊入口；既有比较工具及其参数、返回值、工具权限保持不变。新增工具计数和打包清单必须通过兼容验收，不把旧版宿主测试视为新入口验收。
- 支持 macOS 上已有 Android/iPhone 归档和 Mock；只读分析不要求连接设备。真机验收限定登记的 App/设备/OS，DSH 固定 `0.1.5-rc.2`；不改 Harness agent loop。
- 默认 loopback、无模型/网络外发、不接受自由文件路径或任意诊断命令、不自动重跑/修复/清理/提交问题。持久化只增加派生报告和显式用户复核记录。
- 不引入必需外部服务或新模型依赖；不承诺通用视觉理解、自动根因、设备云或替代已有定位器修复功能。
