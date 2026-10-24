# 2026-10-05 双端真机验收增量与未完成边界

本轮以本地缓存的 `origin/dev@REDACTED_REVISION` 为候选基线，另有本次探针/文档改动；USB 续验包含下述 iOS readiness 最小修正。验收执行时远端刷新因 GitHub 连接/认证失败未成功；用户授权提交推送后重新 fetch 成功，确认远端 dev 仍与此基线一致，不改变验收候选及证据范围。按 active OpenSpec checklist 核对，记录**新增真机证据**，不把单端通过改写成双端、外部试点或发布完成。原始截图、XML、capabilities、设备/签名标识、APK 与运行报告仅保存在本机 Git 忽略的 `artifacts/physical-validation/`；本文不公开这些材料。测试使用预装 `dev.mobilemirror.fixture` 1.0，不安装或重置被测 App；业务写入仅针对隔离的合成夹具/订单。Viewer 运行时关键截图已目检。

续验修正：下列初始真机片段基于 `REDACTED_REVISION`。USB 重接后的 guided 验证发现 readiness 丢弃了 provider 独立核验的 iOS focus；本轮增加最小修正，使其优先消费 `source.structure`，保留原 XML 作为取证。正反焦点回归 24/24 通过，后续 guided 真机闭环基于此修正，不能把旧候选描述成已通过该输入路径。修正未改变 provider、owner、verdict 或 DSH agent loop。

## dev 合并交付（2026-10-05）

- 用户先授权提交推送 `feat/physical-validation-oct@REDACTED_REVISION`，再明确授权合入 dev 并更新文档。
- 合并目标经 fresh fetch 核验为 `origin/dev@REDACTED_REVISION`；源分支仅领先该基线一份提交，无冲突。隔离分支 `chore/merge-physical-validation-dev` 从该目标创建，采用双亲 merge commit，不移动原脏 dev 工作目录的本地分支或覆盖其文件。
- 同步中英文 README、产品 TODO、能力表、里程碑、文档索引及引导／可靠性验证入口。六项关联四个 change 当前 15/16、21/24、21/24、33/39，共 90/103；原路线图及各旧报告保留日期快照。未新增勾选任务、改变验收标准或归档；真机私有材料仍排除。
- 此轮仅验证合并候选软件，不重复真机操作或将旧同包 DSH/真实模型证据冒充重跑。远端交付须以 dev ref 与 merge SHA 一致为准，不以本文代替 CI／发布证明。

| 合并候选命令 | 本轮结果 |
| --- | --- |
| `pnpm check` | 103 文件／848 测试通过，48.30 秒；包括类型与 Harness bundle contract |
| `pnpm build` | 通过；在 E2E 前完成，未与浏览器测试并行 |
| `pnpm test:e2e --workers=1` | 全量一次 73/73，3.7 分钟；没有放宽断言、跳过或增加重试 |
| `pnpm pack:check` | 通过；固定预算／用例进入 dry-run 清单，不等于发布或同包全宿主验收 |
| `pnpm public:check` | 通过；971 文件／88 reachable commits／11 acknowledged legacy commits（提交前统计） |
| `pnpm dlx @fission-ai/openspec@1.9.0 validate --all --strict` | 43/43 通过；规划及格式校验不关闭剩余验收 |

按 user-action-contract 复验：首次验收校验延迟 700 ms 期间显示局部进度，刷新历史仍可点击；改草稿后迟到结果不能确认新修订，503 失败保留旧校验。核查计划延迟 650 ms 期间刷新仍可用，失败保留旧计划，child 比较不修改原 manifest。E2E 生成的首次验收／核查计划桌面与 390px 窄屏共四张运行时截图已目检，留在本机忽略目录 `test-results/`。测试重生成的已追踪历史 Mock 图片恢复候选原件，不纳入合并；原 dev 工作目录既有截图与未追踪 OpenSpec 草稿保持不变。

## 环境与启动边界

