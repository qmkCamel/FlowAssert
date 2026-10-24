# 工作台 P0 补强验证

日期：2026-09-14。**P0 三项验收完成，OpenSpec tasks 10/10。** 双端各三轮正例、独立失败反例、证据回溯与资源清理均有记录；下面保留初次缺设备和修复过程，完成结论以双端补验为准。归档变更：[harden-local-test-workbench](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-harden-local-test-workbench/tasks.md)。基线 `REDACTED_REVISION`，执行器 AppClaw 2.7.0、DSH 0.1.2-rc.1；此前双端硬件结果保留在[原真机报告](workbench-validation.md)。

## 实现与验证边界

| P0 | 本轮完成 | 证明范围 / 未完成项 |
| --- | --- | --- |
| WDA 进程清理 | managed 继承标记、谱系记录、detached/reparent 识别、信号前身份复核、失败保留重试 | 真实 iPhone 三轮正例与反例已通过；停止后独立确认 xcodebuild、端口与设备 runner 清理，见下方补验 |
| 性能与计时 | 单调阶段耗时、同步检查点屏障、消除无关几何/初始化源树请求、Viewer 详情、重复测量探针 | 5 步 Mock 用例只需启动/点击共 2 次几何读取；不能折算成真机提速。Android/iPhone 各三轮样本、阶段统计与校准预算已完成，见下方双端补验 |
| 取证保真 | PNG/XML 独立保存、原子发布、目录同步、恢复孤立/临时材料、拒绝 symlink、哈希复核 | 自动化覆盖截图/源树/磁盘/manifest/worker/宿主终止；不把恢复材料或部分材料判为 pass |

## 故障实测

- 真实 detached Node 后代：停止 managed owner 后后代退出，独立外部进程存活。xcodebuild 同名、父进程已退出、PID 复用、扫描失败与清理重试分别由可注入进程清单验证。没有使用按名称/端口批量 kill。
- 真实原生 worker：在固定等待期间终止线程，先前 PNG/XML 保留，后续点击未发生，最终 inconclusive 并释放租约。
- 真实宿主 SIGKILL：子进程启动同一 WorkbenchService，在 PNG fsync/发布后、manifest 更新前自终止。新 Store 接管已死亡锁，找到 PNG，以 recovered/inconclusive 记录并校验当前字节，不能复原为通过。
- 源树故障保留 PNG；截图故障保留 XML；manifest 持续失败时当前界面保留材料，重启可发现两个未登记文件；临时半文件保留原字节、标记 incomplete，symlink 不作为材料读取。
- Viewer 慢源树采集中主题、历史和画面仍可操作；取消后只有当前步骤，原图、取证错误和分阶段耗时保留。截图见 [部分取证与计时](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-workbench-partial-evidence.png)、[正常步骤证据](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-workbench-evidence.png)。这些是 Mock runtime 截图。

## 验证命令

本轮 `pnpm check`：34 个文件、239 项测试通过；完整 `pnpm test:e2e`：23 项通过，最终工作台专项 5 项再次通过（包括新增取证错误显示与截图滚动可见性）。`pnpm build`、`pnpm pack:check`、本 change strict 与 `pnpm public:check` 通过；已查看保留的 runtime 截图。全量 OpenSpec 的既有 skip_specs 例外仍单列在产品 TODO，不通过创建虚构 delta 消除。

## 初次无设备检查（保留历史）

最初检查时 ADB 未列出在线设备，目标 iPhone 未出现在 xctrace 在线 Devices 中；配对记录不等于已连接。没有重复使用旧报告的 54,496 / 45,948 ms 作为新版本测速，也没有宣称实际 WDA 自动清理已通过。

新检查点屏障使固定等待从上一检查点提交后开始，旧版等待可能与取证重叠；因此新旧总耗时还包含顺序修正，不能仅凭减少几何调用宣称提速。

连接后按[使用说明](test-workbench.md)各执行至少三轮同一用例，保存原始 run、阶段统计、媒体/交互与精确清理证据。还需在实际 iPhone 检查 managed 停止后 WDA xcodebuild、相关 forwarding/listener 与设备 runner 进程；安装的 runner App 留存不是进程残留。样本足够且验收完整后才记录校准预算，并独立执行故意失败反例。


## iPhone 真机补验：2026-09-14

