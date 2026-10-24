## MODIFIED Requirements

### Requirement: 发布包与验证必须证明多宿主而非 Codex 绑定

package SHALL 保留 DSH 默认 export/bundle、MCP library export/可执行 bin、锁定 SDK 依赖和必要文档，并新增不依赖宿主 SDK 的 `flowassert` onboarding CLI。自动化 SHALL 使用通用 MCP SDK client 与真实子进程验证协议；Codex SHALL 作为至少一个真实宿主完成 Mock 图片理解闭环，但代码、doctor、配置 renderer 和工具语义 MUST 不依赖 Codex。

#### Scenario: packed artifact 可运行

- **WHEN** 对 `pnpm pack --dry-run` 产物执行 contract 检查
- **THEN** tarball SHALL 包含 DSH entry、MCP export/bin、onboarding CLI、Viewer、架构/安全/配置/发布/验证文档和所需 runtime dependencies
- **AND** MUST NOT 包含个人配置、Team ID、UDID、证书、真机 capabilities、临时 observation 图片或开发机生成的 host report

#### Scenario: 生成的 MCP 配置保持宿主无关

- **WHEN** onboarding CLI 生成 MCP JSON 或 Codex 注册命令
- **THEN** command/args SHALL 启动发布包中的同一个 stdio MCP bin，并通过同一 standalone config parser
- **AND** renderer 生产代码 MUST NOT 导入 Codex API、修改宿主配置或复制 Local Device Runtime

#### Scenario: 通用 MCP Mock 闭环

- **WHEN** SDK client 对 packed/compiled MCP server 执行 `list/start → snapshot/inspect → observation-bound action → re-observe → stop`
- **THEN** 工具 schema、PNG、结构、revision/epoch 变化、stale rejection 和清理 SHALL 全部通过
- **AND** 该结果 SHALL 标记为通用协议/Mock 验收而非物理设备验收

#### Scenario: Codex 视觉闭环

- **WHEN** Codex 通过同一 stdio command 注册 server 并消费 Mock snapshot
- **THEN** Codex SHALL 能描述图片中的可核对内容，执行 observation-bound safe action，并在 re-observe 中确认 action revision 变化后 stop
- **AND** Codex 配置 SHALL 只出现在文档/验收步骤中，生产代码 MUST 不导入或调用 Codex 专属 SDK

#### Scenario: 完整仓库门禁

- **WHEN** change 实现完成
- **THEN** `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 和 `git diff --check` SHALL 通过
- **AND** release candidate SHALL 额外通过临时 tarball 安装、onboarding CLI、managed Appium、MCP built-bin 和精确 DSH `0.2.0-rc.2` Native/PTC clean-profile probes
- **AND** Viewer 有改动时 MUST 留存并人工检查运行时截图，Android/iOS 真机与模型验收缺口 SHALL 单独报告
