# 连接模拟器

在 macOS 上准备 Appium 与对应驱动（Android：UiAutomator2；iOS：XCUITest）。

1. 在 Android Studio 启动 Android Emulator，或在 Xcode 的 Simulator 中启动 iPhone/iPad。
2. 打开 Viewer，选择 **Appium · 设备**，选择 Android 或 iPhone，再将**设备类型**切换为**模拟器**。
3. 点击检查，选择模拟器和 Appium 运行方式，然后连接。默认查看当前屏幕，也可选择打开系统设置。

只列出已经运行的本机模拟器；多台同时运行时显式选择。Android 仍需确认 UiAutomator2 辅助 APK 安装/更新。iOS Simulator 无需 Apple Team ID，不继承真机 WDA 签名设置；首次连接可能编译和安装 WDA。模拟器内业务 App 请事先安装。

检查不会启动或清空模拟器。设备在检查后退出、切换平台/设备类型或检查过期时，重新检查后再连接。保存设置只保存 Appium 路径，不保存模拟器身份。截图、Inspector、手动操作和 YAML 工作台继续使用同一会话。

本次仅扩展连接向导；模拟器测试不等于真机验收，Mock 也不等于模拟器实测。模拟器媒体默认 PNG，低延迟媒体沿用现有可选策略。

XCUITest 的运行选项见 [Appium 官方能力文档](https://appium.github.io/appium-xcuitest-driver/latest/reference/capabilities/)。

## 本机验证（2026-10-09）

- iPhone 17 Pro / iOS 26.5 Simulator、Pixel 6 / Android 13 Emulator：当前屏幕与系统设置两种连接均实测通过，保存了设备 PNG、结构 JSON、Viewer 连接中和完成截图；两次停止均释放自有 Appium。
- 使用 `scripts/simulator-connection-probe.ts` 经真实 Viewer 检查和连接入口验证，无需提供 raw capabilities。探针要求显式平台和绝对 Appium 路径，且只允许一台已启动模拟器，避免自动选错设备。
- 本轮未新增模拟器内业务 App 的 YAML、录屏或低延迟媒体验收，仍以各能力自己的验证记录为准。原始实测材料保存在忽略的 `artifacts/simulator-validation/`，不进入打包文件。
