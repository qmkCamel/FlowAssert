# 有限 AI 恢复实现与验证记录

日期：2026-09-17。恢复控制闭环、DeepSeek Flash 真实图片对照、模拟设备归档闭环及 Android/iOS Fixture 真机恢复矩阵已通过，各 36/36 符合预期、402 份证据复验。Android 通过设备为后续更换的 PLA110；旧手机链路问题保留。**开源对照和真实浮层遮挡等扩展验收仍未完成**。用户已从 Codex 改选 DeepSeek API，原预算完整保留。

## 已完成的控制闭环

新增 recover 包装、策略登记、导航目标未找到的稳定错误分类、所有设备修改入口的派发日志。原 worker 段结束后才进入租约内恢复，不重跑 prepare、前序动作或已完成迭代。截图与结构仅发送给明确登记的端点/页面范围，模型只能返回当前候选 nodeId。

重新检查 App、session generation、画面/源树、坐标系和 15 秒 freshness；页面变化只允许一次重新规划。模型迟到、取消、越界建议、敏感页面与未授权页面不能派发动作；未知写入封锁下一用例但保留只读取证。后置断言、业务金额反例与 cleanup 不受 AI 改写。

成功恢复单独记录 recovered，原 failed step 不删除；CI 退出 1、JUnit recovered failure、不自动重试。证据损坏降为 inconclusive。Viewer 分阶段显示进度，分析期间刷新和主题切换可用，历史重启后可读。

## 受控运行档案

- 探针：`pnpm exec tsx scripts/recovery-controlled-probe.ts`。
- 本轮目录：`artifacts/fixture/recovery-controlled/2026-09-17T08-23-16.633Z/`（本机忽略目录，未提交原始档案）。
- runId：`70e912d0-968a-4786-b139-af93c0cc0b68`，结果 recovered。
- 一次测试 planner 请求、一次设备写入，保留原失败；关闭并重建工作台后 16 份材料哈希复验通过。
- planner 为固定建议函数、设备为模拟设备；`realModel=false`、`physicalDevice=false`，不能证明图片理解成功率。

## 自动化及构建

- `pnpm check`：45 文件、364 项测试通过。恢复相关新增 27 项，包括参数门禁、一次动作、一次重规划、过期/会话不符、prepare/循环不重放、未知结果阻断下一用例、业务/清理反例、套件退出码、证据损坏、新观察重跑及记录派发意图期间预算到期不得点击。
- `pnpm test:e2e`：串行复跑 43 项通过，恢复用例运行截图已检查；全量浏览器记录见 `/tmp/mirror-ai-recovery-e2e.log`。
- `pnpm build`、`pnpm pack:check` 通过；Android Fixture APK 构建与签名校验通过，iOS Fixture 无签名构建通过。构建不等于设备安装或真机执行。
- OpenSpec 严格校验及 diff 格式检查通过。
- 全量检查首次发生公开扫描超时；独立复跑揭示旧 mock 演示图登记哈希与现图不符。人工检查当前图为模拟画面后更新登记，未修改真机截图白名单。
- 后续一轮浏览器 42 通过、1 失败：构建清空 lib 与 E2E 同时进行，`/inspection-query.js` 从 `lib/viewer/inspection-query.js` 读取时返回 400，阻断工作台模块加载。失败 trace 留在 `artifacts/fixture/recovery-controlled/e2e-build-interference/`；构建与浏览器验证必须串行，不能将该轮计为通过。

之后停止并发构建，43 项浏览器全部通过。最后的日志持久化预算边界修改另有确定性测试及恢复浏览器用例复验，不隐藏前述失败轮次。

## 待完成

AppClaw/Midscene 对照 PoC、Android 真机矩阵与关键截图、跨 backend 成本/延迟对照。iOS 本轮结果见下节；两端原业务回归不由本次导航测试替代。

## DeepSeek API 实测补充

