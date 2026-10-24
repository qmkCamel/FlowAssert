# Android 补充验收：2026-09-16

范围：OnePlus 8T / KB2000、Android 14，Appium 3.2.0、UiAutomator2 6.8.0、scrcpy 4.1。使用隔离配置与正式 Viewer CLI，系统设置页作为非业务验证场景；原始手机截图、源树、日志和设备标识仅本机保留。

## 连接向导

首次检查 → 明确选择系统设置 → 确认 helper 副作用 → 保存本机配置 → 连接；关闭并重启 CLI 后，通过已保存配置快速连接 current-screen。两轮源树确认 com.android.settings 在前台，均可截图、录屏、切换主题并滑动。

| 样本 | 首帧 | 实际画面 | 滑动响应 | 停止 |
| --- | --- | --- | --- | --- |
| 首次设置连接 | 1,337 ms | scrcpy H.264，71 painted frames | 553 ms | idle、owned=false |
| 保存后快连 | 564 ms | scrcpy H.264，65 painted frames | 550 ms | idle、owned=false |

两轮视频分别为 VP8 864×1920、576×1280，均无音轨。已人工检查 Viewer 截图。样本耗时不作为设备矩阵或性能 SLO。

首次运行捕获到第三方 App前台且动作失败，未计通过，材料单独保存。随后添加 Appium 诊断日志，两轮设置验收通过；不据此宣称已定位首次失败根因。日志包装脚本曾影响 CLI driver 预检，修正其仅对服务启动添加日志后继续，该问题属于测试脚本。

## 语义输入及录像归档

语义输入通过：inspect → actionable 搜索入口 tap_node → focused re-inspect → replace `MOBILE-MIRROR` → append `-PUBLIC-ACCEPTANCE` → 完整文本精确核验 → clear → 退出搜索 → owned stop。保留并人工查看替换、追加和清空截图及结构。首次误选装饰容器被安全拒绝；之后实际发现 UiAutomator2 hint 追加丢字，修正 provider 后重验通过，见 [ADR 0005](decisions/0005-semantic-agent-actions.md)。新增六个回归覆盖 hint 原文保留、歧义拒绝、超限、焦点变化、写后不符、读取失败。

录像归档通过：run `e5212e94-aff4-499d-afc7-acd9db0ae86e`，系统设置 7 步 pass，与 Viewer 共用会话。VP8 864×1920、无音轨，11,400 ms / 2,196,290 字节；完整解码 342 帧、289 个不同帧哈希。SHA-256 为 `ea840f683951b9e1d2fda15b31ec54a4760883cc9f6b35ecf0e5cb6b46885957`。关闭设备会话并重启 Viewer 后恢复同一视频，播放及步骤跳转至约 1.90 秒成功。录制期间截图和主题切换可操作。

## 清理及证据

受控停止后宿主 4723/8200 无监听，ADB 转发在恢复服务前已与基线一致；恢复调试连接后，通过设备端筛选 `ps -A`（退出码 1、stdout/stderr 均空）确认无 UiAutomator2/scrcpy；原始全量 ps 输出仍有超时，因此保留诊断限制。

**环境限制**：本轮多次发生“ADB 能列出设备、shell/getprop 超时”，重新插拔/定向重连后仍复发；人工重启本机 ADB 服务后，连续读取及修正后的输入/录像流程通过。最终进程审计也需要恢复 ADB。该结果证明功能样本及最终无残留，不证明停止瞬间即可通过设备审计，也不代表已经解决 ADB 连接稳定性。产品没有增加自动重启 ADB 的行为，后续应单独定位 transport/媒体退出关联。

本机忽略目录：`artifacts/physical-validation/android-acceptance-2026-09-16/`。包含 guided-report.json、首轮与快连 PNG/XML/WebM、语义输入失败基线、Appium 日志、连接参数及 host-cleanup.json。未经筛查的原始材料不进入公开仓库或安装包。


录像原始材料位于 `artifacts/physical-validation/workbench-video-2026-09-16T06-34-35-772Z/`，含 probe.json、每步证据、recording.webm、ffprobe.json、frames.md5 和 restored.png；已打开检查重启回放画面，原始截图不公开。

工程门禁：309 项单测、41 项 E2E、类型/契约、build、pack:check 通过。OpenSpec 1.9.0 全库 strict 24/24 和公开内容检查通过。真实 Android 结果仅覆盖上述设备与场景，不扩展为任意应用或业务持久化证明。
