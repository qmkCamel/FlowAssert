# Android 真机与 UiAutomator2 hidden API 兼容

这份文档用于配置和验证物理 Android 的 Appium/UiAutomator2 链路。插件不会 root 设备、授予 `WRITE_SECURE_SETTINGS`，也不会通过预检修改 hidden API policy。

## Viewer 连接向导（推荐）

完成 Appium、UiAutomator2 和 ADB 安装后，打开本机 Viewer，选择 **Appium · 设备 → Android → USB 真机 → 检查这台 Mac 与 USB 设备**。真机检查只读取 Appium/driver 版本、`adb devices -l`、系统版本和 Settings intent；它拒绝 emulator、TCP serial、offline/unauthorized 设备，不执行 install、pair、root、`settings put`、`am start` 或 ADB input。模拟器请切换设备类型，见[模拟器连接](simulators.md)。

选择 `Android 1` 等通用设备引用并确认 UiAutomator2 可能安装/更新 automation helper APK 后，点击 **连接设备 / Connect device**。默认“查看当前画面”，不指定或主动启动/重启 App，并保留手动解锁边界；首次自动化初始化可能短暂切换画面。需要诊断时可显式选择“打开系统设置”，该模式仍使用经解析并重验的 Settings activity 与 `forceAppLaunch=true`。Settings 解析失败只禁用该设备的 Settings 选项，不阻塞普通连接。Appium 未运行且配置为 external 时，可显式选择本次 `managed-once`；该选择只启动刚验证的 loopback executable 一次，不写回个人 profile。scrcpy 4.1 缺失只显示 PNG polling warning，不阻塞连接。

从正式 `flowassert-viewer` 或 `pnpm start` 启动时，可以在首次成功检查后勾选“记住这台 Mac”。它只把重新验证的 managed Appium 路径和 Android 平台偏好写入仓库外私有配置，不保存 serial、设备名、capabilities 或 helper APK 确认。重启 Viewer 后会出现一次“检查并连接”确认；仅发现唯一已授权 USB 真机时才自动进入连接，否则停在报告供选择。完整流程见[本机 Viewer 指南](local-viewer.md)。

手机端仍需人工解锁、开启 USB debugging，并接受这台 Mac 的 ADB 授权。向导不会自动修复依赖或接受弹窗。若检查失败，按稳定 action 修复后重试；需要 TCP 设备、任意 app 或 raw capabilities 时展开高级入口。回滚只需 Clear/Stop，或切回 Mock；插件只清理自己创建的 session/managed child。

## 点击或截图超时

`http://127.0.0.1:4723/status` 可达只说明 Appium listener 存活，不代表设备上的 UiAutomator2 session 能响应。Viewer 会把这两层分别报告为 `appium_server_unreachable`、`appium_request_timeout`、`appium_session_command_timeout` 或 `appium_session_command_failed`，不会显示设备 ID、session ID、绝对路径或 Appium 原始响应。

已建立 session 的 PNG 请求最多等待五秒；同一时间只发一个，连续三次失败后显示 degraded 并改为每十秒做一次 liveness probe。最后可用画面和内存缓存帧会保留，tap/swipe/back 的完成不再同步等待截图。mutation 若超时，设备是否已经执行未知，因此不要再次点击；先 Stop，再新建 session。scrcpy 4.1 已显式配置时，Viewer 优先等待媒体首帧，不会立刻用额外 PNG probe 抢占 Appium command queue。

ColorOS/OPlus 等 ROM 可能在 listener 仍健康时冻结 `io.appium.uiautomator2.server`。此时在手机系统设置中分别找到 UiAutomator2 server、UiAutomator2 server test 与 Appium Settings helper，允许后台运行并设为“不限制”或等价的电池策略；菜单名称随 ROM 版本变化。保持手机解锁和亮屏，然后停止旧 session 并重新连接。插件不会自动修改 OEM 电池策略、root、授予写权限或重放结果不确定的动作。若 owned Stop 本身也因 helper 冻结而超时，只停止本次明确拥有的 Appium 进程，并清理本次精确 ADB forward；不要使用进程表扫描或全局 `pkill`。

