## Why
用户已授权实现本机移动测试工作台的最小完整闭环。现有真机预览和独立 YAML PoC 尚未共用会话，也缺少持久化运行历史与证据验收。

## What Changes
- 在已有 Viewer 增加 YAML 编辑、运行、取消、步骤证据和持久化历史。
- 固定 AppClaw 2.7.0 原生解析和执行器，仅启用结构化无模型子集；通过 MirrorService 受控适配器复用 Android/iOS 会话和媒体。
- 增加独占运行租约、隔离 worker、取消后排空控制、证据原子提交及 hash 校验。
- 验收范围为明确的 UI 断言、声明的遮挡条件及证据完整性，不将截图留存等同于自动视觉或业务持久化验收。

## Capabilities
### New Capabilities
- `local-test-workbench`: 本地固定流程、共享会话、证据及运行历史。
### Modified Capabilities
无。

## Impact
MirrorService、ViewerServer、LocalDeviceRuntime、Viewer UI、新增工作台模块与 AppClaw 固定依赖。只监听既有 loopback 服务，不修改 DSH agent loop；已有 Agent 内容政策不变，用户点击运行显式授权本地取证和 YAML 动作。
