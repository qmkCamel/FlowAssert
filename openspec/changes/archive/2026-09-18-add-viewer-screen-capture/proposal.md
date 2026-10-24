## Why

独立 Viewer 已能查看手机，但缺少手动截图和开始/结束录屏入口。用户需要连接后直接保存画面，不依赖 YAML 测试。

## What Changes

- 画面工具栏增加截图、开始/结束录屏、录制计时与下载入口。
- 复用当前显示的 PNG/MJPEG/H.264 解码画面，本机导出 PNG 和浏览器支持的视频格式，无麦克风/桌面采集。
- 支持录制中截图、操作手机及测试；断开/换 session/隐藏页面时结束并保留下载，失败保留上一结果。

## Capabilities

### New Capabilities
- `viewer-screen-capture`: 独立 Viewer 手动截图与录屏。

### Modified Capabilities

无。设备控制、测试证据和 DSH/MCP 契约不变。

## Impact

Viewer 前端、新静态模块路由、中英文文案、E2E、使用说明与 ADR 0003。仅本机媒体导出，不新增设备命令、服务端录像进程或 agent 工具。
