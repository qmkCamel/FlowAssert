# Web 视觉验收试点

提供独立取证命令和默认关闭的产品内 Web 自举入口。两者共用八个有界场景，使用真实 Viewer 前端和本次生成的 Mock 历史，不连接手机、不读取用户归档、不复跑原测试。验收进度以 [OpenSpec 任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/port-report-playback-and-web-selftest/tasks.md)为准；个人版本轮验证不沿用来源分支的校准数字。

## 产品内自举

### 可选 CI 取证

`.github/workflows/web-visual-acceptance.yml` 仅在受保护分支通过 `workflow_dispatch` 显式勾选取证后提供手动作业，需要 `macos-visual` 交互式 shell Runner 和已固定版本的本地工具。它不会安装全局工具、运行手机用例或自动批准截图；作业成功只代表取证完成。成功及失败材料保留 14 天，下载后仍需真实图像复核与独立 gate。当前只验证本地流程和配置，未声称自托管 Runner 已部署或远程作业已通过。

显式以 `MOBILE_MIRROR_WEB_TESTS=1` 启动本机 Viewer 后，用例页出现「创建 Web 自检用例」。选择场景、确认本机保存材料，保存修订或开始。工具不满足固定版本时只阻断本次 Web 运行，不影响手机能力。

A 复用现有用例库、运行列表、取消和报告，启动独立 B 子进程、目录、只读端口和浏览器会话。B 禁止递归。完成采集默认为 inconclusive / needs-review；查看所有截图并填写观察、复核身份后，独立检查器再验证事实与摘要，才可能变为 pass。原生比较、分享、导入、修复和设备健康不适用于 Web。

取消会排空自有执行后落盘；重启后的中断记录保持 inconclusive / cleanup-pending，不自动点击或清理旧 PID。重试建立关联的新 attempt，不覆盖首次失败。本机证据不自动删除。

## 运行

在仓库根目录执行：

```sh
pnpm test:visual:pilot          # 默认可见 Chrome；三场景正反例各三轮，共 18 次
pnpm test:visual:pilot --smoke  # 仅三个正常场景，不满足阶段准入门槛
pnpm test:visual:pilot --headless
pnpm test:visual:pilot --extended --headless # 八个正常场景 + 四种故障，各三轮，36 次
pnpm exec tsx scripts/web-selfhost-probe.ts --eight # 真正由 A 调用 agent-browser 验收 B
pnpm exec tsx scripts/web-selfhost-lifecycle-probe.ts # 隐藏重试、修复后新尝试、取消、崩溃重启
```

预检锁定 [开发工具版本](../scripts/web-visual-acceptance/toolchain.json)。当前支持本机 macOS Chrome；缺少工具或浏览器版本变化时停止，不自动下载、安装或升级。agent-browser 不是手机运行链的必需依赖。第一次在其他环境接入时须明确审查工具路径及版本，不能用 `latest` 静默替换。

每个场景最多 30 次浏览器命令、3 分钟，单个等待 10 秒，全套最多 20 分钟。终端输出当前 attempt；`Ctrl+C` 停止后续操作并清理本次会话。关闭失败单独登记为错误，不隐藏清理风险。已有截图不删除，重跑始终新建目录。

## 试点三个场景

| 场景 | 正常路径 | 故障对照 |
| --- | --- | --- |
| VA-01 | 首屏播放入口、历史截图、限制说明 | 播放按钮文字被覆盖 |
| VA-04 | 动作前后图、已记录位置；无记录步骤不补造标记 | 标记偏移到错误区域 |
| VA-05 | 缺图提示、保留主图、重试恢复 | 重试入口隐藏 |

缺图提示可能在首屏下方，所以同时保存 viewport 和完整页面图。正常展开动作对照后，重复的主截图会按既有 UI 设计隐藏；这不等于原始证据丢失。

扩展场景：VA-02 播放/暂停/速度/结束重播，VA-03 滑块/缩略图/失败暂停，VA-06 慢图切换与迟到结果，VA-07 中英 390px 窄屏，VA-08 键盘焦点与 CSS 200% 缩放。实际自举、36 次校准、截图和未验范围见 [B/C 验收记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/port-report-playback-and-web-selftest/implementation-validation.md)。

