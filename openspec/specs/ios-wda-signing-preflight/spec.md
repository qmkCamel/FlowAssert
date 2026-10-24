# ios-wda-signing-preflight Specification

## Purpose
定义 iOS WebDriverAgent 签名配置、只读预检、实际启动错误分类和安全诊断边界，避免把本机证书或描述文件检查通过误报为开发账号可用、在线签名成功或真机已经就绪。

## Requirements

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

插件 SHALL 提供可独立调用的紧凑预检结果，用于检查 macOS/Xcode、Appium XCUITest driver、连接的物理 iOS 设备、必要配置和匹配的开发签名身份。执行 `security`、`xcrun`、`xcodebuild` 或 Appium host command 的诊断 MUST 通过可注入的主机命令边界，并且必须满足以下授权之一：个人 profile 中独立开启持久诊断，或 loopback Viewer 中用户显式点击后签发的单次、短期、仅限连接助手的诊断授权。Viewer 单次授权 MUST NOT 持久化、传递给 MCP/Harness 工具或允许非诊断副作用。

#### Scenario: 主机签名诊断未授权

- **WHEN** 用户调用 iOS WDA 预检但未开启个人 profile 授权，也没有有效的 Viewer 单次授权
- **THEN** 预检 SHALL 返回 `disabled` 和启用方法
- **AND** MUST NOT 执行任何主机命令

#### Scenario: Viewer 用户授权一次检查

- **WHEN** 用户在 loopback Viewer 显式点击检查，且 same-origin 请求创建一个未过期的单次诊断授权
- **THEN** 预检 SHALL 只为该次助手检查执行有界只读主机命令
- **AND** 授权 MUST 在检查开始时消费，不能用于 MCP、第二次检查或 session 副作用

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

### Requirement: Viewer 本次签名输入必须短期使用且不得扩权

当个人 profile 和独立本机 Viewer 配置都缺少 Team ID 或唯一 WDA bundle ID 时，连接助手 SHALL 接受格式受限的本次签名输入，并默认仅将其作为本次预检与 session capabilities 的内存覆盖。只有用户显式选择“记住此电脑”时，服务端才可把通过 allowlist 校验的 Team/bundle 写入独立本机 Viewer 配置。该入口 MUST NOT 接受 Apple ID、密码、私钥、证书内容、任意 xcconfig 路径或 provisioning/device-registration 授权，也 MUST NOT 写入 DSH profile、浏览器存储、日志或共享状态。

#### Scenario: 输入合法的本次 Team 与 bundle

- **WHEN** 用户在本地 Viewer 输入符合允许字符与长度限制的 Team ID 和 WDA bundle ID
- **THEN** 预检和随后的同一次连接 SHALL 在服务端内存中使用这些覆盖值
- **AND** 对外结果只 SHALL 表示字段已提供，不得回显实际值

#### Scenario: 输入敏感或越权字段

- **WHEN** 请求包含 Apple 凭据、路径、证书内容、自动注册授权或未知签名字段
- **THEN** 系统 MUST 在执行主机命令或创建 session 前拒绝整个请求
- **AND** MUST NOT 部分应用、持久化或记录这些字段

#### Scenario: 本次连接结束

- **WHEN** session 创建成功、失败、取消或助手上下文过期
- **THEN** 系统 SHALL 丢弃本次签名覆盖及其内存引用
- **AND** 未显式选择“记住此电脑”的后续连接 SHALL 重新使用个人 profile/本机 Viewer 默认值或要求重新输入

#### Scenario: 显式保存签名默认值

- **WHEN** 用户提供合法 Team/bundle 并在连接请求中设置 `rememberOnThisMac=true`
- **THEN** 服务端 SHALL 在 spawn/session 前把字段保存到权限收紧的本机 Viewer 配置
- **AND** 该动作 MUST NOT 改写 DSH profile、保存 provisioning 授权或向浏览器回显实际值

### Requirement: 只读预检必须标明 WDA 运行状态未验证

已授权的 iOS WDA 预检 SHALL 将 Xcode、签名身份和本地 profile 的检查结果与真机 WDA 运行状态分开呈现。即使本机检查全部通过，结果也 MUST 标明 WDA 运行状态尚未验证，并将 Xcode Accounts 对应 Team 的登录状态列为人工确认项。只读预检 MUST NOT 为验证运行状态而启动 WDA、创建 Appium session、生成 profile 或访问 Apple 账号凭据。

#### Scenario: 本机材料齐全但 WDA 尚未启动
- **WHEN** 已授权预检发现 Xcode、驱动、设备、签名身份和匹配 profile 都可用
- **THEN** 系统 SHALL 报告本机前提就绪、WDA 运行状态未验证和 Xcode 账号人工确认项
- **AND** MUST NOT 报告“WDA 已运行”或修改 Apple Developer 状态

#### Scenario: 预检未授权
- **WHEN** 主机诊断未授权
- **THEN** 系统 SHALL 保持不执行主机命令的行为
- **AND** SHALL 报告 WDA 运行状态未验证，不把缺少诊断授权误写为签名失败

### Requirement: 缺少已登录开发账号必须被稳定分类

当受控的 WDA 启动收到明确表示当前签名 Team 没有可用 Xcode Accounts 登录的错误时，系统 SHALL 返回独立稳定错误码和指向 Xcode Settings → Accounts 的操作建议。该分类 MUST NOT 从本地签名身份或 profile 存在与否推断，不得返回 Team ID、账号、设备标识、完整命令输出或主机路径。

#### Scenario: Xcode 报告当前 Team 没有已登录账号
- **WHEN** WDA 构建失败的上游错误明确指出对应 Team 没有登录的 Xcode 账号
- **THEN** 系统 SHALL 返回 `wda_developer_account_unavailable` 和登录对应 Apple 开发账号后重试的建议
- **AND** 对外结果 MUST NOT 包含账号邮箱、Team ID 或原始上游日志

#### Scenario: 只有本地 profile 缺失
- **WHEN** 只读预检只发现本地 profile 缺失，且没有上游账号错误
- **THEN** 系统 SHALL 保留 `wda_profile_missing` 或原有静态预检提示
- **AND** MUST NOT 断言 Apple 账号未登录
