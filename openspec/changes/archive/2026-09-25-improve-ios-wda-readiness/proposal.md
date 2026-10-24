## Why

当前 iOS 预检只能证明本机存在 Xcode、签名身份和匹配的 provisioning profile。它无法证明 Xcode 当前登录了可为指定 Team 重新签名的 Apple 账号，也无法证明已安装的 WDA 还能启动。连接失败时，Viewer 助手还可能把实际 WDA 错误压成 `assistant_input_invalid`，让用户在正式测试前无法看懂阻塞点。

## What Changes

- 明确区分“本机签名前提通过”与“WDA 已在这台 iPhone 上启动并可用”：只读预检不得宣称后者。
- 把 Xcode Accounts 与首次 WDA 签名作为人工准备项，在 Viewer 的 iOS 检查报告中提供准确下一步；已有 profile 的用户仍可尝试连接。
- 通过现有显式连接创建的 Appium session 验证 WDA 运行状态。把“当前 Team 没有已登录 Xcode 账号”等可识别错误映射为稳定、脱敏的用户提示；连接失败时不误报为输入错误。
- 更新 iOS 准备说明和相应契约测试；Mock/Android/现有高级连接不增加签名动作。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `ios-wda-signing-preflight`: 预检结果明确静态签名检查与 WDA 运行验证的边界，增加账号人工检查和缺少登录账号的稳定错误分类。
- `guided-device-connection-assistant`: iOS 检查报告提示 WDA 运行仍待连接验证；显式连接失败时保留并显示脱敏的 WDA 分类错误。

## Impact

- macOS iPhone 真机首次准备、Viewer 连接向导和 iOS WDA 故障提示。
- `src/ios-wda-preflight.ts`、`src/wda-errors.ts`、`src/connection-assistant.ts`、`src/viewer-server.ts`、Viewer 文案、相应测试与 iOS 安装指南。
- 不修改 DSH agent loop、Appium provider 所有权、Apple 登录或自动 provisioning 默认策略；不存储 Apple 凭据、证书、私钥或完整 xcodebuild 日志。
