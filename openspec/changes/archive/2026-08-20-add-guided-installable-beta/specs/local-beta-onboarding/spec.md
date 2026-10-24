## ADDED Requirements

### Requirement: Onboarding CLI 必须独立于 agent runtime 且可从发布包运行

package SHALL 提供 `flowassert` 可执行入口，支持 `doctor`、`config`、`--help` 和 `--version`。CLI MUST 复用可注入的核心服务，MUST NOT 注册 DSH/MCP 工具、启动 Viewer、创建 Appium session 或依赖 Codex/DSH 宿主进程。

#### Scenario: 从预构建 tarball 运行 CLI

- **WHEN** 用户把 release tarball 安装到一个空的临时 prefix 并执行 `flowassert --version` 与 `--help`
- **THEN** CLI SHALL 返回 package 的精确版本与已支持命令
- **AND** 进程 MUST NOT 打开 Viewer/Appium listener、执行设备发现或修改宿主配置

#### Scenario: CLI 参数无效

- **WHEN** 用户传入未知命令、未知参数、非绝对 package/config path 或不支持的 target/platform
- **THEN** CLI SHALL 以 exit code 1 失败并输出不含 stack/path 内容的使用提示
- **AND** MUST NOT 运行任何 host command 或写入文件

### Requirement: Doctor 必须提供只读、脱敏且可执行的环境报告

`doctor` SHALL 检查当前 Node、Appium endpoint、显式 Appium executable、已安装 Appium driver、ADB、显式 scrcpy、Xcode/xcrun、WDA/签名诊断授权和连接设备。报告 SHALL 提供稳定 schemaVersion、overall、platform 和 checks；每项 check SHALL 只包含稳定 id/status/code、公开版本或计数及下一步建议，MUST NOT 包含设备 ID/名称、Team ID、证书/profile、绝对路径、原始 stdout/stderr、环境变量或 stack。

#### Scenario: Android 环境 ready

- **WHEN** 用户执行 Android doctor，显式 Appium/ADB/scrcpy 前置条件可用、UiAutomator2 已安装且至少一个 Android 设备在线
- **THEN** report SHALL 把对应 required checks 标为 pass 并返回 overall ready
- **AND** 设备结果 SHALL 只包含计数与状态分类，不返回设备标识

#### Scenario: iOS 签名诊断未授权

- **WHEN** 用户执行 iOS doctor 但配置未启用 host signing diagnostics
- **THEN** Xcode/XCUITest 的安全只读检查 MAY 运行，WDA 签名/profile 检查 SHALL 标为 manual 并给出显式授权或 Xcode 手工检查建议
- **AND** doctor MUST NOT 临时绕过授权、访问钥匙串详情或启用 provisioning/device registration

#### Scenario: 依赖缺失或版本不兼容

- **WHEN** required command 缺失、Appium `/status` 不可用、所需 driver 未安装或显式 scrcpy 不是 4.1
- **THEN** 对应 check SHALL 返回稳定 blocked code 与安装/配置建议，overall SHALL 为 blocked，进程 SHALL 返回 exit code 2
- **AND** doctor MUST NOT 下载、安装、升级、启动或修复该依赖

#### Scenario: Human 与 JSON 输出一致

- **WHEN** 同一依赖注入结果分别使用 `--format human` 和 `--format json`
- **THEN** human 输出 SHALL 是同一 canonical report 的确定性投影，JSON SHALL 满足固定 schema
- **AND** 仅有 warning/manual/skipped 时 exit code SHALL 为 0，参数或内部错误 SHALL 为 1

### Requirement: 配置生成必须默认安全并保留用户确认

`config` SHALL 确定性生成完整 DSH YAML patch、Standalone MCP JSON 或可复制的 Codex MCP 注册命令。所有 target MUST 默认使用 Mock、loopback、`mock-only`、external Appium，并关闭 host discovery、signing diagnostics 和 provisioning/device registration；CLI MUST NOT 直接创建、覆盖或修改 DSH/Codex/MCP 配置文件。

#### Scenario: 生成 DSH 配置

- **WHEN** 用户执行 `config --target dsh`
- **THEN** stdout SHALL 包含 schema 可接受的完整 `mobile-mirror` config row，而不是会丢失默认字段的部分 patch
- **AND** 输出 MUST NOT 读取或包含本机 Team、UDID、证书、profile 或现有个人配置

#### Scenario: 生成 MCP 与 Codex 配置

- **WHEN** 用户分别生成 MCP JSON 和 Codex command，并为 Codex 显式提供绝对 package/config path
- **THEN** MCP JSON SHALL 通过 standalone config parser，Codex command SHALL 以 shell-safe 参数引用同一个 stdio MCP bin 与 JSON 文件
- **AND** 生成过程 MUST NOT 注册 server、启动进程或把 continuous media 放入 MCP 配置

#### Scenario: 生成 Android 或 iOS 模板

- **WHEN** 用户选择 Android 或 iOS platform target
- **THEN** 输出 SHALL 只增加该平台需要的公开占位符与说明，screen policy 仍 SHALL 为 `mock-only`
- **AND** 用户 MUST 显式替换路径/签名值并单独授权真实设备发现、图片或外部账号变更

### Requirement: GitHub prerelease 必须可验证、可安装且可回滚

版本 `0.1.0-alpha.1` SHALL 以 GitHub prerelease 分发同一次 clean runner 构建的 `.tgz`、SHA256 清单和版本化 release notes。package MUST 保持 `private: true`，workflow MUST NOT 执行 npm publish；tag、package version、tarball filename、CLI `--version` 和 release 标题 SHALL 一致。

#### Scenario: Tag 触发成功发布

- **WHEN** 精确 tag `v0.1.0-alpha.1` 触发 release workflow 且完整门禁、pack 检查、临时安装、MCP Mock 和 rc.8 clean-profile probe 全部通过
- **THEN** workflow SHALL 以最小写权限创建 prerelease 并上传 tarball、SHA256 文件和安装/升级/回滚说明
- **AND** checksum SHALL 对发布的同一 tarball 生效，release asset MUST NOT 来自开发机或既有 artifact

#### Scenario: 发布门禁失败

- **WHEN** tag/version 不一致、测试失败、tarball 内容不符、clean install/DSH/MCP probe 失败或 checksum 无法复算
- **THEN** workflow MUST 在创建或更新 GitHub Release 前失败
- **AND** MUST NOT 发布部分 asset、npm package 或未验证的替代 tarball

#### Scenario: 用户校验和回滚

- **WHEN** 用户按 release notes 安装或升级 alpha 包
- **THEN** 文档 SHALL 要求先核对 SHA256，并提供 DSH plugin 移除/恢复旧 tarball、Codex MCP remove/重新注册和 managed runtime stop 步骤
- **AND** 回滚 MUST NOT 删除 attached 外部 Appium session、个人配置或系统安装的 Appium/driver
