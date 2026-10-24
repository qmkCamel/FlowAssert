## Why

FlowAssert 当前支持基线仍固定在 DeepSeek Harness `0.1.2-rc.1`。公共 npm 已提供可复现的 `0.1.5-rc.2`，而 GitHub `master` 已进入 `0.1.6-alpha.1` 之后的开发提交。项目需要在不追随未发布源码的前提下，重新验证公开插件 seam、Native/PTC 工具呈现和打包安装链路。

## What Changes

- 将 DSH attachment/llm/tools/scope 的精确依赖基线升级到 `0.1.5-rc.2` 并刷新 lockfile。
- 保持 `defineTool`、`createUserMessage`、`saveImage` 与十工具共享契约，不修改 Harness agent loop、MirrorService/provider、MCP 或 Viewer 媒体边界。
- 在隔离的 `@deepseek-ai/dsh@0.1.5-rc.2` profile 中验证插件安装、配置、Native/PTC Mock 生命周期和图片模型边界。
- 更新当前支持矩阵与主规格；保留带日期的 `0.1.2-rc.1` 历史证据。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `flowassert`: 当前精确支持宿主升级为 `0.1.5-rc.2`。
- `agent-screen-perception`: 在新宿主上重新验证 attachment/deferred image 与图片模型投影边界。

## Impact

- 影响 package、lockfile、版本契约、DSH runtime/clean-profile probe、当前支持文档和主规格。
- 不改变设备控制、session ownership、安全策略、十项工具公开契约或连续视频传输。
- 不把 `0.1.6-alpha.1` 或更新的 `master` 宣称为已支持版本。
