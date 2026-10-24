## 1. 准备结果契约

- [x] 1.1 为 iOS 只读预检增加明确的 WDA 运行未验证状态和 Xcode Accounts 人工确认项，保持已有授权与脱敏边界。
- [x] 1.2 为本机静态前提齐全、缺失 profile、诊断未授权编写确定性测试，证明只读检查不启动 WDA 或创建 session。

## 2. 连接错误与用户引导

- [x] 2.1 对 Xcode 明确报告当前 Team 没有已登录账号的错误新增稳定分类和脱敏测试，保留已有 profile/证书/设备错误分类。
- [x] 2.2 让连接助手保留已分类 WDA 启动错误的安全码和固定操作建议，覆盖 HTTP 请求、失败后状态和重新检查后重试。
- [x] 2.3 在 Viewer 的 iOS 检查结果中区分本机签名前提与 WDA 运行未验证，并补齐英中两种语言的 Xcode Accounts 修复提示。
- [x] 2.4 在真实运行的 Viewer 页面中验证只读检查、慢连接进度、失败提示、无关控件可交互、保留此前可用画面与重试路径，保留并人工检查截图。

## 3. 文档与门禁

- [x] 3.1 更新 iOS 真机准备、Viewer 快连及能力说明，明确首次登录和 WDA 真机启动验证边界，不把本机静态 ready 当成 WDA 通过。
- [x] 3.2 运行 OpenSpec strict 校验、`pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 并记录实际结果；不以软件模拟声称 Apple 账号或物理 iPhone 已通过。

## 验证记录（2026-09-25）

- `openspec validate improve-ios-wda-readiness --strict`：通过。
- `pnpm check`：通过，52 个测试文件、429 项单测；TypeScript 和契约检查通过。
- `pnpm test:e2e`：通过，47 项浏览器测试。其中新增用例在慢连接期间切换主题，确认脱敏错误、保留最后可用画面与检查报告，以及重新检查后成功重试。
- `pnpm build`：通过。
- `pnpm pack:check`：通过。
- 人工检查 `artifacts/screenshots/mobile-mirror-ios-wda-account-recovery.png`：英文错误和签名/运行区分可见，未见账号、Team ID、UDID、路径等私人值。
- 以上为模拟运行和本机软件门禁；未登录实际 Apple 账号、未连接物理 iPhone，因此未宣称真实 WDA 启动已通过。
