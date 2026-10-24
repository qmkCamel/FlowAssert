## 1. 翻译基础设施

- [x] 1.1 新增 Viewer ES module，定义 `en`/`zh-CN` 规范 locale、浏览器语言归一、本地偏好安全读写、英文回退和参数插值。
- [x] 1.2 建立 key 完全一致的中英文目录，覆盖静态正文、生命周期、观察/控制、媒体、连接助手、策略、已知错误、相对时间和过期提示，保留技术名称/版本/稳定错误码原值。
- [x] 1.3 为翻译模块增加确定性测试，覆盖 key parity、中文变体、非中文回退、有效/无效偏好、缺键英文回退、插值和 localStorage 异常降级。

## 2. Viewer 静态界面与可访问性

- [x] 2.1 在 Viewer 头部增加始终可用、键盘可操作的语言选择器，并为静态文本、placeholder、title 和 ARIA 属性接入语义 i18n 标记。
- [x] 2.2 启动时按“有效偏好 → 浏览器语言 → 英文”解析 locale，同步 `<html lang>`、页面标题和选择器，不增加服务端协商或 HTTP API。
- [x] 2.3 调整 Viewer 样式，保证英文/中文在桌面与窄屏下不遮挡品牌、连接状态、主题、表单和动作控件。

## 3. Viewer 动态文案与无损切换

- [x] 3.1 将 lifecycle、相对时间、observation/control progress、媒体 transport/fallback 和通用错误渲染迁移到共享翻译函数。
- [x] 3.2 将 Android/iPhone 连接助手的 status、检查项、人工动作、设备/runtime 选项、策略摘要、签名/helper 提示和已知错误迁移到显式翻译 key，未知项使用脱敏通用回退。
- [x] 3.3 实现纯展示语言重绘；切换时不得 fetch、执行宿主命令、消费 assistant token、重置 session/媒体/画面/report/busy 状态，或改写 session/capabilities/Team/WDA/确认字段。
- [x] 3.4 确认语言存储只包含规范 locale，DOM、控制台和 fallback 不新增设备/session/路径/签名/capabilities/raw output 暴露。

## 4. 浏览器验收与截图

- [x] 4.1 保持现有英文 Playwright 场景与选择器兼容，并新增中文浏览器首次访问、手动切换、刷新恢复、无效偏好和存储不可用覆盖。
- [x] 4.2 在 Mock streaming、慢连接检查和已有助手 report/未提交输入三种状态切换语言，验证零切换请求、运行态/画面/控件/report/token/字段值不变且完成结果使用新语言。
- [x] 4.3 扫描中英文 DOM、ARIA、console、response、localStorage 和截图，确认无内部 key、`undefined`、意外混排或私有 canary。
- [x] 4.4 保留 `artifacts/screenshots/mobile-mirror-zh-cn.png`，人工检查中文桌面与窄屏布局、进度/策略/连接边界和敏感信息。

## 5. 文档与交付门禁

- [x] 5.1 更新中英文 README、`docs/product-shape.md` 和 `docs/validation.md`，说明语言选择、持久化/隐私边界、使用方式和确切验证证据。
- [x] 5.2 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`、`pnpm public:check`、`git diff --check` 和 `openspec validate add-viewer-localization --strict`。
- [x] 5.3 从打包产物启动 loopback Viewer，复验英文/中文切换、刷新持久化、Mock 生命周期、静态资源包含翻译模块且停止后无残留 listener。
