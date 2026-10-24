## 1. 配置与能力合并

- [x] 1.1 扩展插件配置类型与 schema，增加 Team ID、签名身份、唯一 WDA Bundle ID、xcconfig 路径、设备注册授权和主机签名诊断开关，并为每个字段补充安全默认值与契约测试。
- [x] 1.2 在 Appium provider 的新建 iOS 会话边界合并 WDA 签名默认值，落实“请求级能力 > 插件配置 > Appium 默认值”的优先级，并覆盖显式空值与缺省值场景。
- [x] 1.3 将设备注册授权仅映射到显式启用的 iOS 会话，增加测试证明默认不会触发 Apple Developer 状态变更，且 Android、Mock、复用已有会话路径不受影响。

## 2. 预检与错误诊断

- [x] 2.1 实现可注入的 `HostCommandRunner` 与 `IosWdaPreflightService`，在未授权主机诊断时完全不执行外部命令，并用单元测试验证该边界。
- [x] 2.2 实现 Xcode、XCUITest driver、已连接设备、开发签名身份和 provisioning profile 的受控预检，输出稳定检查项与错误码，不返回原始 UDID、Team ID、证书名称、profile 内容或完整命令行。
- [x] 2.3 注册薄层 `mobile_mirror_ios_preflight` 工具，返回紧凑、可操作的状态结果；使用伪造命令输出验证成功、缺失、超时和敏感信息脱敏场景。
- [x] 2.4 对 WDA 启动失败补充 `wda_profile_missing`、`wda_signing_identity_invalid`、设备安装拒绝等分类，并为未知 `xcodebuild 65` 保留脱敏后的通用回退与原有最后可用结果。

## 3. 文档与持久化

- [x] 3.1 新增 iOS 真机配置文档，覆盖 Developer Mode、UI Automation、设备信任、Xcode 账号/证书、手工打开 WDA 工程、唯一 Bundle ID、自动签名和 Product > Test 首次验证流程。
- [x] 3.2 给出仅含占位符的 `~/.dsh/profiles/<profile>/cordis.patch.yml` 持久化示例，说明请求级覆盖优先级、配置回滚方式，以及为何不得把个人 Team ID、UDID、证书或本机路径提交到仓库。
- [x] 3.3 记录自动注册设备的外部副作用和显式授权要求，补充预构建 WDA 路径、已验证的 Harness/Appium/XCUITest/Xcode 版本与失败排查表，并确保用户需要的说明进入发布包或 README 可达入口。

## 4. 验证与验收

- [x] 4.1 运行配置、能力合并、预检、错误分类和脱敏的聚焦测试，确认 Android、Mock、附着已有会话及未授权诊断均无回归。
- [x] 4.2 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 和 `openspec validate --strict`，检查发布包内容；若 Viewer 增加配置提示或进度状态，保留并人工检查运行时截图。
- [x] 4.3 在全新 DSH profile 中安装打包产物，检查 schema/config dump、工具注册，以及预检关闭和显式授权两条运行路径，证明默认不会修改 Apple Developer 或设备状态。
- [x] 4.4 在用户已完成手工签名配置或明确授权自动 provisioning 后，使用真实 iPhone 完成 Appium/WDA 启动、PNG 帧读取、安全交互、停止和 owned session 清理；记录版本和结果，外部 provisioning 未就绪时不得将本项标为通过。
