## Context

当前包已经包含 DSH bundle、通用 stdio MCP bin、Mock/Appium provider、Viewer 与真机诊断，但用户必须从仓库构建 tarball、手工判断 Appium/driver/平台依赖，并分别拼装 DSH patch 与 MCP host 命令。`LocalDeviceRuntime` 只连接外部 Appium；即使用户希望插件管理本机 Appium，也没有显式 executable、ready 等待和进程所有权契约。

本 change 跨越配置、宿主命令、runtime 生命周期、打包和 GitHub Release。Harness 仍固定为 `0.1.0-rc.8` developer preview；主机命令和设备画面都位于 agent shell sandbox 之外，因此 doctor 必须只读、managed Appium 必须显式 opt-in，任何路径、设备标识、签名值和原始命令输出都不能进入共享报告或发布物。

## Goals / Non-Goals

**Goals:**

- 提供可从预构建 tarball 运行、可单测的 onboarding CLI；用户无需编辑仓库源码即可诊断依赖并得到 DSH/MCP/Codex 配置。
- 用稳定、脱敏、机器可读的 doctor report 区分 required、optional、manual 和 blocked 检查。
- 在不改变 Appium provider 语义的前提下，增加 lazy managed Appium 生命周期和精确进程所有权。
- 产出版本、内容、SHA256 与 release notes 一致的 `0.1.0-alpha.1` GitHub prerelease，并证明 tarball 可在干净目录和 rc.8 profile 中安装运行。
- 保持 external Appium、DSH 八项工具、MCP stdio、Viewer loopback、screen policy 与 session ownership 向后兼容。

**Non-Goals:**

- 不自动下载、安装或升级 Node、Appium、Appium driver、scrcpy、Xcode、WDA 或设备软件。
- 不发布公共 npm 包，不签名/notarize 二进制，不提供 SBOM 或稳定版本兼容承诺。
- 不自动修复 WDA 签名、信任设备、开启 Developer Mode、修改 Android 设置或启用 provisioning/device registration。
- 不增加远程 Appium 管理、daemon、跨进程共享 runtime、孤儿进程扫描或崩溃后的宽泛清理。
- 不修改 DSH agent loop，不把 doctor/配置生成功能注册成 agent 工具。

## Decisions

### 1. Onboarding 使用独立薄 CLI，共享可注入的 TypeScript 服务

新增 `flowassert` bin，入口脚本只调用编译后的 `runOnboardingCli()`。命令限定为：

- `doctor [--platform android|ios|all] [--config <json>] [--format human|json]`
- `config --target dsh|mcp|codex [--platform mock|android|ios]`，Codex target 额外接收用户显式提供的绝对 package/config path
- `--version` 与 `--help`

解析、doctor、renderer 和 IO 都通过依赖注入测试；CLI 不导入 DSH/Codex SDK，不注册 Cordis effect，也不启动 Viewer/session。选择独立 CLI 而不是新增 agent tool，是因为 host 环境诊断和 shell 命令生成属于用户安装面，不应让模型无意触发或获取主机细节。

### 2. Doctor 只返回稳定摘要，不返回原始发现结果

Doctor report 固定包含 schemaVersion、overall、platform、checks；每个 check 仅有稳定 id、`pass|warning|blocked|manual|skipped`、稳定 code、可公开版本/计数和 suggestion。human renderer 只投影同一对象；JSON 便于 CI/支持脚本消费。blocked 返回进程 exit code 2，成功或仅 warning/manual 返回 0，参数/内部失败返回 1。

Node 直接检查当前进程；Appium endpoint 使用有界 `/status`；configured Appium executable、ADB、scrcpy、Xcode/xcrun 通过 `execFile/spawn(shell=false)` 执行版本或只读枚举命令。设备输出只汇总平台、online/offline 数量；不保留 ID、名称或原始行。iOS WDA/签名复用 `IosWdaPreflightService` 的分类和脱敏规则，未显式允许 signing diagnostics 时标记 manual，而不是绕过配置授权。每条命令有独立 timeout 和 1 MiB 上限，报告生成后丢弃原始 stdout/stderr。

不采用自动修复或 PATH 全盘搜索，因为这会执行未审计安装脚本、改变主机/设备状态，并使同一配置在不同机器解析到不同 executable。

### 3. 配置输出默认安全、确定性且不写磁盘

`config` 把同一个安全模型投影为完整 DSH YAML patch、Standalone MCP JSON 或可复制的 Codex 注册命令：Mock、loopback、`mock-only`、host discovery/signing diagnostics/provisioning 全部关闭，Appium 默认 external。Android/iOS target 只显示必要占位符和说明，不读取钥匙串、profile、HOME 或现有宿主配置。

所有输出只写 stdout，诊断写 stderr；CLI 不创建/覆盖文件。DSH renderer 输出完整 config，因为 DSH id patch 会替换整个 config；MCP JSON 必须能被 `resolveStandaloneMcpConfig` 接受；Codex command 对用户传入的绝对路径做 shell-safe quoting，且只引用同一 `flowassert-mcp` bin/config。选择 renderer 而不是直接修改 DSH/Codex 配置，是为了保留用户确认与宿主自己的权限/回滚机制。

