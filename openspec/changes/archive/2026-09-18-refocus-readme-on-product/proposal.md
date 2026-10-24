## Why

当前中英文 README 同时承担产品介绍、源码开发、宿主安装、真机配置、配置参考和验收记录，首次访问者需要穿过大量实现细节才能理解 FlowAssert 的定位、价值和使用路径。随着 Viewer、MCP、双平台真机与语义动作能力逐步完整，仓库首页需要从“技术手册”调整为“产品入口”，并把可变、专业的工程内容收敛到独立技术文档。

## What Changes

- 重构中英文 README 的信息架构，优先呈现产品定位、目标用户、核心价值、产品形态、典型使用场景、五分钟 Mock 体验、成熟度和下一步路径。
- 用产品语言解释 Local Device Bridge、宿主 adapter 与可选 Viewer 的关系，明确 Viewer 不是独立 Web 产品，Codex 也不是唯一宿主。
- 新增中英文技术指南，承接源码工具链、本地开发、构建打包、验证命令、运行时探针、配置与专题文档索引。
- 从 README 删除重复的 capabilities、原始配置、长工具表、真机 capability 示例和维护者验收步骤，改为链接到单一权威文档。
- 保持英文与简体中文 README 结构、事实、版本边界和跳转路径一致，不改变运行时、API、配置或发布行为。

## Capabilities

### New Capabilities

- `project-documentation`: 约束仓库首页的产品说明职责、中英文一致性、技术内容分层和可验证链接边界。

### Modified Capabilities

无。

## Impact

- 主要影响 `README.md`、`README.zh-CN.md`、新增的中英文技术指南，以及将技术指南纳入发布包的 manifest/contract 检查。
- 复用 `docs/product-shape.md`、架构、安全、宿主、平台、Beta 与验证文档作为技术事实来源，不复制运行时实现。
- 不修改运行时 TypeScript、Viewer、DSH/MCP contract、Appium provider 或外部依赖；发布包只增加两份文档，不改变可执行内容。
- 平台支持与安全边界保持不变：Mock 仍是默认体验路径，真机仍要求显式授权，Viewer 仍只监听 loopback，连续媒体仍不进入 DSH/MCP 工具结果。
