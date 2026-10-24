## Why

当前插件已经通过 DSH、MCP、Android/iOS 真机和双端低延迟媒体验收，但安装仍依赖用户手工定位包、准备 Appium/驱动并拼装宿主配置，仓库也没有可校验、可回滚的正式预发布制品。需要把现有开发者预览能力收敛为一个安全、可诊断、可重复安装的 Beta 入口，降低首次使用失败率，同时保持外部命令发现与设备状态变更显式可控。

## What Changes

- 新增宿主侧 `flowassert` CLI，提供只读 `doctor`，检查 Node、Appium、Appium driver、ADB、scrcpy、Xcode、WDA/签名和设备连接状态，并只输出脱敏的稳定检查项与下一步建议。
- 新增 DSH 与通用 MCP 的确定性配置输出，默认生成 Mock/loopback/禁止主机发现与签名变更的安全模板；真机字段只使用占位符或用户显式输入，不读取或回显个人凭据。
- 增加显式配置的 managed Appium 模式：只运行用户指定的绝对 executable 和固定参数，保存精确子进程句柄，等待 `/status` ready，并在 runtime 正常关闭时只终止自己创建的 Appium 进程。
- 保留 external Appium 默认模式；不得搜索 PATH、自动安装/升级 Appium 或 driver，不得接管已有 listener，也不得在失败清理时扫描或终止其他 Appium 进程。
- 将插件版本设为 `0.1.0-alpha.1`，增加 GitHub prerelease 工作流，发布预构建 `.tgz`、SHA256 清单、安装/升级/回滚说明，并在上传前验证 tarball 内容和 clean-profile Mock 闭环。
- 保持 `private: true`，本 change 不发布公共 npm 包；GitHub prerelease 是唯一新增的分发渠道。

## Capabilities

### New Capabilities

- `local-beta-onboarding`: 定义只读 doctor、DSH/MCP 安全配置输出、预发布制品、完整性校验与回滚契约。
- `managed-appium-runtime`: 定义显式 Appium executable、ready 等待、进程所有权、失败保留和精确关闭行为。

### Modified Capabilities

- `flowassert`: 安装验收从仓库本地 pack 扩展到带版本与校验清单的 GitHub prerelease tarball，并保持 rc.8 clean-profile 契约。
- `host-neutral-mcp-adapter`: 发布包新增通用 onboarding CLI，生成的 MCP command/args 必须继续启动同一个 stdio adapter，且不得引入宿主专属运行时代码。

## Impact

- 新增 CLI/doctor/config renderer、managed Appium process owner、发布与 clean-install probe；调整 `package.json`、bin/exports、构建和 CI/release workflow。
- `LocalDeviceRuntime` 获得可选 managed Appium 生命周期，但 `MirrorService`、Appium provider、DSH/MCP 八项工具、Viewer loopback 与 observation 安全边界保持不变。
- doctor 会执行用户显式请求的只读本机命令；managed Appium 会创建本机子进程，但不会安装软件、修改设备设置、自动 provisioning、注册设备或启动真机 session。
- GitHub Release 是外部发布状态；只有 tag、完整门禁、制品校验和 clean-profile 验收全部成功后才允许创建 prerelease。
