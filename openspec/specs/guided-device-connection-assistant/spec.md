# guided-device-connection-assistant Specification

## Purpose
定义由本机用户显式发起的 Android/iOS 连接引导、诊断、配置和重试流程，确保主机命令与设备操作权限清晰，并区分本机前提检查、WDA 实际启动和最终设备连接状态。

## Requirements

### Requirement: 平台连接检查必须由本地用户显式发起

系统 SHALL 仅在 loopback Viewer 收到带匹配 Origin、且用户明确选择 Android 或 iOS 的检查请求后执行对应平台主机诊断。Android SHALL 通过可注入、带超时和输出上限的命令边界检查 Appium/UiAutomator2、ADB 和物理设备授权状态；iOS SHALL 检查 Appium/XCUITest、Xcode、物理设备和 WDA 签名前提。页面加载、状态轮询、MCP/Harness 工具注册和插件启动 MUST NOT 触发这些命令。

#### Scenario: 打开 Viewer 不执行主机诊断

- **WHEN** 用户仅打开 Viewer 或读取镜像状态
- **THEN** 系统 MUST NOT 搜索 Appium/ADB、调用 Xcode/xcrun/security 或枚举设备
- **AND** 页面 SHALL 提供一个先选择 Android/iOS、再由用户点击的“检查设备连接”入口

#### Scenario: 用户发起一次检查

- **WHEN** 用户在 loopback Viewer 点击检查且请求通过 same-origin 校验
- **THEN** 系统 SHALL 并发执行有界的只读检查并发布动作局部进度
- **AND** 超时、取消或某一检查失败 MUST NOT 阻塞停止、主题切换和已有镜像状态读取

#### Scenario: 个人 profile 仍关闭通用 host discovery

- **WHEN** `allowHostDeviceDiscovery=false` 且用户从 Viewer 显式发起一次平台检查
- **THEN** 系统 SHALL 仅为该次 same-origin 助手请求执行所选平台的短期只读发现
- **AND** MUST NOT 修改 profile、启用 MCP/Harness 的设备发现或让授权跨请求复用

#### Scenario: Android 检查不执行 iOS 命令

- **WHEN** 用户选择 Android 并发起连接检查
- **THEN** 系统 SHALL 检查 Appium/UiAutomator2、ADB、在线/未授权设备和可选 scrcpy 状态
- **AND** MUST NOT 调用 Xcode、xcrun、security 或 WDA 签名检查

#### Scenario: iOS 检查不执行 Android 命令

- **WHEN** 用户选择 iOS 并发起连接检查
- **THEN** 系统 SHALL 检查 Appium/XCUITest、Xcode、物理 iPhone 和 WDA 签名前提
- **AND** MUST NOT 调用 ADB 或 scrcpy

### Requirement: 检查上下文必须脱敏、短期且不可重放

每次成功或部分成功的检查 SHALL 创建至少 128 bit 随机性的 `assistantId`，并为每台候选设备创建独立的 `deviceRef`。原始 Android serial、iOS UDID、设备名称、Team ID、证书/profile 内容、绝对路径和命令输出 MUST 只存在于服务端有界内存中；公开结果只能包含平台、通用设备标签、公开版本、布尔/计数、稳定状态码、人工确认项和过期时间。上下文 MUST 与所选平台绑定，在不超过 120 秒后过期，并在连接请求被接受时单次消费。

#### Scenario: 检查发现一台物理 iPhone

- **WHEN** 主机诊断发现一台可用物理 iPhone
- **THEN** Viewer 响应 SHALL 返回不透明 `deviceRef` 和通用 iPhone 标签
- **AND** 响应、日志与共享状态 MUST NOT 包含 UDID、用户设备名称、主机路径或完整命令输出

#### Scenario: 检查发现一台已授权 Android

- **WHEN** ADB 发现一台状态为 `device` 的物理 Android
- **THEN** Viewer 响应 SHALL 返回不透明 `deviceRef`、通用 Android 标签和非识别性的公开系统版本
- **AND** 响应、日志与共享状态 MUST NOT 包含 serial、用户设备名称、主机路径或完整 ADB 输出

#### Scenario: 使用过期或已消费的引用连接