- iPhone 16 Plus / iOS 26.2.1；Xcode 26.5；Appium 3.2.0；XCUITest driver 10.19.1。随后用户连接 OnePlus 8T（KB2000）/ Android 14，完成 USB 调试授权和手动解锁；UiAutomator2 6.8.0、scrcpy 4.1、预装 Fixture 1.0。Node 24.19.0。
- 设备只读检查确认未锁定、已配对、Developer Mode 启用；首轮个人配置中的 WDA Team/Bundle 留空，普通会话未通过。尝试预构建 WDA 虽重新安装了已签名 Runner，但 60 秒内未建立服务，保留为失败样本。
- 从本机已有签名制品读取匹配的 Team/Bundle 并仅作为本次进程参数后，产品 iOS 静态预检六项均通过；随后标准 WDA 实际启动、`/status` ready，完成真实截图/结构和 owned stop。未授权自动 provisioning 或设备注册，也未修改个人 profile。静态 `ready` 与运行时 ready 分开计数。

## 已完成的 iPhone 片段

| 验证 | 结果与范围 | 私有证据目录 |
| --- | --- | --- |
| 感知闭环 | PNG 有效、245 个未截断结构节点；安全滑动后 revision/epoch 均从 1 到 2；owned session 清理。截图人工检查。 | `ios-acceptance-2026-10-05/observation-final.png` |
| MCP 感知闭环 | 经 stdio MCP 启动 iPhone Settings，返回有效 PNG（429,328 bytes）及 245 个未截断结构节点；安全滑动后 revision/epoch 均从 1 到 2，前后图像不同且 owned session 清理。私有截图人工检查。该结果证明 MCP 附件返回，不证明宿主模型理解图片。 | `mcp-observation-ios-2026-10-05T01-28-01-740Z.png` |
| WDA MJPEG P1 | 首次浏览器显示 134 ms，10 秒 relay 144 帧/约 14.16 fps；Appium 动作后 fresh PNG/231 个结构节点可用；主动报告媒体失效后 285 ms 回退，owned stop 成功。页面静止，浏览器仅重绘 1 帧，因此 fps 取 relay 的真实接收窗口，不把 `paintedFrames=1` 误说成动态画面帧率。 | `ios-acceptance-2026-10-05/media-metrics.json`、`media-viewer.png` |
| 私有输出路径回归 | 修改探针默认目录后再跑同一媒体链：首显 203 ms，10 秒 relay 144 帧/约 14.13 fps，fresh PNG/231 节点，489 ms 回退及 owned stop 均通过；新 Viewer 截图已目检，Git 追踪的历史图片/指标未再被覆盖。 | `media-ios-2026-10-05T01-28-42-991Z/` |
| 可靠性故障注入 | 9/9 受控场景符合预期：正常 pass；XML、PNG、磁盘写、manifest 失败为 inconclusive；取证、prepare、cleanup 取消为 cancelled；cleanup 失败为 inconclusive。均释放 run owner；manifest 中断后读取保持 inconclusive。 | `reliability-workbench-ios-2026-10-05T01-12-20-813Z/` |
| 编排与归档 | 两条分支正例 pass、故意失败 fail；取消 exit 130，排队的后续 case 无 attempt；重启后结果一致，50 份材料重读校验。Viewer 截图人工检查。 | `orchestration-ios-2026-10-05T01-14-09-684Z/` |
| Inspector → 用例 → 分析 → 新修订复验 | Inspector 只读选取 Fixture 标题并生成结构断言；加入明确的故意缺失目标后，第一修订真实运行 fail，分析页指向第 3 步及历史截图；第二修订移除该**故意注入**条件后 pass。两个独立 run、同一 session，18 份证据 SHA-256 重读一致；Inspector、失败分析、通过分析截图已目检。它证明 UI 创作与复验链路，不是实际 App 构建变更或业务后端验证。首轮探针因点击分析页隐藏的旧主题按钮而超时，保留失败样本；修正为始终可见的语言切换后完整通过。 | `authoring-ios-2026-10-05T01-18-42-946Z/`（首轮失败目录另存） |
| A1 provenance 样本 | iPhone run 的 App ID、平台/OS、provider、driver、runtime 为 observed；App version/build、二进制摘要、项目环境/数据版本及 viewport 在产品契约中仍为 unknown。没有用系统应用清单倒填运行前未采集到的字段。 | 同上通过运行的私有 manifest |

