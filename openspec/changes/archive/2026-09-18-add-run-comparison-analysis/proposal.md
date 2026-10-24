## Why

工作台已经保留双端运行、断言、截图、XML、阶段耗时与独立业务结果，但定位一次回归仍需要人工打开多份材料。直接把 screenshots、logs、manifests 和 hierarchy 一股脑交给 Codex、Claude 或 GPT，会让每个 Agent 重复理解文件格式、对齐 case/step/attempt、过滤动态噪声和寻找最早分歧；token、工具调用和结论口径都会随 Agent 改变。

本 change 的目标不是内置一个通用 AI Analyzer，而是把 FlowAssert 的领域语义沉淀成可复核的确定性比较与 Diagnostic Context。任意上层 Agent 再基于这个上下文推理“为什么”，并可按 evidence refs 回钻原件。

## What Changes

- 新增只读运行分析服务：选择基线、检查可比性、对齐步骤、比较截图/结构/断言/业务结果/耗时。
- 新运行记录结构化诊断和比较身份；不为旧格式增加迁移、猜测字段或兼容解析，历史原件保留。
- 经 `Raw Runs → Run Alignment → Diff Engine → Evidence Reduction → Diagnostic Context` 生成面向 Viewer、MCP 和任意 Agent 的紧凑诊断上下文；保留可授权回钻的 evidence refs。
- Viewer 增加比较入口、首次可确认分歧、并排证据、失败分类、Diagnostic Context 预览及可保存的本机报告。
- 错误按业务断言、UI 断言、设备/驱动、模型、证据和清理分别描述，未知原因保留 unknown。分析不修改运行 verdict，不触发设备或模型操作。
- Android/iOS 共用分析核心；首期只在同平台内建立可比基线，跨平台仅并排查看。

## Capabilities

### New Capabilities
- `run-comparison-analysis`: 运行身份、基线选择、确定性比较、证据降噪、Diagnostic Context、证据关联、失败归类、分析任务和 Viewer/MCP 友好报告。

### Modified Capabilities
无。新能力通过独立入口组合已有历史查看；不改变原有执行和判定契约。

## Impact

涉及 Workbench 的运行记录、计划执行事件、存储、Viewer API/UI、MCP 可读诊断契约与新增分析 worker。复用既有 PNG/XML 与 sharp，不增加 Runner 或手机会话，不修改 Harness agent loop。首期交付确定性 comparison、规则分类、evidence bundle/Diagnostic Context 及 MCP-friendly 输出；AI reasoning 由调用它的任意 Agent 完成。

首期不增加内置 AI Analyzer、AI 自动归因、AI verdict、自动修复、云端上传、视觉通过门禁或 Allure 导出。未来 Viewer 的 AI 解读可作为便利功能，但只能消费同一 Diagnostic Context，不参与事实判定或原运行 verdict，也不是本能力的核心护城河。仅本机授权读取已归档材料，禁止任意文件路径及跨源请求。
