## Why
现有工作台无法填写表单，第三方 App AI 文字入口需要可重复的输入、发送及结果断言，证明操作后业务状态而不只证明点击成功。
## What Changes
- 接入限定结构化 selector 的 YAML type，支持 replace/append 与空字符串清空。
- 复用 MirrorService 租约及 provider 输入，拒绝密码框、失焦与歧义，不启用 AppClaw 独立 ADB 回退。
- 添加第三方 App AI 文字正例和故意失败反例，逐步 PNG/XML 与结果哈希回溯。
## Capabilities
### New Capabilities
- `workbench-text-input`: 确定性文字输入及业务验收。
### Modified Capabilities
## Impact
影响 flow parser、受限设备 facade、worker 错误边界和工作台文档，不变更 Appium 会话所有权，不修复独立打包依赖问题。
