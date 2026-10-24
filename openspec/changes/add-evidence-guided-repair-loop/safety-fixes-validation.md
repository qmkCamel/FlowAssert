# 页面范围与自有 iOS 转发修复（2026-10-06）

10-07 当前状态补充：dev@REDACTED_REVISION 的新 iPhone 真机探针完成 13/13、114 份证据重启复读，实际会话 WDA/MJPEG 本机监听与清理均已核对。12.6 完成，54/65；下文“离线待重连”是 10-06 历史，不再是当前设备阻塞。原 preinstalled-WDA 启动超时保留，已签名 WDA 副本重试成功；完整修复闭环仍缺真实构建、reset/cleanup、精确审批与独立验收。详见 [10-07 对账](../../../docs/physical-validation-2026-10-07.md)。

## 范围与实现

当前工作树 `docs/repair-verification-design`，基线 `REDACTED_REVISION` 加未提交实现，不声称已合入最新 dev。本轮不构建安装业务 App、不修改全局依赖或其他会话、不调用模型、不冒充审批。

| 问题 | 修复 | 证据边界 |
| --- | --- | --- |
| 正确标题登记被 application-only 误拒绝 | v2 精确锚点与明确祖先容器，兼容 Android TextView 和 iOS StaticText | Android 新真机通过；iOS 新实时探针因离线未执行，历史结构回放通过 |
| 同 App 错页误点 | 旧 App 根登记不再授权；唯一锚点、完整层级、容器归属及几何包围检查；目标不可自我授权为页面锚点 | 双端合成结构、实际 Workbench/Mock 准入与执行、Android 新真机错页零派发 |
| 原 locator 存在时 recovery 忽略 page | 首次点击、fallback 均检查 page，durable intent 后复核 App／页面／快照；fallback 再核对几何、新鲜度和取消 | 普通恢复集成回归，原 locator 存在但错页、intent 后真实页面变化均不派发 |
| WDA/MJPEG host forwarding 全网卡监听 | 自有 Appium 子进程 preload 固定版本和源文件指纹，精确改写共用转发工厂的 listen 为 127.0.0.1 | 真实 XCUITest 工厂双监听／释放通过，无手机连接；不覆盖 external Appium 或手机端 WDA |
| WDA 超时中的“might be locked”被当成确诊 | 只有明确 device is/was locked 等事实触发锁定分类，含糊建议保留 unknown | 错误分类回归 |
| 派发前拒绝被误报 unknown | 将 journal 的 not-dispatched intent 保留为 blocked/not-dispatched；仅缺失目标且空派发区间才允许 missing 事实 | intent 写盘后页面变化，零点击、不授予自动修复 |

登记示例及迁移限制见 [操作指南](../../../docs/evidence-guided-repair-operations.md)。旧登记只读兼容；重新登记使 project revision 和审批摘要改变，不追写历史证据。

## 最新 Android 真机

OnePlus 8T / Android 14，Appium 3.2.0、UiAutomator2 6.8.0，预装合成 Fixture。运行 [repair-android-physical-probe.ts](../../../scripts/repair-android-physical-probe.ts)，独立端口 4737/8207。两轮均 10/10，最后一轮根为 `artifacts/physical-validation/repair-android-2026-10-06T09-16-08.385Z`。

正确页面 `pass/passed`，错页 `inconclusive/blocked/not-dispatched`、零点击；缺失、歧义、禁用、相似目标及原业务断言失败保持各自结果。93 份证据重启复读，同设备第二 owner 拒绝，自有会话清理通过；结束后检查无上述本机监听。未验证旧构建锚点、精确人类审批、安装、可信业务 reset 或两次修复复验，不授予 device-verified。

## iPhone 当前限制

本轮 root `artifacts/physical-validation/repair-ios-2026-10-06T09-03-35.449Z`：零场景，在建立会话前返回 `wda_unknown_start_failure / Unknown device or simulator UDID`。Xcode xctrace 列为 Offline，capabilities 与已知设备身份一致；自有清理完成，4738/8118/9118 无监听。不能把 devicectl 的 available (paired) 当成 Xcode 可运行状态。

使用 08:06 历史完整结构只读回放：正确标题页 v2 容器／目标校验通过，同 App 错页拒绝，旧 application-only 拒绝。这是历史证据解析，不是新 iPhone 操作证明。更新后的脚本有 13 场景，增加 v2 错页反例，并将旧 App 根授权的正例改成明确的弃用拒绝；原正确标题正例和错页零点击要求没有放宽。实时验收单列任务 12.6，待重连。

