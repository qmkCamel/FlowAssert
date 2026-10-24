## Why

当前 Viewer 把设备外框固定在约 560px 高度，大屏上无法充分利用设备预览区域，小屏或需要检查细节时也缺少明确的缩放控制。Viewer 需要提供只改变本地展示尺寸的设备预览缩放，同时保持媒体清晰度、运行态和未来屏幕坐标映射边界稳定。

## What Changes

- 在设备预览工具栏增加“适应窗口”、缩小、当前比例和放大控制，支持键盘操作与英文/简体中文标签。
- 默认使用适应窗口模式；手动缩放范围固定为 50%–200%，按离散步长调整，并支持双击设备外框恢复适应窗口。
- 放大后的设备外框使用真实布局尺寸，超出预览区域时在区域内部滚动，不使用 `transform: scale()`，不裁切控制栏或页面其他区域。
- Android canvas、iOS MJPEG 与 PNG fallback 在缩放后保持相同比例和完整画面；缩放、滚动和复位不得发起 Viewer API、Appium、宿主或设备命令。
- 当前缩放偏好只在页面内保留，不跨刷新持久化；session、媒体切换、错误恢复和语言切换不得擅自重置用户选择。
- 增加宽屏、窄屏、横竖屏和媒体 renderer 的 Playwright 几何/交互覆盖，并保留一张人工检查的运行截图。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-mirror-viewer`: 增加设备预览适应窗口、手动缩放、内部滚动、运行态保持、渲染清晰度、可访问性和无设备副作用要求。

## Impact

- 主要影响 `viewer/index.html`、`viewer/styles.css`、`viewer/app.js` 和翻译目录。
- 影响 Viewer Playwright 断言、运行截图和验证记录。
- 不修改 Viewer HTTP API、MirrorService、Appium provider、MCP/DSH 工具 schema、agent observation 图片、设备分辨率或 session ownership。
- 不增加第三方依赖；缩放状态不写入设备、宿主 profile 或浏览器持久存储。
