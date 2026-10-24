# 第六项离线工程验证（2026-10-02）

范围：`add-local-ocr-and-device-matrix` 的无真机工程任务；工作分支 `feat/change-acceptance-roadmap`，基础提交 `REDACTED_REVISION`。OCR 第 1 节基础运行时来自前次实现，本次补齐评测／批准／断言／界面及设备矩阵。本文只记录实际执行结果，不是生产或真实业务验收。

## 已验证的工程行为

- OCR：冻结数据与原始识别结果重算、分组错误与拒绝率、P50/P95／Wilson 区间、近重复跨 split 拒绝、默认关闭与逐 profile 人工批准；page／project／helper 身份变化失效。单元测试中构造的 candidate-go 数据明确标为虚构测试输入，不属于真实质量证据。
- 检查点 PNG 和 ROI 派生哈希、完整截图、当前步骤与时间身份；明确文字 fail、低置信／歧义 inconclusive，视觉／UI／业务结果独立。
- 真实双 Mock 子进程：每槽独立 PID／Store／会话／引用；FIFO、独占资源排队、单槽取消而另一槽继续、安全复跑与历史 attempt 保留。
- 伪 Appium：明确 Android UDID／driver／mjpeg 配置、断线槽隔离与后续 blocked、另一槽继续，无自动重试／迁移。
- 真实父／子 SIGKILL、IPC 身份／generation／重复及伪造回复、PID 复用／stale owner、重启不重放、未知资源键封锁；未确认清理保留 claim 并拒绝复跑。
- 容量低／未知时不派发，终态文件发布故障不显示成功；冻结 APK／IPA 与源文件修改隔离，保留材料篡改后拒绝。
- 跨 Store 引用、离线互斥只读、损坏图片／缺引用当前降级，matrix-cell 不回退到同名 native run；绿色矩阵不能填补验收 commit／制品来源缺口。
- HTTP 同源及确认文本、loopback CLI、Agent 当前项目白名单与只读边界；单设备目标不随矩阵选择变化。

## 浏览器证据

真实 Playwright／Chromium，双 Mock 子进程，不是静态界面图。OCR 慢识别／取消／失败保留旧结果，输入变化忽略迟到响应；矩阵运行中切槽／历史／媒体、单槽取消、错误保留结果。宽窄截图已人工查看：

- [矩阵宽屏](matrix-running-desktop.png)、[矩阵窄屏](matrix-narrow.png)。
- [OCR 宽屏](../local-ocr/ocr-desktop.png)、[OCR 窄屏](../local-ocr/ocr-narrow.png)。OCR 图中的识别器为 fixture，标注候选、非生产结论。

首次完整 E2E 暴露既有截图按钮与轮询图像 decode 的竞态：按钮启用后图片换帧，点击时 naturalWidth 暂为 0，旧实现静默 return，下载事件超时。trace 中 currentSrc 为空与该分支相符。修复为同会话最多 1 秒非阻塞等待，且补确定性 500ms decode 间隙测试，期间主题控件仍可操作。不是把第一次失败抹去或单凭重跑宣布修复。

## 最终门禁

| 门禁 | 实际结果 |
| --- | --- |
| `pnpm check` | 类型检查、契约／文档链接检查通过；91 文件、747 测试通过 |
| `pnpm build` | 通过，含独立矩阵子进程入口 |
| `pnpm test:e2e --workers=1` | 62/62，通过慢任务交互、取消、失败保留和迟到响应验证 |
| `pnpm pack:check` | 通过；构建／打包与 E2E 串行执行 |
| OpenSpec 1.9.0 `validate add-local-ocr-and-device-matrix --strict` | 通过；使用本机已缓存 CLI 的绝对入口，shell 中无全局 `openspec` 命令 |
| `git diff --check` | 通过 |

环境：Node `v24.19.0`、pnpm `11.7.0`、macOS `26.3.1 (25D2128)`、arm64；插件版本 `0.1.0-alpha.2`。DSH 实际启动器版本为 `0.1.5-rc.2`，不使用本机另一个旧版默认启动器。这个版本指实测启动器，不表示所有传递依赖都固定为 rc.2。

最终一次 `pnpm pack --out /private/tmp/mobile-matrix-engineering.aAj6y3/mobile-mirror-verified.tgz` 生成的同一 tarball 用于以下全部安装包验证，SHA-256：

```text
dd14e8a34200486e249d4a5de76c5e55cf794fc42a96ac6ab5f32e871edc893f
```

