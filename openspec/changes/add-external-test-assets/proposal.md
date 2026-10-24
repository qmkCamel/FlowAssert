## Why

已有 Appium、Maestro 或其他框架资产的团队，不应为了查看同一份变更验收摘要而重写全部用例。先接入外部结果和明确选取的附件，同时保留来源与验证缺口，比直接接管每个框架的设备会话更符合当前架构和安全边界。

本变更对应路线图第五项，依赖 `add-change-acceptance-records`（工程提交 `REDACTED_REVISION`）。状态（2026-10-03）：工程实现及门禁完成，任务 21/24；真实 Maestro／Appium runner 报告兼容与外部使用方接入尚未验收。工程提交 `REDACTED_REVISION`，证据见 [验证记录](../../../artifacts/external-assets/validation.md)，整体状态见[六项总览](../add-change-acceptance-records/roadmap.md)。已实施逐资产显式授权给当前项目，默认仅 Viewer/CLI 本机可见；报告接入不是外部执行器。正文使用中文，英文仅用于 OpenSpec 结构标记、协议字段及产品名。

## What Changes

- 新增版本化外部结果封装协议，首个实际适配器解析受限 JUnit XML；保留执行器名称、版本、报告摘要、测试身份、原始状态、可选来源及附件关联。
- 提供无设备权限的解析适配器接口，初始实现通用 JUnit 与原生封装格式，并加入 Maestro JUnit、Appium 客户端报告的固定样本。来源名称由输入显式声明，不凭文件名猜测。
- 外部结果单独存储、展示和引用：`reported-pass` 不等于本机独立验证通过，缺少业务、清理、视觉、逐步证据时明确为未提供。
- 本机文件选择／CLI 显式导入、预览与确认、幂等发布、取消及安全附件下载；第三方报告中的路径和 URL 不触发文件读取、网络请求、执行或脚本渲染。
- 接入第四项验收覆盖表，但未经本工作台重新执行验证的外部材料不能单独满足严格通过门禁。
- Agent 读取需要每份资产单独授权，授权绑定当前登记项目身份及内容版本，可撤销；导入、关联验收及知道资产 ID 均不自动授权。

## Capabilities

### New Capabilities

- `external-test-assets`：外部报告适配、不可变导入记录、原始结论与本地核查分离、附件安全和验收对象关联。

### Modified Capabilities

无。外部资产是新领域类型，不伪造成 `TestRun`，也不改变既有分享包导入协议。

## Impact

- 新增独立导入服务、解析 worker、来源契约、Viewer 页面区块和 CLI 入口；经 `WorkbenchApplication` 组装，DSH/MCP 只读取有界摘要，不接收连续视频。
- 首期在 macOS 本地工作台验证；支持的是声明的报告格式，不声称完整支持某框架的全部命令、设备或插件。XML 使用已有解析依赖，执行器保持现有版本。
- 不启动 Maestro、Appium 客户端脚本或外部 shell，不安装框架，不交接设备控制权。已有 ADR 0006 的 Maestro 执行 adapter 暂缓决策不变；后续选择实际执行 adapter 需要试点资产与独立方案，不能将本次报告 adapter 称为执行 adapter。
- 实施顺序：第四项完成工程门禁 → 本项 → `add-local-ocr-and-device-matrix`。提供真实报告接入的独立验收任务，不能以模拟 XML 冒充真实框架验收。
