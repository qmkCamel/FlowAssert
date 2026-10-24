## 1. 缩放控件与本地状态

- [x] 1.1 在 stage toolbar 增加适应、缩小、比例、放大 control group，并为 device area 增加支持真实 overflow 的内部 wrapper；保持现有主题和动作控件 DOM 语义。
- [x] 1.2 在 `viewer/i18n.js` 增加 en/zh-CN 对称 zoom 文案、title 和 accessible name，并扩展翻译目录完整性测试。
- [x] 1.3 实现页面内 `fit/manual + 50%–200%` 离散状态、边界禁用、非媒体 bezel 双击复位和比例 live region；证明不使用 localStorage。

## 2. 真实布局尺寸与 renderer

- [x] 2.1 使用 `ResizeObserver` 计算受可用宽高约束的 fit 基准，并通过真实 `.phone` 宽高应用倍率；窗口/布局变化只重算基准，不重置用户 mode/scale。
- [x] 2.2 将 device area 改为内部滚动布局：未溢出时居中、溢出时所有边缘可达，toolbar/action dock 固定在滚动区域之外，窄屏不产生 body 横向溢出。
- [x] 2.3 验证 PNG、MJPEG 和 WebCodecs canvas 的 CSS box 始终匹配 phone frame；Android 下一视频帧按新尺寸与受限 devicePixelRatio 更新 backing store，缩放过程保留最后画面。
- [x] 2.4 保证 zoom、fit、resize、scroll 和语言切换不调用 Viewer API、不请求 screenshot/媒体、不改变 session/observation/revision/epoch，并保持错误、进度、媒体 fallback 和当前缩放状态。

## 3. 自动化与视觉验收

- [x] 3.1 增加 Playwright 宽屏几何测试，覆盖默认 fit、全部步长与边界、200% overflow、完整滚动范围、显式/双击复位和零额外 API 请求。
- [x] 3.2 增加窄屏、en/zh-CN、键盘/ARIA、窗口 resize、状态刷新和语言切换测试，确认 toolbar 重排、状态保留与 body 无横向溢出。
- [x] 3.3 扩展 PNG/MJPEG/WebCodecs fixtures，断言缩放前后 renderer box、canvas backing store、画面比例和动作/stop 可用性。
- [x] 3.4 保留放大状态运行截图并人工检查设备完整外框、滚动区域、toolbar/action dock、画面比例、双语文本和无错误/私密内容残留；更新 `docs/validation.md`。

## 4. 工程门禁

- [x] 4.1 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`、`pnpm public:check`、`git diff --check` 和 `openspec validate add-viewer-preview-zoom --strict`。
