# iOS 真机与 WebDriverAgent 签名

这份文档用于把一次成功的 WDA 签名沉淀到个人 DeepSeek Harness profile。插件不会保存 Apple ID、私钥、钥匙串密码，也不会绕过 Apple 的设备信任、Developer Mode 或签名要求。

## Viewer 连接向导（推荐）

完成下方一次 Xcode/WDA 签名后，打开本机 Viewer，选择 **Appium · 设备 → iPhone → USB 真机 → 检查这台 Mac 与 USB 设备**。本次点击只临时授权只读 Appium/XCUITest、Xcode、物理 iPhone、签名身份和 provisioning profile 检查；响应使用 `iPhone 1` 等通用引用，不返回 UDID、设备名、Team、证书、profile、路径或原始输出。无需签名的 Simulator 入口见[模拟器连接](simulators.md)。

个人 profile 已有 Team ID 与 WDA bundle ID 时直接复用；缺失时可在页面只为本次连接填写。默认只用于当前连接并立即清空；从正式 `flowassert-viewer`/`pnpm start` 启动时，用户也可以显式勾选“记住这台 Mac”，把重新验证的 Appium 路径、平台偏好和合法 Team/WDA bundle 写入仓库外私有配置。它不保存 UDID、设备名、capabilities、证书、Apple 凭据或 provisioning 授权。重启 Viewer 后，唯一可用 iPhone 可以通过一次“检查并连接”确认复用设置；详情见[本机 Viewer 指南](local-viewer.md)。主按钮为“连接设备”，默认查看当前画面，不指定 bundle 或主动启动/重启业务 App；首次 WDA 初始化可能短暂切换到启动页或主屏。只有显式选择“打开系统设置”才指定 `com.apple.Preferences`。向导仍不接收任意 bundle/capabilities。如果 `iosWdaAllowProvisioningDeviceRegistration=true`，向导会拒绝并要求关闭该持久高风险授权或使用高级入口。

iPhone 端的信任、Developer Mode 和 UI Automation 仍需人工确认；向导不会登录 Apple、导入证书、注册设备或自动签名。检查/连接失败后可 Clear 并重试；Stop 只删除插件拥有的 session 和本次 managed child，不终止 external Appium。需要持久配置时仍按下文写入个人 profile。

## 推荐路径：先由 Xcode 完成一次签名

1. 连接并解锁 iPhone，在手机上信任这台 Mac，并开启 Developer Mode；UI Automation 等设备端授权仍需人工确认。
2. 在 Xcode → Settings → Accounts 登录 Apple Developer 账号，确认钥匙串中有包含私钥的有效 `Apple Development` 身份。
3. 执行：

   ```bash
   appium driver run xcuitest open-wda
   ```

4. 在打开的 Xcode 工程中选择 `WebDriverAgentRunner` target：
   - 开启 Automatically manage signing；
   - 选择正确的 Team；
   - 设置团队内唯一的 Bundle ID，例如 `com.example.WebDriverAgentRunner`；
   - 选择已连接的物理 iPhone；
   - 执行 Product → Test，直到 WDA 成功安装并启动。
5. 使用相同的 Team、签名身份和 Bundle ID 写入个人 profile patch，然后运行 `mobile_mirror_ios_preflight`。

免费 Apple Developer 账号也可以走这条路径，但 profile 有效期和设备数量限制更严格；过期后需要在 Xcode 中重新签名。

## 持久化到个人 DSH profile

编辑 `~/.dsh/profiles/<profile>/cordis.patch.yml`。id 定向 patch 会替换命中的整个 `config`，因此示例显式保留所有配置项；只替换占位符，不要把个人值提交到本仓库：

```yaml
- id: mobile-mirror
  config:
    defaultProvider: mock
    agentScreenContentPolicy: mock-only
    appiumUrl: http://127.0.0.1:4723
    viewerHost: 127.0.0.1
    viewerPort: 3210
    frameIntervalMs: 750
    viewerMediaMode: auto
    androidScrcpyPath: ''
    androidScrcpyServerPath: ''
    androidScrcpyMaxSize: 1280
    androidScrcpyMaxFps: 30
    androidScrcpyVideoBitRate: 4000000
    iosMjpegPort: 0
    iosMjpegFramerate: 15
    iosMjpegScalingFactor: 50
    iosMjpegScreenshotQuality: 40
    startupTimeoutMs: 30000
    appiumSessionStartupTimeoutMs: 120000
    mockStartupDelayMs: 700
    allowHostDeviceDiscovery: false
    adbPath: adb
    xcrunPath: xcrun
    androidIgnoreHiddenApiPolicyError: true
    iosWdaXcodeOrgId: '<APPLE_TEAM_ID>'
    iosWdaXcodeSigningId: Apple Development
    iosWdaUpdatedBundleId: com.example.WebDriverAgentRunner
    iosWdaXcodeConfigFile: ''
    iosWdaAllowProvisioningDeviceRegistration: false
    allowHostSigningDiagnostics: true
```

