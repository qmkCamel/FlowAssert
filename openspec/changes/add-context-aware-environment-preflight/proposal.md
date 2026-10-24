## Why

当前 `doctor` 默认按 Android/iOS 执行整组检查，没有表达独立 Viewer、Codex/MCP、DSH 插件和 CLI 的不同前提；报告查看和 Mock 可能因此被无关设备依赖阻塞。DSH 精确 `0.2.0-rc.2` 检查只存在于开发契约与独立验收探针，尚未成为用户环境准备中的明确检查项。

## What Changes

- 引入由入口、操作、provider、平台、功能要求共同决定的共享预检计划：无关项不执行、不展示、不影响结果；必要项缺失才阻止对应操作；可降级能力独立展示可用性。
- 区分 `viewer / mcp / dsh / cli` 四类入口，`codex` 为 CLI 配置别名，归一为 `mcp`；入口不由模型名称、环境中是否存在 dsh 命令等旁证推断。
- 支持基础启动、报告阅读、Mock、真机连接、已登记测试准备，以及显式的媒体/OCR/AI 恢复/浏览器录像能力检查。不选择这些能力时不触发相关进程、凭据检查或网络请求。
- DSH 预检只针对用户明确选定的 executable 和 profile 范围，验证宿主精确版本、有效依赖及插件登记；不以本仓库 lockfile 或另一份全局安装冒充目标宿主。
- 共享计划复用于 CLI doctor 与 Viewer 连接/功能入口；已有设备检查、签名授权、同源保护、设备 claim 和 MirrorService 会话边界保持有效。报告/Mock 不加载 DSH 专属服务。
- **BREAKING（诊断输出，不改变设备工具协议）**：引入 Doctor report v2，明确作用范围、依赖角色、功能可用性与未完成检查。无参数 doctor 改为基础运行环境检查，不再隐式检查双平台真机；显式 `--platform android|ios|all` 保留用户主动检查相应设备的语义。v1 固定输出调用者须迁移，避免将局部 ready 误解为全部能力 ready。
- 保留只读、脱敏、有界、可取消的检查规则；不安装、不升级、不覆盖个人配置、不启动设备会话，不新增 Agent 预检工具。

## Capabilities

### New Capabilities

- `context-aware-environment-preflight`：上下文归一、检查计划、按功能分项判定、DSH 实际宿主检查、预算和跨入口一致性。

### Modified Capabilities

- `local-beta-onboarding`：doctor 按目标操作选择依赖，增加 DSH 显式参数、v2 输出/退出码及迁移说明，保持配置生成只读。
- `guided-device-connection-assistant`：Viewer 根据实际操作选择检查，基础路径不被未选功能阻塞，保持局部进度与平台/代次隔离。

## Impact

- 基线：`origin/dev@REDACTED_REVISION`。在 `feat/scoped-environment-preflight` 独立工作树开展；现有截图/报告与主工作区未提交内容不属于本变更。
- 主要涉及 `src/doctor.ts`、`src/onboarding-cli.ts`、`src/connection-assistant.ts`、`src/host-command-runner.ts`、runtime 组装与 Viewer 的连接/功能展示；新增共享检查计划及 DSH 只读诊断适配，复用既有 OCR/恢复/录屏检查能力，不扩展其权限。
- 修改 doctor/CLI/Viewer 合同测试、真实子进程/假平台探针、打包检查与 E2E；更新安装、MCP、DSH、Viewer 和能力文档。保留默认 20 项工具和 5 项 opt-in 修复工具，连续媒体仍不进入 MCP/DSH 工具结果。
- 支持范围不因预检扩展而扩大：macOS Android/iOS USB 真机为已有产品基线；Mock/报告路径不依赖手机。平台工具不可用时只阻塞已选择的对应真机操作。
- 真实 DSH profile 的检查只读取用户显式授权的路径及有限元数据；禁止读取或回显密钥、模型配置、完整 profile 或设备标识。生产账号、系统依赖和外部 Appium 不自动修复或接管。
