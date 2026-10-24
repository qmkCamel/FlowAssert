## Why

现有工作台已能提出定位器修复候选、保留失败证据并关联复跑，但从“发现问题”到“测试维护或业务源码修复，再独立验证”的过程仍靠人工串联。需要在不放宽原验收标准、不增加设备 owner 的前提下，建立宿主无关、可取消、可审查的修复闭环。

## What Changes

- 新增持久化修复对象，记录原失败、核查方向、冻结验证计划、权限、补丁尝试、审批、软件检查、设备复验及最终结论。
- 分开两条路径：测试维护只允许已证明等价的简单导航定位器替换；业务缺陷由宿主编码 Agent 在隔离工作区修改源码，原测试与业务期望受保护。
- 增加 M1 执行证据前置：保持普通 `tap.id/accessibilityId` 语法，为明确登记的顶层导航步骤提供本地结构化目标解析、派发事实及编译期源步骤身份；不把 Worker 错误文本升级为事实，不改写历史运行。
- 引入独立验证器：不以 Agent 的“已通过”描述、重试成功或外部报告自述作为修复成功证明；区分软件验证、设备验证和待人工验收。
- 为 Codex/MCP 与 DeepSeek Harness/Cordis 提供同一交接协议，宿主负责提案与编码，工作台负责权限、证据与执行门禁；不修改 Harness agent loop。
- 新增显式登记的构建／安装适配边界，绑定源码、补丁、构建产物和设备安装身份，Android/iOS 分别验证；MVP 仅单设备串行，不启动第二套 Appium。
- 分三个里程碑实施：M1 受审定位器修复与复验；M2 宿主源码补丁及软件验证；M3 受控构建安装与设备复验。后续阶段不得反向扩大前一阶段权限。
- 默认只生成建议；一次精确审批可覆盖已展示的有限执行计划。首版不启用无人审批的策略自动放行，不自动提交、推送、创建 PR、合并、改基线或发布。
- 真机发现的安全修复：页面范围改为 v2 唯一锚点及明确祖先容器，旧 App 根登记只读兼容、不授权点击；修正旧 recovery 首次点击的页面检查缺失，以及自有 Appium 的 WDA/MJPEG 全网卡转发。

## Capabilities

### New Capabilities

- `workbench-repair-workflow`：修复对象、分类准入、定位器路径、持久状态机、审批、预算、取消、引用与 UI 交互。
- `workbench-repair-verification`：冻结验证契约、补丁边界检查、前后对照、独立结果判定、跨出口与验收记录衔接。
- `host-code-repair-handoff`：可信源码登记、宿主无关交接、隔离修改、能力协商、有限命令与软件验证。
- `mobile-build-revalidation`：本机构建、制品登记、显式安装、单 owner 设备复验、异常恢复与双端验收。

### Modified Capabilities

现有 `workbench-reviewed-repair`、`workbench-investigation-plans`、`bounded-ai-recovery` 位于活跃变更中，本方案组合其能力：原确认仍生成新草稿／运行，只读核查不执行动作，运行时 AI 恢复仍判 `recovered` 而不是普通通过。安全修复使 recovery 的原定位器与 fallback 同样遵守现有 page 授权及派发前重检；不扩大任何权限。新修复对象使用独立 opt-in 入口，不改变既有 20 工具的默认清单和旧运行 verdict。

## Impact

- 核对基线：`dev@REDACTED_REVISION`，六项迭代及 Worker／引用治理已合入；基础层实施状态见 [implementation.md](implementation.md)，自动执行闭环尚未接入。
- 复用 `WorkbenchApplication`、`WorkbenchRepair`、`WorkbenchInvestigation`、`TestRunCoordinator`、`WorkbenchService`、引用 ledger、容量准入及变更验收对象；新增模块保持单体内分层，不引入数据库、代理服务或通用 Agent 平台。
- 新增 Viewer/CLI 受控写入口与 MCP/DSH 权限交集；Agent 不能自授审批、任意路径访问、任意命令或设备安装权限。工具和 HTTP 名称以 design.md 的拟议契约为准。
- 运行宿主首批为 macOS；验证对象为 Android/iOS 原生 App。模拟器、Mock 与真机证据分别标记。Android APK 与 iOS 已签名开发制品为首批安装对象，分发商店与自动签名不在范围。
- 用户可见长任务遵循全局 user-action-contract：局部进度、可取消、其他控件可用、失败保留结果，必须有运行中交互测试。
- 验收分软件安全契约、真实设备闭环及独立非作者评估；旧路线图未完成的真实验收不因本方案建立而勾选。
