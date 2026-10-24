## Why

当前 Viewer 的静态文案、运行状态、连接助手和可访问性文本均只提供英文，中文用户需要在首次连接真机、理解权限边界和处理错误时额外翻译。项目已经同时面向中文与英文文档用户，因此 Viewer 需要提供完整、可持续维护的双语界面，而不是局部替换标题。

## What Changes

- Viewer 支持英文 `en` 与简体中文 `zh-CN`，提供始终可访问的语言切换入口。
- 首次访问按浏览器首选语言选择中文或英文；用户主动选择后只在本机持久化语言偏好，并在刷新后恢复。
- 静态文案、动态生命周期/进度/媒体/连接助手/错误文案、表单提示、标题和 ARIA 属性统一通过同一翻译目录渲染。
- 切换语言时保留当前设备 session、最后可用画面、连接助手报告、正在执行的操作和用户已输入但尚未提交的字段；不得触发设备或宿主命令。
- 为中英文路径补充 Playwright 覆盖并保留一张经过人工检查的中文运行截图。
- 更新中英文 README、产品形态和验证记录，说明语言选择与本地持久化边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `local-mirror-viewer`: 增加 Viewer 中英文选择、完整文案本地化、语言偏好持久化、运行态无损切换和可访问性要求。

## Impact

- 主要影响 `viewer/index.html`、`viewer/app.js` 和少量 `viewer/styles.css`。
- 影响 Viewer Playwright 断言、运行截图以及 README/产品/验证文档。
- 不修改 Viewer HTTP API、MirrorService、Appium provider、MCP/DSH 工具 schema、设备发现或 session ownership。
- 不增加第三方运行依赖；语言偏好只保存在浏览器本地，且不得包含设备、session、签名或输入内容。
