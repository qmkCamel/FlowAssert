# iPhone 第三方 App业务与 Codex 图片验证（2026-09-16）

## 范围与环境

本次将两个结论分开：第三方 App YAML 业务正例，以及当前 Codex 读取 MCP 图片后的操作闭环。后者不替代 DSH 0.1.2-rc.1 的 attachment／图片模型验收。

iPhone 16 Plus、iOS 26.2.1 真机。本次安装的是第三方 App REDACTED_APP_VERSION（build 3332251）；上次开发包已不在设备，先核对实际 bundle ID 再运行，无安装、重置或账号变更。使用当前仓库构建的 MCP stdio server、Appium 3.2.0、已签名 WDA。为本次会话显式设置 `image-and-structure`，不修改 Codex 已注册 MCP 的 `mock-only` 全局配置。

## Codex + MCP 图片理解：单场景通过

1. MCP `mobile_mirror_snapshot` 返回真实 PNG image content，保留完整工具结果、原始 PNG 和 SHA-256。
2. 当前 Codex 通过 `view_image` 读取从 MCP image content 原样保存的 PNG，在未读取该轮结构前识别第三方 App“精选”页底部中央蓝色 AI 入口，选择 viewport 坐标 `(215, 875)`。图片为 1290×2796，viewport 为 430×932。
3. MCP 执行点击；即时截图仍处于切换前状态，后续新截图确认 AI 面板展开，出现“今日速览”“按住说出你的问题”和键盘图标。
4. 随后读取结构，独立确认 `sample-input-mode-button` 可见且可操作。
5. 两次过期 observation 被 MCP 拒绝；重新观测后才继续，未绕过过期保护。

这证明一次真实图片传输、模型识图决策、设备操作及结果核对。不是视觉准确率基准，不是 DSH 图片链路通过，也未证明模型具备整段自主业务测试能力。图片通过本地 SDK MCP 客户端落盘后交给当前 Codex 读取，并非修改全局 MCP 配置后直接注入的原生工具 image block。

本地证据：`artifacts/physical-validation/ios-business-2026-09-16/` 的 `mcp-4.json/png`、`mcp-5.json`、`mcp-7.json/png`、`mcp-9.json/png`、`vision-assessment.json`。原始手机画面与设备标识仅保留在忽略目录，不作为公开仓库素材。

## YAML 业务验收

冷启动运行 `6d846116-2a3a-4bae-a2d4-035f355b85d1` 判定失败：launchApp 返回成功，但步骤截图停留桌面，下一步找不到首页 AI 入口。重启 Viewer 后 6 份证据哈希全部一致，运行不会误判通过。随后通过系统启动命令进入实际第三方 App，再使用上述图片路径确认 AI 面板，复跑保留原有消息／回复／历史断言的 YAML。两次运行分别记录，前置准备不冒充冷启动正例。

准备后运行 `0faa8e79-1f99-4cc3-a34a-e98c654a36ae`：前 9 步通过（键盘入口、替换、清空、清空断言、正文输入、追加唯一标记、完整输入值断言、发送、等待回复操作栏），第 10 步用户消息正文断言失败，后续 YAML 步骤没有执行。22 份归档证据逐一通过公开 artifact API 核对字节数与 SHA-256。

本轮源树证据明确区分：`sample-message-bubble` 是无正文、无子节点的 Other；`sample-answer-body` 的 StaticText 有非空回复内容。不能通过修改断言只找气泡 ID 来关闭原有正例。

随后单独使用 MCP 图片查看右上历史入口、今天的测试会话，并点击返回该会话。`mcp-10.png` 与 `mcp-16.png` 均能读到唯一标记 `MM0916I-150611` 和同一回复；`mcp-12.png` 保留历史列表。该结论是 Codex 图片核对下的历史选择／返回，未证明重启 App 后持久化，也不是原始 YAML 的自动历史断言通过。工具结果 `mcp-11/15.json` 保留对应动作；一次历史点击因 observation 过期被拒绝，刷新同画面后重试成功。

## 结论与后续

- Codex + MCP：真实图片读取、图像定位、操作和结果核对的单场景通过；另保留业务消息／回复／历史返回的图片核对证据。
- iOS 完整确定性 YAML 正例：仍未通过，OpenSpec 3.2 保持未勾选。需要第三方 App暴露用户消息正文与历史标题可访问文本，然后重跑完整正例；不能用图片人工／模型判断覆盖其结果。
- DSH rc.1 图片链路：未执行，按用户选择单列待验。
- 工程回归：`pnpm check` 309 项、`pnpm test:e2e` 41 项、`pnpm build`、`pnpm pack:check` 全部通过，OpenSpec 1.9 strict 24/24。未修改产品代码。E2E 生成的截图留在本地验证目录，未覆盖已有仓库截图。
- 清理：`mcp-17.json` 确认设备会话 idle、托管 Appium idle 且不再 owned。Viewer 截图用于核对失败运行在历史中展示，不作为手机当时画面的实时性证明。
