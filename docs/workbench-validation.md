# 工作台最小闭环验证（2026-09-14）

Android 和 iPhone + 第三方 App的最小完整闭环均已在真机通过：原生 YAML 执行、同会话实时画面、逐步证据、重启历史与文件完整性。Android 在用户允许自动化 helper 后台运行后完成 12/12 步；iPhone 使用现有签名的 prebuilt WDA 完成 12/12 步。

## 本轮已验证

| 层次 | 结果 | 边界 |
| --- | --- | --- |
| 类型、契约、单元/集成 | `pnpm check`：33 个测试文件、224 项通过 | 其中工作台 18 项使用真正的 AppClaw 2.7.0 解析/执行器和可控 provider |
| 浏览器 | `pnpm test:e2e`：22 项通过 | 包含成功、失败、取消、原图读取、重启历史和操作期间其他控件可交互 |
| 构建 | `pnpm build` 通过 | ESM 入口与原生 worker 路径 |
| 打包 | `pnpm pack:check` 通过 | worker、Viewer 模块、工作台文档进入 tarball；原始设备证据不打包 |
| 构建后运行 | standalone CLI，5/5 步通过、5 份 PNG 及对应源树 | Mock provider，真实原生 YAML engine，不是手机实测 |
| OpenSpec | 该变更 strict 校验通过 | Inspector 的独立变更未纳入本次交付 |

构建后运行 ID：`9e3dedfa-fc4e-415f-8d15-2fefd6d09c8f`。会话始终为 `mock-iphone-15`，运行后 `session-retained`。

