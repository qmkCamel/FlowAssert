# FlowAssert 技术与开发指南

修复闭环为 **Preview（预览能力，默认关闭）**，只适合受控项目试用。M1/M2 软件验证与 M3 Mock 安装协议不等于真实 App 修复验收；项目 `repair.enabled` 与宿主 `repairToolsEnabled` 分开控制，尚无统一总开关或 Viewer 一键开关。使用范围、审批与停用见[修复指南](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。

[English](technical-guide.md) | 简体中文

本指南面向需要阅读源码、开发、构建、验证或扩展 FlowAssert 的贡献者。产品定位、目标用户和快速体验请先阅读[中文 README](../README.zh-CN.md)；部署到具体宿主或真机时，应继续使用下方对应的专题文档。

当前六项迭代完成的是工程范围，不是所有验收。交付前先核对[逐项状态](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-change-acceptance-records/roadmap.md)：90/103（10月5日；原路线图保留10月3日快照），真机、授权材料、独立评审分别跟踪。新增专题为[变更验收](change-acceptance-records.md)、[外部资产](external-test-assets.md)、[本机 OCR](local-region-ocr.md)、[双槽矩阵](local-device-matrix.md)；DSH/MCP 共 20 项默认工具，另有 5 项 opt-in Preview 修复工具，新增三个摘要读取入口不具有矩阵或外部 runner 执行权限。

报告目录、失败阅读和脱敏导出见[报告阅读与离线分享](report-reading-and-sharing.md)；全部活动任务的 10 月 7 日计数见[产品 TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)。源码候选、同包验证与公开 Release 分别核对；安装入口见[指南](beta-installation.md)。

## 工具链基线

| 范围 | 版本或约束 |
| --- | --- |
| 仓库 Node | 24.19.0（通过 mise 固定） |
| package Node | `^22.19.0 || >=24.0.0` |
| pnpm | 11.7.0（通过 Corepack 固定） |
| DeepSeek Harness | `0.2.0-rc.2` |
| Appium | 2 或 3 |
| Android driver | UiAutomator2 |
| iOS driver | XCUITest/WebDriverAgent；自有 WDA/MJPEG host forwarding 暂限经指纹审计的 XCUITest 10.19.1，external Appium 由其 owner 独立核验 |

后续 DeepSeek Harness preview、Appium driver 或 scrcpy 版本不能只修改文档数字；必须重新通过对应的 clean-profile、provider 和真机验收。

## 本地开发

```bash
mise install
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

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

`pnpm build` 生成 ESM、类型声明和 source map；`pnpm pack:check` 会重新构建并检查发布 tarball 内容。package 保持 `private: true`，不会执行 `npm publish`。安装和回滚只使用经过校验的 GitHub prerelease，见 [Beta 指南](beta-installation.md)。

发布包同时包含：

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

- `pnpm check`：TypeScript、contract lint 与 Vitest；
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

这两条路径分别通过 Native tools 与宿主提供的 PTC `run_code` transport 调用真实 DSH registry。当前 registry 包含十项设备工具和五项默认关闭的已登记测试工具；后者必须配置本机项目及白名单后才能使用。必须使用支持图片输入的模型才能证明模型实际看到 PNG；文本模型仍只得到稳定的 omitted 占位。新工具与证据权限见 [Agent 运行指南](agent-test-run-control.md)。

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
| 查看架构决策 | [ADR 目录](decisions/0001-appium-core-local-viewer.md) |
| 查看研究依据 | [产品与竞品调研](https://github.com/qmkCamel/flowassert/blob/main/docs/research/product-landscape.md) |

## 贡献与发布

贡献前阅读 [CONTRIBUTING](https://github.com/qmkCamel/flowassert/blob/main/CONTRIBUTING.md) 和[行为准则](https://github.com/qmkCamel/flowassert/blob/main/CODE_OF_CONDUCT.md)。安全问题使用[安全报告渠道](https://github.com/qmkCamel/flowassert/blob/main/.github/SECURITY.md)，不要放入公开 issue。发布只能由精确 tag 在 clean runner 上创建新的 GitHub prerelease，不能覆盖已有资产或发布到公共 npm；详细规则见[开源发布准备清单](https://github.com/qmkCamel/flowassert/blob/main/docs/open-source-readiness.md)和版本化 release notes。

## Observation 查询与 Viewer Inspector

当前追加第十工具 `mobile_mirror_query_screen`：先用 summary inspect，再对同一 observation 执行 find/get/subtree，无需重新采集或生成图片附件。历史节点仍受原严格动作时限约束。Viewer 可独立检查冻结截图、节点树与属性，不发布 Agent observation，也不修改分享策略。详见[使用与验收边界](inspector-validation.md)。