## 证据与复核

每次输出 `artifacts/visual-acceptance/<新运行目录>/`，默认被 Git 忽略，本机不自动清理、不上传云端：

- `manifest.json`：commit、工作区 diff 摘要、未跟踪文件摘要、工具/浏览器/环境、预算。
- `fixture.json`：独立 origin、合成记录身份、预期动作坐标。
- `<attempt>/steps.jsonl`、`snapshot.json`、`result.json`：命令事实、页面结构和分项检查。
- `<attempt>/screenshots/`：命名的成功、故障、恢复截图及各自 SHA-256。
- `calibration-key.json`：故障分配，仅供校准检查器使用；先看截图，不用该标签代替判断。
- `review.json`：实际逐图复核记录，与原始执行结果分开；`gate.json`：独立阶段门槛结论。

采集后默认是 `visualReview=needs-review`，**不能报视觉通过**。人工或当前已授权 Agent 查看每张原始截图后填写 `review.json` 数组；每条包含 attempt `id`、`status`（pass/fail）、`reviewedAt`、`reviewer`（type/identity；Agent 另有 model，未知明确写 unknown），以及 `items`。每个 item 包含 `evidence` 相对路径、`sha256`、`verdict` 和具体 `observation`，不可批量用“截图存在”代替逐图观察。

```sh
pnpm test:visual:gate artifacts/visual-acceptance/<运行目录>
pnpm exec tsx scripts/web-visual-acceptance/probe-gate.mjs artifacts/visual-acceptance/<运行目录>
pnpm exec tsx scripts/web-visual-acceptance/safety-probe.mjs
```

独立检查器不导入执行器判定函数，重新校验完整的 18 格矩阵、页面/步骤身份、原始图摘要、复核证据、请求副作用、预算和正常/故障结论。负例探针在临时副本中验证伪造 pass、缺复核、篡改图、缺图都会被拒绝。安全探针用真实浏览器验证取消、预算耗尽和等待超时后保留截图。

门槛通过只表示对应场景校准通过，不代表所有页面或真实设备可靠。产品运行可另用 `node scripts/web-visual-acceptance/verify-product.mjs <运行目录>` 独立核验；没有实际视觉复核不能通过。全量场景增加播放控制、滑块/缩略图/失败定位、慢图迟到保护、390px 中英双语和 CSS 200% 键盘操作。CSS 缩放不冒充浏览器原生缩放。

## 像素基线

`baseline.mjs approve <根目录> <PNG> <environment.json> <human-review.json>` 只接受显式 human 批准、复核身份、至少 20 字观察、approved=true 和该图 sha256；不可覆盖已有基线。环境必须包括 tool/browser/os/fonts/dpr/viewport/locale/fixture。

`baseline.mjs compare <批准目录> <当前 PNG> <environment.json> <输出目录>` 输出原始像素差异图与 changedPixels/changedRatio；颜色距离和整体差异比例分别记录，默认零容差，不自动放宽或更新。环境/尺寸不同为 incomparable；无基线为 not-compared；changed 要求实际复核。当前尚未批准产品像素基线，不宣称已建立跨版本视觉基线。

## 安全边界

目标只能是新建合成夹具，不接受任意 URL/归档路径。现有 Viewer 与真实归档不在范围内，不能将其代理或复制到夹具。浏览器使用随机独立会话，清空继承的代理、云供应商、个人 profile、自动连接配置；显式空配置与固定 argv 不接受页面提供的命令。只读测量是仓库中的固定采集器，不暴露任意 eval。

夹具服务拒绝所有非 GET，GET 也有路径白名单；设备帧请求返回空值，绝不转发设备控制。导航校验精确 origin，页面 CSP 限制资源至本 origin，agent-browser 域名 allowlist 只作附加防护，**不是系统防火墙**。不接管用户浏览器，不创建新的模型供应商连接。产品自举使用真实路径隔离和自有资源日志，不以导入外部报告冒充执行。
