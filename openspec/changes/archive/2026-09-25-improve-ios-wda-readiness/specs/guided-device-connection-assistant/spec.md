## ADDED Requirements

### Requirement: iOS 助手必须区分本机签名检查与实际 WDA 连接

iOS 连接检查 SHALL 展示本机签名前提结果，并单列“WDA 运行未验证，需连接后确认”。只有用户显式连接且现有 Appium 会话启动成功，系统才 SHALL 把设备视为可运行；助手 MUST 复用现有会话及资源所有权，不得为静态检查创建第二个 WDA session。

#### Scenario: 检查通过但缓存 WDA 无法启动
- **WHEN** 本机前提通过而已安装 WDA 随后启动失败
- **THEN** 助手 SHALL 保留“本机前提通过”和“运行验证失败”的区别
- **AND** MUST NOT 在正式测试开始前把该设备报为可运行

#### Scenario: 用户只点击只读检查
- **WHEN** 用户在 Viewer 中只点击 iPhone 连接检查
- **THEN** 系统 SHALL 展示运行未验证与 Xcode Accounts 人工准备建议
- **AND** MUST NOT 启动 Appium session、触发 WDA 编译、注册设备或执行测试用例

### Requirement: 助手必须保留安全的 WDA 启动失败原因

助手显式连接遇到已分类的 WDA 启动错误时，HTTP 结果和 Viewer SHALL 展示该稳定错误码对应的操作建议，不得误报 `assistant_input_invalid`。对外内容 MUST 仅包含稳定码和固定文案；错误后重试仍需重新检查设备上下文。

#### Scenario: Xcode 账号未登录
- **WHEN** Appium 在助手连接期间报告 `wda_developer_account_unavailable`
- **THEN** Viewer SHALL 提示在 Xcode Settings → Accounts 登录对应 Team 的开发账号后重新检查并连接
- **AND** MUST NOT 回显账号、Team、UDID、capabilities 或原始 Appium 错误

#### Scenario: 其他已知 WDA 签名错误
- **WHEN** 助手连接因缺失 profile 或签名身份无效失败
- **THEN** Viewer SHALL 显示对应的稳定 WDA 错误码和已有修复建议
- **AND** MUST NOT 把它归类为用户输入格式错误
