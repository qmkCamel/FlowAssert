## MODIFIED Requirements

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

## ADDED Requirements

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