本轮 Viewer 截图显示独立历史证据，而不是把当前手机画面拿来替代失败时的截图。上述故意失败都保留原 verdict；最终 UI pass 的 business/visual 分项仍为 not-performed。

## iPhone USB 重接后的新增证据

| 验证 | 结果与范围 | 私有证据目录 |
| --- | --- | --- |
| 宿主 SIGKILL/no-replay | 仅终止自有隔离子进程；重启 store 保持 inconclusive/cleanup pending/0 步/1 原 run，不自动连接；未解决 claim 拒绝重连。仅 DELETE 本探针 session（200→404），确认 pid 已死且 nonce/generation 一致后归档自有 claim。 | `host-crash-ios-2026-10-05T06-26-47-065Z/` |
| Readiness、助手和业务 child 核查 | 新语法在真实 iPhone 合成订单上执行：UI 均通过，错误金额业务 fail、正确金额 child pass、cleanup 均 pass；原 manifest 字节不变。助手登记 hooks、700 ms 延迟下局部进度/防重/独立语言交互通过，桌面/窄屏截图已目检；fixtures/orders 均归零。用户明确授权临时绑定 Mac 的具体 LAN 地址，未绑定所有网卡，结束关闭 47831。 | `guided-ios-2026-10-05T07-09-45-930Z/` |
| 旋转与 WDA 终止恢复 | 真实 landscape 932×430，新 geometry、旧 observation tap 拒绝，恢复 portrait。仅终止当前自有设备/session 的唯一 WDA Runner PID；运行 inconclusive、后续 tap 未派发、owner 释放，2 份材料保留。新 session 的 Fixture 正例/fresh PNG/101 节点及 owned stop 通过，截图目检。 | `device-fault-ios-rotation-driver-2026-10-05T07-23-08-915Z/` |
| Appium 终止恢复 | 只停止本探针 managed server 的具体句柄；运行 inconclusive、后续 tap 无派发、owner 释放，2 份材料保留。产品释放 claim，新 session 正例/fresh PNG/101 节点恢复，owned stop 完成；人工 claim 诊断分支未执行。 | `device-fault-ios-appium-process-2026-10-05T07-29-07-175Z/` |
| 锁屏与手动恢复 | POST `is_locked` 确认锁定，Fixture assertion 真实 fail，owner 释放；用户手动解锁后新 session 正例/fresh PNG/105 节点恢复。原探针汇总把步骤类别误写成 assertVisible，故 noMutatingSteps 字段为 false；只读复核原 manifest 实际唯一步骤为 failed assert、无 private dispatch journal，保留原件不改写。类别检查已修正为 assert/done。 | `device-fault-ios-lock-2026-10-05T07-37-09-000Z/` |
| 独立业务套件与原生慢操作 | 正例 UI/business pass、exit 0；金额反例 UI pass/business fail、exit 1；cleanup 均 pass，36 份材料重启摘要复核。Submitting 时 Help 可切换，最终 Network error 且保留先前成功结果，截图目检。Help 依据实际初态验证切换，不假设每次都关闭；错误有界等待，不以固定 sleep 判定。临时 exact-interface LAN listener 完全关闭。 | `business-fixture-ios-2026-10-05T08-01-46-956Z/` |
| 固定 30 次基准 | 30/30 pass、0 失败/排除，YAML/caps 摘要不变、每轮新 session，逐步 PNG/XML、持续媒体帧、Viewer 独立控件响应、历史恢复、owned stop 全通过，累计 510 份材料校验。min 8878/median 8927/P95 9017/max 9033 ms，后续回归预算冻结为 10821 ms；阶段分布保留。初态含键盘/Help/先前合成错误，本流程只验证标题和 Help，不是业务成功。首轮运行/结果/历史截图目检。 | `ios-acceptance-2026-10-05/benchmark-30.json`，30 轮私有目录从 `workbench-2026-10-05T08-03-53-204Z/` 至 `workbench-2026-10-05T08-13-42-776Z/` |