用户重新确认连接后，devicectl 成功读取在线手机进程。实测代码为 `REDACTED_REVISION` 加本次 WDA 环境不可见修复；iPhone 16 Plus、iOS 26.2.1、第三方 App REDACTED_APP_VERSION（1079）、AppClaw 2.7.0，使用已有签名 prebuilt WDA 和显式 managed Appium。未安装或重置第三方 App、未变更签名配置。每轮新建会话，轮内 Viewer/执行器共享会话。

### 真机发现与修复

首轮业务 12 步通过，耗时 28,997 ms，但 managed stop 失败，xcodebuild 被重挂到父进程 1。此轮未计入有效样本。检查发现 `/bin/ps eww` 对本机 Node 可读取继承标记，对 Apple xcodebuild 和独立启动的 `/bin/sleep` 不显示环境；原实现强制再次读取 WDA 标记，错误拒绝已经观察到的可信后代。原始失败报告与进程身份记录保留。

修复后，启动期间已证明属于带标记 Appium 的后代可以依据谱系及当前 PID/开始时间/命令身份清理；仅靠标记认领的孤立进程仍须复核标记，未证明归属的同名进程不认领。增加环境不可见与标记丢失两项回归。首轮遗留进程按已记录身份核验后单独 SIGINT 收尾；以下三轮及反例全程自动清理，没有手工 kill。

### 重复正例与独立反例

正例：启动第三方 App → 固定等待 → 精选/首页 Tab 切换 → 排除“跳过”遮罩 → 断言“拍摄/关注/首页” → done。YAML SHA-256：`c5a9eb8ed8b839148e04f7bcf76dfa78a97e06af3549eb50196f0e776be9903e`，三轮 capabilities 和每步新 PNG/XML 策略不变。

| 样本 / runId | 结果 | 用例耗时 ms | 运行期间 relay 帧 | 重启后校验文件 |
| --- | --- | ---: | ---: | ---: |
| 1 / `b5c1d809-b46d-4cda-8803-1e0238b6cb2a` | pass，12/12 | 28,484 | 419 | 26 |
| 2 / `da594c8b-d0ab-492b-a859-227ac149c6eb` | pass，12/12 | 35,806 | 514 | 26 |
| 3 / `1c95c817-8d4a-442b-94dd-da4286f6ce0c` | pass，12/12 | 29,452 | 433 | 26 |
| 反例 / `92013bab-0379-4adc-b9fb-d13ac55e1ff8` | fail，第 3 步按预期停止 | 26,832 | 397 | 8 |

四轮均保持同一轮内 session 不变、主题/历史控件可响应，重启 Viewer 后 manifest 一致，所有公开 artifact 路由返回的字节数与 SHA-256 均匹配。正例为每步一对 PNG/XML 加 YAML/日志，反例保留三步材料。反例声明“首页不可见”，实际树发现 1 个可见匹配，因此失败；断言重试解释了其约 26.8 秒耗时，后续 done 未执行。

三轮用例耗时中位数 29,452 ms，样本 p95/max 35,806 ms；校准预算为 `ceil(35,806 × 1.2) = 42,968 ms`。这只是 3 个本机样本的候选预算，未进行预先设定预算的独立达标试验，不是生产 SLO。计时不含 Appium/WDA 启动、会话清理和历史重启检查；固定等待共 11 秒。第一轮部分时间与本机单元门禁重叠，非专用空闲主机性能实验；本次 App 版本及检查点顺序与旧报告不同，不宣称相对旧版提速比例。

| 阶段 | 每轮累计中位数 ms | 三轮最大 ms |
| --- | ---: | ---: |
| 几何读取 | 318.75 | 319.01 |
| 定位/读树 | 4,329.67 | 7,322.38 |
| 设备动作 | 980.96 | 1,141.99 |
| PNG | 3,200.33 | 3,302.16 |
| XML | 8,394.71 | 12,194.19 |
| 落盘 | 540.88 | 565.64 |
| 证据复核 | 49.74 | 50.21 |

各阶段中位数来自各自分布，不能相加还原某轮总耗时。当前主要可观测耗时是固定等待和 XML/定位读树；不以减少证据数量来改善数字。

### 独立清理核验与证据路径