## 本机真实上游工厂验证

使用 [appium-loopback-runtime-probe.mjs](../../../scripts/appium-loopback-runtime-probe.mjs)，Node 24.19.0，以 `--import ./scripts/appium-loopback-guard.mjs` 加载 hook；显式提供本机已安装的工厂路径。XCUITest 10.19.1 源文件 SHA-256 为 `7b4c45e6145d37b6036f60d085f3182653551f2c32709a6573983671fef56657`，运行前后未变化。

报告 `artifacts/physical-validation/loopback-forwarder-2026-10-06T09-06-39.886Z/report.json`：分别以设备端口 8100／9100 创建真实 host forwarder，监听地址均为 IPv4 127.0.0.1；释放后无 cached connection，TCP 连接失败确认端口关闭。无设备请求、无 WDA 会话，仅证明本机转发工厂与 hook 正常。脚本本身静态加载 guard，忘记命令行 `--import` 也不会临时建立全网卡监听；再次直接运行验证同样通过，报告为 `loopback-forwarder-2026-10-06T09-21-00.644Z`。未知版本、源文件变化和匹配点数量异常另外由子进程测试拒绝；普通 Node 服务不被 hook 修改，子进程 env 不污染父进程、不丢 owner nonce。

## 仓库门禁与剩余验收

最终门禁：`pnpm check --maxWorkers=2` 为 113 文件／958 测试全部通过；`pnpm test:e2e` 66/66；`pnpm build`、`pnpm pack:check`、`pnpm test:application:probe`、`pnpm test:mcp:probe` 均通过。严格 OpenSpec 41/41，`git diff --check` 无问题；dry-run 清单含 guard 和 patch，构建模块的 preload URL 指向随包 scripts。默认 MCP 20 工具保持不变。原有 Mock 截图与发布清单一度不一致，完整 E2E 重生成规范截图后哈希恢复、清单无最终修改；迭代期间运行中的检查曾混用新测试／旧模块，不算最终通过证据，最终全套在代码冻结后重新启动并通过。

本轮按 user-action-contract 复验长任务中的历史、证据、语言等无冲突交互，保留并检查 `artifacts/repair-case/repair-build-running-desktop.png`；属于浏览器合成流程，不证明真实业务构建。新增 12.1–12.5 完成，12.6 待设备重连，整体 53/65，不把剩余完整闭环任务勾选为完成。具体时间线在 [实施记录](implementation.md) 对账。

原任务 5.3/5.4/7.6/8.2/9.3/9.5/10.1–10.4/11.4 保持未完成：分别缺完整双端修复材料、非作者复核、实际双宿主运行、真实制品检查及安装证明、Appium 可信 reset/cleanup 和复验适配、真实业务与独立研究。手机连接恢复只能解除 12.6 的设备依赖，不自动解除上述前置条件。未同步主规格、归档、提交或推送。

## 提交前复核（2026-10-07）

本次提交目标为 `docs/repair-verification-design` 独立开发分支，不合入或覆盖 `dev`。纳入修复闭环实现、安全修复、测试、中文 OpenSpec 和合成场景截图；真机私密原始记录与其他测试生成的截图不纳入提交。

在代码未改变的前提下重新运行：`pnpm check --maxWorkers=2`（113 文件／958 测试）、`pnpm test:e2e --workers=2`（66/66）、`pnpm build`、`pnpm pack:check` 均通过。首次默认 5 worker 的 E2E 为 65/66，既有 `capture.spec.ts` 解码间隙用例未在 500 ms 窗口内观察到 disabled；未修改该用例或生产代码，降低并发后完整复测通过，保留首次失败事实。复测重新生成并检查了修复构建中与安装阻塞截图，仍仅是合成浏览器证据。

OpenSpec 1.9.0 的 `validate --all --strict --no-interactive` 为 41/41。另用 1.14.1 执行严格检查为 37/41：四个既有主规格 `appium-provider`、`guided-device-connection-assistant`、`host-neutral-mcp-adapter`、`local-mirror-viewer` 的长需求文本警告被新版严格校验判为失败，本变更通过；不把新版全仓检查声称为通过，也不在本次提交中改写无关主规格。暂存范围公开内容扫描通过，未纳入私密设备标识、caps 或原始日志。

此次仅交付已有实现与证据，不解除 53/65 之外的 12 项验收缺口；尤其 iPhone 实时复验、Appium 真机安装/reset/完整修复闭环、实际双宿主和独立参与者验收仍待完成。前述 10-06 的未提交状态为当时记录，不是本次 Git 交付结果。
