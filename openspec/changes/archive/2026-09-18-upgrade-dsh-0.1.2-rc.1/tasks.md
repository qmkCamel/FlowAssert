## 1. 版本与宿主契约

- [x] 1.1 将 DSH attachment/llm/tools 精确 peer/dev 基线升级到 `0.1.2-rc.1`，同步 Cordis/Schemastery、为受支持 Node 显式使用 tsdown native config loader，并刷新 lockfile。
- [x] 1.2 扩展版本契约，要求 package、lockfile、README、validation、runtime probe 和 clean-profile probe 使用同一精确版本，并拒绝旧 `code` mode。

## 2. Runtime 兼容与回归测试

- [x] 2.1 将 runtime/clean-profile 探针迁移到 `native|ptc`，保持 PTC `run_code` 九工具语义闭环、deferred image 和 stop/dispose 检查。
- [x] 2.2 扩展 DSH attachment 结构类型与单测，证明宿主返回归一化 media type/尺寸/originalDimensions 时 opaque ref 原样 defer，而 summary/动作几何仍来自原始 observation。
- [x] 2.3 运行 focused 版本契约、tools 单测和 TypeScript 检查。

## 3. 当前文档与规格

- [x] 3.1 更新 README、技术指南、安装指南、安全/架构/产品/里程碑/current readiness 中的当前支持基线和 Native/PTC 名称，保留旧 release/历史验证事实。
- [x] 3.2 更新主 `flowassert`、`agent-screen-perception` 规格及 active semantic-actions change，使版本、模式和 attachment 归一化边界一致。
- [x] 3.3 严格校验本 change、所有 active changes 和主 specs。

## 4. 打包宿主验收与完整门禁

- [x] 4.1 build/pack 同一候选产物，在独立 `@deepseek-ai/dsh@0.1.2-rc.1` prefix/profile 完成安装、config dump、Native/PTC 九工具 Mock 闭环、不发模型请求的 text-only projection 负向边界和 dispose 清理。
- [x] 4.2 在 `docs/validation.md` 新增 2026-09-07 验收记录，明确 GitHub `0.1.3-alpha.1` 仅为源码观察值，并区分未重跑的真实模型/物理设备/Viewer 层。
- [x] 4.3 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`、`pnpm public:check`、`git diff --check` 和 OpenSpec strict gates。