如果团队使用 xcconfig，把 `iosWdaXcodeConfigFile` 改为本机可读的绝对路径。Team ID、UDID、证书名称、profile 内容和本机路径均属于个人或机器配置，不应进入 Git、截图或共享日志。

新建 iOS session 的能力优先级是：单次请求 capability > 个人 profile 配置 > Appium 默认值。请求中的显式空字符串或 `false` 也会覆盖 profile。Android、Mock 和附着既有 `sessionId` 不注入这些默认值。

回滚时删除这些 iOS 字段并恢复完整的原 config；若希望停用整个个人 patch，可将文件内容改为 `[]`。不要留下空文件或仅注释文件，因为那不是有效 patch。

## 预检

`mobile_mirror_ios_preflight` 默认返回 `host_diagnostics_disabled`，且不会执行任何主机命令。只有个人 profile 显式设置 `allowHostSigningDiagnostics: true` 后，它才会只读检查 Xcode、Appium/XCUITest driver、物理 iOS 设备、签名身份和 provisioning profile。

结果只包含布尔值、数量、版本、稳定错误码和操作建议，不返回 UDID、Team ID、证书名称、profile 内容或原始命令输出。`ready` 仅表示本机静态签名前提齐全；返回值中的 `wdaRuntime: not-verified` 明确表示尚未证明 WDA 能在这台 iPhone 上启动。以下四项始终需要人工确认：

- `device_trust`：iPhone 已信任 Mac；
- `developer_mode`：Developer Mode 已开启且重启确认完成；
- `ui_automation`：设备端 UI Automation 权限已允许。
- `xcode_account`：需要重建 WDA 时，Xcode → Settings → Accounts 中已登录对应 Team 的 Apple 开发账号。证书和本地 profile 存在并不能证明账号登录有效。

预检不会登录 Apple 账号、生成 profile、启动 WDA 或创建 Appium session。Viewer 的 iPhone 检查也会将“本机签名前提通过”和“WDA 运行未验证”分开展示；只有用户点击“连接设备”并成功创建真机 session，才算通过 WDA 运行验证。连接失败会保留检查报告及最后可用画面，按错误提示修复后应重新检查，再连接。完整真机验收仍需 `start → PNG/structure observation → observation-bound safe action → re-observe → stop`。

设备在线并完成签名后，可从仓库运行感知版探针；所有签名值只通过本机环境变量传入，不会输出：

```bash
MOBILE_MIRROR_PLATFORM=ios \
MOBILE_MIRROR_UDID=DEVICE_UDID \
MOBILE_MIRROR_IOS_TEAM_ID=APPLE_TEAM_ID \
MOBILE_MIRROR_IOS_WDA_BUNDLE_ID=com.example.WebDriverAgentRunner \
pnpm tsx scripts/physical-observation-probe.ts
```

探针保留最终 PNG，并只打印版本、尺寸、revision/epoch、结构节点数和 owned-session 清理状态。iPhone 离线、锁定、未信任或模型未实际收到图片时，都必须单独记录为未通过，不能用旧 Viewer 截图替代。

当前感知、MCP 感知和媒体真机探针默认将**每次运行**的原图与指标写入 Git 忽略的 `artifacts/physical-validation/`；不再覆盖仓库已追踪的历史示例截图/指标。显式 `MOBILE_MIRROR_EVIDENCE_PATH` 或 `MOBILE_MIRROR_MEDIA_*_PATH` 也必须指向该私有目录内。运行后仍需目检图片并在分享前独立脱敏。

### 语义文本与应用生命周期验收

这条路径会真实修改 Settings 普通输入并 terminate/activate Preferences，必须在 WDA 签名完成后由用户显式授权。人工解锁 iPhone、打开 Settings 并让普通可见输入框出现在页面；确认固定公开 marker `MOBILE-MIRROR-PUBLIC-ACCEPTANCE` 可以出现在保留截图中，然后运行：

```bash
MOBILE_MIRROR_PLATFORM=ios \
MOBILE_MIRROR_UDID=DEVICE_UDID \
MOBILE_MIRROR_IOS_TEAM_ID=APPLE_TEAM_ID \
MOBILE_MIRROR_IOS_WDA_BUNDLE_ID=com.example.WebDriverAgentRunner \
MOBILE_MIRROR_SEMANTIC_ACCEPT=1 \
MOBILE_MIRROR_APPROVED_APP_ID=com.apple.Preferences \
pnpm tsx scripts/physical-observation-probe.ts
```

