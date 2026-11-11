## Why

原 artifacts 目录混合已提交的精选证据与自动生成的本机材料，按具体子目录追加忽略规则容易漏掉新一次排障目录，测试还会覆盖已审查截图。

## What Changes

- 统一为 `artifacts/curated/` 与 `artifacts/local/`，根目录保留规则说明。
- 已跟踪材料迁入 curated；原始及未跟踪材料迁入 local，保留字节与已有审查语义。
- 测试、探针和 fixture 构建默认写 local；文档与媒体清单跟随迁移，CI 继续采集本机输出。
- 新增目录门禁，拒绝跟踪 local 和重新引入第三种产物根目录。

## Capabilities

无新增或修改产品 capability。本次为仓库治理和工具路径变更，声明 `skip_specs: true`。

## Impact

涉及 artifacts、贡献规范、Git 忽略规则、开发脚本、测试输出路径、文档和媒体审查清单。安装包不增加 artifacts，平台支持与安全边界保持不变；不修改 provider、transport、Harness agent loop 或运行时 API 中的 artifacts 路径。
