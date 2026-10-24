## MODIFIED Requirements

### Requirement: 平台连接检查必须由本地用户显式发起

系统 SHALL 仅在 loopback Viewer 收到匹配 Origin、用户明确选择 Android 或 iOS 的检查请求后执行相应平台主机诊断，并按本次操作和功能要求生成预检计划。Android SHALL 通过可注入、有超时/输出上限的边界检查 Appium/UiAutomator2、ADB 和物理设备授权；iOS SHALL 检查 Appium/XCUITest、Xcode、物理设备和 WDA 签名前提。页面加载、报告阅读、Mock 运行、状态轮询、MCP/Harness 工具注册和插件启动 MUST NOT 触发这些诊断命令。独立 Viewer 和 MCP runtime MUST NOT 因存在 DSH 安装而自动检查 DSH。

#### Scenario: 打开 Viewer 不执行主机诊断

- **WHEN** 用户仅打开 Viewer、阅读历史报告或读取镜像状态
- **THEN** 系统 MUST NOT 搜索 Appium/ADB、调用 Xcode/xcrun/security、执行 DSH 或枚举设备
- **AND** 页面 SHALL 提供先选平台再点击的设备检查入口，而非显示未选依赖的错误或“不适用”列表

#### Scenario: 用户发起一次检查

- **WHEN** 用户在 loopback Viewer 点击检查且请求通过 same-origin 校验
- **THEN** 系统 SHALL 执行有界只读检查，并显示动作局部进度、防止同一动作重复提交
- **AND** 超时、取消或失败 MUST NOT 阻塞停止、主题切换和历史读取，旧可用报告及画面 SHALL 保留；完成 SHALL 刷新对应目标状态和真实检查完成时间

#### Scenario: 个人 profile 仍关闭通用 host discovery

- **WHEN** `allowHostDeviceDiscovery=false` 且用户从 Viewer 显式发起一次平台检查
- **THEN** 系统 SHALL 仅为该次 same-origin 助手请求执行所选平台的短期只读发现
- **AND** MUST NOT 修改 profile、启用 MCP/Harness 的设备发现或让授权跨请求复用

#### Scenario: Android 检查不执行 iOS 命令

- **WHEN** 用户选择 Android 并发起连接检查
- **THEN** 系统 SHALL 检查 Appium/UiAutomator2、ADB、在线/未授权设备，并仅按媒体策略检查 scrcpy
- **AND** MUST NOT 调用 Xcode、xcrun、security、DSH 或 WDA 签名检查

#### Scenario: iOS 检查不执行 Android 命令

- **WHEN** 用户选择 iOS 并发起连接检查
- **THEN** 系统 SHALL 检查 Appium/XCUITest、Xcode、物理 iPhone 和获授权的 WDA 签名前提
- **AND** MUST NOT 调用 ADB 或 scrcpy；媒体未要求时不得以 MJPEG 不可用阻止 PNG 路径

## ADDED Requirements

### Requirement: 功能检查不能扩大连接范围或恢复过时状态

Viewer SHALL 区分基础连接与媒体/OCR/AI 恢复/录像的功能检查，保留必需能力及人工确认约束。无关功能 MUST 不触发检查；取消、切换目标或配置修改 SHALL 使当前检查代次失效。浏览器能力检查 SHALL 仅作为本浏览器的可用性提示，不作为服务端权限凭证。

#### Scenario: 可选功能缺失仍可基础连接

- **WHEN** 基础连接前提通过而 preferred 媒体不可用
- **THEN** 页面 SHALL 显示 PNG 降级说明，允许用户按原确认流程连接
- **AND** 选择 required 媒体时 SHALL 单独阻止该要求的连接，不悄悄降级

#### Scenario: 操作中切换平台与失败保留

- **WHEN** 超过 300 ms 的检查进行中用户切换平台，或新检查失败
- **THEN** 旧任务的晚到结果 MUST NOT 恢复原平台可连接状态
- **AND** 上一份可用材料 SHALL 保留并明确标为旧范围，主题/历史等无关操作 SHALL 保持可交互
