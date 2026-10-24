## Context

物理 Android 验收使用 Appium 3.2.0、UiAutomator2 6.8.0 和 Android 14 真机。默认 session 创建在 `settings put/delete global hidden_api_policy*` 阶段收到 `WRITE_SECURE_SETTINGS` 权限拒绝；加入 Appium 官方兼容 capability 后，插件完成 `start → PNG frame → swipe → PNG frame → stop`，并清理 owned session。

该权限限制取决于设备 ROM，安全的只读命令无法可靠证明后续写操作会被允许。因此不能为了预检而执行 `settings put/delete`，也不应要求用户 root 设备。

## Goals / Non-Goals

**Goals:**

- 让受影响 Android 设备无需每次手写 capability 即可启动。
- 保留请求级 `false` 的严格模式覆盖能力。
- 在用户启动前明确说明忽略 policy 修改错误可能隐藏后续兼容问题。
- 用假 Appium 服务器验证精确 payload，并在同一物理设备上回归完整控制链路。

**Non-Goals:**

- 不授予 `WRITE_SECURE_SETTINGS`、不 root 设备，也不修改 Developer options。
- 不假装通过只读预检能够预测所有 OEM policy 行为。
- 不在本变更中增加 scrcpy、Android 音频或多设备 session。

## Decisions

### 使用显式 schema 字段并默认启用

增加 `androidIgnoreHiddenApiPolicyError`，默认 `true`。该默认值只映射为 Appium capability，不直接执行 ADB 命令。用户可在个人 DSH profile 中长期覆盖，也可在单次请求中显式传入 `false`。

默认启用的理由是：标准设备在 policy 修改成功时不受影响；受 OEM 限制的设备可以继续启动；本次真机已经证明继续启动后截图、动作和清理均正常。代价是 Appium 警告后续 automation server 仍可能出现兼容问题，因此配置说明和 Viewer 必须在启动前呈现风险。

### 在 Appium provider 边界合并

`MirrorService` 把经过 schema 校验的 Android 默认值传给 `AppiumProvider`。Provider 仅在创建新 Android session 时合并，优先级为：请求 capability > 插件配置 > Appium 默认值。iOS WDA 默认值仍走独立合并逻辑；附着 session 不创建新 payload。

### 预检不执行有副作用的权限探测

Viewer 根据新建 session 的平台与请求覆盖值显示启动前提示。不会运行 `adb shell settings put/delete` 来验证权限，因为这会改变设备状态，且恰好是当前设备拒绝的操作。启动失败仍保留 Appium 原始可执行错误；默认兼容路径由真机 smoke 验证。

## Risks / Trade-offs

- [忽略 policy 错误后 UiAutomator2 仍可能异常] → 启动前提示风险，允许单次或 profile 设为 `false`，并要求保留真机回归。
- [默认能力影响所有 Android 新 session] → 仅注入一个 Appium 官方布尔 capability，测试证明 iOS、Mock、附着 session 不受影响。
- [ROM/Appium 升级后行为变化] → 验证记录固定设备系统、Appium 和 driver 版本，升级后重跑物理 smoke。