失败样本全部保留（下述时间为 Asia/Shanghai，私有目录 ISO 时间为 UTC）：14:54 WDA UI automation 未授权；14:59 探针把 iOS accessibilityIdentifier 误作 accessible name；15:03 readiness 原 XML 丢失 focus；15:07 原 5 秒预算耗尽（未算业务失败）；15:21 首轮旋转 HTTP 500。输入现在使用明确 30 秒总预算，包括稳定/focus/最终重验与派发，不重试写入。15:13 慢请求首次取样时仍为 Submitting，旧成功结果已保留，不能把未完成请求称为失败；后续探针改为有界等待实际错误，并按实际 Help 初态检查切换，16:01 的独立完整复跑通过。

15:52 iPhone 真 USB 拔插探针在 IOUSB 树确认设备在线后提示人工拔线；180 秒内未检测到 USB 移除，记录 timeout 并清理 session。CoreDevice 无线 paired 不作为 USB 在线依据，不模拟共享 USB/ADB 故障冒充人工拔线；4.5 的这一项仍缺。

## 已完成的 Android 片段及双端对账

| 验证 | 结果与范围 | 私有证据目录 |
| --- | --- | --- |
| 可靠性故障注入 | 9/9 受控场景符合预期，正常 pass、单侧取证/磁盘/manifest 故障 inconclusive、各阶段取消 cancelled、cleanup 失败 inconclusive；run owner 释放及 manifest 重启恢复通过。第一轮探针自建 provider 漏传 OEM 默认值，被 hidden API 权限拒绝；第二轮手机锁屏，PNG 全黑且结构断言 fail。探针改为复用产品配置并由用户解锁后通过，两轮失败均保留。 | `reliability-workbench-android-2026-10-05T03-21-51-347Z/` |
| Inspector → 用例 → 分析 → 新修订复验 | Android Inspector 只读选取标题并生成结构断言，故意缺失条件产生真实 fail；新 revision 去除故意条件后 pass。同一 session、两个独立 run，18 份证据 SHA-256 重读一致；三张 Viewer 截图已目检。 | `authoring-android-2026-10-05T03-29-49-492Z/` |
| A1 双端 provenance | 两端均在运行前记录 App ID、platform/OS、provider、driver、runtime 为 observed；version/build/binary 摘要、viewport 及项目来源/环境/数据声明为 unknown。Android 记录 Android 14；iOS driver 返回 iOS 26.2，系统只读查询为 26.2.1，两者来源分别保留。基线 A1 契约提交 `REDACTED_REVISION`。 | 双端 authoring 通过 run 的 manifest |
| 编排、取消与归档 | 两条分支正例 pass、故意失败 fail；取消 exit 130，后续 case 零 attempt；重启后 50 份材料摘要复验，Viewer 截图已目检。 | `orchestration-android-2026-10-05T03-40-01-770Z/` |
| 固定 30 次基准 | 30/30 pass、0 失败、0 排除；每次输入 SHA 不变、新 session、逐步 PNG/XML、独立主题控件响应、历史恢复和设备/runtime 清理；累计 510 份材料复验。min 7,623 ms、median 8,383 ms、P95 9,762 ms、max 9,806 ms；冻结 `ceil(P95 × 1.2)=11,715 ms` 的后续回归预算。只计 run duration，不包含建/关 session；不是生产 App SLO。 | `android-acceptance-2026-10-05/benchmark-30.json`；公开规则 `fixtures/benchmarks/budgets-v1.json` |
| 独立业务正反例与慢操作 | 正例 UI/business pass、exit 0；金额反例 UI pass/business fail、exit 1；均 cleanup pass，36 份材料重启复验。慢请求显示 Submitting，Help 可操作；超时显示 Network error，保留此前成功结果。手机通过本探针创建的 USB reverse 访问 Mac loopback，未开放 LAN；结束后只移除该映射。 | `business-fixture-android-2026-10-05T03-56-20-768Z/` |
| Agent 测试控制核心 | 单流程、正例套件、业务负例套件和取消分别 pass/pass/fail/cancelled；request/execution/run/suite 关联及重启证据摘要通过。不等于两宿主模型已消费图片。 | `agent-control-android-2026-10-05T04-04-53-080Z/` |
| 宿主 SIGKILL 与 owner/no-replay | 只杀隔离子进程；重启原 store 后保持 inconclusive、cleanup pending、0 设备步骤、1 个原 run、不自动连接设备；未解决 claim 阻止重连。人工诊断后仅 DELETE 本探针会话（200，再查 404），归档匹配 pid/nonce/generation 的自有 claim，不接管别人的会话。 | `host-crash-android-2026-10-05T04-07-26-083Z/` |
| 旋转与驱动终止 | landscape/portrait 获取新 geometry；旧 observation 点击被拒绝。只终止本探针 UiAutomator2 helper，运行 inconclusive、后续 tap 未执行、run owner 释放、已有 PNG/XML 保留；新 session 与 Fixture 正例恢复，owned stop 完成。初轮漏开观察权限及第二轮探针重复对象产生 YAML alias 均已修正，失败样本保留。 | `device-fault-android-rotation-driver-2026-10-05T04-11-06-287Z/` |
| Appium 进程终止 | 在 wait 阶段停止本探针实际创建的 managed Appium 进程句柄，不搜索/终止其他实例；运行 inconclusive、后续 tap 未执行、run owner 释放，2 份已捕获材料保留。本次产品释放 device claim，新 session 正例与 fresh PNG/XML 恢复，owned stop 完成；没有执行探针中的人工诊断 claim 分支。 | `device-fault-android-appium-process-2026-10-05T04-34-16-010Z/` |
| 就绪语法、首次验收助手、核查与 child 复验 | assertReady/fillReady/tapReady/waitFor 在真实订单流程执行；错误金额 fail 后相同 YAML 的明确参数 child pass，独立业务/cleanup 正确，原 manifest 字节不变。助手显示 prepare/verify/cleanup；700 ms 受控校验延迟期间局部进度、防重与语言控件交互通过，明确静态校验不等于业务验收。桌面/窄屏核查截图目检，数据库 fixtures/orders 均 0。 | `guided-android-2026-10-05T04-27-45-846Z/` |
| 实际 Appium 客户端 runner JUnit | node:test 24.19.0 的 W3C HTTP 客户端读取真实 Appium source/screenshot，自动记者生成 JUnit（不是手写 XML/Workbench JUnit）：3 pass、1 故意 fail、1 skipped；包含多 suite、同名参数化、Unicode 和缺附件。预览→确认导入→附件下载原字节一致→验收修订关联均通过；5 条 external-result 为 verified 但验收保持 incomplete、未假装原生业务通过。APK/build 在 runner 前只读捕获，commit 是候选声明关联，非 App 供应链证明。报告许可为项目 MIT/Node reporter 许可；error 方言和 Maestro 未由这个样本覆盖。 | `appium-junit-2026-10-05T04-29-58-953Z/`；报告 SHA-256 `0646458e3ec1c68986fa15d6e6b628afa2af0905c0880226a9429f79a19ae4aa` |