## 推荐配置

安装 Appium 与 UiAutomator2 driver，连接并解锁设备，确认 `adb devices` 中只有目标设备且状态为 `device`：

```bash
appium driver install uiautomator2
adb devices -l
appium --address 127.0.0.1 --port 4723
```

新建 Android session 时，仓库默认配置会注入：

```json
{
  "appium:ignoreHiddenApiPolicyError": true
}
```

部分 OEM Android 会拒绝 ADB shell 执行 `settings put/delete global hidden_api_policy*`，并返回缺少 `android.permission.WRITE_SECURE_SETTINGS`。该 Appium capability 允许 UiAutomator2 在 policy 修改失败后继续启动；它不授予权限，也不会绕过 Android 的应用授权模型。

Appium 明确提示：忽略该错误后，automation server 仍可能因 ROM 的 hidden API 限制在后续操作中异常。因此 Viewer 会在新建 Android session 前显示提示，升级系统、Appium 或 UiAutomator2 后必须重跑真机 smoke。

## 持久化与覆盖优先级

仓库 bundle 默认值已经包含：

```yaml
androidIgnoreHiddenApiPolicyError: true
```

如果个人 DSH profile 使用 id 定向 patch 替换整个 `config`，也必须保留该字段。有效优先级是：单次请求 capability > profile/bundle 配置 > Appium 默认值。

需要严格失败时，可在单次请求中覆盖：

```json
{
  "platformName": "Android",
  "appium:automationName": "UiAutomator2",
  "appium:ignoreHiddenApiPolicyError": false
}
```

也可以在个人 profile 中长期设置 `androidIgnoreHiddenApiPolicyError: false`。回滚不需要修改设备：恢复该字段为 `false` 或降级插件即可。

## 为什么不做写权限探测

安全的只读命令无法可靠证明 OEM 是否允许后续 `settings put/delete`。用真实写命令做“预检”会改变设备状态，且正是受限设备会拒绝的操作。因此插件只在发送 Appium 新 session payload 前合并配置并显示风险，不主动修改 hidden API policy。

## 可选：scrcpy 4.1 低延迟 Viewer

