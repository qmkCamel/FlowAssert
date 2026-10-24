## Why

当前 Viewer 连接 Android/iOS 真机都要求用户自行启动 Appium、判断 ADB/UiAutomator2 或 XCUITest/WDA 环境并手写 capabilities JSON，容易把本机路径、设备标识和签名配置带入日志或 Agent 上下文，也让已经完成设备准备的用户仍难以首次使用。现在需要把已有 doctor、平台预检和 MirrorService 能力组合成一条显式、可审计、可恢复的双平台引导连接流程。

## What Changes

- 新增 Viewer 内的统一设备连接助手：用户选择 Android 或 iOS 后显式发起检查，分别展示 Appium/UiAutomator2/ADB 或 Appium/XCUITest/Xcode/WDA 的脱敏状态。
- 用短期、不透明的设备引用代替浏览器可见的 Android serial/iOS UDID；主入口为“连接设备”，默认查看当前画面，另可显式选择打开系统“设置”。两种预设均由服务端生成安全 capabilities；原始 capabilities JSON 保留为高级入口。
- Android 检查将 USB 调试、ADB 授权、设备解锁和 UiAutomator2 辅助 APK 安装/更新列为人工或显式副作用边界；scrcpy 4.1 仅作为可选媒体能力，缺失时回退 PNG polling，不阻塞基础连接。
- 增加 Android Appium session 稳定性保护：固定 Settings 前台与 UiAutomator2 idle/action acknowledgement 上限，区分 Appium server 不可达和 session 命令超时，并让控制完成不再等待可选的后置截图。
- 为 PNG polling 增加单飞、连续失败退避和降级恢复；本地开发入口允许显式注入受信任的 scrcpy 4.1 路径，避免在已配置低延迟媒体时继续高频占用 Appium screenshot。
- 支持在用户确认后使用已验证的绝对路径一次性启动受管 Appium；不自动安装 Appium/driver，不静默注册设备，也不放宽 WDA provisioning 权限。
- 增加独立于 DSH profile 的本机私有 Viewer 配置：仅在用户勾选“记住此电脑”后持久化已验证的 Appium 路径、平台偏好和最小 WDA Team/bundle；文件权限收紧、原子写入且默认不进入仓库。
- 增加正式的本地 Viewer 启动入口和已保存配置的快速连接确认；单设备且预检无阻塞项时，不再要求用户重复填写路径和签名字段。
- 将 Appium server ready timeout 与真机 session/WDA cold-start timeout 分离，避免已正确签名的 iPhone 因首次 WDA 构建超过 30 秒被误判失败。
- iOS 自动媒体优先复用 WDA 默认 MJPEG 端口 9100；端口不可安全使用时明确回退 PNG polling，不再为已缓存 WDA 随机分配不匹配的设备端口。
- 为检查和连接提供本地进度、失败后保留最近一次可用结果、过期与单次消费保护，并保证其他 Viewer 控件仍可交互。
- 将 Viewer 所有改变本机状态的 POST 接口统一纳入 same-origin 校验、请求体上限、稳定错误码和日志脱敏。
- 允许 Viewer 中一次显式用户操作授予仅限本次检查的平台主机诊断权限；该权限不持久化，也不向 MCP/Agent 工具开放。

## Capabilities

### New Capabilities

- `guided-device-connection-assistant`: 定义 Android/iOS 的显式检查、脱敏设备发现、短期连接上下文、安全预设、连接生命周期和失败恢复。

### Modified Capabilities

- `local-mirror-viewer`: 增加双平台引导连接界面、渐进反馈、高级入口兼容性，以及所有状态变更接口的 same-origin 安全要求。
- `managed-appium-runtime`: 增加用户确认后、以已验证绝对路径执行的一次性受管启动，同时保持禁止隐式 PATH 搜索和自动安装的边界。
- `ios-wda-signing-preflight`: 增加 Viewer 用户手势授权的单次诊断模式，并要求结果和日志持续脱敏。

## Impact

- 影响本地运行时、Viewer 私有配置/CLI、Viewer HTTP API/前端、Appium 请求错误分类与 frame 调度、Android 只读设备发现和 iOS WDA 预检；MirrorService 与 Appium provider 继续作为两端会话和设备控制的唯一核心。
- 新增的主机命令发现仅绑定 loopback Viewer 的显式用户操作，MCP 与 Harness adapter 不获得自动发现、进程启动或原始设备标识能力。
- 需要新增私有配置权限/原子写入测试、CLI/单元测试、Viewer E2E、运行时截图验收，以及 Android/iOS 分别执行“检查 → 连接设置 → 读取画面/结构 → 停止”的真机验收记录。
