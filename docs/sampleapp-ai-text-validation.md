# 第三方 App AI 文字验收

本文保留原真机验证结论，应用名称及标识已经脱敏；不是当前通用 Fixture 的重跑结果。参见[历史资料说明](privacy-history-cleanup.md)。

日期：2026-09-15。Android OnePlus 8T / Android 14，Appium 3.2.0、UiAutomator2 6.8.0，AppClaw 2.7.0。

## 范围

第三方 App底部 AI 入口 → 文字输入 → 发送 → 回复正文及操作栏 → 历史会话再进入。固定公开测试句，命令与断言由工作台执行；不使用语音、独立 ADB 输入、模型判题或后端读取。

## 实现与失败边界

结构化 type 的 replace/append/空串清空已接入。设备 facade 在租约内重新读取目标与焦点，调用现有 provider。原生输入 RPC 失败时不回复给 AppClaw，由父进程结束 worker，防止触发其独立 ADB 回退；失败步骤也保留 PNG/XML。

首次正例在追加断言检出只剩后缀的问题，未发送不完整消息。Android driver 源码声明 setValue 为 append，但该第三方 App输入框重新聚焦后实测不能保持原值；本次不将原因未经证实归于整个驱动。工作台从最新目标读取现值并写入合并后的完整值，保证 YAML append 不依赖键盘选区。未修改 Agent provider append 的既有语义，Agent Android 独立输入验收保持原状态。

## 结果

| 场景 | runId | 结果 | 耗时 | 重启后哈希复验 |
| --- | --- | --- | --- | --- |
| 完整正例 | `c393c063-5a21-49d6-9294-1c7111f2d871` | 21/21 pass | 91,619 ms | 44 份材料 |
| 故意失败反例 | `36ae888d-03c9-4328-9e61-9a24c92a48b7` | 第 2 步按预期 fail，未执行末尾 done | 33,332 ms | 6 份材料 |
| 最终代码正例复跑 | `2cc57d92-c2ee-43b2-8016-33fb643774d0` | 21/21 pass | 87,102 ms | 44 份材料 |

正例覆盖公开文本替换、清空、追加后的完整内容、发送、用户消息、非空回复正文、消息底部操作栏、历史列表以及选中最新同名会话后的消息与回复。反例不发送消息，断言不存在的回复文本，确认不会误判通过。运行时主题切换、历史刷新保持可操作；工作台重启后记录恢复且逐文件通过 HTTP 下载复验字节数及 SHA-256。正常停止后独立检查 4723/8200 无监听、设备无 UiAutomator2/scrcpy 进程、ADB 转发为空。

真机材料分别位于 `artifacts/physical-validation/workbench-2026-09-15T07-13-51-917Z`、`workbench-2026-09-15T07-16-26-968Z`、`workbench-2026-09-15T07-17-45-604Z`。每个目录有 probe.json、运行中/结果/恢复历史截图及 runs 中逐步 PNG/XML。最终输入内容、回复/历史截图和失败结果截图均已打开检查。材料保持 Git 忽略，未公开账号与设备原始数据。探针使用 PNG polling，未将本轮结果算作 scrcpy/H.264 新增验收。

## 工程验证

- `pnpm check`：39 文件、284 项通过；包括 9 项输入专项测试。
- `pnpm test:e2e`：36/36 通过，新增 1.5 秒慢输入期间进度/取消按钮和主题操作的浏览器回归。运行截图 `artifacts/screenshots/mobile-mirror-workbench-text-input.png` 已保留并检查。
- `pnpm build`、`pnpm pack:check`、OpenSpec strict、公开内容扫描与差异检查通过。示例按仓库既有契约保留在 examples，不进入运行时安装包。
- 调试中修复了用例 type selector 应用短类名 TextView 的问题，以及新浏览器 fixture 缺少显式 assistant。一次公开截图哈希检查与 E2E 重写旧截图并发导致失败，恢复测试生成的旧截图后复跑 check 通过；未放宽检查。
- 本轮未提交、推送、发布或修复 Inspector 遗留的干净安装依赖阻塞。

验收覆盖声明的 UI 条件与历史再打开，不证明后端数据库持久化、服务端完成状态或 AI 答案事实正确；manifest 的 businessVerification 仍为 not-performed。本轮不声称 iPhone 业务验收通过。

## 2026-09-16 iPhone 复验

当前安装包再次确认：输入、清空、追加、发送与回复完成标志通过；用户消息正文截图可见，但 XML 气泡没有正文和子节点。完整 YAML 正例继续保留未通过，详见 [iOS 业务与 Codex 图片验证](https://github.com/qmkCamel/flowassert/blob/main/docs/ios-business-and-codex-vision-validation-2026-09-16.md)。
