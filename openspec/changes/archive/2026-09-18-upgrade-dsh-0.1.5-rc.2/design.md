## Context

DSH `0.1.5-rc.2` 是当前公开可安装的 next 候选版，根包及相关子包版本一致。FlowAssert 只通过 Cordis effects/registries 接入公开的 tools、attachments 与 llm seam，不持有 Harness agent loop 或 PTC runtime。

## Goals / Non-Goals

**Goals:**

- 使用精确 `0.1.5-rc.2` 形成可复现的 package、lockfile 和 clean-profile 支持基线。
- 证明十工具在 Native/PTC 下仍共享同一 registry、parser、结果与 deferred image 行为。
- 区分确定性宿主兼容、真实图片模型、物理设备和 Viewer 证据。

**Non-Goals:**

- 不接入实验性 Python PTC runtime，不修改或复制 Harness agent loop。
- 不改变 MCP、Viewer、Appium provider、session ownership 或安全策略。
- 不因宿主升级自动刷新真机与 Viewer 验收结论。

## Decisions

### 1. 精确锁定 `0.1.5-rc.2`

使用 npm 可安装的根包与子包精确版本，避免子包 `latest` dist-tag 滞后及 alpha/master 漂移。升级结论以 packed tarball 在 clean profile 中的运行结果为准。

### 2. 保持适配器边界

插件继续使用 `defineTool`、`AttachmentStore.saveImage` 和 `createUserMessage`。如果新宿主的公开类型或结果契约发生变化，只在薄适配层处理，不进入 MirrorService/provider，也不 patch agent loop。

### 3. Native/PTC 均走宿主能力

PTC 验收继续调用宿主 `run_code`，再访问同一十工具 registry。FlowAssert 不选择或实现 Node/Python PTC backend；Python backend 的发布和 profile 装配状态不属于本 change。

### 4. 当前事实与历史证据分离

当前入口、支持矩阵和主规格更新为 `0.1.5-rc.2`。带日期的 rc.1、rc.8、真机和 Viewer 记录保持原样，并在新的验证记录中明确哪些层本次实际重跑。

## Risks / Trade-offs

- [DSH 预发布接口仍可能变化] → 精确 pin，并由版本契约与 clean-profile probe 阻止静默漂移。
- [新模型目录改变旧 text-only 负例] → 探针按模型声明验证图片能力，不把模型名称硬编码为永远 text-only。
- [dirty worktree 包含其他工作] → 只修改 DSH 升级文件，不覆盖或提交其他 change 的内容。

## Migration Plan

1. 更新依赖、锁文件、版本契约和探针。
2. 修复编译或 runtime 暴露的公开 seam 差异。
3. 更新当前文档与主规格。
4. 用同一 tarball 完成 clean-profile Native/PTC 验收。
5. 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 和严格 OpenSpec 校验。

## Open Questions

无。
