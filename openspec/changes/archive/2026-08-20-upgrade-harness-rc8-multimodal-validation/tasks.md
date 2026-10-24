## 1. rc.8 契约与依赖固定

- [x] 1.1 核对 rc.8 的 attachment、LLM message、tool registry 和 provider modality 契约，记录插件实际使用的兼容面。
- [x] 1.2 将 DSH 直接依赖、peer dependencies 与 lockfile 精确固定为 `0.1.0-rc.8`，且不改写历史验证记录中的原始版本。
- [x] 1.3 扩展 contract checker 与测试，使依赖、lockfile、当前 README/验证基线或 probe 发生版本漂移时稳定失败。

## 2. 插件兼容实现与确定性测试

- [x] 2.1 修复 rc.8 引起的类型或运行时兼容问题，保持 `MirrorService`、provider、ObservationStore、MCP 和连续媒体边界不变。
- [x] 2.2 增加或更新单测，覆盖 deferred `ImageBlock`、单次 attachment 投递、文本模型不支持图片的清晰错误和既有 Native/Code observation 生命周期。
- [x] 2.3 构建 packed tarball，并验证包内只包含声明资产且不包含 profile、凭据、设备标识或临时 observation 数据。

## 3. 隔离 DSH rc.8 Runtime 验收

- [x] 3.1 创建不覆盖用户配置的隔离 DSH `0.1.0-rc.8` profile，安装 packed tarball并验证 bundle/config dump 与八项工具注册。
- [x] 3.2 分别执行 Native Mode 和 Code Mode 的 `start → snapshot/inspect → observation-bound action → re-observe → stop`，验证 deferred context、revision、stale protection 和 listener/process 释放。
- [x] 3.3 使用真实 `text,image` 模型执行 raster-only challenge，验证模型描述未在 JSON/structure 中披露的像素特征、使用 fresh observation 完成安全动作并最终 stop。
- [x] 3.4 对公共 DeepSeek V4 或等价 text-only 目录项执行负向验收，确认 attachment/首轮工具成功不会被误报为视觉通过。
- [x] 3.5 对 runtime 输出、profile 和保留摘要执行敏感信息扫描；只保留版本、provider/model、工具序列、revision、最终状态和脱敏结论。

## 4. 文档与完整门禁

- [x] 4.1 更新 README 和验证矩阵，把 `0.1.0-rc.8` 作为后续固定基线，记录真实模型正/负向结果并保留 rc.6 历史事实。
- [x] 4.2 若 rc.8 改变 provider/attachment 边界，更新对应 ADR；否则在验证文档明确“宿主升级未改变核心/MCP/连续媒体架构”。
- [x] 4.3 运行 `pnpm check`、`pnpm test:e2e` 并保留/人工检查最终 Viewer 截图，确认升级期间其他控制保持可交互。
- [x] 4.4 运行 `pnpm build`、`pnpm pack:check`、`git diff --check` 和 `openspec validate upgrade-harness-rc8-multimodal-validation --strict`，记录分层结论与未通过的外部条件。