据此完成 `add-workbench-authoring-and-visual-validation` 2.6、`improve-workbench-authoring-and-analysis` 6.1 及 `harden-workbench-adoption` 2.5。独立用户研究、两次实际构建变化、视觉与业务后端验收另计。

## OpenSpec 对账：已完成项与剩余边界

| 任务 | 本轮推进 | 尚缺的具体条件 |
| --- | --- | --- |
| `harden-workbench-adoption` 4.4 | Android 9 项故障、锁屏失败样本、旋转/驱动/Appium 终止恢复、宿主 SIGKILL/no-replay 已新增。 | 真实 USB 拔插仍缺：探针等 180 秒未检测到拔线，超时后关闭自有会话；不能用软件模拟替代，也不终止共享 ADB server 冒充 USB 故障。 |
| `harden-workbench-adoption` 4.5 | USB 重接后新增宿主 SIGKILL/no-replay、旋转/WDA/Appium 终止与锁屏/手动恢复；旧候选证据仍分开。 | 本次真实 USB 拔插在 180 秒内未操作，timeout 后关闭自有 session；这一项尚缺，矩阵保持未完成。 |
| `harden-workbench-adoption` 4.6（已完成） | 双端各固定 30 次、各 510 份材料校验、各 0 失败/排除；预算分别冻结为 Android 11715/iPhone 10821 ms。 | 仅校准基线与后续回归阈值，不称为生产 SLO、跨平台排名或后续版本已通过此预算。 |
| `add-workbench-text-input-acceptance` 3.2 | 第三方 App测试包仍在设备，WDA 前提已恢复。 | 需获已登录业务 App 发送公开测试句的确认后重跑；既有消息气泡正文/历史标题不暴露可访问文本，不能降低结构断言或借旧图片勾选。 |
| `add-guided-mobile-acceptance` 5.1（已完成） | 双端新就绪语法＋助手能力发现＋业务核查/child 复验通过；iPhone focus 修正及显式 LAN 授权留证。 | 仅完成合成 Fixture 双端功能验收，不代替 5.2 独立用户/外部项目研究。 |
| `add-external-test-assets` 5.1–5.2 | 实际 node:test/Appium HTTP runner 的报告及导入/附件/验收关联完成，原件私有冻结。 | Maestro 真实 JUnit、error 方言和持有外部资产的独立使用方仍缺。本机未发现 Maestro 可执行文件，不自动安装新框架或将合成 XML 称为 Maestro 输出。 |
| `add-agent-test-run-control` 4.4 | 核心控制＋真机成功；iPhone stdio MCP 图片已返回。 | 两宿主真实模型图片消费未完成；当前 Codex 会话未挂载 FlowAssert 工具，完整 DSH rc.2 依赖/模型授权需独立核验，不能以直接探针或 view_image 代替。 |
| `add-local-ocr-and-device-matrix` 8.1–8.4、`add-workbench-authoring-and-visual-validation` 3.5/4.7/6.2 | 双端创作已有新证据，Android 服务链可用。 | 授权冻结图片语料、已批准 visual/OCR profile、两次真实 App 构建与 iPhone 同时可用未齐；20 轮双槽及每端各 3 次故障/取消仍缺。单个 Fixture 构建不能代替；production OCR 保持关闭。 |
| `add-evidence-guided-failure-triage` 7.3–7.4、`add-change-acceptance-records` 6.1、`add-workbench-long-term-operations` 5.3/6.3 | 本轮没有把旧功能的真机 smoke 迁移为这些新候选的验收。 | 分诊实现/冻结候选及两构建矩阵、真实代码变更与业务 verifier、两个外部试点及三团队四周采用日志尚缺。 |
| `add-bounded-ai-recovery` 5.1/5.6 | 当前 iPhone 连接不改变旧 DeepSeek 单 backend 记录。 | 跨 backend 对照、真实遮挡/成本以及旧 Android 线材/接口单变量复验仍未完成。 |

