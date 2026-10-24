## 1. 版本与契约

- [x] 1.1 将 DSH attachment/llm/tools/scope 精确依赖和 lockfile 升级到 `0.1.5-rc.2`。
- [x] 1.2 更新版本契约与 runtime/clean-profile probe，使版本或 Native/PTC 模式漂移自动失败。

## 2. 兼容实现与测试

- [x] 2.1 适配 DSH `0.1.5-rc.2` 暴露的公开类型/API 差异，保持薄 adapter 和十工具行为。
- [x] 2.2 增加或更新回归测试，覆盖 attachment/deferred image、模型图片能力边界和 Native/PTC 生命周期。

## 3. 当前文档与规格

- [x] 3.1 更新 README、技术/安装/架构/安全/能力文档中的当前支持基线，保留历史记录。
- [x] 3.2 更新主 `flowassert` 与 `agent-screen-perception` 规格。

## 4. 验证

- [x] 4.1 用同一 packed tarball 在隔离 DSH `0.1.5-rc.2` profile 中完成安装、config dump、Native/PTC 与模型图片能力边界验证。
- [x] 4.2 运行完整工程门禁、diff 检查和严格 OpenSpec 校验，并记录实际证据边界。
