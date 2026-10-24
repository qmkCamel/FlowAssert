# 时间、持久性、健康与性能门禁

状态：工程预览。原 YAML、Worker v1 和五维结果保持原语义；只有显式使用下列能力时才产生 product/summary v2。真实业务、Android/iOS 健康信号放行与工程测试是不同证据。

## 使用入口

在高级 YAML 编辑器或项目 flow 中使用；保存/校验不执行手机动作。CLI、MCP、DSH 使用原运行入口，不启动第二个设备所有者。运行详情复用同一结果投影，显示采样/业务观察/重启、健康观察/排空阶段，以及测量阈值和结果。新步骤需高级源码编辑，不承诺可视化卡片编辑复杂谓词。

```yaml
name: Delayed result
platform: android
appId: dev.mobilemirror.runtimefixture
---
- launchApp
- measure:
    id: delayed-state
    maxElapsedMs: 20000
    steps:
      - tap: {accessibilityId: runtime.delay}
      - assertEventually:
          predicate: {assertVisible: {text: Complete}}
          withinMs: 10000
          pollMs: 1000
          maxSampleGapMs: 5000
```

- `assertEventually`：在截止前实际读到匹配结果才通过；迟到结果、采集错误、缺样为不确定。
- `assertStable`：从第一个有效采样起连续观察 durationMs；首个反例立即失败，禁止遇错重新计时。它证明有界采样窗口，不保证两个采样间永远没有闪烁。
- 纯谓词仅允许 `assert/assertVisible/assertNotVisible/assertCount`，或仅含 target/state 的 `assertReady`。完整树、有效阻断条件、父范围、唯一性和敏感节点检查不能省略。负断言不能凭空树或缺材料通过。
- 单个窗口 100–60000 ms，poll 100–5000 ms，maxSampleGap 100–10000 ms 且不小于 poll；最坏采样每断言 <=256、run <=1024，展开步骤 <=500。采样串行，不并发访问设备。stable 的总采集预算另加两个最大间隔，成功仍须覆盖原 duration。
- PNG/XML 每部分 <=1 MiB，每时间断言 <=16 MiB、运行材料 <=64 MiB；容量不可知或不足时在取得设备和副作用前拒绝，另保留 256 MiB 安全余量。传统归档仍为 64 文件/16 MiB，超限拒绝，不静默裁剪成“完整证据”。

## 重启后仍存在

参见 [固定预期 Fixture](../examples/runtime/persistence.yaml.example)。在重启前后分别断言固定的 Saved 1200，不能把重启前临时观察到的值当作新的预期。

`restartApp: {timeoutMs: 10000}` 沿用现有 App 控制授权，需 owned session、目标 App 一致、query/manage 能力和 session-app 或显式 allowlist。terminate/activate 各有持久化 operation ID；任何未知写入都阻断下一次动作，不自动重试，不清除 App 数据。重启使旧 observation 失效。

## 两次提交没有重复写入

参见 [two-submit 模板](../examples/runtime/two-submit.yaml.example) 与 [可信登记](../examples/runtime/project.json.example)。它需要自己授权的测试 App、唯一业务键和只读后端查询：模板不是已验收业务用例。

使用模板时将 project.json.example/two-submit.yaml.example 复制为同目录的 project.json/two-submit.yaml，并将 business-http/verify-only-once.mjs 复制到该目录。每次独立执行生成新的隔离 UUID 业务键，先配置授权后端的准备/清理 hook；示例不替你清理生产订单。

`assertBusiness` 要求登记 role=verify，observation.readOnly/repeatable=true、allowedModes 包含所选模式。默认 once，eventually 只重试合法 mismatch，异常/超时/迟到/缺失结果立即不确定。登记是对可信代码的声明，不是沙箱或静态证明只读。不得在 verifier 中点击、写订单或注册清理资源；凭据通过既有本机 credential 引用传入。

only-once verifier 单次调用内部观察一个有界唯一性窗口；只能登记 once，不能 eventually 把曾经重复的写入轮询到“只剩一条”。模板两次显式 tap 使用同一隔离业务键，suite retries=0；金额/归属/数量/状态固定检查，清理失败单独保留。样例 verifier 请求超时/字节/样本/总时限有界，不能证明窗口结束后的世界，也不能替代后端持久化/idempotency 约束。

这个查询只证明窗口内可见订单唯一及字段正确，不证明数据库物理写入次数，也不验证支付、通知等其他副作用。需要更强的“只发生一次”保证时，必须登记能独立查询那些事实的可信 verifier，不能从订单数量推断。

## measure 的含义

