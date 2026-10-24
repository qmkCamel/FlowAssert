# Viewer 手动截图与录屏验证

日期：2026-09-14。对应[归档 change](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-viewer-screen-capture/tasks.md)与 [ADR 0003](decisions/0003-low-latency-viewer-media.md)。

## 功能与边界

独立 Viewer 画面工具栏提供截图、开始/结束录屏、计时及最近 PNG/视频下载。导出当前手机画面，不包含 Viewer 控件，不请求桌面或麦克风权限，无音轨。截图保留当前源帧尺寸；录屏固定初始画布（最长边不超过 1920），旋转后等比留黑。目标编码上限 30 fps，不保证设备实际帧率。

录制期间允许截图、主题/语言切换和既有控制/工作台交互；断开、换会话、页面隐藏自动结束。10 分钟或累计分片达到 128 MiB 自动结束，末尾分片可略超限。编码异常保留非空部分视频并标记不完整；空结果/截图失败保留上次下载。浏览器自动下载受限时可以点击下载链接。

文件由浏览器保存；链接仅在当前页面有效，关闭前应下载。强制关闭/崩溃不保证保存。这不是工作台 runId 视频归档，不能替代步骤 PNG/XML 和自动断言。

## 浏览器验证

`tests/e2e/capture.spec.ts` 使用真实 Canvas / MediaRecorder 导出 PNG 和视频，并实际播放解码；覆盖红蓝帧变化、源图旋转、固定视频尺寸、无音轨、并行控件/截图、中英文、窄屏和大窗口布局、断开/更换会话、隐藏释放轨道、截图及编码失败、部分录制、时长上限和不支持录屏时仍可截图。

`tests/e2e/viewer.spec.ts` 的 iOS MJPEG 场景补充真实 JPEG 截图、录制、PNG 降级后继续录制和视频播放验证。这是原浏览器媒体链路验证；2026-09-15 已补充 iPhone 真机两轮截图/录屏、实际解码与清理，见[iPhone 补验](ios-acceptance-2026-09-15.md)。

保留并查看运行截图：[录制中](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-capture-recording.png)、[窄屏下载入口](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-capture-narrow.png)。

## Android 真机

OnePlus 8T / Android 14，第三方 App REDACTED_APP_VERSION；Appium 3.2.0、UiAutomator2 6.8.0、scrcpy 4.1、AppClaw 2.7.0。DSH 兼容基线维持 0.1.2-rc.1，未修改 Harness loop。

首次因锁屏导致第三方 App流程第 2 步失败，锁屏 PNG/视频仍可导出。用户解锁并打开第三方 App后重新验证；不将前次失败计为通过。

成功 runId：`53805be0-fd79-4841-84fd-a48b2ebaeb5f`。

| 项目 | 实测结果 |
| --- | --- |
| 录屏时运行既有第三方 App YAML | 12/12 通过，保持同一会话 |
| 独立交互 | 录制中切换主题、保存 PNG，不中断录制 |
| PNG | 576×1280，当前 H.264 源帧尺寸 |
| 视频 | VP8 / WebM，864×1920，1,866,187 bytes，无音轨 |
| 实际完整解码 | ffmpeg 成功解码 274 帧，156 个不同帧哈希，帧时间跨度 9.358 秒 |
| 分辨率差异 | 开始录制时使用较高分辨率 PNG；切入 H.264 后保持初始画布 |
| 断开清理 | managed runtime 停止；独立检查无 UiAutomator2 instrumentation、scrcpy 或 adb 转发残留 |

仅本机原始材料：`artifacts/physical-validation/viewer-capture-2026-09-14T14-01-31-556Z/`，含 `probe.json`、`phone.png`、`phone.webm`、`recording.png`、`completed.png`、`video-inspection.json`、`decoded-frames.md5`、`export-verification.json` 及工作台步骤证据。失败材料另存于 `viewer-capture-2026-09-14T13-58-17-654Z/`；原始手机内容不进入 Git。

SHA-256：

- PNG：`284ae1d4d4669e658c48cf053cf984427687fa1dfd08709e034e449bf724aa8c`
- WebM：`ec93e899dffe9697b98d551ca2d24ef24f1a7e45c0903c4ba73e941069fffd1a`

复验入口：`pnpm test:capture:physical`，显式提供 `MOBILE_MIRROR_CAPABILITIES_PATH`、`MOBILE_MIRROR_FLOW_PATH`、`MOBILE_MIRROR_APPIUM_EXECUTABLE`，以及需要的 scrcpy 路径。该入口控制所选设备，请先解锁并打开流程要求的 App 页面。

## 工程门禁

- `pnpm check`：类型/契约检查通过，34 个测试文件、241 项测试通过。
- `pnpm test:e2e`：29/29 通过，包含新增 6 个截图/录屏场景和扩展的 iOS MJPEG 场景。
- `pnpm build`、`pnpm pack:check`：通过，产物包含 `viewer/capture.js` 与本验收说明。
- OpenSpec 1.2.0：本 change `validate --strict` 通过；`pnpm public:check` 通过。
- 大窗口/窄屏 runtime 截图已查看；修正新增下载栏挤占画面高度的问题。