没有把 2026-09-25 旧候选的通过自动归属为本候选通过。所有未满足完整验收定义的 checklist 保持未勾选。个人账号、Team、UDID、完整手机截图和本机绝对路径不进入仓库。

## 可复跑入口及授权边界

在仓库内使用绝对路径的私有 `MOBILE_MIRROR_CAPABILITIES_PATH`，指定明确设备及预装 Fixture，并提供绝对 `MOBILE_MIRROR_APPIUM_EXECUTABLE`：

- `pnpm test:authoring:physical`：双端 Inspector/新修订复验。
- `pnpm test:guided:physical`：双端 readiness/业务助手/核查；Android 的 USB reverse 是单独显式准备。iPhone 经用户授权后显式设置 `FIXTURE_HOST` 为 Mac 的具体 IPv4 interface 地址，可另设 `FIXTURE_DEVICE_URL`；默认保持 loopback，拒绝 wildcard binding。验证结束必须关闭临时 listener。
- `pnpm test:crash:physical`：另需显式 loopback `MOBILE_MIRROR_APPIUM_URL` 指向单独受控 Appium；只杀自己的子进程，未解决资源不重放。
- `pnpm test:device-fault:physical`（Android 旧别名保留）：默认旋转/驱动终止；`MOBILE_MIRROR_DEVICE_FAULT=appium-process` 只停止自己的 managed server；`disconnect` 需要人在 180 秒内实际拔插线；`lock` 是明确受控锁屏并等待人工解锁，不输入密码。iOS driver fault 只终止当前自有 session 的唯一 WDA Runner PID，过程记录私有。进程故障若留下未解决 claim，只在服务器确认不可达且 pid/nonce/generation 匹配时执行明确的探针 owner 诊断/归档，不宣称产品自动恢复。
- `pnpm test:appium-junit:physical`：明确 Android Fixture 和 loopback Appium；只读复制该已安装 APK，真实 runner 报告含故意失败，导入阶段无设备连接；不新增外部执行 adapter。
- `pnpm test:workbench:benchmark`：固定 YAML、caps 和证据策略，`MOBILE_MIRROR_REPEAT_COUNT=30`；预算使用 `fixtures/benchmarks/budgets-v1.json`，不边测边放宽。