指标固定 `automation-observed-e2e`，不是生产 SLO、CPU/内存/FPS 或 App 内部耗时。单调时钟从块入口到块内动作、等待、实际断言与必要端点证据完成；包括驱动、截图/结构和本机持久化开销，不含块外 prepare/verify、health tail、cleanup 和最终报告写入。

最多 8 个不同声明 ID，最坏展开最多 256 个报告，不可嵌套；预算 100–60000 ms。循环实例单独保存，不以最快一次覆盖失败。块内至少实际执行一条成功断言；空分支、只有块外断言或快速功能失败均不能给性能通过。等于阈值允许；超预算失败；用户取消、run 截止、未知写入或 provider/材料故障为不确定。预算到期停止后续派发，不重试未知写入。

## App 健康能力

声明示例（当前真实来源不支持，会在任何 prepare/手机动作前拒绝）：

```yaml
runtimeGates:
  health: {signals: [crash, anr], tailMs: 2000}
```

| 来源 | crash | ANR | hang | 当前证据 |
| --- | --- | --- | --- | --- |
| Android ADB candidate | unsupported | unsupported | 不适用 | 可读 exit-info/logcat 不等于完整实时窗口 |
| iOS diagnostics candidate | unsupported | 不适用 | unsupported | 未获得授权实时诊断来源 |
| 受控 Mock collector | 合成协议验证 | 合成协议验证 | 合成协议验证 | 不作平台健康放行 |

来源必须证明进程世代、开始/结束 cursor、丢失检测、单调映射与排空确认；没有日志不能默认健康。窗口从 collector ready 到 prepare/执行/verify/tail 完成，最长 10 分钟；ready/drain/close 预算各 5 秒，collector 必须回收自己的进程并等待退出，不能关闭外部服务。正常显式 terminate 只关联匹配 operation ID 的正常退出，附近真实 crash 仍失败。旧事件、跨 App、PID 复用、其他矩阵槽位不混作本次违规。已确认违规与缺口并存仍保留失败，空流有缺口为不确定。

只读来源探针（退出码 2 表示尚未认可，不是命令异常）：

```sh
pnpm exec tsx scripts/mobile-mirror-cli.mjs health-probe --platform android --device SELECTED_DEVICE --app YOUR_TEST_APP --adb /absolute/path/to/adb
pnpm exec tsx scripts/mobile-mirror-cli.mjs health-probe --platform ios
```

发布包使用 `flowassert health-probe ...`。原始日志、设备标识、路径和私有 journal 不进入公开报告。私有归因窗口由原 run 持有，随证据读租约与保留生命周期一起保护，健康通过要重读其 hash 与归因结果。

## Android 合成真机验收入口

以下是开发源码中的专用 Fixture，不是生产业务 App。需要 Android API 26+、授权设备、JDK 17、Android SDK/build-tools 34，以及已配置 UiAutomator2 的 Appium。构建与首次安装：

```sh
ANDROID_HOME=/absolute/path/to/sdk ANDROID_BUILD_TOOLS=34.0.0 ANDROID_PLATFORM=android-34 node fixtures/runtime/android/build.mjs
adb -s SELECTED_DEVICE install artifacts/fixture/runtime-android/fixture.apk
```

确保 JDK 17 的 javac/keytool 在 PATH；在手机端确认系统安装提示并保持解锁，不绕过 OEM 安装授权。APK 使用独立本机调试签名，构建产物和密钥不进入 Git/发布包。用已选设备和本机 Appium 执行：

```sh
MOBILE_MIRROR_DEVICE_ID=SELECTED_DEVICE MOBILE_MIRROR_ADB_PATH=/absolute/path/to/adb MOBILE_MIRROR_APPIUM_EXECUTABLE=/absolute/path/to/appium pnpm exec tsx scripts/workbench-runtime-android-probe.ts
```

脚本只针对 dev.mobilemirror.runtimefixture，覆盖延迟/闪烁、固定值重启保留与丢失、时限正反例、取消；同时故意暂停自己的探针宿主 8 秒以验证采样缺口，自有辅助进程会恢复它。不会暂停/关闭其他宿主或外部 Appium/ADB 服务，不清除现有业务 App 数据。USB 断线场景需另加 MOBILE_MIRROR_MANUAL_DISCONNECT=1 并按提示人工拔线；默认明确记录 not-performed，不替你清空全局 ADB 连接。材料仅存 artifacts/physical-validation/，是默认忽略的本机私有目录。脚本准备完毕不代表真机已验收，当前健康来源仍不开放 crash/ANR 通过判定。