实际执行：

```sh
node scripts/release-candidate-probe.mjs --tarball /private/tmp/mobile-matrix-engineering.aAj6y3/mobile-mirror-verified.tgz --checksum /private/tmp/mobile-matrix-engineering.aAj6y3/mobile-mirror-verified.sha256 --ocr-output <WORKTREE_ABSOLUTE>/artifacts/local-device-matrix/ocr-packaged
node scripts/dsh-clean-profile-probe.mjs --dsh /private/tmp/mobile-acceptance-dsh.n9vi07/node_modules/.bin/dsh --tarball /private/tmp/mobile-matrix-engineering.aAj6y3/mobile-mirror-verified.tgz
```

公开文档使用 `<WORKTREE_ABSOLUTE>` 替代执行时的本机工作区路径；参数含义与实际命令不变。上述命令记录历史执行，复现时需替换为本机路径。

结果摘要：

- 仓库外 clean-prefix 安装、checksum、CLI、Viewer 本地化、信号关闭、YAML 证据哈希均通过；MCP 共 20 工具，新增 `mobile_matrix_status`；实际双 Mock 子进程和 CLI／MCP 查询通过，不只是注册清单检查。
- 同包实际准备并执行 Apple Vision revision 3，`en-US`／`zh-Hans` 合成 PNG 均完整精确匹配，结束后 active／queued 为 0；[原始输出、版本和摘要](ocr-packaged/summary.json)、[英文](ocr-packaged/english.json)、[中文](ocr-packaged/chinese.json) 已保留。`syntheticOnly: true`、`productionEnabled: false`，不是授权真实集质量放行。
- DSH 干净 profile 禁用安装脚本、使用 `patchReload: startup`，Native／PTC 均完成实际 Agent 流程、双 Mock 矩阵摘要查询、外部结果与验收查询；图像能力／纯文字模型边界和关闭链通过。未修改 Harness agent loop，也不代表真实手机业务通过。
- OCR 读取能力／登记配置也补了按钮局部进度，慢请求期间历史／语言可操作；配置编辑后迟到响应不覆盖新输入。最终 62 项 E2E 包含这些断言。

分段提交：`REDACTED_REVISION`（OCR）、`REDACTED_REVISION`（矩阵），本报告及回归修复在后续集成提交。OCR 提交还在独立 detached checkout 用 Node 24.19.0 直接运行 TypeScript `--noEmit` 和 8 文件／36 测试，均通过；临时目录的 mise trust 提示没有通过修改用户信任配置绕过。原 `artifacts/screenshots/` 中既有及本轮重生成文件不纳入本次提交，仅纳入本变更专用证据目录。

此前中间检查曾通过 743／744 测试，文档链接检查发现本报告尚未创建；已补齐并在最终 747 项检查中通过。首次完整 E2E 的截图竞态失败见上文，未将其当作通过。

## 明确未完成

没有取得授权真实 App 的冻结 OCR 图像集；没有 candidate-go 真实质量结论或生产 profile 批准；没有本轮 Android＋iPhone 20 轮业务矩阵、每平台各 3 次异常对照；没有非作者独立判读。OpenSpec 8.1–8.6 均保留未完成，不同步主规范、不归档、不把既有历史真机记录当成本轮验收。

## 2026-10-03 文档同步与公开性复核

六项状态总览、README 中英文、产品／技术入口、MCP 清单和两份 proposal 同步为工程已实现、89/103 项；14 项剩余验收按真机、真实材料、独立人员和归档前置分别列明，任务勾选不变。

此前文档更新检查为 746/747：本报告曾含本机绝对工作区路径，且检查同时覆盖当前文件和 Git 历史。经用户明确同意，仅修订尚未推送的集成提交以替换公开路径并说明占位符，新提交为 `REDACTED_REVISION`；不改代码、不添加历史白名单、不关闭扫描规则、不改远端历史。

修订后重新串行执行 `pnpm check`（91 文件／747 测试通过）、`pnpm build`、`pnpm test:e2e --workers=1`（62/62）、`pnpm pack:check`，均通过；OpenSpec 1.9.0 全量严格校验 37/37。本轮只是文档及公开性修正，没有再次执行真实手机业务或宣布发布；上文同包 OCR／MCP／DSH 探针仍是 2026-10-02 的对应 tarball 证据，不冒称为本次文档更新后重新打包验证。回归重生成的截图不纳入文档提交。
