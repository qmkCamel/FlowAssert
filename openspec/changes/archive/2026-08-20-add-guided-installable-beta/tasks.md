## 1. 配置与公共契约

- [x] 1.1 在共享配置中增加 `appiumRuntimeMode` 与 `appiumExecutablePath`，保持 external/空路径默认值，并为 managed 的绝对可执行文件与 loopback URL 增加 fail-closed 校验。
- [x] 1.2 同步 standalone MCP config key allowlist、Cordis bundle 默认配置、DSH schema/示例和未知字段拒绝测试。
- [x] 1.3 定义 managed Appium phase、稳定错误码与脱敏公共 state/output schema，确保不暴露 executable、URL 端口、参数或命令输出。
- [x] 1.4 更新 DSH/MCP contract 与 config 单测，证明现有 external、Mock 和八项工具输入保持兼容。

## 2. Managed Appium 生命周期

- [x] 2.1 实现可注入的 `ManagedAppiumRuntime` 接口和 external no-op，解析 loopback Appium URL 并生成固定 address/port/base-path 参数。
- [x] 2.2 使用 `spawn(shell=false)` 实现单 child/in-flight start、有界输出、spawn 前 listener 冲突探测和 `/status` ready 轮询。
- [x] 2.3 实现提前退出、timeout、取消、端口冲突和无效 executable 的稳定错误映射，所有失败路径只清理本次保存的 child handle。
- [x] 2.4 实现幂等 stop：先 SIGTERM 等待 2 秒，必要时只对同一 child SIGKILL，并禁止进程表扫描、pkill 或按端口删除未知资源。
- [x] 2.5 把 Appium lifecycle 注入 `MirrorService`/`LocalDeviceRuntime`：Appium start 前 lazy ensureReady，stop/start failure/dispose 时按媒体 → provider session → child 关闭。
- [x] 2.6 managed 模式在 spawn 前拒绝 attached `sessionId`；external 模式继续允许 owned/attached session 且永不终止外部 Appium。
- [x] 2.7 把 managed phase/owned/error 投影到 status、MCP progress 与 Viewer 连接进度，慢启动时保留上一画面并保持 status/theme/stop 控件响应。
- [x] 2.8 增加 fake process/status server 单测，覆盖 ready、慢启动、listener 冲突、提前退出、取消、provider 失败、重试、并发 stop/dispose、SIGKILL 与 external no-op。
- [x] 2.9 增加 Viewer E2E 慢 managed Appium 场景，保留并人工检查最终截图，断言进度可见、其他控制可交互、失败后旧结果仍可用。

## 3. Doctor 服务

- [x] 3.1 定义 versioned `DoctorReport`、check id/status/code、overall 与 human/JSON 共用 canonical model。
- [x] 3.2 实现 Node、Appium endpoint 与显式 Appium executable 只读检查，解析公开版本/ready 状态并丢弃原始响应。
- [x] 3.3 实现 Appium installed-driver 检查，按 Android/iOS target 验证 UiAutomator2/XCUITest，输出稳定计数/版本而非原始 plugin 列表。
- [x] 3.4 实现 Android ADB/version/device-count 与显式 scrcpy 4.1 检查，只汇总 online/offline/unauthorized 数量，不输出设备标识或路径。
- [x] 3.5 实现 iOS Xcode/xcrun/device-count 检查，并复用 `IosWdaPreflightService` 的授权、分类和脱敏；未授权签名诊断时返回 manual。
- [x] 3.6 为所有 host command 增加 timeout/abort/1 MiB 上限，确保 doctor 不下载、安装、启动、修复或修改主机/设备状态。
- [x] 3.7 实现 overall 与 exit code 规则：blocked=2，ready/warning/manual=0，参数/内部失败=1。
- [x] 3.8 增加完全注入的 doctor 测试矩阵，覆盖 Android ready、iOS manual、缺失命令、driver 缺失、scrcpy 版本错误、Appium unreachable、超时和敏感输出脱敏。

## 4. 安全配置生成与 CLI

- [x] 4.1 实现完整 DSH YAML renderer，包含全部 schema 字段与安全默认值，Android/iOS target 只输出公开占位符且保持 `mock-only`。
- [x] 4.2 实现 Standalone MCP JSON renderer，并用生产 parser round-trip 验证默认 Mock/loopback/external Appium 与所有高风险授权关闭。
- [x] 4.3 实现 Codex MCP 注册命令 renderer，要求绝对 package/config path、执行 shell-safe quoting，并始终引用同一发布包的 stdio MCP bin。
- [x] 4.4 实现可注入 IO 的 `runOnboardingCli()` 参数解析、help/version、doctor/config 命令和 stdout/stderr/exit code 边界；未知参数不得执行 host command。
- [x] 4.5 新增薄 `flowassert` bin、library export、构建入口与 package files/bin 声明，保持 MCP bin 与 DSH 默认 export 不变。
- [x] 4.6 增加 CLI/config tests，证明输出确定性、无文件写入、无宿主 SDK import、路径安全转义、错误不含 stack/path，并从 built bin 验证 help/version/config。