### 4. Managed Appium 是 lazy、loopback-only 的 runtime 依赖

配置新增：

- `appiumRuntimeMode: external|managed`，默认 `external`
- `appiumExecutablePath`，默认空；managed 时必须是可执行的绝对文件

managed 模式只允许 `appiumUrl` 为 HTTP loopback URL；address、port 和 base path 从该 URL 派生为固定 Appium CLI 参数，不接受任意额外 shell/CLI 参数。`mobile_mirror_start(provider=appium)` 才调用 `ManagedAppiumRuntime.ensureReady()`，插件加载、list、doctor 和 Mock 不启动 Appium。managed 模式拒绝 attach `sessionId`，已有健康 listener 占用目标 URL 时返回稳定冲突错误并提示改用 external，绝不接管该 listener。

`ManagedAppiumRuntime` 使用已有 streaming child abstraction 的同类 `spawn(shell=false)` 实现，持有唯一 child handle、64 KiB 有界输出和 abort signal。它在 spawn 前探测占用，spawn 后轮询 `/status`，只在 ready 后创建 `AppiumProvider`。shared state 增加不含路径/端口的 `appiumRuntime { mode, phase, owned, lastErrorCode }`，Viewer 与 MCP progress 可在超过 300 ms 时继续显示 connecting/starting 状态。

Appium provider 不拥有进程。`MirrorService` 通过注入的 appium lifecycle 在 Appium session 前准备、在 session stop/start failure/dispose 后关闭。关闭顺序为媒体 → provider-owned session → managed Appium child；SIGTERM 等待 2 秒后只对保存的 child handle SIGKILL。external 模式 lifecycle 是 no-op，从不发送信号。这样 DSH 与 MCP 继续复用同一核心，且 attached/owned Appium session 语义不被复制。

### 5. 失败保留状态并允许安全重试

spawn、ready timeout、提前退出、listener 冲突和 stop timeout 映射为稳定错误码，公共状态不包含 executable path、参数、stdout/stderr 或 stack。启动失败继续保留 Viewer 上一可用画面和错误摘要；本次创建的 child 在失败路径完成精确清理。取消信号会中止 ready 轮询并等待 child 静止。后续 start 可以创建新 child，但同一 runtime 同时最多存在一个启动 promise 和一个 owned child。

### 6. GitHub prerelease 从 tag 构建，不上传本机产物

package version 改为 `0.1.0-alpha.1` 且保持 `private: true`。release workflow 只响应精确 tag `v0.1.0-alpha.1`，校验 tag 与 package version 一致，然后在干净 GitHub runner 上执行 frozen install、完整工程门禁、严格 OpenSpec、pack 内容检查、临时目录安装、onboarding CLI smoke、MCP Mock probe 和 rc.8 clean-profile bundle/runtime probe。

workflow 从同一次 `pnpm pack` 产出 `.tgz`，生成包含 basename 与小写 hex digest 的 SHA256 文件，并通过 GitHub CLI 以最小 `contents: write` 权限创建 prerelease。release body 使用仓库中的版本化说明，包含支持矩阵、安装、校验、升级和回滚。任何 gate 失败都不得创建或更新 release；workflow 不使用本机已有 tarball、token 文件或真机证据。

## Risks / Trade-offs

- [Appium CLI 参数在后续主版本变化] → 固定当前 Appium 2/3 支持的 address/port/base-path 子集，doctor 记录版本；升级通过独立兼容 change。
- [端口预检与 spawn 存在竞态] → spawn/ready 失败映射为冲突或提前退出，只清理保存的 child，不扫描占用者。
- [SIGKILL 仍可能留下 Appium 自己创建的下游资源] → 正常顺序先删除 provider session再关闭 child；崩溃恢复仍明确留给后续 hardening。
- [Doctor 在不同平台缺少命令] → 用 skipped/manual/blocked 区分适用性，不把 iOS-only 缺口阻断 Android-only 目标。
- [配置模板被误认为已授权真机读取] → 所有 target 默认 `mock-only`；真机 screen policy 和 provisioning 必须由用户在生成后显式修改。
- [GitHub prerelease 被当作稳定兼容承诺] → 版本使用 alpha、release notes 标注 developer preview、固定 Harness rc.8 和已验证设备矩阵。

## Migration Plan

1. 增加配置字段、doctor/config renderer、managed Appium lifecycle 与确定性测试，external 默认保持现有行为。
2. 增加 onboarding bin、包内容与文档，先从本地 tarball完成 clean install、DSH/MCP Mock 和 managed fake-Appium 验收。
3. 将版本切到 `0.1.0-alpha.1`，增加 release notes/workflow，执行全部仓库门禁。
4. 合并并确认 main CI 绿色后创建 `v0.1.0-alpha.1` tag；只允许 workflow 生成 GitHub prerelease。
5. 回滚时删除 prerelease/tag（仅在发布错误且获得明确授权时）、恢复上一 commit 或继续使用原 `0.1.0` 本地 tarball；用户侧可移除 DSH plugin/Codex MCP 注册并停止 managed runtime。

## Open Questions

无阻断开发的问题。公共 npm、签名制品、SBOM、自动安装依赖和跨进程 orphan recovery 均保持在后续独立 change。