- **WHEN** 客户端使用已过期、未知或已消费的 `assistantId`/`deviceRef`
- **THEN** 系统 SHALL 在启动 Appium 或创建 session 前拒绝请求并返回稳定 stale 错误码
- **AND** MUST NOT 泄露该引用是否曾映射到某个具体设备

### Requirement: 安全预设必须在服务端生成最小 capabilities

助手 SHALL 为物理 Android/iOS 提供默认的 `android-current-screen|ios-current-screen` 通用连接，以及显式可选的 `android-settings|ios-settings` 系统“设置”预设，并由服务端根据短期设备引用、平台检查结果及允许的 profile 默认值生成最小 Appium capabilities。current-screen MUST 设置 `autoLaunch=false`、`noReset=true`、`forceAppLaunch=false`、`shouldTerminateApp=false`，不传任意 app/package/bundle/activity，不查询或重新激活前台 App；Android 还 MUST 设置 `skipUnlock=true` 并保留 session 级 idle/action 上限。旧 Settings 预设语义不变：Android 使用 UiAutomator2、`com.android.settings` 和经只读解析得到的 activity；iOS 使用 XCUITest、`com.apple.Preferences` 及 WDA 默认值/本次受限输入。客户端 MUST NOT 接收完整 capabilities、serial/UDID 或已保存签名值；助手请求 MUST NOT 接受任意 app 标识、capability key、ADB/shell 参数或 provisioning 授权。

#### Scenario: 通用连接不指定业务应用

- **WHEN** 用户连接 Android 或 iPhone 的 current-screen 预设
- **THEN** MirrorService SHALL 以非自动启动、非重置的最小 capabilities 创建 owned session，并显示连接后设备的实际画面
- **AND** MUST NOT 指定或启动 Settings、自动重启前台 App、授予 target-app 应用管理权限，或跳过原有 Android helper/iOS 签名确认

#### Scenario: current-screen 的输入不合法或设备变化

- **WHEN** 请求传入任意预设、与检查平台不匹配的 current-screen、额外 capabilities，或设备在检查后离线
- **THEN** 系统 MUST 在进程/session 启动前拒绝请求，保持 TTL、单次消费和设备重验边界

#### Scenario: 连接 Android 系统设置

- **WHEN** Android 检查确认 UiAutomator2、已授权物理设备和可解析的系统 Settings activity，且用户确认连接
- **THEN** 系统 SHALL 在服务端生成最小 Android Settings capabilities，并由 MirrorService 创建 owned Appium session
- **AND** SHALL 设置 `forceAppLaunch=true`、session-scoped `waitForIdleTimeout=1000` 与 `actionAcknowledgmentTimeout=1000`，并按现有配置合并 `appium:ignoreHiddenApiPolicyError`
- **AND** 不得通过预检执行修改 hidden API policy、电池优化或后台冻结策略的 ADB 命令

#### Scenario: noReset 复用后台 Settings 进程

- **WHEN** Settings 进程仍存在但设备前台已切换到其他应用
- **THEN** 助手生成的 session SHALL 通过 `forceAppLaunch=true` 明确把 Settings 拉回前台
- **AND** MUST NOT 把其他前台应用的截图或结构报告为 Settings 连接成功

#### Scenario: OEM 持续 accessibility 事件

- **WHEN** Android OEM 页面持续产生 accessibility 事件，导致 UiAutomator2 等待 idle
- **THEN** 助手生成的 session SHALL 把 idle 与 action acknowledgement 等待限制在已声明的 1 秒上限
- **AND** timeout 后 MUST NOT 自动重放 tap、swipe、back 或其他可能已经发生的 mutation

#### Scenario: Android Settings activity 无法安全解析

- **WHEN** 只读 ADB 查询无法为所选设备解析 `android.settings.SETTINGS`
- **THEN** 助手 SHALL 阻止 Settings 预设连接并返回稳定修复建议
- **AND** MUST NOT 猜测 OEM activity、执行任意 shell 启动或回退到未声明的应用
- **AND** SHALL 保留已授权设备引用，公开该设备 `settingsAvailable=false`，以 warning 表示可选 Settings 不可用，并允许 current-screen 连接