初始手机无 WDA runner、相关三个端口无监听；运行中观察到真实 WDA runner 和 xcodebuild。三轮探针均报告 session/runtime idle；整组结束及反例结束后分别再次读取真实手机进程、宿主进程表与 4723/8100/9100 监听：WDA runner 为 0，xcodebuild/Appium/iproxy 相关进程为 0，三个端口无监听。已安装 runner App 留存不算进程残留。

逐轮外部采样与下一轮启动可能重叠：第一轮结束采样已经看到下一轮 runner/listener，不能把该快照当“第一轮清理后为零”的证据；第二/三轮采样及无下一轮竞争的最终清单均保留。最终独立核验与四轮 runtime 停止结果共同支持本次正常断开清理结论，不扩展为强杀宿主、所有 iOS/签名环境的承诺。

原始材料均在本机忽略目录 `artifacts/physical-validation/`：

- `iphone-p0-2026-09-14/benchmark.json`：三轮完整汇总；`acceptance-summary.json`：验收摘要；`initial-failed-*`：首轮失败，不覆盖。
- `workbench-2026-09-14T09-41-01-415Z/`、`workbench-2026-09-14T09-41-40-471Z/`、`workbench-2026-09-14T09-42-26-262Z/`：三轮 run、原始 PNG/XML、运行中/result/history-restored 截图。
- `workbench-2026-09-14T09-43-49-354Z/`：故意失败反例、三步材料及重启截图。
- `iphone-p0-2026-09-14/device-after-benchmark.json`、`device-after-negative.json` 及对应 host/ports 文件：独立清理记录。材料含设备/页面信息，不提交公共 Git。

已实际查看第三轮 running、第一轮 history-restored、反例 history-restored 截图，确认手机画面、步骤计时和历史原图可见。`pass` 仍只证明声明的 UI 断言与证据完整，未执行业务持久化或通用视觉验证。当时任务 4.1 仅完成 iPhone 部分；Android 缺口已由下面的补验关闭。

本次修复后重新验证：`pnpm check` 34 文件 / 241 测试通过，`pnpm test:e2e` 23 项通过。首次与真机并行运行 check 时 public-readiness 单项触发 5 秒超时；真机结束后原样重跑完整 check 通过，未修改阈值或跳过测试。
`pnpm build`、`pnpm pack:check`、当前 change strict 与 `pnpm public:check` 均通过；未修改 Viewer，本次 E2E 生成的既有 Mock 截图已恢复，真机截图独立保留。


## Android 真机补验与 P0 收尾：2026-09-14

实测基线 `REDACTED_REVISION`，本次没有修改运行时代码。OnePlus 8T / KB2000、Android 14、第三方 App REDACTED_APP_VERSION，Appium 3.2.0、UiAutomator2 6.8.0、scrcpy 4.1、AppClaw 2.7.0。ADB 明确选定已在线设备，沿用已有私有 capabilities（包括此前 OEM 验证采用的 idle/notification 设置）；不重置第三方 App数据。三轮测速期间未运行项目单元/E2E/构建门禁。

正例沿用 12 步精选/首页切换与 `SAMPLE_FEATURED_PAGE` 断言，固定等待共 6 秒，每步采集新 PNG/XML。每轮重新建立 managed Appium/session，轮内 Viewer 和原生执行器共享会话；YAML 和 capabilities 哈希在每次运行前复核，保持不变。YAML SHA-256：`fbf52d43ddf79f0e8411446c1c45cb18b5bf6021cc5b4f4d2d396ef965eabf70`。

| 样本 / runId | 结果 | 用例耗时 ms | 运行期间 relay 帧 | 重启后校验文件 |
| --- | --- | ---: | ---: | ---: |
| 1 / `cc0d94d5-0218-4836-9c3f-5e4e401658f7` | pass，12/12 | 54,023 | 1,270 | 26 |
| 2 / `070f1d30-5a11-4634-8a1d-a1d6c62af96c` | pass，12/12 | 45,061 | 944 | 26 |
| 3 / `fc840eb7-9384-42d4-854a-1626f133d7c4` | pass，12/12 | 42,515 | 908 | 26 |
| 反例 / `455eb9dc-d58a-462e-b326-ae7e447814d9` | fail，第 3 步按预期停止 | 36,851 | 1,123 | 8 |

四轮均验证同轮 session 一致、主题/历史控件可响应、运行后会话保留、显式停止时 managed runtime 回到 idle；重启 Viewer 后 manifest 一致，每份 artifact 路由返回的字节数和 SHA-256 均匹配。正例每轮保留 12 对 PNG/XML 和 YAML/日志，共 26 份；反例保留三步材料和 YAML/日志，共 8 份，断言失败后 done 未执行。

