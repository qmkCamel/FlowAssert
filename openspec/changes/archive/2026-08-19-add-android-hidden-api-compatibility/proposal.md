## Why

Android 14 物理设备已经完成真实 Appium/UiAutomator2 验收，但部分 OEM 系统禁止 ADB shell 修改 hidden API policy。Appium 因缺少 `WRITE_SECURE_SETTINGS` 在创建 session 前失败，只有每次手工加入 `appium:ignoreHiddenApiPolicyError=true` 才能继续，当前开箱配置不可复用。

## What Changes

- 增加 schema-backed 的 Android hidden API policy 兼容配置，并在新建 Android Appium session 时默认注入对应 capability。
- 单次请求显式提供 `appium:ignoreHiddenApiPolicyError` 时保持最高优先级，允许用户选择严格失败模式。
- Viewer 在新建 Android session 前显示兼容风险提示；不通过写系统设置来探测权限，避免“预检”本身产生设备副作用。
- 增加 capability 精确载荷测试、配置契约、真机回归记录和 Android 配置说明。

## Capabilities

### New Capabilities

- `android-hidden-api-compatibility`: 定义 Android UiAutomator2 hidden API policy 兼容默认值、覆盖优先级、风险提示与真机验收。

### Modified Capabilities

无。

## Impact

- 影响插件 schema、Appium 新建 Android session 的 capability 合并、Viewer 启动前提示、契约测试和 Android 真机文档。
- 不修改设备的权限、Developer options 或系统设置；Appium 仍可能尝试设置 hidden API policy，配置只允许其在 OEM 拒绝时继续启动。
- Mock、iOS 和附着已有 Appium session 不读取或注入该 Android capability。
