## ADDED Requirements

### Requirement: 持久化 Android hidden API policy 兼容默认值

插件 SHALL 通过 schema-backed 配置持久化 Android UiAutomator2 的 hidden API policy 错误处理策略，并仅在创建 Android Appium session 时把未被请求覆盖的值映射为 `appium:ignoreHiddenApiPolicyError`。单次请求 capability MUST 拥有最高优先级。

#### Scenario: 默认兼容受限 OEM 设备

- **WHEN** 用户创建 Android Appium session 且请求未提供 `appium:ignoreHiddenApiPolicyError`
- **THEN** 插件 SHALL 注入配置中的兼容默认值
- **AND** 仓库默认配置 SHALL 允许 UiAutomator2 在 OEM 拒绝修改 hidden API policy 时继续启动

#### Scenario: 请求启用严格模式

- **WHEN** Android 启动请求显式提供 `appium:ignoreHiddenApiPolicyError=false`
- **THEN** 插件 MUST 保留该请求值
- **AND** MUST NOT 用持久化默认值覆盖它

#### Scenario: 非 Android 或附着 session 不受影响

- **WHEN** 用户创建 iOS session、使用 Mock，或附着已有 Appium session
- **THEN** 插件 MUST NOT 为该路径注入 Android hidden API policy capability

### Requirement: 兼容风险必须在启动前可见

当新建 Android session 的有效策略会忽略 hidden API policy 修改错误时，Viewer SHALL 在用户触发启动前提示该行为可能隐藏后续 UiAutomator2 兼容问题，并说明可通过显式 `false` 恢复严格失败。插件 MUST NOT 为了预检而执行会修改设备 hidden API policy 的 ADB 命令。

#### Scenario: 新建 Android session 显示提示

- **WHEN** Viewer 选择 Appium、新建 Android session，且请求没有显式关闭兼容策略
- **THEN** Viewer SHALL 在点击启动前显示兼容风险提示

#### Scenario: 严格模式或附着 session 隐藏提示

- **WHEN** 请求显式设置 `appium:ignoreHiddenApiPolicyError=false`，或用户填写已有 session ID
- **THEN** Viewer SHALL 隐藏该提示

### Requirement: Android 真机验收不得由假服务器替代

Android 兼容默认值的最终验收 SHALL 使用物理 Android 与真实 Appium/UiAutomator2 链路，并记录 session 创建、PNG 帧、安全动作、停止和 owned session 清理证据。

#### Scenario: 默认配置完成物理 smoke

- **WHEN** 受 hidden API policy 权限限制的物理 Android 在线，且请求不手写兼容 capability
- **THEN** 插件 SHALL 完成 `start → frame → safe action → stop`
- **AND** 前后帧 SHALL 是不同的非空 PNG，停止后插件自有 session SHALL 被删除
