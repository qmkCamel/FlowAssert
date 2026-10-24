## ADDED Requirements

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
