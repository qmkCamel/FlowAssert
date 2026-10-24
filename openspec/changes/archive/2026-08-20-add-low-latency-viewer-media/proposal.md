## Why

当前 Viewer 每 750 ms 通过 Appium 拉取 PNG，适合检查和控制，但不能给人类监督者提供流畅、低延迟的实时画面。Android 与 iOS 真机控制 P0 已闭环，现在可以在不改变 agent 单帧 observation 和 Appium 控制权的前提下，分别接入 scrcpy 视频与 WDA MJPEG，完成 P1 媒体层。

## What Changes

- 新增仅服务本机 Viewer 的低延迟媒体协调层：Android 使用 scrcpy H.264，iOS 使用 WDA MJPEG，Mock 和不满足条件的设备继续使用 Appium/Mock 帧轮询。
- Android 只启动 scrcpy 视频 socket，关闭 audio/control；点击、滑动、返回、session ownership 和设备发现仍由 Appium/现有核心负责。
- iOS 为 runtime-owned 新 session 规划不冲突的 MJPEG 端口，并代理、校验 WDA 的有界 JPEG 帧；附着外部 session 时不创建或删除外部端口转发。
- Viewer 在同一 loopback origin 内消费连续媒体，显示 starting/live/fallback 状态；首帧前和媒体失败后保留并恢复现有截图轮询，stop 与安全控制始终可用。
- 连续媒体不进入 DSH/MCP tool result、attachment、observation store、日志或持久化文件；`snapshot`/`inspect_screen` 继续从 Appium 获取 fresh PNG/结构。
- 增加显式媒体配置、稳定错误码、背压/帧大小/客户端数量限制、进程与端口回收、浏览器能力检测和双平台真机性能验收。

## Capabilities

### New Capabilities

- `low-latency-viewer-media`: 定义 scrcpy H.264、WDA MJPEG、媒体协调状态、loopback 传输、资源限额、降级和清理行为。

### Modified Capabilities

- `local-mirror-viewer`: Viewer 从单一截图轮询升级为按能力切换连续媒体/截图回退，并增加非阻塞进度和降级可见性。
- `appium-provider`: Appium session 需要提供有界的内部媒体上下文，为 owned iOS session 安全规划 MJPEG 端口，同时保持截图与动作语义不变。

## Impact

- 主要影响 `MirrorService`/`LocalDeviceRuntime` 的关闭顺序、Appium provider 的内部 session 元数据、Viewer HTTP 流接口与浏览器渲染逻辑。
- Android 低延迟路径需要用户显式配置受信任的 scrcpy 可执行文件；兼容基线固定为 scrcpy 4.1、H.264 和 Android USB/ADB，媒体不可用时自动回退。
- iOS 基线复用 Appium XCUITest/WDA 已有 MJPEG broadcaster 和 USB port forwarding；不设置 `mjpegScreenshotUrl`，避免把连续流最新帧冒充 agent fresh observation。
- 发布包、配置契约、安全文档、ADR、Vitest/Playwright/fake media server 和 Android/iOS 真机验收矩阵需要更新。
- 不新增远程 listener，不增加新的 device-control stack，不改变八项 DSH/MCP 工具名称或输入参数。
