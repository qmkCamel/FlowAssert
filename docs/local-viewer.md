# 本机 Viewer：一次配置，后续快速连接

修复闭环为 **Preview（预览能力，默认关闭）**，只适合受控项目试用。M1/M2 软件验证与 M3 Mock 安装协议不等于真实 App 修复验收；项目 `repair.enabled` 与宿主 `repairToolsEnabled` 分开控制，尚无统一总开关或 Viewer 一键开关。使用范围、审批与停用见[修复指南](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。

本指南面向只想在当前 Mac 上查看和控制已连接手机的用户。Viewer 是本机监督界面；DeepSeek Harness、Codex 和其他 MCP 宿主仍通过同一个 Local Device Bridge 使用 Agent 工具。页面与 Appium 默认都只监听 loopback，不是公网服务。

## 启动

Viewer 提供折叠的“环境前提检查”，可选基础运行、报告、Mock 或已登记测试；不会在打开页面时自动诊断。它与手机连接助手分开，失败保留旧结果，改变范围后旧结果标为历史。连接助手的低延迟媒体可选 off/preferred/required：不选时不查 scrcpy，可选失败保留 PNG，必需项未满足则阻止该连接要求。iOS MJPEG 只能在 session 建立后实证，因此只读预检不将其标为已验证。详见[预检指南](environment-preflight.md)。

在源码仓库中：

```bash
pnpm start
```

在已安装的发布包中：

```bash
flowassert-viewer
```

命令默认打开 `http://127.0.0.1:3210`，并读取本机私有配置：

```text
~/.config/deepseek-harness-mobile-mirror/viewer.json
```

设置了 `XDG_CONFIG_HOME` 时，配置位于该绝对目录下。专家可以用 `--config /ABSOLUTE/PATH/viewer.json` 和 `--port 3210` 覆盖；相对配置路径、未知参数或非 loopback 配置会直接拒绝。启动和页面加载都不会搜索 Appium、枚举手机或创建 session，只有用户点击检查/连接后才执行对应工作。

## 用例、运行记录与离线报告

当前默认首页是“用例”，连接和Mock演示在“设备”。“运行记录”提供报告筛选分页、失败导航、历史截图缩放、用例历史和趋势。新分析页“分享”可画框遮蔽、预览完整HTML、确认并下载；无需连接手机就能阅读已保留材料。高级兼容工作台使用 `#/legacy`。见[工作台指南](test-workbench.md)与[报告指南](report-reading-and-sharing.md)。

设备画面工具栏导出的临时截图/录像只在当前页面保留；工作台明确留证的run材料独立持久化，HTML则是人工审查后的派生阅读文件，三者不混同。

## 首次连接

1. 连接并解锁 Android 或 iPhone。Android 需接受 USB 调试；iPhone 需信任 Mac、开启 Developer Mode，并先完成一次 WDA 签名。
2. 打开 Viewer，选择 **Appium · 真机**，再选择 **Android** 或 **iPhone**。
3. 点击 **检查这台 Mac 与 USB 设备**。报告只显示公开版本、通用设备序号和稳定错误，不显示 serial、UDID、Team、bundle 或本机路径。iPhone 报告将本机签名前提与“WDA 运行未验证”分开显示，并提醒在 Xcode → Settings → Accounts 确认对应 Team 的账号；只读检查不会启动 WDA。
4. 选择要连接的设备；连接方式默认 **查看当前画面**。Android 需确认 UiAutomator2 可能安装或更新 helper APK；iOS 缺少签名默认值时填写 Team ID 和唯一 WDA Bundle ID。
5. 如需下次复用，勾选 **在这台 Mac 上记住已验证的配置**，再点击 **连接设备**。

iPhone 的“本机签名前提通过”不代表 WDA 能启动；点击连接后才会在现有 Appium session 路径上验证。若提示 `wda_developer_account_unavailable`，先登录对应 Apple 开发账号，再重新点击检查并连接；其他签名错误按 [iOS/WDA 指南](ios-real-device.md#常见失败)处理。失败时保留上一次可用画面和检查报告，连接过程中的主题切换等安全控件仍可操作。

“查看当前画面”不会指定、启动或重启业务 App；连接后在手机上打开希望查看的页面即可。首次自动化初始化可能短暂切换到启动页或主屏，因此不保证连接前的画面完全不变。若要诊断基础连接，可把连接方式改为 **打开系统设置**：该选项会主动切换到设置 App。Android 无法解析设置 App 时，只有该选项不可用，普通连接不受影响。指定其他 App 仍使用高级连接，不在默认向导里搜索或列出已安装应用。

保存发生在 Appium 启动和设备 session 创建之前；写入失败会停止连接，并保留刚才的检查结果供重试。配置目录权限为 `0700`、文件为 `0600`，同目录临时文件写完后原子替换。目标是符号链接、格式非法、包含未知字段或超过 64 KiB 时会 fail closed。

只保存重新验证过的 Appium 可执行文件、平台偏好和必要的 iOS Team/WDA Bundle 默认值，以及现有 Mirror 安全配置。不会保存设备 ID/名称、assistant token、raw capabilities、Apple ID、证书、私钥、密码、provisioning 授权或 Android helper 确认；浏览器状态只知道“已保存 Android/iPhone”，看不到具体值。不要把此文件复制进仓库。

## 后续快速连接

再次运行 Viewer 时，已保存的平台会显示 **检查并连接**：

- 一次点击先重新检查当前 Mac 与 USB 设备，再创建连接；不会在页面加载时自动操作主机。
- 快捷连接始终使用 **查看当前画面**，不沿用之前“打开系统设置”的选择；检查中切换平台或取消，不会继续自动连接。
- 只有“恰好一台设备、无阻塞项、不缺签名字段、保存的 runtime 可用”时才自动进入连接。
- 多台设备、设备未授权、Appium/driver 缺失、签名变化或任何歧义都会停在完整报告，不会猜设备或循环重试。
- Android 按钮和说明仍明确包含 helper APK 副作用，该点击就是本次确认。
- 连接可能需要较长时间：Appium server ready 仍使用 30 秒默认上限，真机 session/WDA 冷启动独立允许 120 秒；Stop 和其他安全界面控制仍保持可用。
- 停止仍先尝试删除本次 session；若 owned managed Appium 的删除响应与关闭竞争，只要本次 child 已成功静止并释放端口，Viewer 会稳定回到 idle。external Appium 的删除失败不会被吞掉，也不会终止外部 listener。

首次保存后需要重启 Viewer，才能让新保存的 managed Appium 配置成为完整 runtime 默认值。如果 4723 已由你手工启动的 external Appium 占用，请先按其正常方式停止；FlowAssert 不会接管或终止未知 listener。

## iPhone 画面与 MJPEG

iOS 自动媒体现在与 WDA 默认设备端口对齐：未显式设置端口时，Viewer 先探测本机 9100；可用时请求 `appium:mjpegServerPort=9100`，因此复用已编译/缓存的 WDA 不再因为随机设备端口而转发失败。

若本机 9100 已被其他进程占用，或 Appium 建立转发时发生端口竞争，FlowAssert 不会强制 `useNewWDA`、卸载 WDA 或随机改写设备端端口。它会保留可用的控制 session，并自动回退到 PNG screenshot polling。专家显式设置非零 `iosMjpegPort` 时，需要自行保证该值与 WDA 实际启动端口一致。

## 故障恢复

| 现象 | 处理 |
| --- | --- |
| 没有快速连接卡片 | 首次连接时勾选“记住这台 Mac”，成功保存后重启 Viewer。 |
| 快速连接停在检查报告 | 按报告处理设备授权、driver、签名或多设备选择，再手工连接。 |
| `assistant_persistence_failed` | 检查配置目录/文件所有权和权限；不要用符号链接作为配置目标。 |
| managed Appium 报 listener 冲突 | 正常停止自己启动的 external Appium；不要用 `pkill` 扫描清理。 |
| iPhone 首次连接超过 30 秒 | 新版本会给 WDA/session 120 秒；保持设备解锁并处理手机上的 UI Automation 提示。 |
| `viewer_media_port_unavailable` | 控制仍可用，Viewer 已回退 PNG；释放本机 9100 或明确配置与 WDA 一致的专家端口后重连。 |

平台专属准备和排障见 [Android 真机指南](android-real-device.md) 与 [iOS/WDA 指南](ios-real-device.md)。安全边界见[安全模型](security.md)。


## 手动截图与录屏

连接并显示手机画面后，右侧画面工具栏提供 **截图**、**开始录屏 / 结束录屏**。

- **截图**：保存当前显示的手机内容为 PNG，使用输入帧像素，不含网页按钮和手机装饰框。输入为压缩/缩放媒体时，质量与该媒体帧一致。
- **开始录屏**：红点和时长显示录制状态。录制中可继续操作手机、缩放、截图和运行 YAML 测试。
- **结束录屏**：生成带时间文件名的视频并尝试下载；工具栏下方保留最近截图/视频的下载链接。默认 WebM，浏览器支持时可用 MP4 fallback；只录手机画面，没有声音。

断开连接、切换 session、页面隐藏会自动结束；10 分钟或 128 MiB 上限也会结束。录屏保持固定画布，旋转和尺寸改变时等比留边。PNG 轮询降级仍可录制，但视频只反映 Viewer 实际收到的画面更新，不能当作设备原生全帧率录屏。

请在关闭页面前下载结果。自动下载被浏览器拦截时点击 **下载截图 / 下载视频**；链接只在当前页面有效，未加入工作台历史。录制错误尽可能保留可下载片段并标注不完整，截图失败保留上一结果。不支持录屏的浏览器会显示说明，截图仍可用。

验证记录见 [Viewer 截图与录屏验收](viewer-capture-validation.md)。