反例在精选页声明 `SAMPLE_FEATURED_PAGE` 不可见，实际发现可见匹配，因此按预期失败。运行期间 scrcpy H.264 持续显示：三轮浏览器绘制速率约 24.47 / 20.86 / 21.12 fps，receive-to-paint 样本 p95 均为 3 ms，无截图降级；这是浏览器内指标，不是设备到显示器的端到端延迟，也不与 iPhone relay 指标做性能排名。

### 耗时与样本预算

Android 三轮中位数 45,061 ms，样本 p95/max 54,023 ms，校准预算 `ceil(54,023 × 1.2) = 64,828 ms`。iPhone 已有对应中位数 29,452 ms、校准预算 42,968 ms。两端分别记录预算，流程等待时间和定位方式不同，不混作同一性能分布。

| 阶段 | Android 每轮累计中位数 ms | 三轮最大 ms |
| --- | ---: | ---: |
| 几何读取 | 161.76 | 189.77 |
| 定位/读树 | 7,585.72 | 10,292.35 |
| 设备动作 | 824.59 | 831.30 |
| PNG | 16,811.83 | 19,836.28 |
| XML | 12,724.67 | 15,656.72 |
| 落盘 | 610.90 | 660.03 |
| 证据复核 | 50.68 | 61.24 |

当前 Android 用例主要耗时在 PNG、XML 与定位读树，动作本身累计中位数约 0.82 秒；每步必需证据未删减。各阶段统计不能直接相加还原某次运行。总耗时仅覆盖用例执行与取证，不含 Appium/session 启动、停止和历史重启检查。预算来自三个完整验收样本，仅作后续预设门禁的校准输入，未执行独立固定预算达标试验，不声明生产 SLO 或相对旧版的精确提速比例。

### 资源清理、截图与可回溯材料

运行前 ADB 无转发，设备原有 `io.appium.settings` helper。运行中观察到 UiAutomator2 instrumentation、`com.genymobile.scrcpy.Server` 和本次 8200/动态 scrcpy 转发；三轮组结束与反例结束后分别独立读取设备进程、ADB forward 列表、宿主进程表和 listener，确认：

- UiAutomator2 instrumentation 与 scrcpy server 均退出；ADB 临时转发为 0；4723/8200 无监听。
- 本次 managed Appium/媒体宿主进程已停止；已有 ADB 服务及 settings helper 保留，不将外部基础设施或已安装 helper 当作本次残留。
- 四轮均无手工 kill，没有以退出码代替独立清理核验。

已查看第一轮 running、第三轮 history-restored、反例 result 的真实 Viewer 截图，确认运行中画面、历史原图、计时与失败提示可见。原始截图、XML、日志和设备配置只保留本机忽略目录，不提交公共 Git：

- `artifacts/physical-validation/android-p0-2026-09-14/benchmark.json`、`acceptance-summary.json`：三轮统计、runId、各阶段明细和验收摘要。
- `workbench-2026-09-14T13-04-54-310Z/`、`workbench-2026-09-14T13-06-02-143Z/`、`workbench-2026-09-14T13-06-59-050Z/`：同一 physical-validation 目录下的三轮完整材料。
- `workbench-2026-09-14T13-08-59-930Z/`：反例原始材料、结果与恢复截图。
- `android-p0-2026-09-14/device-after-{benchmark,negative}.txt`、对应 `forward-*`、`ports-*`、`host-*`：独立资源核验清单。

至此 task 4.1 的双端三轮、样本预算、媒体/交互/证据/清理要求全部满足；P0 三项完成。`pass` 仍限于声明的 UI 条件与证据完整，更多 OEM/系统矩阵、业务/视觉验证和生产性能 SLO 属于后续工作，不是此次 P0 的未完成项。

本次收尾门禁：`pnpm check` 34 文件 / 241 测试通过；`pnpm test:e2e` 23 项通过；`pnpm build`、`pnpm pack:check` 与 change strict 通过。OpenSpec apply 返回 `complete: 10, remaining: 0, state: all_done`。真机截图已查看并保留，E2E 生成的既有 Mock 截图恢复为原文件。
`pnpm public:check` 亦通过；私有设备材料不进入提交。
