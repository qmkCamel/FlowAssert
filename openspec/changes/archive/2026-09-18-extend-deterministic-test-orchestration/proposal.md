## Why

提案时工作台能执行并留证单条固定 UI 流程，但账号/数据变化需要复制 YAML，业务结果无法独立核对，多用例缺少统一调度和 CI 判定。此次按“流程复用与数据驱动 → 代码校验与环境清理 → 套件管理”补齐确定性回归能力；截至 2026-09-18，代码、声明的双端编排矩阵及 Fixture 业务验收已完成，详见 tasks 与验收报告。

## What Changes

- 直接扩展当前 YAML 的受限编排格式，支持类型化参数、数据行、注册子流程、有界条件和循环；不设 YAML 版本开关或旧格式兼容分支。
- 可信本机扩展注册，提供 prepare/verify/cleanup，保存代码依赖快照、独立业务判定与清理记录。
- 单设备串行套件、标签筛选、数据展开、显式安全重试、JSON/JUnit 报告及非零失败退出码。
- Viewer 展示编排步骤路径、阶段、用例/attempt 和原始失败，继续复用现有截图、源树与视频归档。
- Android/iOS 真机沿用 MirrorService/Appium；不新增设备 owner，不引入完整 Maestro/AppClaw Runner/Playwright 执行栈。AI、敏感 UI 输入、多设备并行、云设备农场不在本次范围。

## Capabilities

### New Capabilities
- `workbench-flow-composition`: 统一格式流程、参数/数据行、受限控制流与来源映射。
- `workbench-code-verification`: 注册扩展、生命周期、独立业务证据与清理语义。
- `workbench-test-suites`: 串行套件、attempt、报告及 CI 判定。

### Modified Capabilities
无已发布主规格变更。实施时必须同步仍活跃的 `add-local-test-workbench` 中 local-test-workbench 规格和 ADR 0006：其“禁止一切插值/仅原生 YAML”约束改为允许本方案受限编排；不能同时保留矛盾契约。

## Impact

涉及 workbench-flow/service/store/device、worker、Viewer、HTTP/CLI 入口及打包运行探针。新增编排器、扩展宿主和套件调度器，预计不新增大型测试框架依赖；扩展代码只允许本机登记的可信 JS/预编译 TS，子进程不宣称是安全沙箱。参考源、取舍、验收及缺口覆盖详见 design.md。
