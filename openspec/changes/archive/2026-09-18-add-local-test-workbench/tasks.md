## 1. 核心与执行
- [x] 1.1 固定原生 AppClaw 执行器、严格校验及隔离 worker。
- [x] 1.2 实现 MirrorService 独占租约、同会话工具适配及取消排空。
- [x] 1.3 实现运行协调、原子证据库、最终验收、恢复及重跑关联。
## 2. 产品闭环
- [x] 2.1 增加同源运行/历史/证据 API 与独立 Viewer 生命周期集成。
- [x] 2.2 增加 YAML 编辑、进度、取消、证据详情和历史 UI，保持其他控件可交互。
- [x] 2.3 更新 ADR、使用说明和可运行示例。
## 3. 验证
- [x] 3.1 覆盖原生执行器成功/失败、取消、独占、证据缺失/篡改、恢复及 HTTP 边界。
- [x] 3.2 浏览器运行闭环、交互性、历史重启和截图检查。
- [x] 3.3 执行 pnpm check、pnpm test:e2e、pnpm build、pnpm pack:check。
- [x] 3.4 用可连接的 iPhone + 第三方 App验证同会话执行与实时画面、证据和历史，记录硬件边界。
- [x] 3.5 根据用户补充的 Android 真机执行第三方 App完整流程，验证同会话媒体、步骤证据与重启历史。

硬件边界（2026-09-14）：Android 14 / OnePlus KB2000 在用户允许自动化 helper 后台运行后完成第三方 App 12/12 步、54.5 秒流程：同会话约 20.44 fps、12 PNG + 12 XML、重启历史与 26 文件校验通过，正常 Stop 返回 idle。此前 Toast 异常与读取超时的两份 inconclusive 记录保留；Toast listener 关闭，未验证 Toast。iPhone 16 Plus / iOS 26.2.1 恢复连接后，以现有 prebuilt WDA 完成第三方 App 12/12 步、45.9 秒流程与 26 文件重启校验；同会话 MJPEG relay 约 10.87 fps。双端故意错误断言均得到 fail 并保存完整失败证据。WDA xcodebuild 在 Appium 退出后仍存活，本次按精确 PID 清理，设备 WDA 及监听均已消失；自动回收尚未实现。详见 docs/workbench-validation.md。
