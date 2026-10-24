## Context

Viewer 使用 PNG image、iOS MJPEG image、Android WebCodecs canvas 显示手机。当前无导出入口，测试证据由 WorkbenchStore 独立拥有。

## Goals / Non-Goals

Goals：三个手动操作、录制计时、本机下载；录制中可截图/控制/运行测试；失败保留上一结果。
Non-Goals：设备原生录屏、声音、桌面/网页 UI 录制、后台持续录制、自动上传或测试证据替代。

## Decisions

复用已经显示的 image/canvas，PNG 按源像素导出；录屏用独立 canvas + captureStream/MediaRecorder，30 fps 上限、最长边 1920。优先 WebM，运行时探测 MP4 fallback。无需第二媒体订阅或设备命令；系统原生录屏需要额外平台权限及会话协调，因此本次采用 Viewer 画面录制。

独立模块拥有按钮状态、blob URL、计时与录制资源。session 改变清除旧画面引用并结束旧录制；隐藏页面/断开自动停止并生成下载。Canvas 固定录制尺寸，旋转时等比留黑边，避免截断或拉伸。截图使用另一个 canvas，可与录制并行。

每种保留最近一个下载入口，成功替换才释放旧 URL；开始新操作不删除已有结果。录制按 10 分钟或 128 MiB 自动结束，1 秒数据分块。录制错误尽力保留已编码片段并标注不完整，不把部分片段当完整成功。

## Risks / Trade-offs

导出质量受 Viewer 输入帧率与浏览器编码支持影响；PNG 降级时视频会重复当前帧，明确记录的是 Viewer 画面。录屏视频无音轨。结果由浏览器下载，页面内链接只在当前页面存活；录制中离开触发原生确认，关闭/崩溃不能保证浏览器异步编码落盘，关闭前应结束并下载。不承诺后端持久化或生产性能。

## Migration Plan

新增静态前端模块路由；已有 API、Agent 工具、控制和媒体传输均不变。通过撤销前端入口和静态路由可回滚。覆盖真实浏览器编码/播放、错误保留与并行交互，再做在线真机验证。