只重试人工 USB 场景时，再设置 MOBILE_MIRROR_RUNTIME_PROBE_MODE=disconnect（必须同时设置 MOBILE_MIRROR_MANUAL_DISCONNECT=1）。等脚本提示进入采样后拔线，结果保留后再插回；没有实际断线则该验收失败，不能记为通过。Fixture 1.1 将合成延迟/闪烁窗口延长，以确保真机自动化开销下仍能采到变化前后；探针要求实际保留负→正和正→反例样本，不靠单张最终截图确认时序。

## iOS 合成真机验收入口

`fixtures/runtime/ios/` 提供独立 dev.mobilemirror.runtimefixture，不覆盖 dev.mobilemirror.fixture 或其他 App。只存合成 Saved 1200，不联网。需要 Xcode、已授权并解锁的物理 iPhone、覆盖该设备和 Bundle ID 的有效本机 development profile，以及 profile 中对应的有效私钥身份；不需要 xcodegen。离线构建：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
FIXTURE_PROVISIONING_PROFILE=/absolute/path/to/existing.mobileprovision \
FIXTURE_SIGN_IDENTITY=EXISTING_CERTIFICATE_SHA1 \
MOBILE_MIRROR_DEVICE_ID=SELECTED_HARDWARE_UDID node fixtures/runtime/ios/build.mjs
```

构建器检查 profile 时效、设备、Bundle ID 与签名证书，支持一个 profile 中多个证书。不自动申请/更新 profile 或注册设备；签名制品、entitlements、profile 与构建身份仅存被忽略的 artifacts/fixture/。用 `xcrun devicectl device install app --device SELECTED_COREDEVICE_ID /absolute/path/to/RuntimeFixture.app` 安装新制品，并核对安装回执与版本。CoreDevice Identifier 与 Appium hardware UDID 不可混用。

沿用跨平台探针的历史脚本名称，显式选择 iOS：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
MOBILE_MIRROR_PLATFORM=ios MOBILE_MIRROR_DEVICE_ID=SELECTED_HARDWARE_UDID \
MOBILE_MIRROR_RUNTIME_IOS_APP_PATH=/absolute/path/to/RuntimeFixture.app \
MOBILE_MIRROR_IOS_WDA_BUNDLE_ID=YOUR_INSTALLED_WDA_BASE_BUNDLE_ID \
MOBILE_MIRROR_APPIUM_EXECUTABLE=/absolute/path/to/appium \
pnpm exec tsx scripts/workbench-runtime-android-probe.ts
```

默认使用已安装 WDA，不卸载重建。若选择已签名的预构建 WDA，再显式传 MOBILE_MIRROR_IOS_WDA_DERIVED_DATA=/absolute/path/to/verified/DerivedData；只执行 test-without-building，不允许 provisioning/device registration。每次只尝试启动一次；失败清理后才能另行重试。WDA 启用 automation mode 超时不是用例失败或签名必然错误，应查看本次 xcresult 并人工核对 UI Automation、解锁与信任，不能伪造真机通过或自动改设备设置。

与安卓相同的六组用例、取消、自有宿主暂停及人工断线均保留独立本机证据。默认 USB 为 not-performed；断线专用模式和人工时序要求同上，iOS 拔 USB 可能保留无线连接，必须实际证明观察中断而不能仅凭拔线动作宣称通过。iOS 本机签名二进制摘要与安装回执/版本分别记账，不冒充已读回安装后二进制。真实 crash/hang 来源未获认可时，预检仍拒绝必需健康信号；接通 WDA 与静态 unsupported 声明不完成 live 诊断来源任务。

## 版本及证据边界

| 数据 | 无新特征 | 显式新特征 |
| --- | --- | --- |
| Worker/flow 文档 | v1/原语法 | Worker 仍 v1，由工作台编译扩展 |
| product/summary | v1 | v2 + requiredFeatures |
| native archive 导入 | envelope 1 | envelope 3 |
| 脱敏派生分享 | envelope 2/rules 1 | envelope 4/rules 2 + requiredFeatures |
| change acceptance | v1 五维 | v2 七维 |

未知版本/特征拒绝可信读取，不能去掉字段降级。UI/business/visual/cleanup/evidence/health/performance 必需项共同决定可信结果；导入与派生结果不重新验证，不能提升为独立健康证明。旧 pass 不满足新维度；验收修订不能删 required 来变绿。JSON/JUnit/Viewer/CLI/MCP/DSH 共用投影，JUnit 在 v2 附加 health/performance 状态与原因，原 v1 golden 保持。

工程与设备验收、未完成项见 [验收审计](runtime-gates-validation.md)。安装/使用新 YAML 需要本次候选包；此前安装在电脑上的版本不会因源码变更自动升级。