本轮新增 iOS readiness 对 provider 核验结构的最小修正，并修正验证探针配置/交互与私有输出目录；未改 DSH agent loop、provider/transport 边界或产品 verdict。原 checkout 的未提交文件保留；没有隐式 commit、push、合并、tag、Release 或 OpenSpec 归档。

## 最终工程回归与资源收尾

USB 续验最终门禁：`pnpm check` 103 文件/848 测试全部通过（48.06 秒）；后续探针条件收紧后 `pnpm typecheck` 再通过。`pnpm test:e2e --workers=1` 73/73（3.7 分钟）；`pnpm build`、`pnpm pack:check`、`pnpm public:check` 均通过，公开扫描 971 文件/87 reachable commits/11 acknowledged legacy commits；OpenSpec strict 43/43。预算与固定用例加入 pack 文件清单，但 pack dry-run 不证明新的同包全宿主/发布验收。E2E 只在隔离 worktree 再生的历史 Mock 图片已恢复候选原件，原 checkout 的 20 张未提交图片和未追踪 triage 草稿保留。

最后重新复核：iPhone 对应全局 claim 不存在；本次 managed/external Appium 的 4723/4735 与 Fixture 47831 均无 listener；guided/business 两份数据库 fixtures/orders 各为 0。当前 Android 不在线；未发现 Maestro 可执行文件，当前会话未挂载 FlowAssert 宿主工具。验收收尾时尚未 commit/push；后续经用户显式授权，在隔离的 `feat/physical-validation-oct` 分支单独提交推送，不合并 dev、不创建 tag/Release，也不归档 OpenSpec。下面保留前阶段 gate，不将其混作续验的新结果。

- `pnpm check`：103 个测试文件、846 项通过；Appium 进程探针新增后再次执行仍全部通过（47.60 秒），包括 TypeScript 与 Harness bundle contract。
- `pnpm test:e2e --workers=1`：73/73 通过（3.7 分钟）。自动再生的已追踪 Mock 截图恢复为本候选原件，本轮真机截图留在私有目录，不覆盖历史公开证据。
- `pnpm build`、`pnpm pack:check`：通过；后者是候选包文件清单/构建 dry-run，不称为新的发布或真机同包全宿主验收。
- `pnpm public:check`：通过（971 个文件、87 个 reachable commits、11 个已确认 legacy commits）。OpenSpec 1.9.0 `validate --all --strict`：43/43 通过。
- 上一阶段结束时 Android/iPhone 对应的全局 device claim 均不存在；受控 Appium 的 4723/4735 和 Fixture 47831 均无监听，ADB reverse 列表为空。续验仍需最后重新核对资源，不用该历史状态证明当前收尾。未关闭其他用户服务或共享 ADB server。
- 前阶段勾选 B1 Inspector 双端 2.6、authoring/analysis 双端 6.1、A1 provenance 双端 2.5。USB 续验新增 guided 双端 5.1、harden 双端基准 4.6；对应进度 22/45、37/38、15/16、28/36，均不归档。真 USB、实际模型/OCR/两构建/独立用户与外部试点各自保留缺口，不能从软件门禁通过推导为全部交付。
