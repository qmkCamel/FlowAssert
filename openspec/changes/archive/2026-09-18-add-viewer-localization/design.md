## Context

Viewer 是由 `viewer/index.html`、`viewer/app.js` 和 `viewer/styles.css` 组成的无构建静态前端。当前英文文案同时存在于 HTML、动态状态渲染、连接助手检查项、媒体回退、错误处理和可访问性属性中；服务端返回稳定状态/错误码，但不承担界面语言协商。Viewer 还承载长操作进度、最后画面保留、短期连接授权和未提交签名字段，因此语言切换不能通过整页重建或重新请求来实现。

## Goals / Non-Goals

**Goals:**

- 完整支持 `en` 与 `zh-CN`，并提供键盘和辅助技术可用的语言选择器。
- 首次按浏览器语言选择，用户选择后仅持久化规范化 locale。
- 让静态文案、动态状态、错误、表单提示、标题和 ARIA 属性共用一份可审计的翻译目录。
- 切换语言时只重绘文案，不改变 session、设备、连接助手 token/report、媒体、操作或未提交字段。
- 保持现有英文 E2E，并新增中文及无损切换覆盖和中文运行截图。

**Non-Goals:**

- 不本地化设备/Appium 返回的应用名称、版本号、平台名、协议名、错误码或用户输入。
- 不引入服务端语言协商、第三方 i18n framework、远程翻译服务或新 HTTP API。
- 不修改 DSH/MCP 工具结果、设备控制策略、Appium capabilities 或 session ownership。
- 本 change 不增加繁体中文、其他语言、复数规则平台或翻译后台。

## Decisions

### 1. 使用依赖自由、键名驱动的 Viewer 翻译模块

新增一个随 Viewer 静态发布的 ES module，导出支持语言、locale 规范化、翻译目录和插值函数。`index.html` 的静态节点通过 `data-i18n`、`data-i18n-placeholder`、`data-i18n-aria-label`、`data-i18n-title` 标记；`app.js` 的动态状态统一调用同一 `t(key, params)`。

这样可以继续使用当前无 bundler 的 Viewer 交付方式，也能让测试枚举并比较中英文 key。备选方案是引入 i18next 或由服务端渲染两份 HTML；前者为两种语言增加不必要依赖和打包面，后者会把纯展示关注点带入 ViewerServer 并增加刷新/状态迁移风险，因此不采用。

翻译缺键时回退英文，并在测试中要求两个目录 key 完全一致；页面不得显示内部翻译 key、`undefined` 或空文案。产品名、Android/iPhone/Appium/WDA/scrcpy、版本和稳定错误码保持原值，周围解释性文字本地化。

### 2. locale 解析顺序固定且失败安全

仅接受规范值 `en`、`zh-CN`。启动顺序为：有效的 `localStorage` 偏好优先；否则按 `navigator.languages`/`navigator.language` 选择，任一以 `zh` 开头的语言归一为 `zh-CN`，其他语言回退 `en`。存储 key 使用带版本的专用名称，只保存 locale 字符串。

读取或写入 `localStorage` 被浏览器策略拒绝时，Viewer 继续使用内存 locale，不影响启动、连接或控制。用户选择语言后同步更新 `<html lang>`、页面标题、语言选择器的可访问名称和所有已渲染文案。

### 3. 语言切换采用纯展示重绘，不触发副作用

`app.js` 保留当前服务端 state、连接助手的分平台 report/stale/busy 状态和本地媒体失败状态。语言改变时先应用静态属性，再用现有缓存状态调用无副作用的展示函数；不得调用 fetch、重新检查设备、连接/停止、重置媒体、消费 assistant token，或改写 Team ID/WDA bundle/session/capabilities 输入值。

运行中的长操作保持原 busy/disabled 状态，只即时切换其标题和说明。相对时间与 120 秒过期提示按 locale 重新格式化，但底层时间戳不变。

### 4. 稳定枚举映射为本地化展示，原始宿主输出继续不可见

为生命周期、观察/控制阶段、媒体 transport/fallback、连接助手 status/check id/action、策略摘要和已知公开错误码建立显式 key 映射。未知值使用本地化通用文案，可附带已经允许公开的稳定错误码；不得把 raw command output、路径、capabilities、设备标识、签名值或服务端堆栈作为翻译 fallback。

### 5. 浏览器验收同时验证语言和状态不变量

Playwright 保持默认英文测试不变，新增中文首次选择/手动切换/刷新持久化测试，并在 Mock streaming 与连接助手 report 存在时切换语言，核对 lifecycle、画面、输入值、report、按钮状态和请求计数不变。截图固定使用受控 Mock/assistant 数据，保存 `artifacts/screenshots/mobile-mirror-zh-cn.png` 并人工检查桌面布局、窄屏换行和敏感信息。

## Risks / Trade-offs

- [新增文案漏接翻译目录，形成中英混排] → 测试比较目录 key，并扫描 HTML/动态渲染的关键用户文案；代码评审要求新文案使用语义 key。
- [语言切换意外触发已有 render 中的清理逻辑] → 把纯文案渲染与网络/表单清理分开，E2E 在 busy/report/输入存在时验证零请求和状态保留。
- [中文长度导致头部、按钮或移动宽度溢出] → 语言控件复用紧凑头部布局，允许标签换行，并保留桌面与窄屏截图/断言。
- [localStorage 不可用导致页面启动失败] → 所有存储访问使用窄范围 `try/catch`，内存 locale 仍可工作。
- [翻译稳定错误时掩盖诊断信息] → UI 展示本地化说明并保留公开稳定错误码；详细诊断仍以现有脱敏日志/验证路径为准。

## Migration Plan

1. 先加入翻译模块和完整目录，再给静态 DOM 增加语义标记并迁移动态渲染。
2. 保持英文作为非中文浏览器及异常情况下的兼容回退，现有 URL/API/config 无需迁移。
3. 补齐测试、中文截图和文档后运行 Viewer 全门禁。
4. 如需回滚，只撤销 Viewer 翻译模块、标记和语言控件；本地存储中残留的单个 locale 字符串不会被旧版本读取，也不影响服务端或设备。

## Open Questions

无。后续增加其他语言时应独立评估日期/复数/排版需求，不在本 change 中预留不受测试的通用框架。
