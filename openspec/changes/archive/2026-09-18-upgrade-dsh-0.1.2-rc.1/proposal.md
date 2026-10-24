## Why

FlowAssert 当前把 DeepSeek Harness 支持基线固定在 `0.1.0-rc.8`。截至 2026-09-07，公共 npm 上最新可安装的 DSH 预发布版为 `0.1.2-rc.1`，而 GitHub `master` / `dsh-v0.1.3-alpha.1` 已继续迭代但尚无对应 npm 发布。项目需要升级到可复现的最新公开宿主，适配 `Code Mode → PTC mode` 命名变化，并明确区分“已观察源码”和“已验收兼容版本”。

## What Changes

- 将 `@deepseek-ai/dsh-attachment`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools` 的精确 peer/开发依赖和 lockfile 基线升级到 `0.1.2-rc.1`，同步 DSH 使用的 Cordis/Schemastery 版本。
- 将隔离宿主探针从 Native/Code 改为 Native/PTC；PTC 仍通过宿主提供的 `run_code` 执行九工具 Mock 语义闭环。
- 保持 `defineTool`、`createUserMessage`、`saveImage` 和 deferred image context 边界，不修改 DSH agent loop；增加附件归一化返回 JPEG/WebP 或缩小尺寸时的兼容测试。
- 更新当前 README、技术指南、安装指南、主规格与 active semantic-actions 规格中的当前兼容描述；历史 rc.8 验收记录、旧 release 说明和不可变资产保持原样。
- 使用打包产物在全新 `@deepseek-ai/dsh@0.1.2-rc.1` profile 中完成安装、config dump、Native/PTC 九工具 runtime 和不发模型请求的 text-only projection 负向边界，再运行完整仓库门禁。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `flowassert`: 将精确支持宿主升级到 DSH `0.1.2-rc.1`，并把第二种工具呈现模式改为 PTC。
- `agent-screen-perception`: 明确 DSH 归一化附件与原始 observation 几何的边界，并在新宿主上重跑确定性/宿主验收。
- `semantic-agent-actions`: 将 active change 的 DSH 宿主证据更新为 `0.1.2-rc.1` Native/PTC，保持九工具共享契约。

## Impact

- 影响 `package.json`、`pnpm-lock.yaml`、DSH 版本契约/运行探针和相关测试。
- 影响当前 README、技术/安装/安全/架构/产品文档、主 OpenSpec 及 active semantic-actions change；不改写历史验收环境和旧 release 资产事实。
- 不改变 `MirrorService`、provider、MCP、Viewer 连续媒体、session ownership、策略默认值或九项工具的公开名称/输入/结果。
- 不增加 agent-loop patch，不把 GitHub 未发布的 `0.1.3-alpha.1` 宣称为支持版本。
