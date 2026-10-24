## ADDED Requirements

### Requirement: 持久化 iOS WDA 签名默认值

插件 SHALL 通过 schema-backed 配置接受 iOS WDA 的 Team ID、签名标识、唯一 WDA bundle ID、可选 xcconfig 路径及显式 provisioning 授权，并仅在创建 iOS Appium session 时把已配置且未被请求覆盖的值映射为对应的 Appium capabilities。个人 Team ID、设备 UDID、证书名称、密码和本机绝对路径 MUST NOT 进入仓库默认配置或示例实值。

#### Scenario: 使用 DSH profile 中的持久化配置

- **WHEN** 用户在自己的 DSH profile patch 中配置 iOS WDA 签名默认值，并以不含同名 WDA capabilities 的 iOS 请求启动镜像
- **THEN** 插件 SHALL 把持久化值合并到 Appium session 请求
- **AND** 工具结果、Viewer 状态和插件日志 MUST NOT 回显这些值或完整 capabilities

#### Scenario: 单次请求覆盖持久化默认值

- **WHEN** iOS 启动请求显式提供某个 WDA capability
- **THEN** 请求值 SHALL 覆盖对应的持久化默认值
- **AND** 未被请求覆盖的其他持久化默认值仍 SHALL 生效

#### Scenario: 非 iOS provider 不受影响

- **WHEN** 用户启动 Mock 或 Android Appium session
- **THEN** 插件 MUST NOT 注入任何 iOS WDA 签名 capability

### Requirement: Apple Developer 状态变更必须显式授权

插件 MUST 默认禁止自动 provisioning 和设备注册。只有用户在个人 DSH profile 配置或单次请求中显式启用设备注册授权时，插件才 SHALL 向 Appium 传递 `appium:allowProvisioningDeviceRegistration=true`；该授权的外部副作用必须在配置说明和运行前诊断中可见。

#### Scenario: 默认启动不修改 Apple Developer 状态

- **WHEN** 用户未显式启用 provisioning/device registration 授权
- **THEN** 插件 MUST NOT 注入 `appium:allowProvisioningDeviceRegistration=true`
- **AND** profile 缺失或设备未注册时 SHALL 失败并给出人工修复建议，而不是静默扩权

#### Scenario: 用户显式启用自动 provisioning

- **WHEN** 用户明确启用设备注册授权并启动 iOS 真机 session
- **THEN** 插件 SHALL 把授权映射到 Appium capability
- **AND** 诊断结果 SHALL 提示 Xcode 可能更新 provisioning profile 或在 Apple Developer 账户中注册设备

### Requirement: 可审计的 iOS WDA 启动预检

插件 SHALL 提供可独立调用的紧凑预检结果，用于检查 macOS/Xcode、Appium XCUITest driver、连接的物理 iOS 设备、必要配置和匹配的开发签名身份。执行 `security`、`xcrun`、`xcodebuild` 或 Appium host command 的诊断 MUST 由独立配置显式开启，并通过可注入的主机命令边界实现。

#### Scenario: 主机签名诊断未授权

- **WHEN** 用户调用 iOS WDA 预检但未开启主机签名诊断
- **THEN** 预检 SHALL 返回 `disabled` 和启用方法
- **AND** MUST NOT 执行任何主机命令

#### Scenario: 诊断发现配置或签名缺口

- **WHEN** 主机签名诊断已授权且 Team/bundle 配置、开发签名身份、Xcode、XCUITest driver 或连接设备任一项缺失
- **THEN** 预检 SHALL 返回稳定的错误代码、布尔检查项和下一步建议
- **AND** MUST NOT 返回原始设备 UDID、Team ID、证书名称、私钥信息、完整命令输出或完整 capabilities

#### Scenario: 诊断满足启动前提

- **WHEN** 主机签名诊断已授权且所有可自动验证的启动前提满足
- **THEN** 预检 SHALL 返回 `ready`
- **AND** SHALL 明确把设备端 Developer Mode、UI Automation 与首次信任确认列为需要人工确认的边界

### Requirement: WDA 签名失败必须可执行地解释

插件 SHALL 保留 Appium session 创建失败，并把已知的 WDA `xcodebuild` 65、provisioning profile 缺失、签名身份无效和设备代码签名拒绝映射为稳定诊断类别与修复路径；未知错误 MUST 保留经过脱敏的原始 Appium 摘要。

#### Scenario: 缺少 provisioning profile

- **WHEN** Appium 报告 WDA bundle 没有匹配的 iOS App Development provisioning profile
- **THEN** 插件 SHALL 分类为 `wda_profile_missing`
- **AND** SHALL 建议配置唯一 WDA bundle ID 后执行一次性手动签名，或显式启用自动 provisioning

#### Scenario: 签名身份不可用

- **WHEN** Xcode 或设备报告开发证书无私钥、已过期或签名身份不再有效
- **THEN** 插件 SHALL 分类为 `wda_signing_identity_invalid`
- **AND** SHALL 建议在 Xcode Accounts/Keychain 中修复对应 Team 的 Apple Development 身份后重试

### Requirement: 真机验收不得由 Mock 或假服务器替代

iOS 真机验收 SHALL 使用物理设备和真实 Appium/XCUITest/WebDriverAgent 链路，并记录 session 创建、PNG 首帧、安全坐标动作、停止以及插件自有 session 清理证据。Mock、模拟器或假 W3C 服务器结果 MUST NOT 被报告为该验收通过。

#### Scenario: iOS 真机 smoke 通过

- **WHEN** 一台已信任并完成 WDA 签名的物理 iPhone 在线
- **THEN** 插件 SHALL 完成 `start → frame → safe action → stop`
- **AND** 首帧 SHALL 是非空 PNG，状态 SHALL 记录动作，停止后插件自有 Appium session SHALL 被删除

#### Scenario: 外部签名状态阻塞验收

- **WHEN** 真机启动被 Apple Developer provisioning、设备注册或证书私钥阻塞
- **THEN** 验收 MUST 保持未通过
- **AND** 报告 SHALL 区分仓库测试通过项与需要用户授权或人工修复的外部签名状态