探针只使用 fresh nodeId 和 WDA active element/rect，执行 `tap_node → focused re-inspect → replace marker → re-inspect → clear → terminate → activate/launch → re-observe → owned stop`。secure text、active element overlap 不足、target 不精确匹配或 attached session 都会在固定边界失败；不使用 label/XPath fallback、clipboard、arguments/environment 或通用 execute-script。stdout 不记录 marker、app/device/element/session id、签名值、capabilities 或 evidence 路径；保留截图只允许出现该公开 marker，并必须人工复核。

## WDA MJPEG 低延迟 Viewer

`viewerMediaMode=auto` 时，新建 owned iOS session 若没有显式 `appium:mjpegServerPort`，会先探测 WDA 默认端口 9100。`iosMjpegPort: 0` 表示：本机 9100 可用时请求 `appium:mjpegServerPort=9100`，使 Appium 的本机转发与复用/缓存 WDA 的设备端 MJPEG 端口一致；本机端口已占用时不争抢、不随机改写设备端端口，直接保留控制 session 并回退 PNG polling。session 成功后，插件通过 Appium Settings 设置：

- `mjpegServerFramerate=15`
- `mjpegScalingFactor=50`
- `mjpegServerScreenshotQuality=40`
- `mjpegFixOrientation=true`

这些值可在个人 profile 的有界字段中调整。默认 9100 forwarding 发生竞争时，provider 会只重试一次不带 MJPEG capability 的 session 创建；不会设置 `useNewWDA=true`、卸载/重装缓存 WDA 或用随机设备端端口碰运气。Settings 或 stream 失败只让 Viewer 回退 PNG，不删除已经可用的控制 session。插件不会设置 `mjpegScreenshotUrl`，因此 agent fresh screenshot 仍独立来自 Appium screenshot endpoint。

附着已有 session 时不会创建、修改或删除 forwarding，也不会修改 Settings；只有 attached capabilities 明确包含可达的 `mjpegServerPort` 才尝试只读订阅。紧急回滚使用 `viewerMediaMode: polling`。

媒体 P1 必须在物理 iPhone 上另行证明：本机 9100 可用时使用默认端口并获得首帧不超过 5 秒、持续变化窗口至少 8 fps；9100 冲突时保留控制 session 并回退 PNG；Appium action、fresh PNG 和 structure 同时可用；主动中断后 2 秒内回退，owned stop 只清理对应 forwarding/8100/session。普通 WDA 截图/动作 smoke 不能替代这些指标。

设备已解锁、WDA 签名已就绪且 loopback Appium 已启动后，可运行同一脱敏媒体探针：

`MOBILE_MIRROR_UDID` 必须填写 `hardwareProperties.udid`（通常形如 `00008...`），不要填写 `xcrun devicectl list devices` 展示的 CoreDevice 配对 `Identifier`。可先运行 `xcrun devicectl device info details --device DEVICE_NAME`，只读取输出中的 `hardwareProperties.udid`；探针不会把它写入证据文件。

```bash
MOBILE_MIRROR_PLATFORM=ios \
MOBILE_MIRROR_UDID=DEVICE_UDID \
MOBILE_MIRROR_IOS_TEAM_ID=APPLE_TEAM_ID \
MOBILE_MIRROR_IOS_WDA_BUNDLE_ID=com.example.WebDriverAgentRunner \
pnpm run test:media:physical
```

探针不会开启自动 provisioning/device registration。它验证有效 MJPEG relay、Viewer 可见首帧、10 秒 fps、媒体期间 fresh observation/安全动作、固定故障回退和 owned stop，并把 Viewer 截图与指标 JSON 写入 `artifacts/`。Viewer 截图可能包含手机个人内容，发布前必须人工复核，原始真机截图不要提交仓库。

2026-10-05 在 iPhone 16 Plus / iOS 26.2.1、Xcode 26.5、Appium 3.2.0、XCUITest 10.19.1 上重新执行：浏览器首显 134 ms，relay 在 10 秒内接收 144 帧（约 14.16 fps），安全动作后 fresh PNG 与 231 个结构节点可用，主动断流后 285 ms 回退，owned session 正常清理。测试画面静止，浏览器 `paintedFrames=1` 不用于声称动态内容 8 fps；上述 fps 是服务端持续接收帧的指标。运行时截图已人工检查；本轮原始图片/指标移至 Git 忽略的私有 `artifacts/physical-validation/ios-acceptance-2026-10-05/`，仓库追踪的示例截图与指标文件保持原样。完整对账见 [2026-10-05 真机验收记录](physical-validation-2026-10-05.md)。

