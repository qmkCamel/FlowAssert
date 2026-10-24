## Why

当前设备控制、单帧截图、界面结构和 observation 安全契约已经位于宿主无关的核心层，但对外只有 DeepSeek Harness adapter，其他 agent 宿主仍无法复用。现在需要补齐标准 MCP 接入面，使 Codex 只是首批验收宿主之一，而不是新的架构中心或第二套设备控制实现。

## What Changes

- 抽取可被 DSH 与 MCP 共同创建和释放的 Local Device Runtime，继续复用现有 `MirrorService`、provider、Viewer、会话所有权、WDA 预检和安全策略。
- 新增默认使用 stdio 的通用 MCP server 与可执行入口，暴露发现、iOS 预检、启动、状态、单帧截图、界面结构、动作和停止八项能力。
- 将一次性 PNG 作为 MCP image content 投影，将规范化结构和控制状态作为有界结构化结果返回；canonical JSON、日志和共享状态不携带图片 Base64，连续视频仍只走 loopback Viewer 媒体路径。
- 保持现有 DSH 工具名称、参数与行为兼容，并用共享 contract/conformance fixture 防止 DSH 与 MCP 语义漂移。
- 增加协议、进程生命周期、安全、打包和多宿主验收；Codex 作为一个真实宿主完成 Mock 闭环，通用 MCP client 作为自动化协议基线。
- 更新架构 ADR、产品形态、安全、配置、安装和验证文档，明确 stdio 信任边界、宿主差异和当前支持矩阵。

## Capabilities

### New Capabilities

- `host-neutral-mcp-adapter`: 定义共享 Local Device Runtime、stdio MCP server、离散观察投影、生命周期/安全边界、跨宿主一致性和 Codex/通用 MCP 验收契约。

### Modified Capabilities

无。现有变更尚未归档到 `openspec/specs/`，本 change 不改变已经交付的 DSH 工具或 agent-screen-perception 行为。

## Impact

- 代码：`src/index.ts`、`src/tools.ts`、`src/viewer-server.ts` 将接入共享 runtime/contract；新增 MCP server、MCP projector、独立配置入口和进程启动脚本。
- 包契约：增加锁定版本的 MCP TypeScript SDK 运行时依赖、MCP export/bin、多入口构建及 tarball 校验；保持现有 DSH peer dependency 与 bundle 入口不变。
- 运行时：MCP 默认仅通过 stdio 通信；Viewer 继续只监听 loopback；stdout 专用于 MCP 帧，诊断只写 stderr 且必须脱敏。
- 测试：增加 in-process MCP client、子进程 stdio、DSH/MCP conformance、进程清理、Mock 闭环和 Codex 手工验收；继续执行仓库全部 required gates。
- 平台：继续支持 Mock、Android Appium 和 iOS Appium/WDA，不新增第二套 driver，不改变已附着/新建 session 的所有权语义。
