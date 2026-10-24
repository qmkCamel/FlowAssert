## Context

M1 的 Appium provider 已能创建/附着 W3C session，但 iOS 真机所需的 WDA 签名参数完全依赖每次请求的原始 capabilities。2026-08-17 的物理 iPhone 测试证明设备、Appium 3.2.0 与 XCUITest driver 10.19.1 均已进入真实启动链路，最终失败在本机没有匹配 WDA bundle 的 provisioning profile，且设备拒绝无效签名。Appium 官方提供 `xcodeOrgId`、`xcodeSigningId`、`xcodeConfigFile`、`updatedWDABundleId` 和 `allowProvisioningDeviceRegistration` 等能力；其中最后一项会让 `xcodebuild` 同时获得 provisioning update 与设备注册权限，因此不能作为默认值。

现有安全边界要求主机命令发现保持显式，DSH adapter 保持薄，核心逻辑可被未来 MCP adapter 复用。个人 Team、设备和证书信息属于本机配置，不属于仓库或 agent 结果。

## Goals / Non-Goals

**Goals:**

- 让 WDA 签名默认值能持久化在用户自己的 DSH profile patch，并以确定的优先级合并到 iOS Appium session。
- 在启动前给出脱敏、可测试的签名预检结果，提前区分缺配置、缺设备、缺证书和缺 profile。
- 保持 Apple Developer provisioning/device registration 默认无副作用，只有显式授权才向 Appium 传递相关 capability。
- 把一次性手动签名、自动 provisioning 和预装 WDA 三条运维路径写入仓库文档，并以物理真机闭环作为最终验收。

**Non-Goals:**

- 不代管 Apple ID、私钥、keychain 密码或 Developer Portal 凭据。
- 不绕过 Xcode/Apple 的签名、设备注册或 Developer Mode 安全要求。
- 不在本变更中实现 WDA MJPEG、高帧率媒体、Android scrcpy 或多 session。
- 不把任何本机实值写入 `cordis.patch.yml`、测试夹具、截图、日志或 OpenSpec。

## Decisions

### 使用显式的 schema 字段，而不是通用 capabilities blob

新增以下扁平配置，空值表示不注入：

- `iosWdaXcodeOrgId`：默认空字符串；
- `iosWdaXcodeSigningId`：默认 `Apple Development`；
- `iosWdaUpdatedBundleId`：默认空字符串；
- `iosWdaXcodeConfigFile`：默认空字符串；
- `iosWdaAllowProvisioningDeviceRegistration`：默认 `false`；
- `allowHostSigningDiagnostics`：默认 `false`。

扁平字段延续现有配置风格，便于 Schemastery 校验和 DSH profile patch 覆盖。拒绝只提供 `defaultCapabilitiesJson`：它会混合平台、难以描述副作用，也更容易把云端凭据带入配置和日志。

### 在 Appium provider 边界合并 iOS 默认值

`AppiumProvider` 接收经过验证的 iOS WDA defaults，在 `platformName` 为 iOS 且创建新 session 时合并 capabilities。优先级为：单次请求 capability > 持久化显式字段 > Appium 自身默认值。Android、附着既有 session 和 Mock 不执行合并。

Provider 只构造发送给 Appium 的内存对象，不把合并后的 capabilities 写入状态或错误。DSH 工具和 Viewer 继续只调用 `MirrorService`，避免 adapter 持有签名逻辑。

### 预检作为可复用核心服务，DSH 工具只做适配

新增 `IosWdaPreflightService` 与可注入的 `HostCommandRunner`。服务生成稳定的检查项和错误码；DSH 注册紧凑工具 `mobile_mirror_ios_preflight`，未来 MCP adapter 可复用同一服务。工具不接收或返回原始 UDID/Team/证书值，目标只确认是否存在符合配置的设备与身份。

当 `allowHostSigningDiagnostics=false` 时，服务在执行任何命令前返回 `disabled`。开启后才允许调用受控的 `xcodebuild -version`、`xcrun`、`security find-identity`、Appium status/driver doctor，并只保留布尔值、数量、版本和稳定错误码。设备端 Developer Mode、UI Automation 与信任弹窗没有可靠、通用的只读接口，结果明确标为人工确认项。

