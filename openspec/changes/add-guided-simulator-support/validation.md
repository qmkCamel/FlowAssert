# 验证记录（2026-10-09）

实现位于个人版 `dev` 的本地未提交改动。本次不包含发布，也不把模拟器结果算作真机验收。

## 功能验收

| 对象 | 当前屏幕 | 系统设置 | PNG / 页面结构 | 自有 Appium 停止 |
| --- | --- | --- | --- | --- |
| iPhone 17 Pro / iOS 26.5 Simulator | 通过 | 通过 | 两种模式均保存 | 两次通过 |
| Pixel 6 / Android 13 Emulator | 通过 | 通过 | 两种模式均保存 | 两次通过 |

实测工具为 `scripts/simulator-connection-probe.ts`，经 Viewer 真实检查和连接入口创建会话；iOS 使用本机 Xcode + XCUITest 10.19.1，Android 使用 UiAutomator2 6.8.0。未传签名信息、未使用 raw capabilities 绕过向导。检查仅枚举已启动设备，模拟器由本轮验证手动启动并在结束后关闭；4799 上无遗留监听。

本地证据目录（被 Git 忽略）：

- `artifacts/simulator-validation/ios-2026-10-09T08-00-39-633Z/`
- `artifacts/simulator-validation/android-2026-10-09T08-03-06-342Z/`

各含 `probe.json` 及 `current-screen` / `settings` 的 ready、connecting、viewer、device PNG 和 structure JSON。已查看双端 Viewer 实测截图。最初 iOS 探针错误地在隐藏且尚未更新的连接按钮上判断 ready；修正为等待 report 和检查完成后重跑通过，原失败目录保留，未算作产品连接失败。

## 工程验证

- 最终连接策略、Appium provider、Viewer HTTP 定向测试：3 文件 / 64 项全部通过。
- `pnpm typecheck`、`pnpm lint:contracts`、`pnpm build`、`pnpm pack:check`：通过；模拟器使用文档包含在包清单，私有实测材料不包含。
- OpenSpec 全量 strict：53/53 通过。
- `pnpm check` 首轮并行执行与模拟器启动重叠，9 项超时/等待失败；`vitest run --maxWorkers=2` 完整复跑后为 1157 通过 / 1 失败。唯一剩余项为未改动的 `public-readiness.test.mjs` 全 Git 历史扫描超过 90 秒。未跳过、放宽或修改该检查，完整 check 门禁仍未通过。
- `pnpm test:e2e --workers=2`：88 通过、1 跳过、1 超时。超时项为内测引导中等待 `journey-run` 可用；单独原样复跑该用例通过（11.8 秒）。跳过项为已有的 1000 条报告目录性能抽样。新增模拟器交互用例首轮通过。
- Viewer 自动化覆盖类型切换失效、签名输入清理、Android helper 确认保留、检查期间语言切换、迟到检查不能覆盖新选择、连接期间禁用类型切换。
- 已保留 `artifacts/screenshots/simulator-ios-ready.png` 和 `simulator-android-ready.png`（假设备 UI 状态，明确不作实测）；其他回归生成的截图收于忽略的 `artifacts/runtime/simulator-regression-screenshots/`，避免覆盖无关既有材料。
- 其他 OCR、设备矩阵和修复回归产物保存在 `artifacts/runtime/simulator-regression-artifacts/`；门禁原始输出保存在 `artifacts/runtime/simulator-validation-logs/`。

## 限制

仅实测 PNG 和页面结构的连接闭环；业务 App 的 YAML、录屏、低延迟媒体及更多系统版本不在本次新增验收范围。完整工程门禁因历史扫描超时保持未通过。