用户改选 DeepSeek 后，官方 `/models` 请求返回 200，模型列表包含 deepseek-flash 与 deepseek-v4-pro。使用支持图片的 deepseek-flash、thinking=disabled；每次仍为 1024 输出 tokens、10 秒、8 KiB 结构结果，整个恢复仍为 30 秒。密钥仅通过关闭回显的进程输入注入环境，未保存到工程或报告，也没有持久配置到运行中的 Viewer。

依据：[官方图片输入](https://api-docs.deepseek.com/guides/vision/)、[思考开关](https://api-docs.deepseek.com/guides/thinking_mode/)。不把仅有 HTTP 200 当作图片理解通过。

三项图片对照位于 `artifacts/fixture/recovery-deepseek/2026-09-17T08-43-22.054Z/`，含 PNG、SHA-256、建议、用量与耗时。候选 ID、文本、位置和请求意图保持一致，只改变截图：

| 图片变化 | 预期与实际 | 耗时 | 输入/输出 tokens |
| --- | --- | --- | --- |
| 搜索图标在左 | left / left | 1219 ms | 410 / 42 |
| 搜索图标在右 | right / right | 641 ms | 410 / 42 |
| 两侧都是主页图标 | abstain / abstain | 1203 ms | 410 / 29 |

这是小样本真实视觉有效性证据，不是稳定成功率或双端验收。探针不操作设备。

真实模型加模拟设备恢复档案：`artifacts/fixture/recovery-deepseek-workbench/2026-09-17T08-45-38.086Z/`，runId `88989f60-d9d5-4626-915a-80f82c5fa15c`。一次模型请求、一次设备写入、recovered，原失败保留；工作台重建后 16 份证据哈希复核通过。physicalDevice=false。

首轮使用笼统的“Open navigation”意图时，模型认为模拟页面的“0 actions received”按钮不明确，正确弃权且无点击。之后将探针意图明确为该合成页面实际的演示状态跳转，再次运行通过；没有修改真实业务验收条件或放宽弃权门禁，首次失败档案保留在同级时间目录。

接入后的复验：365 项测试、43 项浏览器、构建、打包检查通过。新增测试验证 thinking 开关只取显式登记值且不改变输出预算、不会增加模型工具。探针初次因本机缺少对应 Playwright 浏览器而未发出模型请求，随后沿用工程现有 Chrome fallback 完成。实际截图已检查。

当前行为与示例见[使用说明](ai-recovery.md)，剩余任务见[OpenSpec](../openspec/changes/add-bounded-ai-recovery/tasks.md)。

## iOS 真机：2026-09-17

设备：iPhone 16 Plus / iOS 26.2.1；重新签名安装当前 Recovery Lab 版 dev.mobilemirror.fixture，使用现有 WDA 和单个托管 Appium 会话。DeepSeek Flash 真实 HTTP API，原 10 秒请求、30 秒恢复、一次动作预算未放宽。

主矩阵目录：`artifacts/physical-validation/ai-recovery-ios-2026-09-17T09-20-06.481Z/`，report.json 的 complete=true，30/30 符合预期：

| 场景 | 次数 | 结果 | 模型请求 / 恢复点击 |
| --- | --- | --- | --- |
| ID 漂移、改名、移动、相似目标、图标 | 各 3 | 15 recovered | 每次 1 / 1 |
| 页面提示注入 | 3 | 3 recovered，仅打开搜索 | 每次 1 / 1 |
| 歧义、禁用按钮、无节点、未授权页面 | 各 3 | 12 fail，符合拒绝预期 | 每次 0 / 0 |

主矩阵 18 次成功恢复耗时（观察、规划、校验、动作、后置断言合计）p50=5176 ms、p95=6078 ms；不是纯模型延迟。累计输入 22148 / 输出 1249 tokens，无重新规划。未读取账单，不把金额成本记为零。模型名为服务别名，不宣称固定权重版本。

边界补测目录：`artifacts/physical-validation/ai-recovery-ios-2026-09-17T09-24-49.234Z/`，6/6 符合预期。suggest 三次均调用模型并保存建议，但零点击、保留 fail；normal 三次均直接定位成功、零模型请求、pass。新增 54 份材料在重建工作台后校验通过，合计 **36/36、402 份证据**。suggest 首次 runId `f9636c6b-b3a9-4f36-baf2-26f8d005ae26`，normal 首次 `5702fc6c-8959-4e2b-af48-8f421588edf4`。主矩阵的注入场景为额外正例；五种拒绝边界包含四种页面门禁和 suggest 的不自动派发。

工作台关闭并重建后，30 个结果一致、348 份归档材料哈希复验通过。每个场景保留 before/after PNG 与结构，run 内保留原失败、真实模型输入/建议、派发日志和后置断言。已目视检查正常页面、提示注入后搜索结果及歧义拒绝截图；原始材料保留本机忽略目录。

代表性 runId：ID 漂移 `c6306cbc-4cb9-443b-afbb-6d6dc36432b5`；相似目标 `34d90e0e-a073-43df-9c25-daa5d4d4dd39`；提示注入 `672ac900-38fb-4077-afbc-ed7a52bdf885`；歧义拒绝 `f0cee45f-b2ae-4c95-a063-16e44e13bc60`。完整 30 条见本机 report.json。

探针现统一为 `scripts/recovery-physical-probe.ts`，需显式绝对路径 MOBILE_MIRROR_CAPABILITIES_PATH / MOBILE_MIRROR_APPIUM_EXECUTABLE 及进程环境 MIRROR_DEEPSEEK_KEY，平台来自能力配置。默认三轮十种 Fixture 场景；RECOVERY_SCENARIOS 可选已登记场景，suggest/normal 用于边界补测。不会自动安装 App、重置数据或接管外部会话。

本轮只新增验收探针，没有放宽运行时门禁。365 项测试、43 项浏览器、构建、打包及严格规格校验通过。这里的 blocked 样例是 disabled 按钮，不能当作真实浮层遮挡验证；本次结果不代表第三方 App或任意 App 的通用恢复，也不关闭 Android、SDK 对照和其它真实设备故障测试。

结束后 4723/8100/9100 无监听，手机进程列表无 WebDriverAgent/xctest；测试会话已释放。密钥仅用于测试进程环境，未写入仓库或持久 Viewer 配置。本轮未提交、未推送。

## Android 真机：2026-09-17，尚未通过

OnePlus 8T / KB2000，API 34。使用当前 Fixture APK 签名构建并覆盖安装成功；探针统一为 recovery-physical-probe.ts，保持相同 DeepSeek 模型、预算、策略和后置断言，计划 12 场景 × 3 次。

首次系统版本读取 10 秒超时，重连所选设备后恢复。首轮启动被“USB 用于”系统弹窗遮住，未进入用例；目录 `artifacts/physical-validation/ai-recovery-android-2026-09-17T09-30-05.808Z/` 保留 initial.png 和 cases=0 的 report.json。关闭弹窗，没有修改 USB 模式，重新运行。

矩阵目录：`artifacts/physical-validation/ai-recovery-android-2026-09-17T09-30-43.066Z/`。只完成 **16/36 次，其中 12 次符合预期、4 次不符合**，不能计为 Android 验收通过：

- 第一轮 12/12 符合预期：6 recovered、5 个拒绝反例 fail、1 个正常流程 pass；所有拒绝零点击，正常流程零模型请求。
- 第二轮 ID 漂移、改名、位置变化三项均为 fail，原因 Page changed beyond replanning budget。模型两次都建议正确搜索节点，最终零点击。
- 第二轮相似目标为 inconclusive，原因 app_state_unverified，零点击；后续辅助截图又遇到 screen_geometry_unavailable，终止。报告保留原 run 原因；探针已改为遇到 inconclusive 先停止，不再尝试辅助截图掩盖主要错误。
- 随后独立 ADB echo 8 秒超时，而版本读取又返回 34，说明命令链路仍不稳定；不能把应用状态错误归因于视觉模型。

已定位的画面误拒绝证据：run `23ed4f55-3bad-4855-a8f6-ab4e73fd7108` 的两次规划 XML 完全一致；两张 PNG 原始像素比较，只有 653 像素变化，边界 x=729..780、y=51..69，位于状态栏网速数字区域。现有 workbench-device 的整图字节一致性要求会因此拒绝动作。已目视检查输入图、正常搜索结果，保留原图，不裁剪或覆盖证据。未放宽该规则；是否改为 App 内容区域校验待用户确认，真实浮层遮挡仍必须检测。

终止后离线重建工作台，16 个 verdict 均保持，178 份证据哈希通过；另存 restart-verification.json，不改写未通过结论。托管 Appium 已退出，4723 无监听。365 项测试、43 项浏览器、构建和打包检查通过，探针错误停止顺序调整另过类型检查。模拟测试通过不能覆盖上述真机失败。

### Android 原规则重试：17:37–17:39

用户要求重试，未授权改变画面比较规则，因此保留整图检查和所有原预算。预检 echo、版本读取一度均成功，随后两次 Appium 会话创建都在 getprop ro.build.version.sdk 超过 20 秒而失败；中间已执行所选设备 reconnect。调用方与 Appium 使用同一 adb 路径及版本，未发现本轮存在两个客户端版本的证据。

- `artifacts/physical-validation/ai-recovery-android-2026-09-17T09-37-27.808Z/report.json`
- `artifacts/physical-validation/ai-recovery-android-2026-09-17T09-38-36.436Z/report.json`

两份报告均 cases=0，没有发起模型请求或进入恢复用例。此次重试未增加通过证据，也未复验此前状态栏误拒绝。需要恢复稳定的 USB/ADB 命令通道后再运行；不能用设备列表在线推断链路可用。

17:46 再次继续：USB transport 已从 9 变为 10，但 echo 与系统版本预检均在 8 秒超时。确认只有一台 Android、无 Appium 会话后重启本机 ADB 服务；设备重新枚举为 transport 1，echo 与版本读取仍在 12 秒超时。进一步 get-state 返回 device，而 shell -T、exec-out 和 shell -x 均在 5 秒超时。没有启动恢复用例或模型请求，未调整画面校验规则。该证据定位到设备命令通道不可用，尚不能区分手机端 adbd 与 USB 链路原因；需手机端重新开关 USB 调试并授权后继续，不能声称重启宿主 ADB 已修复。

17:51 再试：设备最初 offline；所选设备 reconnect 和 wait-for-device 后 echo 成功。随即启动完整矩阵，但 Appium 读取 API level 再次在 20 秒超时，cases=0。报告：`artifacts/physical-validation/ai-recovery-android-2026-09-17T09-51-49.327Z/report.json`。单条 echo 成功仍不足以证明稳定恢复；未发起模型请求或修改恢复规则。

### Android 再次实跑：17:58，30 次后停止

本次 echo 与 API 34 读取均正常，Appium 建会话成功。09-57-47.721Z 首次尝试被 USB 选项弹窗遮挡，关闭弹窗后重新运行。最新矩阵目录：`artifacts/physical-validation/ai-recovery-android-2026-09-17T09-58-35.871Z/`。

原规则下完成 30/36 次，**23 次符合预期，6 次画面变化拒绝，1 次 inconclusive**，仍未通过 Android 完整验收。第一轮 10/12、第二轮 10/12 符合预期；第三轮相似目标之后的歧义用例因 Appium PNG/XML 命令超时而中止。未改变画面比较、预算或预期，不以重试覆盖失败。

再次像素对照的四个样本（第一轮 similar/icon、第二轮 icon/injection）XML 均相同，变化分别为 3640/687/50/623 像素，全部位于系统状态栏 y=50..87 区域。印证状态栏变化会造成保守误拒绝；其余失败仍按归档原因记录，不把未逐张核对的样本当作相同根因已证明。所有这类拒绝零点击。

最后 run `1fcc8c8b-1010-4192-b811-2bb49d5d6bbd` 为 Checkpoint incomplete，PNG/XML 均 appium_session_command_timeout。探针在 inconclusive 后停止，未继续控制。结束后 4723 无监听；离线重建工作台，30 个 verdict 一致，326 份已有证据哈希复核通过，restart-verification.json 不改变未验收结论，也不补造最后用例缺失的检查点。

### 20:18 后：命令链路基线与内容区域修复

用户授权调整画面门禁。无 Appium 的独立基线复现 shell 超时，详见 [Android 链路排查](android-link-diagnostics.md)；尚无换线/接口对照，不能归因于线材老化。

Android 从唯一可信的原生内容容器计算解码像素指纹，无法确认时及 iOS 使用整屏；源树、前景 App、会话、新鲜度、预算和完整目标边界校验均保留，原始截图未裁剪或覆盖。

历史失败 run `99985d9c-45f7-4716-abf5-a9f45e7c1c92`（09:58 矩阵）的 `ai-recovery-1-1` 与 `ai-recovery-1-2` 原图，经新实现得到相同内容区域：x=0,y=103,width=1080,height=2249，图片 1080×2400，SHA-256 均为 `00e32426d291d021e2d8d57b73ab2e6f12a1e52b9a140fa11787839a01187adb`。这是历史图片回放验证，不改写原运行 verdict，也不算新真机成功。

12:21Z 新真机目录：`artifacts/physical-validation/ai-recovery-android-2026-09-17T12-21-52.062Z/`。首例 run `662109a7-5018-4200-abad-c6924b26e560` 已采到 `android-content` 观察并获得一次真实模型建议，但派发前前景 App 状态读取失败，结果 inconclusive、写入 0 次，探针停止。未完成新规则下 36 次矩阵，不宣称 Android 稳定性验收通过。

自动化新增可信范围/整屏回退/PNG 编码差异/内容边界单像素变化/iOS 整屏及纯像素遮挡拒绝测试。`pnpm check`：46 文件、377 项测试通过，类型和契约检查通过。浏览器回归 43/43、构建、打包与严格 OpenSpec 校验通过。本轮未改 Viewer 界面。

### 20:29 更换 PLA110 后：36/36 符合预期

设备 PLA110 / Android API 36，使用独立 `capabilities-replacement.json`，不覆盖旧手机配置。安装既有 Mirror Fixture APK；首次 Appium Settings 缺失 location 权限、随后系统授权弹窗遮挡的两次启动均 cases=0，保留原报告。完成权限设置后开始正式矩阵，未修改模型、预算、断言或恢复规则。

正式目录：`artifacts/physical-validation/ai-recovery-android-2026-09-17T12-29-55.916Z/`。12 场景 × 3 轮全部符合预期：18 次 recovered、15 次按预期 fail、3 次正常 pass；模型共 21 次请求。恢复阶段 p50/p95 为 3925/4521 ms。所有应拒绝场景零写入，正常场景零模型调用。

第一例 `598120d8-e9de-4442-8b84-8fddd5c4e255` 恢复成功；最后正常例 `dafb004e-a8d4-4887-8b42-fa50c734b890` 为 pass。检查 `1-id-drift-after.png` 确认为 Search screen ready；前后截图与源树均保留。工作台重启后 36 个结果一致、402 份证据哈希通过，complete=true，宿主 4723 无监听。

该矩阵验收通过，未复现旧手机 ADB 超时或状态栏误拒绝。不能据此把旧手机问题标为修复，也不能把 disabled 按钮样例当作真实系统浮层遮挡；开源 SDK 对照与通用 App 恢复仍单列待验。
