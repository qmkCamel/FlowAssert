## Why

dev@REDACTED_REVISION 已有确定性编排、独立业务验证、有限恢复、比较和 Agent 运行入口，但外部团队独立安装、无人值守执行与真实项目稳定性尚缺完整证据。第一阶段将现有能力收口为可独立采用的候选版本，并先稳定后续阶段共享的数据契约。

## What Changes

- C0：冻结运行来源、验证分项、证据引用及后台任务的兼容契约；旧记录不补造事实，现有通过/恢复/重试语义不放宽。
- A1：记录带来源的 App/构建、执行环境和测试数据身份，区分可比、不同和未知。
- A2：提供显式 attach 与 managed-job 两种 CLI 生命周期，复用本机 runtime/设备 claim/协调器，输出真实 JSON/JUnit 与退出码。
- A3：建立故障注入、真机兼容与固定环境性能验收集；不以新设备通过替代旧设备故障解决。
- A4：干净安装、升级回退、真实自研项目试点及按版本发布证据；发布需要独立授权。
- 第二、三阶段可在 C0 后按工作包并行，不要求等待第一阶段全部试点结束。详见总览 docs/roadmaps/workbench-productization.md。

## Capabilities

### New Capabilities

- `workbench-product-contracts`: 版本化运行/验证/证据/任务契约及兼容规则。
- `workbench-run-provenance`: 有来源、脱敏的环境与构建记录。
- `workbench-managed-job`: 明确所有权的无人值守启动、执行、取消、报告与退出。
- `workbench-adoption-readiness`: 可复现安装、故障矩阵、支持声明和真实项目采用门槛。

### Modified Capabilities

无替换既有要求；新增 managed-job 包裹现有运行，设备会话规则仍由现有工作台保证，外层仅在 job 退出时清理自有资源。共享结果契约增加分项容器，但本阶段不启用视觉判定。

## Impact

影响 workbench-store/project/comparison/cli、local-device-runtime、设备所有权、Viewer 详情及打包/验收文档。首期 macOS 主机上的 Android/iPhone 已验设备，Mock 可离线演示；不宣称 Windows/Linux 真机通过。DSH 保持已验 0.1.5-rc.2 Native/PTC，AppClaw 保持固定 2.7.0，不升级依赖或修改 agent loop。不自动安装 App、扩大网络监听、重放未知设备写操作或新增云服务。

本变更只新增方案；既有 active change 的图片模型消费、输入验收、恢复对照与发布事项保留原归属。外部试点、账号、签名和设备是实施验收的外部条件，缺失时不得标记达标。
