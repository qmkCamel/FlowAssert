## Why

iOS 真机链路已经实际进入 XCUITest，但 WebDriverAgent 因缺少匹配的 provisioning profile、签名私钥和自动签名授权而以 `xcodebuild` 65 失败。当前只能把 Team、签名和 WDA bundle 信息临时塞进 capabilities，既不可复用，也无法在启动前给出安全、明确的诊断。

## What Changes

- 增加 schema-backed 的 iOS WDA 签名配置，支持持久化 Team ID、签名标识、唯一 WDA bundle ID 和本地 xcconfig 路径；单次请求 capabilities 仍拥有最高优先级。
- 增加默认关闭的 provisioning/device registration 显式开关；只有用户主动开启时，才允许 Appium/Xcode 更新 Apple Developer provisioning 状态或注册设备。
- 增加本地 iOS WDA 预检与错误分类，检查配置完整性、连接设备、开发签名身份和 Appium/XCUITest 依赖，并把常见 code 65、profile 缺失和签名无效错误转换为可执行建议，且不回显设备 UDID、Team ID、证书名称或 capabilities。
- 增加持久化 DSH profile patch 示例和真机配置文档，分别覆盖推荐的手动一次性签名路径、显式 opt-in 自动 provisioning 路径以及预装/复用 WDA 路径。
- 增加确定性单元测试、假主机命令测试、Appium 错误映射测试和 iOS 真机 smoke 记录。

## Capabilities

### New Capabilities

- `ios-wda-signing-preflight`: 定义 iOS WDA 签名配置、持久化优先级、安全授权、预检诊断与真机验收行为。

### Modified Capabilities

无。

## Impact

- 影响 `src/config.ts`、Appium 启动输入构造、主机诊断边界、相关测试、README/安全文档和发布包内容。
- macOS/iOS 真机路径新增可选的 `security`、`xcrun` 和 Appium driver doctor 只读诊断；其他平台和 Mock/Android 行为保持不变。
- 自动 provisioning 可能修改 Apple Developer 账户中的 profile 或设备注册，必须保持默认关闭并由用户显式授权。
- 不把个人 Team ID、设备 UDID、证书名称、私钥、密码或本机绝对路径提交到仓库。
