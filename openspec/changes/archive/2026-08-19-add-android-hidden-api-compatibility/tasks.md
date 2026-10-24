## 1. 配置与合并

- [x] 1.1 增加 `androidIgnoreHiddenApiPolicyError` schema 字段、安全说明和 bundle 默认值。
- [x] 1.2 在新建 Android Appium session 时注入默认 capability，并保证请求级显式 `false` 优先。
- [x] 1.3 增加配置和精确 Appium payload 测试，证明 iOS、Mock 与附着 session 不受影响。

## 2. 启动前提示与文档

- [x] 2.1 在 Viewer 的 Android 新建 session 路径显示 hidden API policy 兼容提示，并覆盖平台切换、附着 session 和显式严格模式。
- [x] 2.2 增加 Android 真机配置文档与 README 入口，说明默认值、profile/请求覆盖、风险和回滚方法。
- [x] 2.3 更新产品能力边界与验证记录，不再把物理 Android 标记为未验收。

## 3. 验证

- [x] 3.1 运行 OpenSpec strict、聚焦单元测试与 Viewer E2E，并保留/目检启动前提示截图。
- [x] 3.2 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build` 和 `pnpm pack:check`。
- [x] 3.3 在物理 Android 上不手写兼容 capability，完成 `start → PNG frame → safe action → stop`，确认 owned session 与本地 Appium 进程清理。
