## Why

开发分支仍声明 DeepSeek Harness `0.1.5-rc.2`，新宿主 `0.2.0-rc.2` 会拒绝不匹配的 DSH peers；旧消息来源、模型目录和 profile 探针也不再符合公开契约。需要精确升级可安装版本并以同一候选包重新验收，避免把依赖更新当成运行时兼容。

## What Changes

- **BREAKING**：当前精确支持宿主升级到 DSH `0.2.0-rc.2`，与宿主一致的 Cordis `4.0.4` / Schemastery `3.18.4`；保留旧版本的历史记录和资产。
- 为截图及测试证据声明独立的 FlowAssert 消息来源，使用公开消息、附件和工具定义类型，保持薄适配器及现有二十工具行为。
- 更新模型能力、精确依赖家族、Native/PTC、live/startup HMR 和关闭清理探针；同包覆盖既有只读报告授权与双 Mock 矩阵。
- 同步当前文档、主规格和工程验证记录；通过隔离 runtime/profile 后更新本机全局 CLI，先备份个人配置。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `flowassert`：更新精确支持版本、安装兼容检查、二十工具和生命周期验收。
- `agent-screen-perception`：新版来源声明及图片/纯文本投影验收基线。
- `host-neutral-mcp-adapter`：发布候选的精确 DSH clean-profile 门禁。

## Impact

涉及 package/lockfile、DSH adapter、runtime/install/clean-profile probes、当前文档和上述规格。设备控制继续由 MirrorService/provider 负责，连续媒体仍在本机 Viewer；默认 loopback、显式设备及报告授权保持原契约。不修改 Harness agent loop，不执行真实模型请求或真机写操作，不发布包或合并 dev。验收主机为 macOS arm64；其他平台与真实模型/设备验收分开记录。
