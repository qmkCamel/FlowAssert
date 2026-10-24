# iPhone 补充验收：2026-09-15

范围：当前 iPhone 16 Plus / iOS 26.2.1；Appium 3.2.0、XCUITest 10.19.1、Xcode 26.6。使用独立测试配置与正式 Viewer CLI，不修改默认 Viewer 配置或 DSH profile。首轮验收发现输入缺口后，按用户要求修复 provider/normalizer 并重验。Android 未在本轮补测。

## 结果

| 项目 | 结果与证据 |
| --- | --- |
| 首次连接向导 | 通过：检查 → 通用 iPhone 引用 → 设置预设 → 记住配置 → 设置 PNG/XML → 停止 |
| 保存后的快速连接 | 通过：关闭并重新启动正式 CLI，读取本次私有配置，点击快速连接；默认 current-screen；首次停止后设置已退出，快速连接正确展示当前主屏幕，PNG/XML 可读；未将主屏幕误称为设置页 |
| WDA MJPEG | 两轮通过，首帧分别 224 / 155 ms，9100 媒体无 fallback；该指标不是设备矩阵或性能 SLO |
| 手动截图/录屏 | 两轮通过，录制中截图、切换主题及滚动均成功；PNG 为当前源帧，视频 VP8/WebM 324×700，无音轨 |
| 视频实际解码 | 首次视频完整解码 204 帧、125 个不同帧哈希；快速连接视频完整解码 158 帧、158 个不同帧哈希，哈希详见本机材料 |
| iOS 应用生命周期 | 通过：设置 App foreground → terminate → not-running → activate/launch → foreground；Home 后确认 suspended → activate → foreground；最终 terminate → not-running，之后恢复设置 |
| epoch / 会话复用 | 受控 lifecycle epoch 3 → 4 → 5 → 6；激活后可重新 observe，同一会话可正常停止 |
| 普通文本输入 | 修复后通过：fresh inspect → tap_node → focused inspect → replace → append → 公共 marker 核对 → clear；真实 WDA clear/value 路径成功 |
| 密码框拒绝 | 通过：设置 → 无线局域网 → 其他网络的真实 SecureTextField，返回 screen_text_input_sensitive；取消表单，未加入网络 |
| 停止清理 | 各探针正常 dispose；最终独立检查 4723/8100/9100 无 listener，设备进程检查无 WDA runner |

## 首轮输入缺口与复现

在设置搜索框执行 inspect → tap_node → re-inspect。节点 platformRole 为 `XCUIElementTypeSearchField`，修复前 normalizer 未将其映射为 input；iOS 源结构不含 focused 属性，修复前 normalize 只读取该属性。实际 input_text 因 focused 不为 true 被拒绝。另行只读核验 WDA active-element 接口返回 200。

首轮没有发送实际输入，失败基线保留于 `lifecycle-report.json`，当时 task 11.4 保持未完成。

## 输入修复与重验

- 将 `XCUIElementTypeSearchField` 识别为普通 input；iOS observation 在源树读取前后查询 WDA active element、类型及 rect，仅稳定且唯一对应的输入节点标记 focused。失败、焦点变更、歧义或截断时拒绝推断焦点。
- 输入执行仍复核 active element/rect，密码框仍硬拒绝。工作台保留原始 XML，只有 observation 请求额外焦点信息，不改变 YAML source 路径。
- 最终代码在设置搜索框完成 8 个 M 的 replace、追加至 16 个 M、`MOBILE-MIRROR-PUBLIC-ACCEPTANCE` 精确值核对，再清空。对应 `input-fixed-report.json` 的 input=true；该探针随后因旧版“取消”按钮名称导致密码框导航失败，该失败没有计为通过。
- 独立 `secure-final.ts` 使用 iOS 26 实际“关闭”按钮完成其他网络表单导航，真实密码框请求返回 `screen_text_input_sensitive`，取消表单并正常停止；`secure-fixed-report.json` 记录 secureRejected=true、stopped=true。没有输入密码、提交网络或修改现有网络配置。
- 留存并目检普通 marker、清空及真实密码框截图；本轮关闭 iOS 11.4，Android 11.2 仍待真机补验。

## 验收过程中的修正

- 旧第三方 App探针的 Team/bundle 与现有签名构建不一致，首次预检返回 wda_profile_missing；从本机已签名 WDA 的 Info.plist/embedded profile 核对实际配置后，预检 ready。profile 的通配 application-identifier 不可直接作为 WDA bundle；没有注册设备、申请新 profile 或修改 Apple 账户。
- 首次建立会话后的源树读取曾失败，后续采用有界只读重试取得真实设置结构；失败没有记为通过。
- 测试专用 Viewer 重启后端口改变，页面恢复中文，早期探针误等英文 Streaming；修正探针语言选择后，完成快速连接验收。该探针错误不是 Viewer 连接失败。
- Home 后 app-state 存在异步过渡，最终探针先确认 suspended，再验证真实后台激活分支，未用 already-foreground 结果充数。

## 本机证据

原始材料仅本机保留在 `artifacts/physical-validation/iphone-acceptance-2026-09-15/`，不提交手机页面、签名数据、设备/session 标识：

- `guided-report.json`、`first-settings-source.xml`、`saved-quick-source.xml`。
- `first-settings.png` / `.webm`、`saved-quick.png` / `.webm`，两张对应 Viewer runtime 截图。
- `first-video-inspection.json`、`quick-video-inspection.json`、`first-frames.md5`、`quick-frames.md5`、`export-verification.json`。
- `lifecycle-report.json` 保存失败基线；`input-fixed-report.json`、`secure-fixed-report.json` 保存修复后的分阶段结果。
- `2-focused.json`、`3-replace`、`4-append`、`5-marker`、`6-cleared` PNG/JSON，以及 `secure-5-secure-form`、`secure-6-secure-navigation` PNG/JSON 保存最终代码输入和密码框证据。
- `input-device-processes-after.json` 保存最终输入验收后的独立设备进程检查。
- `device-processes-after.json`、探针脚本与独立测试配置。设备信任、Developer Mode 与 UI Automation 已由现有设备环境具备；本轮未覆盖首次弹窗授权。

对应任务：[连接向导归档](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-guided-device-connection-assistant/tasks.md) 9.5、13.3 完成；[语义动作](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-semantic-agent-actions/tasks.md) 11.4、11.5 完成。iPhone 媒体补验补充至[截图/录屏记录](viewer-capture-validation.md)。

## 工程回归

- 类型与契约检查通过；默认并行 `pnpm check` 两次因公开历史扫描超过 5 秒失败（其余 240 项通过）。
- 保持同一测试集与超时，`pnpm check --maxWorkers=1` 修复后串行执行 249/249（35 文件）通过；没有跳过测试或放宽断言。
- `pnpm test:e2e` 29/29、`pnpm build`、`pnpm pack:check` 通过；两个相关 change 的 OpenSpec 1.2.0 strict 校验通过。
- 真机 Viewer runtime 截图与导出 PNG 已目检；原始图片仅本机保留。