#### Scenario: 使用个人 profile 中已配置的 WDA 默认值

- **WHEN** 用户选择“设置”预设且个人 profile 已包含可用 WDA Team 和 bundle 默认值
- **THEN** 系统 SHALL 在服务端合并这些默认值并创建 iOS Appium session
- **AND** Viewer 只 SHALL 显示“已配置”状态，不得返回实际值

#### Scenario: 本次补充缺失的签名字段

- **WHEN** 个人 profile 缺少 Team ID 或唯一 WDA bundle ID，且用户在本地 Viewer 为本次连接补充合法值
- **THEN** 系统 SHALL 仅将这些值用于本次服务端 session 请求并在完成或失败后丢弃
- **AND** 系统 MUST NOT 把这些值写入浏览器存储、仓库、日志、状态或 Agent 结果

#### Scenario: 请求助手自动注册设备

- **WHEN** 助手连接请求包含 provisioning/device-registration 授权或未知 capability 字段
- **THEN** 系统 MUST 在创建 session 前拒绝该请求
- **AND** MUST NOT 修改 Apple Developer 账户、provisioning profile 或设备注册状态

#### Scenario: 个人 profile 已开启自动设备注册

- **WHEN** 当前个人 profile 已设置 `iosWdaAllowProvisioningDeviceRegistration=true`
- **THEN** 助手 SHALL 把该连接标为 blocked，并提示关闭持久授权或使用明确暴露风险的高级入口
- **AND** 助手 MUST NOT 创建继承该授权的 session

#### Scenario: 必要检查仍被阻塞

- **WHEN** 所选平台的 Appium driver、物理设备或 iOS Xcode/WDA 任一必要项仍为 blocked
- **THEN** 助手 MUST 在消费连接上下文、启动进程或创建 session 前拒绝连接
- **AND** SHALL 保留检查结果并提供对应的稳定修复建议

### Requirement: Android 连接必须明确授权和设备副作用边界

Android 检查 SHALL 区分 `device`、`unauthorized`、`offline` 与其他 ADB 状态；只有 `device` 状态可以生成可连接的 `deviceRef`。助手 MUST 把设备解锁、USB 调试和 ADB 主机授权列为人工确认项，并在创建 UiAutomator2 session 前提示 Appium 可能在目标设备安装或更新 automation helper APK。助手 MUST NOT 自动接受调试授权、执行无线配对、root 设备、安装宿主依赖或授予 Android 系统权限。

#### Scenario: Android 设备未授权

- **WHEN** ADB 只发现 `unauthorized` 或 `offline` 设备
- **THEN** 助手 SHALL 返回 blocked、对应计数和人工授权/重连建议，但不得创建 `deviceRef`
- **AND** MUST NOT 尝试接受设备弹窗、重启 ADB daemon、无线配对或创建 Appium session

#### Scenario: Android 设备只通过无线或模拟器连接

- **WHEN** ADB 只发现 emulator 或 TCP/IP transport，而没有 USB 物理设备
- **THEN** 助手 SHALL 返回 unsupported/blocked，且不得为这些 transport 创建 `deviceRef`
- **AND** MUST NOT 自动执行 `adb pair`、`adb connect` 或把无线/模拟器设备伪装为 P0 真机通过

#### Scenario: 用户尚未确认 UiAutomator2 helper APK 副作用

- **WHEN** Android 设备已授权但用户未确认 Appium 可能安装或更新 helper APK
- **THEN** 助手 MUST 在 managed Appium 启动和 session 创建前拒绝连接
- **AND** 页面 SHALL 保留检查结果和显式确认入口

#### Scenario: scrcpy 未配置或不兼容

- **WHEN** Android 的 Appium/UiAutomator2/ADB 前提已通过，但可信 scrcpy 4.1 未配置或校验失败
- **THEN** 助手 SHALL 允许基础 Settings session 使用 Appium PNG polling 连接
- **AND** SHALL 把低延迟媒体标为可选 warning，不得自动搜索、下载、安装或执行其他 scrcpy 版本

#### Scenario: Appium server 可达但 Android session 命令超时

