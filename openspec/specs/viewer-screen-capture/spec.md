# viewer-screen-capture Specification

## Purpose
定义 Viewer 中由用户触发的截图、录屏、本地下载和失败保留行为；慢保存需给出局部进度，取消和页面关闭后的结果应与运行归档分开，避免误称证据已持久化。

## Requirements

### Requirement: Manual viewer screenshot
Viewer SHALL 在画面工具栏提供截图按钮，将当前连接已显示的手机内容保存为源像素 PNG，并保留下载入口。无有效画面时 MUST 禁用截图，不能捕获桌面或网页装饰。
#### Scenario: Screenshot during a recording
- **WHEN** 用户录制中点击截图
- **THEN** 录制继续、PNG 可下载，独立控件保持可操作，截图失败保留上次成功结果。

### Requirement: Local recording lifecycle
Viewer SHALL 提供开始/结束录屏及计时，录制当前已显示的手机画面且无音轨。系统 SHALL 探测格式支持，不支持时禁用并说明，结束后生成带时间文件名的下载入口。
#### Scenario: Stop and replay
- **WHEN** 用户开始录制、操作手机并结束录制
- **THEN** 下载视频可播放，包含变化的画面且无 Viewer 控件，停止录制不影响手机会话。
#### Scenario: Disconnect or hide
- **WHEN** session 断开/替换或页面隐藏
- **THEN** 自动结束录制并保留已编码内容下载，不能混入下一 session；页内结果不代替后端持久化。
#### Scenario: Limits or encoding error
- **WHEN** 录制达到 10 分钟/128 MiB 限制或编码错误
- **THEN** 结束录制、释放 track/定时任务，保留上一次成功结果或本次非空片段并标明不完整；不能显示虚假的成功。

### Requirement: Independent capture controls
截图/录屏 SHALL 复用 Viewer 显示源，不新增设备操作、Agent 工具或媒体订阅。超过 300ms 的操作 SHALL 显示本地进度，保持主题、缩放等控件可操作；入口 SHALL 支持中英文和窄屏布局。
#### Scenario: Changing layout and media
- **WHEN** 用户缩放预览、切换语言或媒体在 PNG/MJPEG/H.264 之间降级
- **THEN** 导出只含手机内容，录制保持固定画布内等比显示，按钮和已有下载仍可访问。