保留材料：
- [构建后运行摘要](https://github.com/qmkCamel/flowassert/blob/main/artifacts/metrics/mobile-mirror-workbench-compiled.json)
- [工作台运行截图](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-workbench-running.png)
- [证据与诊断截图](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-workbench-evidence.png)
- [构建后工作台截图](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-workbench-compiled.png)

负向验证包括：原生断言返回 false；引擎绿色但检查点内容改变；声明 blocker 命中；截图落盘失败；证据篡改与路径穿越；取消时等待已派发动作收敛；通信错误后封锁后续控制，直到断开重连；中断/损坏记录恢复；运行准备失败不遗留虚假的 running 记录；跨源调用及未明确同意本地留证被拒绝。

## Android 真机复验

2026-09-14 接入 OnePlus 8T / KB2000、Android 14，第三方 App版本 REDACTED_APP_VERSION。栈为 Appium 3.2.0、UiAutomator2 6.8.0、scrcpy 4.1、AppClaw 2.7.0。原 Appium 配置路径已失效，本次在仓库外安装固定版本并显式启动 loopback listener，复用已安装 driver。

用例见 [Android 第三方 App YAML](https://github.com/qmkCamel/flowassert/blob/main/examples/flows/sampleapp-android.yaml)：通过当前页面实际读取到的 accessibilityId 切换精选、首页，再返回精选，并断言页面标记。没有点赞、关注、发布或修改应用数据。

### 解除后台限制后的成功复验

运行 `f119b3b7-d98c-4470-ae63-d54c287e2e77` 于本地时间 15:01 开始，最终 `pass`：

| 验证点 | 结果 |
| --- | --- |
| 固定 YAML | 12/12 步，54,496 ms；精选 → 首页 → 精选，4 个声明 UI 断言全部通过 |
| 会话一致性 | 运行前、运行记录与运行后 sessionId 相同，执行结束后会话保留 |
| 实时画面 | 执行期间 relay 增加 1,132 帧；浏览器观测窗口约 20.44 fps、首绘 943 ms、receive-to-paint p95 6 ms；无 polling 回退 |
| 本地交互性 | 运行期间主题切换与历史刷新可用，保留运行截图 |
| 证据 | 每步各一张原始 PNG 和一份 XML，共 12 PNG + 12 XML，另有 YAML 与执行日志 |
| 回溯 | 停止设备会话并重启 Viewer 后，manifest 与原记录完全一致；全部 26 个文件通过 HTTP 读取和长度/SHA-256 校验，历史原图成功显示 |
| 清理 | 此轮正常 Stop 返回 idle，无需强制停止 helper |

已人工检查运行结果与重启历史截图，以及首页/精选检查点原图。原始材料在本机 `artifacts/physical-validation/workbench-2026-09-14T07-00-53-294Z/`，不进入发布包。后台设置改变后同一软件栈完成了流程，支持其为先前卡顿的主要影响因素；Toast listener 仍关闭，不能宣称该 ROM 的 Toast 反射问题已修复。用例不验证 Toast。

54.5 秒包含每步全尺寸 PNG 与源树采集，部分采集达到 7–8 秒；这是可回溯的闭环基线，尚未达到快速回归的性能目标。帧率是该内容与该设备观测窗口的实测值，不是恒定帧率承诺。

### 真机负向断言

随后以新的 owned session 执行 `b95488c1-f0e0-42d7-88c1-ae1b13e64864`：第三方 App仍在精选页时，故意声明 `assertNotVisible: { accessibilityId: SAMPLE_FEATURED_PAGE }`。工作台按预期输出 `fail`，在第 3 步中止，后续 done 没有执行；失败步骤的原图、源树及断言诊断已保留。全程 37,290 ms、3 PNG + 3 XML，与 YAML/日志合计 8 个文件均在 Viewer 重启后通过 HTTP 与 SHA-256 校验。同会话媒体增加 916 帧，浏览器约 24.38 fps、receive-to-paint p95 6 ms；运行时本地控件响应正常，Stop 正常返回 idle。

本机材料：`artifacts/physical-validation/workbench-2026-09-14T07-02-34-306Z/`。这是一条验证失败判定的负向用例，预期结果就是 fail；它不撤销前一条完整流程的通过结果。

### 设置前的失败记录（保留）

| 验证点 | 实测结果 |
| --- | --- |
| 首轮动作 | launchApp 与精选点击完成；后续截图耗时 66,922 ms，源树在 `UiElementSnapshot.addToastMsg` 路径报 `Cannot set AccessibilityNodeInfo's field 'mSealed' to 'true'` |
| 第二轮配置 | `waitForIdleTimeout=0`、`enableNotificationListener=false`；Toast 合成路径被关闭，但源树请求仍在 30 秒后超时 |
| 错误裁决 | 两轮均为 `inconclusive`，没有把已派发动作当成整条测试通过 |
| 同会话实时画面 | 第二轮 session 保持一致；执行期间 relay 增加 894 帧，浏览器 27.49 fps，首绘 902 ms，receive-to-paint p95 5 ms |
| 失败历史 | 第二轮服务重启后原始 manifest 一致，两份已保存的运行文件经 HTTP 读取及 SHA-256 校验；该轮未取得步骤截图，不能计为步骤证据闭环 |
| 设备诊断 | OPlus 在 UiAutomator2 启动约 11 秒后接管 `UiAut` 唤醒锁并代理该 UID 的 alarm；随后出现 HANS 对该进程的 accessibility RPC 记录。后台限制是需排除的主要阻塞，不能据此断言它解释了所有 Toast 反射异常 |
| 清理 | 首轮正常删除会话；第二轮删除也卡住，按明确 ownership 停止本次 UiAutomator2 helper 后完成退出；最终 Appium listener、UiAutomator2、ADB forward 与 scrcpy 均无本次残留 |

[脱敏指标](https://github.com/qmkCamel/flowassert/blob/main/artifacts/metrics/mobile-mirror-workbench-android-physical.json)包含失败与成功尝试。原始截图、源树、日志和运行目录位于本机 `artifacts/physical-validation/`，被 Git 与发布包排除。

探针现在会检查运行期间主题和历史控件响应、完成状态、重启历史、逐文件完整性，并保留失败摘要。正常操作超时与 Appium 建会话超时分开设置，避免把建会话等待时间用于每个步骤；没有截图的失败记录不会再被探针的截图等待错误覆盖。

## iPhone 真机复验

2026-09-14 通过 USB 连接并解锁 iPhone 16 Plus / iOS 26.2.1，开发者模式可用。实际安装第三方 App REDACTED_APP_VERSION（build 1079），包名与之前 PoC 不同，本次只在本机 YAML 中替换为通过设备安装列表确认的包名。Appium 3.2.0 + XCUITest driver 10.19.1 复用现有签名的 prebuilt WDA；AppClaw 2.7.0 仅提供解析/执行器，设备操作仍全部经过 MirrorService 持有的 Appium session，没有启动独立 AppClaw 设备栈或修改其 RemoteXPC。

成功运行 `c03bd07e-a1a1-4695-afd5-07edc9d1e798`：

| 验证点 | 结果 |
| --- | --- |
| 固定流程 | 启动第三方 App → 精选 → 首页，12/12 步，45,948 ms；5 个声明 UI 断言通过，包括页面特征与“跳过”遮挡排除 |
| 同会话实时画面 | 前后 sessionId 一致；执行期间 MJPEG relay 增加 509 帧，观测窗口 relay 约 10.87 fps；首幅图片显示 198 ms，无 polling 回退 |
| 指标边界 | MJPEG 在浏览器原生 img 中播放，当前探针只有首次 load，无法提供连续绘制 fps 与 receive-to-paint p95；不能与 Android 的浏览器绘制指标直接排名 |
| 本地交互性 | 运行期间主题切换与历史刷新成功 |
| 步骤证据 | 12 张 1290 × 2796 原图、12 份源树，另有 YAML 与执行日志；已人工检查精选原图、完成状态与重启历史截图 |
| 历史回溯 | Stop 返回 idle，重启 Viewer 后 manifest 完全一致；26 个文件经 HTTP 读取及长度/SHA-256 校验，历史原图可加载 |

[iPhone 脱敏指标](https://github.com/qmkCamel/flowassert/blob/main/artifacts/metrics/mobile-mirror-workbench-ios-physical.json)。原始材料仅在本机 `artifacts/physical-validation/workbench-2026-09-14T08-05-26-654Z/`，被 Git 与发布包排除。

负向运行 `1cab087a-9738-4f44-a967-0e65f0e994c7` 故意断言可见的“首页”应不可见，31,468 ms 后按预期在第 3 步得到 `fail`，没有执行后续 done。失败步骤包含一份真实可见节点的诊断、原图和源树；3 PNG + 3 XML 与 YAML/日志合计 8 个文件，在重启后全部通过校验。该轮 MJPEG relay 增加 466 帧，约 14.47 fps；本地控件响应、同会话与历史检查通过。材料位于本机 `artifacts/physical-validation/workbench-2026-09-14T08-06-57-586Z/`。

清理审计发现：正常 Stop 删除 Appium session 并释放 8100/9100 转发，Appium 退出后本次启动的 WDA xcodebuild 仍存活。已按启动时记录的精确 PID 发出 SIGINT，随后确认 host xcodebuild、设备上的 WebDriverAgentRunner 进程与 4723/8100/9100 listener 均消失；已安装的签名 runner App 保留。由此可以确认本次最终清理完成，但**不能报告为 WDA 自动生命周期回收已实现**，该行为仍需独立改进。

## 验收边界

最初 iPhone 不可用时没有把历史 PoC 计为集成通过；本次恢复连接后已补齐同会话的真机工作台验收。Android 与 iPhone 使用各自已安装版本的固定只读流程，不能推导为所有 App、系统版本和设备均已覆盖。

`pnpm test:workbench:physical` 已提供明确配置入口：指定已有 Appium、绝对路径 YAML 与能力 JSON 后，验证原生 YAML 期间媒体帧继续增加、sessionId 不变，保存运行截图、结果与证据。未检测到真机时不自动选择模拟器，也不另起 Appium。

验收范围仅为声明 UI 断言、声明 blocker 与证据完整性。未实现通用视觉校验、业务后台验证器、Inspector、输入/任意代码扩展、Maestro adapter 和录像。动作请求发出后取消不是回滚；会话保留不等于 WDA 已被销毁。