- **WHEN** loopback Appium `/status` 正常，但 UiAutomator2 session 的 screenshot、geometry 或 action 命令超过运行时上限
- **THEN** 系统 SHALL 报告稳定的 session-command-timeout，而不是把它误报为 Appium server 不可达
- **AND** SHALL 保留 stop、状态读取和最近一次可用画面，不得输出 session id、命令 path 或设备端异常堆栈

### Requirement: 助手连接必须复用唯一会话和进程所有权

助手 SHALL 通过 `MirrorService` 启动 Appium provider，并通过同一个 `AppiumRuntimeLifecycle` 完成外部 Appium 连接或用户确认的一次性受管启动。它 MUST NOT 创建第二套 provider、session 或进程清理逻辑；停止、失败和 runtime dispose SHALL 遵循现有媒体、provider-owned session、owned Appium child 的清理顺序。

#### Scenario: 已有外部 Appium 可用

- **WHEN** 检查确认 loopback Appium endpoint 已 ready 且用户选择连接
- **THEN** 助手 SHALL 复用 external runtime 并由 MirrorService 创建唯一 session
- **AND** stop/dispose MUST NOT 终止该外部 Appium 进程

#### Scenario: 用户确认一次性启动 Appium

- **WHEN** endpoint 未运行、检查已验证一个 Appium 绝对可执行路径，且用户明确选择“启动并连接”
- **THEN** 助手 SHALL 将该路径一次性装载到受管 runtime，等待真实 `/status` ready 后再创建 session
- **AND** stop、连接失败或 dispose SHALL 只清理本次 runtime 持有的 child handle

### Requirement: 本机连接默认值只能在显式确认后安全持久化

连接助手 SHALL 支持可选的 `rememberOnThisMac=true`，将已经重新验证的最小连接默认值写入独立于 DSH profile 和仓库的本机私有 Viewer 配置。可持久化字段 MUST 限于 managed Appium 绝对可执行路径、平台偏好，以及格式通过校验的 iOS Team ID/WDA bundle ID；系统 MUST NOT 保存 serial/UDID、设备名、assistant token/deviceRef、完整 capabilities、Apple 凭据、证书内容、provisioning/device-registration 授权或 Android helper APK 确认。持久化不可用或写入失败 MUST 在 Appium spawn/session 前 fail closed，并返回稳定静态错误。

#### Scenario: 用户记住已验证的 iOS 配置

- **WHEN** 用户使用重新验证的 Appium 候选和合法 Team/bundle 连接 iPhone，并显式选择“记住此电脑”
- **THEN** 系统 SHALL 以权限收紧、原子替换的方式保存 allowlist 默认值和 iOS 平台偏好
- **AND** Viewer 响应、DOM、日志和 Agent 结果 MUST NOT 回显这些值

#### Scenario: 用户不选择记住

- **WHEN** 用户提交同样的连接请求但没有设置 `rememberOnThisMac=true`
- **THEN** Appium/WDA 覆盖值 SHALL 只用于本次内存中的连接
- **AND** 系统 MUST NOT 创建或修改本机 Viewer 配置、DSH profile、浏览器存储或仓库文件

#### Scenario: 持久化目标不安全或写入失败

- **WHEN** 配置路径不是绝对路径、已有目标为符号链接、文件过大/结构非法，或原子写入失败
- **THEN** 系统 SHALL 返回 `assistant_persistence_unavailable` 或 `assistant_persistence_failed`
- **AND** MUST NOT 启动 Appium、创建 session、部分保存敏感字段或丢失当前检查结果

### Requirement: 连接结果必须可恢复且保留人工边界

助手 SHALL 把检查、连接和停止建模为可取消的有界阶段，返回稳定脱敏错误码和可执行建议。后续检查失败 SHALL 保留同一平台最近一次成功检查结果并明确标为 stale；Android 解锁/USB 调试/ADB 授权/UiAutomator2 helper APK 与 iOS 设备信任/Developer Mode/UI Automation/首次 WDA 签名分别 MUST 显示为人工或显式副作用边界，且不得伪装为自动验证通过。

#### Scenario: 第二次检查暂时失败

