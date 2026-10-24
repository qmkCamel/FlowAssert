## Why

插件友好架构已合入 dev@REDACTED_REVISION，但 comparison/share 仍依赖历史扫描保护证据，执行 Worker 缺少版本化消息校验，查询规模成本尚未测量。本轮收敛这些具体边界，并保留兼容与真机验收的诚实边界。

## What Changes

- 同步并归档已完成的插件友好架构规范，更新治理状态。
- 将新 comparison/share 记录迁入统一持久引用发布与退休协议；旧记录继续保守保护，故障允许额外保留而不得失去保护。
- 给原生执行 Worker 增加版本化消息、结构和时序校验；不引入第二引擎，不改变既有 YAML 和设备 owner。
- 增加可复跑的 100/1,000/10,000 记录查询基准，区分摘要、状态、完整性复验；根据结果记录优化决策。
- 保留录屏偶发失败线索并补确定性回归；复跑工程、宿主和可用真机验证，明确无设备时的剩余验收项。

## Capabilities

### New Capabilities
- `evidence-runtime-boundaries`: comparison/share 的持久引用生命周期、执行 Worker 协议与可复跑规模测量。

### Modified Capabilities
无。保持既有工具、结果语义和旧记录读取，新增边界作为独立能力规范。

## Impact

涉及 References、comparison/share、legacy snapshot、原生 Worker、测试与验收文档。不升级依赖，不改变 DSH agent loop，不新增动态插件加载。Android/iOS 支持范围不扩大；Mock/软件门禁不替代双端真机验证。运行中操作仍需局部反馈、保持无关控件交互和失败结果保留。
