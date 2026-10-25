# FlowAssert 技术与开发指南

[English](technical-guide.md) | 简体中文

本指南面向阅读源码、开发、构建、验证或扩展 FlowAssert 的贡献者。首次体验见[中文 README](../README.zh-CN.md)，逐项能力与验收见[能力总表](https://github.com/qmkCamel/flowassert/blob/main/docs/capabilities.md)，活动任务见 [PRODUCT_TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)。本页集中维护工程命令，不重复维护任务计数。

修复闭环为 **Preview，默认关闭**；启用、审批与退出见[修复指南](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。软件/Mock、包与宿主、真机和真实模型分别验收。

## 工具链基线

| 范围 | 版本或约束 |
| --- | --- |
| 仓库 Node | 24.19.0（通过 mise 固定） |
| package Node | `^22.19.0 || >=24.0.0` |
| pnpm | 11.7.0（通过 Corepack 固定） |
| DeepSeek Harness | `0.2.0-rc.2` |
| Appium | 2 或 3 |
| Android driver | UiAutomator2 |
| iOS driver | XCUITest/WebDriverAgent |

自有 WDA/MJPEG host forwarding 暂限经指纹审计的 XCUITest `10.19.1`，external Appium 由其 owner 核验。后续 Harness preview、driver 或 scrcpy 升级须补相应 clean-profile、provider 和真机证据，不能只修改版本数字。

## 本地开发

```bash
git clone --branch main --single-branch https://github.com/qmkCamel/flowassert.git
cd flowassert
mise install
mise exec -- corepack enable
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

已有源码目录时从 `mise install` 开始；自行管理 Node 时可省略 `mise exec --`，确保当前终端版本符合上表。

开发入口默认在 `http://127.0.0.1:3210` 启动 loopback Viewer；没有本机保存配置时使用安全的 Mock provider。Mock 不需要手机、Appium、模型凭据或宿主设备发现，适合 UI、生命周期和 Agent contract 的确定性开发。

`pnpm dev` 与 `pnpm start` 都调用正式 Viewer 启动实现；安装包对应命令是 `flowassert-viewer`。启动器默认读取仓库外私有配置，但不在启动/页面加载时枚举设备或启动 Appium。真机首次保存、后续快速连接与故障恢复见[本机 Viewer 指南](local-viewer.md)。

仓库中的核心边界：

- DSH plugin 与 MCP server 是薄 adapter，共用 `LocalDeviceRuntime` 和 `MirrorService`；
- Appium provider 是 Android/iOS 语义控制层；
- Agent 只接收离散 PNG/结构 observation，连续媒体只进入本机 Viewer；
- 任何超过 300 ms 的用户操作都必须展示局部进度，并在失败时保留上一可用结果；
- Viewer 和 managed Appium 默认只接受 loopback，session/server 所有权必须显式区分。

详细组件、生命周期和数据边界见[架构文档](architecture.md)。

## 构建与打包

```bash
pnpm build
pnpm pack:check
```

`pnpm build` 生成 ESM、类型声明和 source map；`pnpm pack:check` 通过 `pnpm pack --dry-run` 的实际文件清单检查随包文档链接，同时触发构建，不代替真实 tarball 的隔离安装。生成本机候选使用 `pnpm pack --pack-destination /ABSOLUTE/CANDIDATE_DIR`。当前入口是源码，package 保持 `private: true`；未来 Release 下载与回滚模板见[安装指南](beta-installation.md)。

候选包包含：

- DSH Cordis bundle；
- 通用 stdio MCP launcher；
- 只读 `doctor/config` onboarding CLI；
- Viewer 静态资源；
- 用户运行所需的架构、宿主、平台、安全、验证和发布文档。

## 必需门禁

提交前运行：

```bash
pnpm check
pnpm test:e2e
pnpm build
pnpm pack:check
pnpm public:check
git diff --check
```

- `pnpm check`：TypeScript、contract lint、文档检查与 Vitest；
- `pnpm test:e2e`：Viewer Playwright 场景；
- `pnpm public:check`：公开文件、Markdown 链接、secret/path、作者身份和发布边界；
- Viewer 改动还必须保留并人工检查最终截图；
- OpenSpec 变更必须执行 `openspec validate <change> --strict`。

精确测试矩阵、真机证据和未关闭边界见[验证记录](validation.md)。

## 运行时探针

### MCP Mock

```bash
pnpm build
pnpm run test:mcp:probe --launcher ./scripts/mobile-mirror-mcp.mjs
```

该探针启动真实的 built stdio 子进程，验证工具 schema、Mock observation/action 闭环、mutation/stale protection、信号清理和 Viewer 端口释放。MCP/Codex 的安装、权限和配置 contract 见 [MCP 宿主指南](mcp-hosts.md)。

### DeepSeek Harness

```bash
DSH_TOOLS_MODE=native dsh web --patch ./scripts/dsh-runtime-probe.patch.yml
DSH_TOOLS_MODE=ptc dsh web --patch ./scripts/dsh-runtime-probe.patch.yml
```

这两条路径分别通过 Native tools 与宿主提供的 PTC `run_code` 调用真实 DSH registry。默认工具集合为十项设备工具、五项已登记测试工具和五项只读摘要工具；测试执行须另行启用并配置项目白名单。五项 Preview 修复工具需宿主 opt-in 与有效项目登记，可见不代表获准执行。完整职责见[工具清单](product-shape.md#agent-与控制面)，授权见 [Agent 运行指南](agent-test-run-control.md)。

DSH `0.2.0-rc.2` 的目录将 `deepseek-flash` 声明为 `text,image`，`deepseek-v4-pro` 为仅文本；后者收到稳定的图片省略占位。目录元数据或附件送达不能证明真实模型已读取图片，须独立验证。当前 DSH Doctor 的 Cordis 检查存在[已知版本漂移](environment-preflight.md#dsh静态前提与实际启用分开)。

### 物理设备

```bash
pnpm run test:mcp:physical
pnpm run test:media:physical
```

这些命令需要显式平台、设备、Appium 和媒体环境，不会自动发现授权值或绕过设备锁屏。运行前分别阅读 [Android 真机指南](android-real-device.md) 或 [iOS/WDA 指南](ios-real-device.md)，并把输出解释为单设备证据而不是广泛兼容性。

## 配置与安全原则

- 默认 provider 是 Mock；宿主设备发现、签名诊断、真机屏幕、文本输入和应用控制都需要分别授权。
- Appium server 默认为 external；managed 模式要求绝对 executable 和 loopback URL，只清理自己保存的 child。
- 新建 session 是 owned，附着 `sessionId` 是 attached；stop 只删除 owned session。
- Appium capabilities 可能包含凭据，不能进入日志、工具结果或共享状态。
- `image-and-structure` 会把单帧 PNG 交给所选宿主/模型，核心内存 TTL 不等于宿主 attachment 的删除策略。
- 自动 provisioning/device registration 默认关闭，因为它可能修改 Apple Developer 外部状态。

完整 threat model、数据保留和策略说明见[安全模型](security.md)。

## 技术文档地图

| 任务 | 权威文档 |
| --- | --- |
| 理解产品边界和最终形态 | [产品形态与能力边界](product-shape.md) |
| 理解组件、生命周期和媒体通道 | [架构](architecture.md) |
| 安装 DSH Beta、doctor/config、升级与回滚 | [Beta 安装指南](beta-installation.md) |
| 注册 Codex 或其他 MCP client | [MCP 宿主指南](mcp-hosts.md) |
| 配置 Android、UiAutomator2 和 scrcpy | [Android 真机指南](android-real-device.md) |
| 配置 iPhone、Xcode、WDA 和 MJPEG | [iOS/WDA 指南](ios-real-device.md) |
| 启动 Viewer、保存本机配置和快速重连 | [本机 Viewer 指南](local-viewer.md) |
| 评估权限、隐私和外部状态变更 | [安全模型](security.md) |
| 查看测试、性能和物理证据 | [验证记录](validation.md) |
| 查看开发阶段和未完成矩阵 | [里程碑](milestones.md) |
| 查看架构决策 | [ADR 目录](https://github.com/qmkCamel/flowassert/blob/main/docs/README.md#架构决策-adr) |
| 查看研究依据 | [产品与竞品调研](https://github.com/qmkCamel/flowassert/blob/main/docs/research/product-landscape.md) |

## 贡献与发布

贡献前阅读 [CONTRIBUTING](https://github.com/qmkCamel/flowassert/blob/main/CONTRIBUTING.md) 和[行为准则](https://github.com/qmkCamel/flowassert/blob/main/CODE_OF_CONDUCT.md)。安全问题使用[安全报告渠道](https://github.com/qmkCamel/flowassert/blob/main/.github/SECURITY.md)，不要放入公开 issue。发布只能由精确 tag 在 clean runner 上创建新的 GitHub prerelease，不能覆盖已有资产或发布到公共 npm；详细规则见[开源发布准备清单](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md)和版本化 release notes。

## Observation 查询与 Viewer Inspector

`mobile_mirror_query_screen` 只查询已保留的 observation，不重新截图，也不延长动作有效期。Viewer Inspector 独立冻结本机截图与结构；使用与验收见 [Inspector 指南](inspector-validation.md)。