### provisioning/device registration 保持单独、默认关闭

`iosWdaAllowProvisioningDeviceRegistration=true` 映射到 Appium 同名 capability。XCUITest driver 10.19.1 会因此给 `xcodebuild` 同时增加 `-allowProvisioningUpdates` 和 `-allowProvisioningDeviceRegistration`。Viewer 与工具在启动前沿用现有连接进度，并显示这可能修改 Apple Developer profile/设备注册的提示。

不尝试自动修改 Xcode project 或调用 Developer Portal API。替代方案是默认开启自动 provisioning，但这会扩大外部状态变更且可能消耗设备注册名额，因此拒绝。

### 持久化位置是用户 profile patch，不是仓库 bundle patch

文档提供带占位符的 `~/.dsh/profiles/<profile>/cordis.patch.yml` 示例，通过 id-targeted config override 写入个人配置。仓库 `cordis.patch.yml` 只保留安全默认值，不出现个人实值。单次 capabilities 继续适合临时验证，profile patch 作为长期配置。

推荐路径是运行 `appium driver run xcuitest open-wda`，在 Xcode 中为 `WebDriverAgentRunner` 选择 Team、唯一 bundle ID 和自动签名，并对目标物理设备执行一次 Product > Test；成功后把同一 Team/bundle 信息写入 profile patch。自动 provisioning 路径必须由用户显式开启；已有稳定 WDA 的团队可使用 Appium 的 prebuilt/preinstalled 能力，但不在本变更中代管制品。

### 错误分类不依赖泄露完整 Xcode 日志

预检优先发现本地 profile/identity 缺口；Appium 失败后只对脱敏摘要做分类。稳定错误码至少包括：

- `host_diagnostics_disabled`；
- `xcode_unavailable`；
- `xcuitest_driver_unavailable`；
- `ios_device_unavailable`；
- `wda_signing_config_incomplete`；
- `wda_profile_missing`；
- `wda_signing_identity_invalid`；
- `wda_device_trust_or_developer_mode_required`；
- `wda_unknown_start_failure`。

未知错误保留有限长度、经 Team/UDID/路径脱敏的 Appium message。拒绝默认打开 `showXcodeLog`：Appium server 自身可能打印完整 capabilities 和设备标识；文档仅把它作为本地临时诊断步骤。

## Risks / Trade-offs

- [预检通过不等于 WDA 一定能安装] → 把 Developer Mode、UI Automation、设备信任和 Apple 服务端状态列为人工边界，最终仍要求真机 smoke。
- [解析 provisioning profile 与证书格式随 Xcode 演进] → 通过命令 runner、fixture 和稳定错误码隔离解析细节；未知格式降级为人工检查，不伪报 ready。
- [自动 provisioning 修改外部 Apple Developer 状态] → 默认关闭、schema 描述副作用、启动前再次提示，并允许单次请求覆盖为 false。
- [配置字段增加 DSH 表面积] → 仅添加 iOS 专用字段，Android/Mock 不读取；保持请求 capability 兼容。
- [工具诊断可能暴露本机身份] → 默认禁用主机命令，结果只含布尔值/数量/错误码，测试覆盖脱敏。
- [WDA/driver 升级使已有签名失效] → 文档要求升级后重跑预检和真机 smoke，验证记录固定 Appium/XCUITest/WDA 版本。

## Migration Plan

1. 以安全默认值发布新 schema 和 capability 合并逻辑，现有用户行为不变。
2. 增加预检服务/工具、脱敏测试和 Appium 错误分类。
3. 增加 DSH profile patch 示例、手动/自动/预装 WDA 文档与安全说明。
4. 用户在本机完成一次 WDA 签名或显式授权自动 provisioning，再写入个人 profile patch。
5. 使用物理 iPhone 完成 `start → PNG frame → safe action → stop`，记录版本与 session 清理证据。

回滚时删除个人 profile patch 中新增字段并降级插件即可；默认值不会修改 Apple Developer 状态，也没有仓库数据迁移。

## Open Questions

无。实现阶段以 XCUITest driver 10.19.1 的 capability 与命令行为为固定兼容基线，升级 driver 时重新验证。