## 三种运行方式

### 手工签名（推荐）

先在 Xcode 中执行一次 Product → Test，再把对应 Team 与 Bundle ID 写入 profile。这条路径最容易观察并修复 Apple 的具体签名错误。

### 自动 provisioning（显式授权）

仅当你接受外部状态变化时设置：

```yaml
iosWdaAllowProvisioningDeviceRegistration: true
```

这会向 XCUITest driver 传递 `appium:allowProvisioningDeviceRegistration=true`，从而允许 `xcodebuild` 更新 provisioning profile 或在 Apple Developer 中注册设备，可能消耗设备名额。默认值是 `false`；Viewer 会在新建 Appium session 前显示警告。单次请求可显式传 `false` 临时关闭。

### 预构建或预安装 WDA

已有稳定 WDA 制品的团队可以在单次 Appium capabilities 中使用 `appium:usePreinstalledWDA`、`appium:usePrebuiltWDA`、`appium:prebuiltWDAPath` 等 XCUITest driver 能力。插件仅转发请求，不管理制品、签名或设备安装状态。

## 常见失败

| 错误码或现象 | 含义 | 处理方式 |
| --- | --- | --- |
| `host_diagnostics_disabled` | 主机诊断未授权 | 只在个人 profile 中显式开启 `allowHostSigningDiagnostics` |
| `wda_signing_config_incomplete` | Team、Bundle ID 或 xcconfig 不完整 | 检查占位符是否已替换，xcconfig 是否可读 |
| `wda_profile_missing` / `xcodebuild` 65 | 没有匹配 WDA Bundle ID 的 profile | 用 `open-wda` 打开工程，选 Team 和唯一 Bundle ID 后 Product → Test |
| `wda_developer_account_unavailable` | WDA 构建明确报告对应 Team 没有已登录的 Xcode 账号 | Xcode → Settings → Accounts 登录该 Team 的 Apple 开发账号；重新检查 iPhone 环境后再连接。仅凭本地证书/profile 不能排除该问题 |
| `wda_signing_identity_invalid` / `0xe8008018` | 证书、私钥或签名链无效 | 在 Xcode Accounts 和钥匙串修复含私钥的 Apple Development 身份 |
| `wda_device_trust_or_developer_mode_required` | 设备拒绝安装或启动 | 解锁并信任 Mac，开启 Developer Mode，确认 UI Automation |
| `Timed out while enabling automation mode` | WDA 已启动但 XCTest 首次自动化初始化超时 | 保持设备解锁并确认 UI Automation；首次初始化失败被完整清理后可重试一次，重复失败再回到 Xcode Product → Test 检查设备提示 |
| Viewer 显示 `viewer_media_port_unavailable` | 默认 9100 已占用/转发竞争，或显式 MJPEG port 无效 | 控制 session 会保留并回退 PNG；释放已确认归属的 9100 listener 后重连，或显式配置与 WDA 实际端口一致的专家端口 |
| Viewer 显示 `viewer_media_stream_ended` | WDA MJPEG 断流或 multipart/JPEG 校验失败 | 控制 session 仍可用；确认 WDA forwarding 后重试，或设为 `polling` 回滚 |
| `ios_device_unavailable` | 未发现可用物理 iPhone | 检查 USB、解锁状态、信任弹窗和 `xcrun xcdevice list` |
| `wda_unknown_start_failure` | 其他 WDA/Appium 失败 | 在本机临时查看 Appium/Xcode 日志；分享前删除 capabilities、UDID、Team 和路径 |

## 已验证基线

2026-08-18 的截图/动作真机基线为 macOS arm64、Node 24.19.0、pnpm 11.7.0、DeepSeek Harness 0.1.0-rc.6、Appium 3.2.0、XCUITest driver 10.19.1、Xcode 26.6、iOS 26.2.1。

2026-08-19 在 iPhone 16 Plus / iOS 26.2.1 上进一步完成 MCP 感知闭环：WDA 11.1.4、430 × 932 portrait、有效 PNG、256 个未截断结构节点、observation-bound 安全滑动、revision/epoch 1 → 2 和 owned session 删除。升级 Xcode、XCUITest driver 或 WDA 后，应重新运行预检和真机 smoke。

`0.1.0-alpha.2` 的语义文本/应用生命周期脚本与确定性/fake-server 门禁已实现；上面的 iOS 物理语义命令尚需在用户显式授权且页面准备完成后单独运行，既有截图/滑动/MJPEG 证据不替代它。