- **WHEN** 页面已经展示一次成功结果，而后续刷新因 xcrun 超时失败
- **THEN** 页面 SHALL 保留上一次结果并标明其时间和 stale 状态
- **AND** SHALL 展示本次稳定错误码、重试入口和仍可用的停止/状态控件

#### Scenario: Android 后续检查暂时失败

- **WHEN** 页面已经展示一次成功 Android 结果，而后续刷新因 ADB 超时失败
- **THEN** 页面 SHALL 只保留 Android 上一次结果并标明其时间和 stale 状态
- **AND** iOS 的 report/token MUST NOT 被替换或误用于本次 Android 连接

#### Scenario: iOS 自动检查全部通过

- **WHEN** 所有可自动验证的 Xcode、Appium、XCUITest、设备和 WDA 签名前提均通过
- **THEN** 助手 SHALL 将自动检查标为 ready
- **AND** 仍 SHALL 要求用户确认设备信任、Developer Mode 与 UI Automation，不能把它们报告为机器已验证

#### Scenario: Android 自动检查全部通过

- **WHEN** Appium、UiAutomator2、ADB、已授权设备和 Settings 目标检查均通过
- **THEN** 助手 SHALL 将 Android 自动检查标为 ready 或仅因 helper APK 确认而标为 action-required
- **AND** 仍 SHALL 展示设备解锁、USB 调试、ADB 授权和 helper APK 边界，不能把用户确认伪装为机器已验证

### Requirement: P0 平台范围必须明确

连接助手的首个版本 SHALL 支持 macOS 上通过 USB 连接物理 Android 与 iPhone。Android emulator、iOS Simulator、无线 ADB 配对、任意应用目录、自动安装宿主依赖、root/系统授权和 Apple 账号登录 MUST 保持在本变更范围之外；UiAutomator2 session 自身可能安装或更新 helper APK 的副作用仅在用户显式确认后允许。

#### Scenario: 请求不支持的平台

- **WHEN** 客户端向 P0 助手请求模拟器、无线 Android、任意应用或非 macOS host
- **THEN** 系统 SHALL 返回稳定 `assistant_platform_unsupported` 错误
- **AND** MUST NOT 执行该平台的主机命令或改变当前镜像 session

### Requirement: iOS 助手必须区分本机签名检查与实际 WDA 连接

iOS 连接检查 SHALL 展示本机签名前提结果，并单列“WDA 运行未验证，需连接后确认”。只有用户显式连接且现有 Appium 会话启动成功，系统才 SHALL 把设备视为可运行；助手 MUST 复用现有会话及资源所有权，不得为静态检查创建第二个 WDA session。

#### Scenario: 检查通过但缓存 WDA 无法启动
- **WHEN** 本机前提通过而已安装 WDA 随后启动失败
- **THEN** 助手 SHALL 保留“本机前提通过”和“运行验证失败”的区别
- **AND** MUST NOT 在正式测试开始前把该设备报为可运行

#### Scenario: 用户只点击只读检查
- **WHEN** 用户在 Viewer 中只点击 iPhone 连接检查
- **THEN** 系统 SHALL 展示运行未验证与 Xcode Accounts 人工准备建议
- **AND** MUST NOT 启动 Appium session、触发 WDA 编译、注册设备或执行测试用例

### Requirement: 助手必须保留安全的 WDA 启动失败原因

助手显式连接遇到已分类的 WDA 启动错误时，HTTP 结果和 Viewer SHALL 展示该稳定错误码对应的操作建议，不得误报 `assistant_input_invalid`。对外内容 MUST 仅包含稳定码和固定文案；错误后重试仍需重新检查设备上下文。

#### Scenario: Xcode 账号未登录
- **WHEN** Appium 在助手连接期间报告 `wda_developer_account_unavailable`
- **THEN** Viewer SHALL 提示在 Xcode Settings → Accounts 登录对应 Team 的开发账号后重新检查并连接
- **AND** MUST NOT 回显账号、Team、UDID、capabilities 或原始 Appium 错误

#### Scenario: 其他已知 WDA 签名错误
- **WHEN** 助手连接因缺失 profile 或签名身份无效失败
- **THEN** Viewer SHALL 显示对应的稳定 WDA 错误码和已有修复建议
- **AND** MUST NOT 把它归类为用户输入格式错误