Android 连续画面固定兼容 scrcpy 4.1 framed H.264。请从 [scrcpy 4.1 官方 release](https://github.com/Genymobile/scrcpy/releases/tag/v4.1) 安装或取得受信任的 4.1 executable 和同版本 `scrcpy-server`。runtime 不搜索 PATH、不下载、不安装，也不会自动接受其他版本；升级 scrcpy 前需要同步更新协议 fixture 和真机矩阵。

先在个人终端确认实际路径和精确版本：

```bash
/absolute/path/to/scrcpy --version
test -x /absolute/path/to/scrcpy
test -r /absolute/path/to/scrcpy-server
```

第一条必须报告 `scrcpy 4.1`。然后只在个人 DSH/MCP 配置中填写真实绝对路径：

```yaml
viewerMediaMode: auto
androidScrcpyPath: /absolute/path/to/scrcpy
androidScrcpyServerPath: /absolute/path/to/scrcpy-server
androidScrcpyMaxSize: 1280
androidScrcpyMaxFps: 30
androidScrcpyVideoBitRate: 4000000
```

标准 portable/Homebrew 布局可把 `androidScrcpyServerPath` 留空，runtime 只会检查 executable 同目录和确定性的 `share/scrcpy/scrcpy-server` 前缀；非标准布局必须显式填写。不要把个人绝对路径提交到仓库。

scrcpy 只负责 `video=true`；`audio=false`、`control=false`。所有点击、滑动、返回和 session 清理仍走 Appium。浏览器缺少 WebCodecs、版本/路径不匹配、协议异常或断流时，Viewer 保留最后画面并恢复 PNG polling。紧急回滚只需设置：

```yaml
viewerMediaMode: polling
```

## 真机验收标准

物理设备必须完成以下闭环，假 Appium 服务器或模拟器不能替代：

1. 使用不含 `appium:ignoreHiddenApiPolicyError` 的 Android capabilities 启动插件；
2. 插件创建 owned Appium/UiAutomator2 session；
3. 获取有效非空 PNG；
4. 在系统设置页执行安全滑动并获取不同的最终 PNG；
5. 停止插件，确认状态回到 `idle`，UiAutomator2 进程与本地 Appium 监听均已清理。

媒体 P1 还必须在持续变化页面单独证明：10 秒窗口内首帧不超过 5 秒、绘制至少 15 fps、host receive-to-paint p95 不超过 100 ms；主动中断媒体后 2 秒内恢复 PNG polling；stop 后本 runtime 的 scrcpy child、精确 ADB forward 和唯一远端 jar 均消失。截图/动作 smoke 不能替代这些指标。

设备已解锁并停留在允许测试的持续变化页面、loopback Appium 已启动后，可运行脱敏媒体探针：

```bash
MOBILE_MIRROR_PLATFORM=android \
MOBILE_MIRROR_UDID=DEVICE_UDID \
MOBILE_MIRROR_SCRCPY_PATH=/absolute/path/to/scrcpy \
MOBILE_MIRROR_SCRCPY_SERVER_PATH=/absolute/path/to/scrcpy-server \
pnpm run test:media:physical
```

若普通页面没有足够的持续动画，可让探针通过 Appium 打开系统时钟并按可访问名称启动/暂停秒表；包名和 Activity 必须来自目标设备，只通过本次进程环境传入，不写入仓库配置：

```bash
MOBILE_MIRROR_ANDROID_APP_PACKAGE=SYSTEM_CLOCK_PACKAGE \
MOBILE_MIRROR_ANDROID_APP_ACTIVITY=SYSTEM_CLOCK_ACTIVITY \
MOBILE_MIRROR_ANDROID_DYNAMIC_SCREEN=stopwatch \
pnpm run test:media:physical
```

该模式只识别中英文的“秒表/Stopwatch”“开始/Start”“暂停/Stop”控件，使用 Appium 完成准备、正常 500 ms 安全滑动和收尾；scrcpy 仍固定 `control=false`，不会用 ADB input 伪造控制证明。若目标时钟没有这些可访问名称，探针会失败，不会回退到坐标猜测。

探针验证 Viewer 首帧/fps/receive-to-paint、媒体 live 期间 fresh observation 与安全滑动、固定枚举故障后的 2 秒回退和 owned stop；只输出脱敏指标，并把最终 Viewer 截图与 JSON 写入 `artifacts/screenshots/`、`artifacts/metrics/`。UDID、scrcpy 路径、端口、generation 和命令不会进入证据。

仓库提供感知版探针。先人工解锁设备并停留在允许测试的页面，再启动 loopback Appium：

```bash
MOBILE_MIRROR_PLATFORM=android \
MOBILE_MIRROR_UDID=DEVICE_UDID \
pnpm tsx scripts/physical-observation-probe.ts
```

探针使用 `image-and-structure` 核心策略执行 `start → PNG/structure → observation-bound viewport swipe → re-observe → stop`，只输出版本、尺寸、revision/epoch、节点数和清理状态，并把最终 PNG 留在 `artifacts/screenshots/`。它不会绕过 PIN/生物识别；设备锁定时只能证明锁屏观察链路，不能报告为已解锁 Settings 页面验收。

验证通用 MCP adapter 时使用 stdio 版本探针：

```bash
pnpm build
MOBILE_MIRROR_PLATFORM=android \
MOBILE_MIRROR_UDID=DEVICE_UDID \
pnpm run test:mcp:physical
```

它从 built MCP launcher 启动独立 runtime，通过 MCP image content/structuredContent 完成同一闭环，并保留 `mobile-mirror-mcp-android-physical-final.png`。设备仍需先由用户人工解锁；探针不会尝试绕过锁屏。探针显式要求把系统设置拉到前台，避免 `noReset` 复用后台进程时误验主屏幕；Android 验收会话同时把 UiAutomator2 的 `waitForIdleTimeout` 限为 1 秒，避免持续 accessibility 事件导致滑动后的结构获取长期阻塞。这两项都只作用于 Appium session，不会修改手机的系统设置。

### 语义文本与应用生命周期验收

这条路径会真实修改系统设置搜索框内容并 terminate/activate Settings，不能由普通 observation smoke 隐式触发。先人工解锁设备、打开系统设置并让一个普通可见输入框出现在页面中；确认固定公开 marker `MOBILE-MIRROR-PUBLIC-ACCEPTANCE` 可以出现在保留截图中，再显式运行：

```bash
MOBILE_MIRROR_PLATFORM=android \
MOBILE_MIRROR_UDID=DEVICE_UDID \
MOBILE_MIRROR_SEMANTIC_ACCEPT=1 \
MOBILE_MIRROR_APPROVED_APP_ID=com.android.settings \
pnpm tsx scripts/physical-observation-probe.ts
```

探针先用 `forceAppLaunch=true` 确保 Settings 位于前台。如果首页没有普通 input，Android 路径只允许从同一 fresh structure 精确选择 Settings 自身的 `search_src_text` 节点并以 observation-local `tap_node` 打开搜索页；它不会把 resource id 交给 provider 重新定位。`AutoCompleteTextView` 按 Android 可编辑控件规范化为 input。随后执行 `tap_node → focused re-inspect → replace 短公开 append probe → re-inspect → append → re-inspect → replace 完整 marker → evidence → clear → terminate → activate → re-observe → owned stop`。

语义搜索页会持续产生 accessibility 事件，因此该 session 使用 `waitForIdleTimeout=0`、`actionAcknowledgmentTimeout=1000`，每次 observation/mutation 另有 20 秒 probe 上限；超时 mutation 不自动重试，并按 may-have-mutated 规则重新观察和清理。找不到普通输入、焦点未建立、append 未保留旧值、target 不精确匹配或 secure 节点时立即失败，不使用 ADB input、clipboard、driver-specific set-value、shell 或坐标 fallback。stdout 不记录 marker、app/device/element/session id、capabilities 或 evidence 路径；保留截图只允许出现上述公开 marker，并必须人工复核。

## 已验证基线

2026-08-18 的物理基线为 KB2000、Android 14 / SDK 34、macOS arm64、Node 24.19.0、Appium 3.2.0、UiAutomator2 driver 6.8.0。该设备会拒绝 hidden API policy 写入；兼容 capability 生效后，真实系统设置页面完成了截图、滑动和 owned session 清理。

2026-08-20 在同一 Android 14 设备上完成 scrcpy 4.1 连续媒体验收。系统秒表由 Appium 启动并暂停，10 秒窗口取得首绘 738 ms、308 帧 / 30.27 fps、receive-to-paint p95 5 ms；媒体期间 500 ms 安全滑动和 fresh PNG/73 节点结构成功，主动中断后 466 ms 回退。最终 stop 删除 owned Appium session，4723、UiAutomator2/scrcpy process、owned ADB forward 和唯一远端 jar 均清空；最终截图和脱敏指标见验证记录。

2026-08-21 在同一 Android 14 设备上执行了两次独立 clean session 语义复验。两次的节点点击、聚焦、replace 和结果 re-inspect 均通过，并都在 append 结果复核处失败：UiAutomator2 6.8.0 对 ColorOS `AutoCompleteTextView` 的 append 请求没有保留已有值。这排除了单次启动/超时抖动；按照安全契约没有切换到 ADB input、clipboard 或 driver-specific fallback，输入已清空、截图未保留，Appium、UiAutomator2、scrcpy 和 ADB forward 无残留，因此文本验收保持未通过。独立应用生命周期闭环通过：foreground → terminate/not-running → activate/foreground，epoch 1 → 4，同一 session 可再次观察并完成 owned stop；脱敏证据和截图拒绝原因见验证记录。
