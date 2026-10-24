## Context

Viewer 目前使用固定 `.phone` 高度：桌面端 `min(560px, 62vh)`，窄屏为 490px；`.device-area` 使用居中 grid 和 `overflow: hidden`。PNG 与 MJPEG 由浏览器按元素尺寸绘制，Android WebCodecs canvas 则在每个新帧到达时根据 `.phone-frame.clientWidth/clientHeight` 与设备像素比更新 backing store。固定尺寸使宽屏空间被浪费，而简单 `transform: scale()` 会只放大合成层、不更新布局和 canvas backing store，并为未来屏幕直接点击引入坐标错位风险。

缩放属于纯 Viewer 展示状态。它不能进入 `MirrorState`、Viewer HTTP API、DSH/MCP 结果或 agent observation，也不能触发 Appium、媒体重连或新截图。本 change 复用现有媒体 renderer 和本地化目录，不增加依赖。

## Goals / Non-Goals

**Goals:**

- 默认让设备外框尽量填满当前预览区，同时保持完整比例。
- 提供 50%–200% 的确定性手动缩放、适应窗口复位和内部滚动。
- 缩放时改变实际布局尺寸，使图片、MJPEG、canvas 和未来坐标换算读取一致的几何边界。
- 保持 session、最后画面、媒体 transport、错误/进度、语言与动作控件不变。
- 为英文、简体中文、键盘和辅助技术提供完整控制语义。

**Non-Goals:**

- 不实现手机画面内部的局部放大、平移、裁剪或手势透传。
- 不增加屏幕直接点击，也不改变当前 Test tap/swipe 的设备坐标。
- 不改变设备方向、媒体分辨率、scrcpy/WDA 配置或 agent observation 图片。
- 不跨刷新、跨标签页或跨设备 session 持久化缩放偏好。

## Decisions

### 1. 以“适应窗口基准 × 用户倍率”计算真实布局尺寸

新增页面内状态：`mode: 'fit' | 'manual'` 与 `scale`。`ResizeObserver` 观察预览区可用 content box，按现有 phone aspect ratio 计算不超出可用宽高的 fit 高度；manual 模式在该基准上应用固定步长 `[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]`。fit 模式显示“适应”，manual 显示百分比。窗口或控制面板布局变化时重新计算 fit 基准，但不得重置 mode/scale。

实际高度和宽度通过 `.phone` 的 inline CSS custom properties/尺寸更新，不使用 `transform`。这样 `getBoundingClientRect()`、`clientWidth/clientHeight`、滚动范围和 canvas backing store 使用同一几何事实。选择相对 fit 基准而不是固定 560px 的“100%”，可让不同桌面/窄屏视口保持一致含义；100% 表示当前窗口的完整适配尺寸。

### 2. 使用滚动容器和 auto margin 保证放大后所有边缘可达

`.device-area` 改为 `overflow: auto`，内部增加最小宽高为 100% 的 flex wrapper，`.phone` 使用 `flex: none; margin: auto`。当 phone 小于预览区时 auto margin 居中；大于预览区时 margin 归零并产生从左上到右下完整可达的滚动范围。舞台 toolbar 与 action dock 位于滚动容器之外，不能随画面滚走或被覆盖。

选择真实 overflow 而不是拖拽平移，是为了保留浏览器原生键盘/触控板滚动、降低手势冲突，并避免新增 pointer capture 状态。

### 3. 缩放控制属于 stage toolbar 的本地 control group

toolbar 右侧增加带可访问名称的 control group：适应窗口、缩小、当前倍率、放大，以及现有主题按钮。缩小/放大在 50%/200% 边界禁用；当前倍率使用 `aria-live="polite"`，不高频播报窗口 resize。双击仅绑定 phone 外框/非媒体 bezel，用作 fit 快捷方式；媒体表面不消费双击，给未来设备手势保留边界。

语言切换只重新渲染 zoom 标签，不改变 zoom 状态。控件通过现有 `viewer/i18n.js` 维护 en/zh-CN 同键翻译。

### 4. 复用现有 renderer，缩放不得请求新设备数据

PNG/MJPEG 元素随 `.phone-frame` 的真实尺寸重排。Android canvas 继续在下一视频帧按 `clientWidth/clientHeight × min(devicePixelRatio, 2)` 更新 backing store，并使用 contain 计算；缩放事件本身不请求媒体帧、不调用 `/api/frame`、不重启 decoder。静态 canvas 在下一帧前可能由浏览器短暂缩放已有 backing store，但不得改变宽高比、清空最后画面或显示黑帧；首个后续帧必须恢复匹配新布局的 backing store。

本地 zoom handler 不调用 `api()`、`refreshState()`、`manageMedia()` 或 session 操作。测试通过请求计数证明 fit、step、resize、滚动和语言切换不会产生额外 Viewer API 请求。

### 5. 测试以几何事实而不是视觉比例猜测为准

Playwright 覆盖：默认 fit 不溢出、放大后 phone 边界和 scroll extent 同步增加、缩放边界/禁用态、fit 复位、窄屏 toolbar 换行但不覆盖、语言切换保留比例、Mock/PNG/MJPEG/WebCodecs 元素始终等于 `.phone-frame`。Android media 至少等待一个缩放后的新帧，再断言 canvas CSS box 与 backing store 按 devicePixelRatio 更新。

保留一张放大状态运行截图，人工检查完整外框、滚动区域、控制栏、画面比例和错误残留。截图不得含设备/session 标识或私人真机内容。

## Risks / Trade-offs

- [200% 放大会产生双向滚动，手机不再居中] → 使用 auto margin 让仅溢出的轴从起点滚动，并保留显式 fit 按钮一键恢复。
- [频繁 resize 触发大量布局计算] → `ResizeObserver` 只更新数值变化后的 CSS 尺寸，不发网络请求，也不触发 state refresh。
- [canvas 在缩放与下一视频帧之间短暂插值] → 保留已有画面并在下一帧重建 backing store；不为视觉放大主动请求或缓存额外设备帧。
- [双击可能与未来屏幕手势冲突] → 只绑定非媒体 bezel；未来引入直接屏幕手势时可移除快捷方式而不影响 fit 按钮。
- [缩放控件挤压窄屏 toolbar] → toolbar actions 允许换行，zoom group 保持连续，舞台标题单独保留最小宽度。

## Migration Plan

1. 先加入 DOM、翻译和纯本地 zoom state，再替换 `.device-area` 布局。
2. 用 Mock/fixture 验证三种 renderer 与宽/窄视口，更新基准截图。
3. 运行完整 Viewer E2E 与仓库门禁；部署不需要配置或数据迁移。
4. 回滚时删除 zoom controls/state 与 wrapper，恢复固定 `.phone` 高度和 `overflow: hidden`；HTTP、session 与设备侧无残留状态。

## Open Questions

无。局部画面放大、缩放持久化和屏幕直接点击如需支持，应分别建立后续 change。
