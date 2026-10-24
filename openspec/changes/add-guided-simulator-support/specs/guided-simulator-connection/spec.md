## ADDED Requirements

### Requirement: 显式模拟器选择与只读发现
系统 SHALL 在 Viewer 中提供真机和模拟器选择，默认真机；模拟器发现 SHALL 仅接受本机已在线 Android emulator 和已启动可用 iOS Simulator。检查 MUST NOT 启动、安装、擦除或关闭设备。

#### Scenario: 混合设备列表
- **WHEN** 用户选择模拟器并执行检查
- **THEN** 列表只包含该平台运行中的本机模拟器，排除真机、TCP、离线、不可用及其他 Apple 平台

#### Scenario: 模拟器未启动
- **WHEN** 没有可用运行中的模拟器或检查失败
- **THEN** 报告为 blocked 并提示用户启动模拟器或修复环境后重试

### Requirement: 模拟器会话隔离
系统 SHALL 把设备类型和身份绑定服务端检查上下文并在连接前重查。iOS 模拟器 MUST NOT 要求 Apple Team ID、执行真机签名诊断、继承真机签名默认值或开启设备注册。结果 MUST NOT 被表述为真机验收。

#### Scenario: 无签名 iOS 模拟器
- **WHEN** 本机 Xcode、Appium、XCUITest 和启动中的 iOS Simulator 可用
- **THEN** 用户可连接当前屏幕或 Settings，无需签名字段，复用现有 MirrorService 会话

#### Scenario: 检查后设备下线或类型切换
- **WHEN** 用户切换设备类型或原设备在连接前下线
- **THEN** 原报告失效或连接被拒绝，不回退到另一设备

#### Scenario: 检查期间操作其他控件
- **WHEN** 模拟器检查超过 300ms
- **THEN** Viewer 显示局部进度，其他控件仍可交互，迟到结果不覆盖新的选择