## 5. 发布包与安装验收

- [x] 5.1 将 package version 设为 `0.1.0-alpha.1` 且保持 `private: true`，同步 lockfile、package version contract、README 示例和 tarball 文件名。
- [x] 5.2 扩展 pack contract，要求 onboarding bin/export、Beta 安装/回滚文档和 release notes 存在，并拒绝配置、host report、凭据、真机 capability 与临时图片。
- [x] 5.3 增加从单次 `pnpm pack` 产物执行的 clean-prefix install probe，验证 checksum 可复算、CLI help/version/config、MCP built-bin Mock 闭环与退出清理。
- [x] 5.4 增加 release-runner managed Appium smoke：安装固定 Appium 工具到临时 prefix，传入绝对 executable，验证 doctor、ready、stop 和 listener 释放，并明确不声称物理设备通过。
- [x] 5.5 增加精确 `@deepseek-ai/dsh` rc.8 临时 HOME/profile probe，从 tarball 安装 bundle，验证 config dump、八项工具、Native/Code Mock observation/action 与 dispose。
- [x] 5.6 编写版本化 `0.1.0-alpha.1` release notes，覆盖支持矩阵、SHA256 校验、DSH 安装/升级、MCP/Codex 配置、managed/external Appium、已知限制和安全回滚。

## 6. GitHub prerelease 自动化

- [x] 6.1 新增仅响应精确 `v0.1.0-alpha.1` tag 的 release workflow，使用 Node/pnpm 固定版本、frozen install 和最小 `contents: write` 权限。
- [x] 6.2 在创建 Release 前校验 tag/package/CLI/tarball 版本一致，并运行 `pnpm check`、Viewer E2E、build、pack、strict OpenSpec 与全部 clean-install/runtime probes。
- [x] 6.3 从同一 clean runner tarball 生成规范 SHA256 清单，复算通过后使用 GitHub CLI 一次性创建 prerelease 并上传 `.tgz`、checksum 与版本化说明。
- [x] 6.4 增加 workflow/脚本 contract tests，证明任一 gate 失败时不会创建/更新 Release、上传部分 asset 或执行 npm publish。

## 7. 文档、安全与产品状态

- [x] 7.1 更新中英文 README，增加 prerelease 下载/校验、onboarding CLI、doctor、配置生成、managed Appium 使用和 external 默认兼容说明。
- [x] 7.2 新增 Beta 安装与回滚指南，分别给出 DSH、通用 MCP、Codex 的复制命令，并明确配置文件、attached session 和系统 Appium/driver 不属于回滚删除范围。
- [x] 7.3 更新 architecture/ADR/security，记录 CLI 与 agent 的隔离、managed process ownership、loopback/固定参数、doctor 脱敏、失败清理和 crash orphan 边界。
- [x] 7.4 更新 product-shape、milestones 与 validation，区分 deterministic、clean package、managed host runtime、DSH/MCP/Codex、物理 Android/iOS 和 GitHub 发布证据层。

## 8. 完整验证与发布

- [x] 8.1 运行 `pnpm check`，确认 typecheck/contracts/Vitest 包含新增 doctor、renderer、managed lifecycle 和 package/release contracts。
- [x] 8.2 运行 `pnpm test:e2e` 并检查 retained Viewer screenshot，确认慢 managed startup 进度、并发控件和失败保留行为。
- [x] 8.3 运行 `pnpm build`、`pnpm pack:check`、clean-prefix/managed-Appium/DSH rc.8/MCP probes、`git diff --check` 和严格 OpenSpec 校验。
- [x] 8.4 对 staged diff 与 tarball 做敏感信息扫描，确认没有本机绝对路径、设备/签名标识、token、host report、capabilities 或未声明发布文件。
- [x] 8.5 提交并推送实现，等待 main CI 绿色；只有远端 commit 与全部 gates 对齐后创建并推送 `v0.1.0-alpha.1` tag。
- [x] 8.6 等待 release workflow 完成，核对 GitHub prerelease 的 commit/tag、三类 asset、SHA256、安装/回滚说明和 clean-runner 日志；失败时不得手工上传未验证替代物。
