# Agent 运行已登记测试验收

更新：2026-09-18。本报告只记录 `add-agent-test-run-control` 已取得的证据；Android 与 iPhone 均已完成真机闭环，真实模型理解仍保持待验。

## 已通过

- 五工具共享契约：MCP、DeepSeek Harness Native 与 PTC 均完成 catalog → start → status → evidence；MCP 另完成 suite 与 cancel。
- 同一 `0.1.0-alpha.2` tarball 在临时目录干净安装。MCP 返回 15 个工具并通过 flow/suite/cancel/image；DSH `0.1.5-rc.2` clean profile 的 Native/PTC 均通过已登记 flow 与历史图片 attachment。
- 受理恢复：临时文件 fsync、原子 rename、目录 fsync 三个边界均注入故障。未形成持久受理的请求可重新提交；已 rename 的请求重启后保留 requestId/executionId，终态为 `inconclusive`，没有设备动作重放。
- 设备 owner：不同 runsDir、不同进程仍竞争同一个机器级 claim；PID 启动身份、nonce、旧 active claim 与清理失败均按拒绝接管处理。
- Viewer：Agent 与 Viewer 共用历史，来源标签可见；运行截图 [`mobile-mirror-agent-run-source.png`](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-agent-run-source.png) 已人工检查。
- 工程门禁：`pnpm check` 通过（48 个测试文件、393 项测试），`pnpm test:e2e` 44/44，`pnpm build`、`pnpm pack:check` 通过；OpenSpec change 与全量 30 项 strict 校验通过。
- iPhone 16 Plus / iOS 26.2.1：同一已登记 Fixture 项目完成单 flow pass、正例 suite pass、错误金额 suite fail、受理后 cancel；四个 execution 重启回查与证据摘要通过。全部业务 run 的 cleanup 为 pass，取消 run 未继续执行 UI；最终报告为本机 `artifacts/physical-validation/agent-control-ios-2026-09-18T08-21-13-099Z/report.json`，`complete=true`。
- 真机复验暴露并修复 `LocalDeviceRuntime.close()` 停止 managed Appium/WDA 后未释放设备 claim 的问题。修复后再次完成整套 iOS 用例，claim 自动删除，4723/47831/8100 无监听，手机无 WDA/xctest 进程；同时保留 external session 删除失败时不释放 claim 的安全边界。
- Android PLA110 / Android 16：通过 USB 与临时 `adb reverse` 使用同一 Fixture 项目，单 flow pass、正例 suite pass、错误金额 suite fail、受理后 cancel；四个 execution 重启回查与证据摘要通过。三个业务 run 的 cleanup 均为 pass，取消 run 为零步骤且 cleanup pass；最终报告为本机 `artifacts/physical-validation/agent-control-android-2026-09-18T08-30-27-771Z/report.json`，`complete=true`。
- Android 结束后 device claim、4723/47831/8200 listener 与 `adb reverse` 均已清理；未发现残留 UiAutomator2/Appium server 测试进程。系统安装的 `io.appium.settings` helper 仍存在并运行，不等同于活动测试 session。

## 仍待真机/模型证据

- `pnpm test:agent-control:physical` 仅接受显式 capabilities、预装 `dev.mobilemirror.fixture` 且禁止 reset；依次验证 flow、正/反 suite、取消、重启查询与证据摘要。Android 与 iPhone 均已通过，任务 4.3 已补齐。
- DSH 已验证图片附件进入宿主及图片/纯文本模型投影边界，但未发起真实模型调用，所以没有宣称“模型已理解并完成断言”。真实模型消费仍是任务 4.4。

## 结论

运行管理 API、持久幂等、设备 owner、共享历史、证据权限、两类宿主安装包和双端 Fixture 已形成可用闭环。发布前剩余门禁是两宿主真实图片模型消费；它属于验收证据缺口，不是五工具实现缺失。
