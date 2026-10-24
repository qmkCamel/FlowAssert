# iOS 第三方 App输入修复与对照验收

本文保留原真机验证结论，应用名称及标识已经脱敏；不是当前通用 Fixture 的重跑结果。参见[历史资料说明](privacy-history-cleanup.md)。

日期：2026-09-15。本修复基于工作区正在开发的 YAML type 能力；只修补 iOS 输入链路，不替代 Agent 独立输入/生命周期验收。

## 修复

1. `WorkbenchDevice` 原来只按几何回查规范化节点。iOS 的 TextView 与外层 Other 容器同为 x=27、y=524、width=343、height=26，导致误报歧义。现在同时要求输入角色、选中元素的非空 identifier、原生类型及几何对应，仍拒绝两个无法区分的输入节点；不借用其他同边界输入的焦点。
2. normalizer 与 WDA 稳定焦点类型检查补齐 iOS TextView/TextEditor。Android 普通 TextView 仍是文本；敏感输入、前后 active element 身份/几何、可见/启用限制保持有效。
3. 真机进一步检出重新聚焦后 iOS 光标可能位于正文中间。工作台 append 现在使用独占调用内刚读取的实际 value 拼接完整内容，再按 replace 写入；空值不能使用 label/text 代替。Android 已有处理保留，Agent provider 的 append 语义不变。

## 回归

新增同边界容器、同边界其他输入焦点、真实输入歧义、失焦/隐藏/禁用/密码框、iOS 多行类型、Android 文本角色以及追加空值/非空值测试；WDA fake HTTP 覆盖同边界容器下 TextView 稳定焦点。针对性 28 项通过。

## 真机用例适配

使用设备应用清单中的实际已安装包，进入首页 AI 入口再切换文字；iOS 输入内容断言读取 value，发送按钮使用原生 identifier。复制 Android accessibilityId=发送 的约束会与 iOS 的 name 语义不同，不能直接照搬。

原始材料仅本机：`artifacts/physical-validation/ios-ai-side-2026-09-15/`。原始边界歧义、入口前置条件不满足、光标追加错误的记录均保留；错误追加被发送前断言阻止，没有发送错误文本。该轮在确认错误后取消，不算故意失败反例。

## 最终真机结果与剩余边界

设备为 iPhone 16 Plus / iOS 26.2.1，第三方 App开发版 REDACTED_APP_VERSION（1079），AppClaw 2.7.0。2026-09-15 解锁后已重新执行；下述结果取代此前等待解锁状态。

| 运行 | 结果 | 证据数 | 结论 |
| --- | --- | --- | --- |
| `916662ca-dc57-4fb0-aa03-f996527fca8a` | fail，执行至第 12 步 | 26 | 前 11 步通过：替换、清空、追加后的完整 value、发送、等待回复；第 12 步用户消息文本断言失败 |
| `1ccd2198-03f8-4db3-afd8-f5162c411413` | fail，执行至第 5 步 | 12 | 回复正文非空、打开历史成功；按消息标题定位历史项失败 |
| `c9c56421-13fb-4bd7-a540-4c19f6441c1e` | pass，5/5 | 12 | 使用本次源树实际观察到的历史项 ID 重入，气泡、回复正文及完成控件仍在 |
| `d33274ff-c872-451a-842f-da1790456e9f` | 预期 fail，第 2 步 | 6 | 不存在的回复文本断言失败，未执行 done；保留失败截图与源树 |

发送前完整 value 断言通过，实际文本为“请用一句话解释自动化测试的价值 MM0915I。”。发送后与历史重入后的截图均已人工检查，问题文本正确、回复仍在。回复正文非空有结构化断言支持；这不证明 AI 回复的业务正确性。

完整 21 步正例仍未通过。源树中的 `sample-message-bubble` 只有可访问容器，无消息 label/value/文本子节点；历史 `sample-history-item-*` 项也没有标题文本。屏幕上能看到文字，但当前结构化 selector 无法验证消息原文或按标题找到历史项。已确认的是源树暴露缺口，尚未检查 App 源码，不能归因到具体 RN 组件实现。

观察到的历史项 ID 只用于本次人工辅助对照，不写入可复用用例，也不将其计作自动按标题重入成功。后续需由 App 暴露用户消息和历史标题的可访问文本，再复跑原始正例；不把存在容器的断言降级成文本验证成功。OpenSpec 真机完整验收项仍保持未完成。

反例的失败断言耗时约 194 秒，主要为多次 iOS 源树读取；本轮验证了正确失败边界，尚不能宣称失败判定足够快。

## 证据回溯与清理

四次运行共 56 份证据已通过 Viewer HTTP 下载核对字节数和 SHA-256。结束旧服务后，使用同一证据目录启动新的 Viewer，再次下载并核验全部 56 份，历史结果保持原始 pass/fail；已保留并检查恢复后的 Viewer 截图。

本机材料：`final-verified-runs.json`、`final-history-verification.json`、`final-running.png`、`final-history-restored.png`，均位于上述私有证据目录。原始截图与源树不进入公开文档。

停止后服务 idle、managed owned=false。独立检查确认本次 Viewer 进程退出、4735/8100/9100 无监听，主机无相关 Appium/xcodebuild/iproxy，设备进程清单无 WebDriverAgent；没有改动手机锁屏设置或其他 Viewer 服务。

## 最终工程门禁

- `pnpm check`：40 文件、295 项测试及类型/契约检查通过。
- `pnpm test:e2e --workers=1`：36/36 通过，未放宽断言或超时。并行轮有 3 个控件等待超时，保留其日志；串行全量复验通过。
- `pnpm build`、`pnpm pack:check`：通过。
- OpenSpec strict、公开检查与差异检查通过；真机任务保持未完成。
- 已恢复 E2E 重写的既有基准截图，保留主任务原有改动；本侧任务未提交或推送。
