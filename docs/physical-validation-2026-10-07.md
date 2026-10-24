# 真机续验与全项目剩余任务对账 — 2026-10-07

本轮从远端 `dev@REDACTED_REVISION` 的隔离分支 `test/physical-acceptance-followup` 续验。验证期间 dev 合入修复工作流及 DSH 适配，当前本地基线已更新为 `dev@REDACTED_REVISION`，通过冻结 lockfile、offline / ignore-scripts 准备 DSH `0.2.0-rc.2` 依赖，没有修改全局 CLI 或个人 profile。原主目录的旧 dev、修改截图及未跟踪 OpenSpec 保持不动。设备为授权 Android 14 / OnePlus KB2000 和用户确认已连接、解锁的 iPhone；只操作已安装的合成 Fixture，不修改账号、不重装/重置 App、不自动安装诊断 agent、不外发图片。本轮不声称真实模型或实际双宿主交接验收。

证据候选分开：初轮受控故障、旋转/server/host、锁屏和录像对应 `REDACTED_REVISION` 加本轮实现；iPhone 新修复导航/转发探针对应 `REDACTED_REVISION` 未修改的隔离导出代码。`REDACTED_REVISION→REDACTED_REVISION` 的 src 变化仅 `index.ts/tools.ts`（DSH 薄适配），不改设备控制模块，也不将已有记录改标为新执行。最终工程门禁对应 `REDACTED_REVISION` 加本轮改动；更新基线前后只临时保存本轮明确路径并恢复，没有暂存用户主目录改动。

真机收尾时远端又更新到 `REDACTED_REVISION`。fetch 后核对相对 `REDACTED_REVISION` 只改 36 份文档，无运行代码/lockfile/测试变化；当时先冻结 `REDACTED_REVISION` 验证，没有改标旧证据。后续按用户提交 dev 的明确授权，隔离分支 fast-forward 到 `REDACTED_REVISION` 并恢复本轮明确路径；两处文档冲突同时保留 Preview／默认关闭与新设备事实，不回退远端文档。519 文件源码指纹仍一致，Git 历史路径阻塞仍保留；交付 SHA 以提交记录和远端复核为准。本轮探针时刻按原私有报告的 UTC 记录，设备状态是验证阶段事实，不冒充提交时新设备诊断。

## 本轮已取得的证据

| 范围 | 实际结果 | 不能据此宣称的能力 |
| --- | --- | --- |
| 初轮 iPhone live 诊断来源探针 | 固定 `devicectl device info details/files`，实际设备详情及 RuntimeFixture 限定的 systemCrashLogs 目录均可读；验证 Xcode `info.outcome`、命令及结果结构；health 6.3 完成 | crash 归档不证明测试窗口完整；hang 未取得可信实时来源，两个信号仍 unsupported |
| REDACTED_REVISION 候选 iOS 受控故障 | 9/9：正常基线、XML/PNG 单侧失败、PNG 存储失败、manifest 写失败及恢复、取证/prepare/cleanup 取消、cleanup 失败均符合预期 | 非真实手机磁盘耗尽；不是整个故障矩阵完成或新合并候选的重复验收 |
| Android 受控故障，含 REDACTED_REVISION 复跑 | 初轮及合并后均 9/9 符合预期。首次 Recovery Lab 初态失败保留；探针仅通过 MirrorService 终止/重开明确合成 Fixture，不清数据。最新 9 runs / 56 files / 1123287 bytes 只读复验及 manifest 不变 | 没有重装、清数据或将首次失败改写为通过；同样非真实磁盘耗尽 |
| Android 锁屏 | 持续锁屏前后确认；标题断言 fail、0 写入动作、owner 释放。原 180 秒手工解锁等待超时保留；后来独立读取 keyguard 不显示，新会话标题、PNG/XML 恢复通过 | 后来恢复不将原 timeout 改为通过；首次瞬时锁屏无效；无自动解锁 |
| 双端旋转 / driver / server，Android 含 REDACTED_REVISION 复跑 | 初轮双端横屏真实几何、旧 observation 坐标拒绝；UiAutomator2/WDA 和自己启动的 Appium 进程终止均 inconclusive、无后续 tap、owner 释放；新会话图像及 15 节点恢复。新候选 Android 同样通过；两类故障各 3 runs / 23 files 只读校验，manifest 不变 | 只终止明确归属的进程；不等于 USB 拔线或任意后台服务恢复；iOS 初轮记录不挪作新候选重复验收 |
| 双端宿主 SIGKILL，Android 含 REDACTED_REVISION 复跑 | prepare 注册清理后只强杀本次 child；重启 inconclusive / cleanup pending、0 steps / dispatch、无设备重连；stale owner 阻止隐式重连；显式诊断自己的 session/claim 后清理通过。新候选 Android 再次通过，1 run / 2 files / 1330 bytes 只读复验、manifest 不变；测试自建 loopback Appium 随后关闭 | 外部资源 pending 不假装自动清理，不重播动作；不是强杀外部使用者的 Appium |
| 双端录像，Android 含 REDACTED_REVISION 复跑 | 初轮各 7 步 Fixture pass、同会话、完整归档/hash、重启解码及近似步骤定位；Android scrcpy H.264 / iPhone WDA MJPEG；ffmpeg 完整解码 302/158 帧、269/25 不同帧、均无音轨。新候选 Android 完整录像 7781 ms / 1345376 bytes、VP8 864×1920、226 帧 / 225 不同帧 / 无音轨，已查看重启回放截图 | 视频与原生截图分辨率不同；不是全帧率、零丢帧或生产性能证明；新 Android 不替代新 iOS 录像 |
| dev@REDACTED_REVISION 新 iPhone 修复导航 | 13/13 预期匹配、114 份证据重启复读、同设备第二 owner 拒绝；正确 v2 页通过，旧 App 根/错页/错误语义零派发，原后置断言失败保留 | 普通合成导航，不是危险同文字、旧构建对照、真实安装/reset/受审修复闭环 |
| dev@REDACTED_REVISION 真实会话 host forwarding | lsof 核对同一自有 Appium PID 的 4738/8118/9118 全为 IPv4 127.0.0.1；WDA status 200/ready；结束后无上述监听 | 不检查/修改手机端监听或外部 Appium；Appium sessions 列表 404 不当作无 session 证明 |
| 最新报告真实材料复验 | 11 份双端归档（9 历史＋2 本轮录像）、2 组 fail→child pass、performance pass/fail/inconclusive；新分析页实际解码录像；仅副本删图，原 reported pass 不变、材料 unavailable | 不重执历史业务，不推断复验证明根因；未声明不当健康通过；作者阅读不替代独立验收 |
| 实际 Safari 部分阅读 | Safari 26.3.1 原生 file URL、来源/未重验警示、Option+Tab/Enter 锚点及 5 页打印预览已查看 | 未隔离网络或测请求计数，未做原生窄屏；report 5.9 不勾选，未实际打印 |
| 历史 USB 中断证据复验 | 10 月 6 日两端实际拔线 run：Android 17 份 / iOS 41 份登记材料 hash 复验，temporal/measurement 原生语义重放均通过，原 manifest 不变 | 仍是历史合成 RuntimeFixture 中断记录，不升级为最新候选业务/健康信号放行或完整可靠性矩阵 |
| 历史宿主 SIGKILL 复核 | 双端各 1 份 run、2 份登记材料复核；0 dispatch，inconclusive 原件保持；既有报告记录 stale owner 阻止重连及显式诊断回收 | 不是新执行的宿主强杀，也不证明任意外部资源可自动回收 |

私有证据保留在 Git 忽略的 `artifacts/physical-validation/`，包括首次失败报告，不上传设备标识、签名配置、原始诊断 JSON、截图/XML 或录像。公开文档只记录范围、数量、稳定状态及限制，不把本机未入库原件作为公共可点击附件。

只读复验入口：`pnpm exec tsx scripts/physical-evidence-audit.ts <absolute-private-runs-directory> [...]`。它不初始化/修复原 Store，不调用设备/provider/模型/业务扩展，不升级 verdict；检查登记文件大小/hash、runtime 冻结计划和 temporal/measurement 证据，并核对前后 manifest 摘要。live iOS 入口：`pnpm test:health:ios:physical`，显式提供私有 capabilities 路径和 Xcode xcrun 路径；输出只有有界事实。未认可来源仍在动作前拒绝 required health。

## 录像与材料范围复核

当前设备只读观察：Android KB2000 / Android 14（显式设备 getprop）；iPhone 16 Plus (`iPhone17,4`) / iOS 26.2.1（同一 capabilities 选定设备的 live devicectl）。原生登记截图分别 1080×2400 / 1290×2796；最终视频 VP8 864×1920 / 324×700，iOS 使用配置缩放的 MJPEG，不将 Viewer 小图当原生像素。新观察不倒填为旧归档的精确硬件证明。

两次初始 Viewer 未就绪为新 worktree 缺少 build 生成的 browser projection，独立 Mock 复现 `/report-presentation.js` 400；补 build 后通过。首份 iPhone 视频含启动前的私人桌面，只保留私有原件、不作公開材料；探针现先验证 Fixture 再录制，重新采集并查看截图。随后探针误读旧历史 runId（实际新视频已归档），改为等待本次 activeId/展示一致后复跑通过；不改产品 verdict、不抹去失败尝试。WebM MediaRecorder 的 duration 可为 Infinity，验证使用实际解码尺寸、readyState/seek 及 ffmpeg 完整帧，不把有限 duration 当可读性前提。

只读审核入口仅覆盖 run/step 登记文件和 temporal/measurement；独立 video index/录像由录像及报告材料探针另验。它不是视频解码器。私有输出中原始 source manifest、video index 及视频 hash 保持不变。重新采集的 iOS 新分析页截图显示 Fixture，仍未上传 raw 图片/视频。

修复导航首次 preinstalled-WDA 尝试为 60 秒启动超时、0 场景，自有清理完成，日志仅含糊提出 might be locked，未当成锁定确诊。随后复制此前已签名 WDA 制品到本次私有根，以 test-without-building 启动；模板查找按观测 OS major.minor 生成配置副本，不重新标记二进制 SDK、签名或构建被测 App。13 场景完成，5 个符合预期的导航派发、8 个零派发拒绝/缺失场景；完整修复仍未放行。114 份登记证据逐项重读，private host-forwarding-observation.json 留存真实端口事实，首个失败原件保留。

更新基线后再次诊断：08:19 的 details 仅配对缓存可读（tunnel unavailable），systemCrashLogs 调用失败，08:20 Xcode xctrace 将同一 iPhone 列为 Offline。不能把 details 命令成功或 source probe 的“已尝试检查”当成实时通道可用；health 继续 unsupported。已询问重新连接/解锁，当前没有启动新的 iOS 故障注入；保留此前 9/9 与已完成的 13/13，不改成新候选重复验收。

## 尚未完成任务与具体前提

用户本轮明确确认：暂时没有真实业务两构建、隔离后端／真值／清理接口与批准时限，也没有获批视觉／OCR profile。不得用合成样本或作者自批补足这些要求。

| Change / task | 剩余内容 | 缺口或执行边界 |
| --- | --- | --- |
| harden 4.4 / 4.5 | 完整双端故障矩阵、最新候选恢复与证据映射 | 初轮双端各类受控故障和恢复已验；REDACTED_REVISION 新增 Android 9 项、旋转/driver/server 和宿主 SIGKILL 复跑。还需当前候选 USB 拔插/恢复、锁屏/人工恢复协调，iPhone 当前 Offline 还需恢复连接后重复检查。历史记录不自动重新归属；已询问是否方便配合，未回复不触发新锁屏或伪造拔线 |
| health 6.2 / 6.4 | Android crash/ANR、iOS crash/hang 正反例及排空放行 | 缺认可的进程世代、窗口起止游标、丢失检测、单调时间映射及 end-cursor drain 来源；可读历史归档不满足这些条件，不开放信号 |
| temporal 6.3 / health 6.6 / change-acceptance 6.1 | 业务持久性、两次提交、性能及提交制品绑定 | 用户确认暂无真实 App/后端、隔离业务键、独立只读真值、清理接口和批准时限 |
| authoring/visual 3.5 / 6.2、triage 7.3 / 7.4 | 两构建定位器修复、真实失败四方向、维护收益 | 缺两次真实 App 制品和合法业务故障材料；Fixture 初态/确定性假故障仅作准备，不能关闭整项 |
| authoring/visual 4.7、local-ocr 8.1–8.3 | 获批视觉、真实冻结 OCR 质量与双端正反断言 | 用户确认没有获批基线/profile；缺合法真实数据、冻结评测和具体页面/构建批准，候选不等于生产批准 |
| local-ocr 8.4 | 20 轮双槽业务＋串行对照、各平台 3 次中断/取消/显式复跑 | 缺业务材料、并发安全声明与重置/清理条件；单设备可靠性不能替代双槽业务矩阵 |
| text-input 3.2 | iPhone 第三方 App完整正文正反例 | 原真机 XML 正文不可访问，未有该 App 的获批 OCR profile；新的发送/账户及外发范围需单独确认，不默认使用私人会话 |
| bounded-ai 3.2 / 3.3 / 5.1 | AppClaw/Midscene 同输入双端 PoC、SDK/backend 成本及遮挡对照 | 现有 DeepSeek 真机通过保留；缺对照端点/版本、请求预算与外发授权，不自行调用未授权服务 |
| bounded-ai 5.6 | 旧 Android 换线/换接口单变量对照 | 缺已登记的对照线材/接口和人工换接；不能把设备当前在线或替换机通过当作旧故障已修复 |
| harden 5.3 | 前一支持 Workbench 包的完整升级/回退/旧归档只读 | alpha.1 早于 Workbench，不是支持基线；已有特定 dev 回滚探针不等于完整前一支持版本验收 |
| harden 5.6–5.9 / 6.4 | 两自研 App/20 流程、试点接口、5 人、连续 7 天/100 运行及外部审计 | 缺项目方材料、授权、独立参与者与足够周期日志；工程审计与外部放行分开，保持未完成 |
| triage 6.1 / 6.2 / 6.5、8.1–8.5 | 60＋60 冻结双人标注、5 名非作者盲测和收益 | 缺独立标注者/参与者与合法材料；作者检查和更多 Mock 不代替独立验收 |
| report 5.9 / 7.1–7.4 | 完整浏览器离线、完整可用材料、runtime 展示与 5 人研究 | Safari 已补原生阅读/键盘/打印，仍缺隔离/请求计数及窄屏；双端录像、11 份归档已补，旧来源精确硬件未知、完整脱敏接收材料复核未完成。健康仅未声明/未验展示；无认可源不伪造健康正反报告。独立参与者仍缺 |
| guided 5.2、authoring-analysis 6.2、long-term 5.3 / 6.4 | 相邻 change 的独立用户和试点收益 | 同上，缺参与者/真实外部接口，不自动跨 change 勾选 |
| agent-test-control 4.4 | Codex 与 DSH 两宿主真实图片消费 | 既有模型图片事实不等于当前两宿主同候选验收；缺明确真实模型环境/外发授权 |
| external-assets 5.1 / 5.2 / 5.6 | 真实 Maestro / Appium runner 报告兼容、完整导入回钻及独立迁移 | 已有实际 Appium runner 3 pass / 1 故意 fail / 1 skipped 证据保留；Maestro 实际报告仍缺，本机 PATH 没有 Maestro CLI，不自行下载新执行器或在手机安装其 agent；独立资产使用方也未提供 |
| change-acceptance 6.2 / 6.3 | 非作者复核与完整验收收敛 | 缺至少两位独立复核者，6.1 的真实业务前提也未齐；不能以本轮作者检查或工程门禁替代 |
| repair 5.3 / 5.4 / 7.6、8.2 / 9.3 / 9.5、10.1–10.4 / 11.4 | 完整导航维护、实际双宿主交接、真实制品检查/安装、可信 reset 与冻结修复复验、独立研究 | 12.6 的实时 iPhone/本机转发前提已解除；其余仍缺危险同文字/旧构建/精确人类审批、真实 Appium 制品及 reset/cleanup 执行适配、模型交接范围和独立参与者。53/65→54/65，不用 13 次普通导航勾掉完整闭环 |

这些是本轮真机续验关联的剩余要求，不是所有 active change 的全部工程 TODO。健康来源探查完成后，health 为 29/32，三个放行/业务任务继续未勾选；新修复 iPhone 12.6 完成后 repair 为 54/65，11 项仍保留具体前提。未同步主 spec、未归档、未发布包或创建 Release。

## 工程门禁

新增诊断/只读复验单测 19/19 已通过，独立 `pnpm typecheck` 通过。首次完整 check 出现文档创建前断链和默认 2 秒完成轮询失败；断链修正、相同用例独立通过后，串行完整 check 为 110 files / 963 tests passed（347.27 秒）。不增加超时或弱化断言。

首次 E2E 为 79 passed / 1 failed / 1 skipped：创作执行返回 runId 后首次详情读到 manifest 尚不可用的临时记录；后续真实摘要已存在，分析页只因临时 phase=finished 停止刷新。trace 中明确是 ENOENT，不把它无证据归因于手机或并行 build。确定性回归在修复前稳定失败（真实记录存在，6 秒仍无第二次读取）；修复根据权威摘要的 name/startedAt/stepCount 身份变化刷新一次，而非根据投影 verdict 无限复读。慢读取保持旧结果、局部进度和独立步骤搜索，完成后刷新；原 manifest hash 不变。新增测试曾错误点击在分析页隐藏的主题控件，修正为实际可见的步骤搜索，不绕过可见性。

`REDACTED_REVISION` 候选最终工程复验：`pnpm check --maxWorkers=1` 为 110/963 passed（349.99 秒），`pnpm build` 和 `pnpm pack:check` 通过，`pnpm test:e2e --workers=1` 为 81 passed / 1 skipped（4.2 分钟）。单独 `REPORT_PERFORMANCE=1 pnpm exec playwright test tests/e2e/report-reading.spec.ts -g '1000-summary' --workers=1` 通过，1000 条摘要（526893 bytes、0 steps/record）冷页/刷新各 30 样本，p95 412.54/238.62 ms，阈值 2000 ms；冷页不驱逐文件系统缓存，不是大型证据/真机性能。内置结果文件旧 candidateBase=REDACTED_REVISION 仅为遗留标签，不作当前源码证明；真实输入 470 文件 sha256 `91a75c9226a78ec87aa5f1b1b02b66385bf5c4022b4d53949560ddca4c793b68`。

`REDACTED_REVISION` 加本轮改动的独立门禁：`pnpm test:e2e --workers=1` 为 83 passed / 1 skipped（4.4 分钟），跳过的目录性能项单独通过（15.6 秒）；1000 条摘要 / 526893 bytes、冷页和刷新各 30 样本，p95 255.20 / 250.39 ms（阈值 2000 ms），仍不是大型证据或真机性能证明。`pnpm build` 与 `pnpm pack:check` 均通过。冻结且复核一致的输入为 519 文件、sha256 `df37a810d5956f63cf4c2480b0f290bfb9bb4513f5240e3dfb4b2e2bab58be39`；不将旧候选结果或内置 performance 的遗留 candidateBase 标签升级为当前源码证明。

两张 reader 的 Mock 运行中/完成截图已在最终 E2E 后再次实际查看并保留，新真机材料页面截图只留在私有根。其他本轮自动生成软件材料归入忽略的 software-gates/ 与 software-gates-8a/；最终 63 张本轮再生的已跟踪 PNG 恢复到 HEAD，12 份软件材料可恢复地移入私有目录，不改公开发布哈希或用户主目录快照。

新基线第一次 check 发现本轮私有源码导出目录（含依赖 symlink）被 Vitest 递归发现，出现副本 E2E 和依赖测试的 0-test 错误；已仅终止确切自有 Vitest PID，退出 143，不计为门禁通过。源码导出移至仓库外的私有临时目录，两个实际设备证据目录移回本仓库的忽略根，原报告/manifest 字节不改；未修改 include/exclude、超时或断言来绕过问题。随后在输入冻结后重新运行完整门禁。

OpenSpec 1.14.1：初轮 health/harden/report 三个 change strict 通过，全库及未修改 REDACTED_REVISION 导出均 42 passed / 6 failed。更新到 REDACTED_REVISION 后，health/harden/report/repair 均通过，全库和只读未修改 HEAD 导出均 44 passed / 6 failed（50 items），失败项相同（appium-provider、guided-device-connection-assistant、host-neutral-mcp-adapter、local-mirror-viewer、workbench-authoring-journey、旧 improve-workbench-authoring-and-analysis）。这些既有长度/重叠问题不在本轮自动改 spec 行为，也不称全库 strict 通过。首次误用 validate 多位置参数被 CLI 拒绝，随后逐项执行通过。

新基线冻结输入完整 `pnpm check --maxWorkers=1`：TypeScript/契约通过，126 files / 1117 tests passed，1 file / 1 test failed（共 127 / 1118，521.06 秒）。失败是 public readiness 检测到此前 dev@REDACTED_REVISION 的 `upgrade-dsh-020-rc2/merge-validation.md` 本机 home 路径（工作文件＋历史共 2 findings），不是隐藏失败或未执行其余测试。已将当前命令改为 portable placeholder；最终 `pnpm public:check` 仍失败，仅余已提交 commit `REDACTED_REVISION` 的 1 条历史 finding。初次附加未支持的 `--json` 被 CLI 拒绝，不计正式检查，随后无该参数完整检查取得上述结论。历史扫描仍需单独治理授权，不能改 legacy allowlist、浅克隆绕过或未经授权改写/强推。当前候选的全量 check 不标通过。

设备验证收尾资源复查：4723/4735/4737/4738/8100/8118/9100/9118/47831 均无本机监听，device-claim JSON records/active/starting 均为 0。SIGKILL 复跑自建 Appium 通过具体 child 句柄关闭；没有改系统网络/偏好或杀不归属的 Appium。早先在线查询曾见 1 个设备端 WDA Runner；验证收尾时同一 iPhone 仍由 xctrace 列为 Offline，随后 `ioreg -p IOUSB` 也没有匹配 capabilities 选定设备，无法新查手机 helper 数量。宿主 session/端口/claim 已清理不等于设备进程一律消失；没有可用独占 PID 归属记录时不按进程名杀它，不写“所有设备进程为零”。

软件、物理 Fixture、真实业务、健康放行和独立验收分开记账。用户已明确授权提交至 dev 并推送；实际交付状态以 Git/远端结果为准，不把提交当作全部验收通过。未同步/归档主 spec 或发布包。

## dev 提交前复核

交付基于 `REDACTED_REVISION`，519 文件源码 sha256 与上述完整门禁一致，未再次执行同一输入的全量 check/E2E，不将定向复核写成另一轮全量通过。实际新执行：`pnpm typecheck`、`pnpm lint:contracts` 通过；两份新增 probe/audit 单测 19/19 通过；`pnpm exec playwright test tests/e2e/journey.spec.ts -g 'initially unreadable' --workers=1` 1/1（5.0 秒），慢读取时原结果与步骤搜索保留，局部进度显示，完成刷新且不无限轮询，两张 Mock 截图再次查看。四个相关 change 的 OpenSpec 1.14.1 strict 均通过，`pnpm pack:check`（包含 build）通过。

`pnpm public:check` 复核仍失败，仅 1 条 `REDACTED_REVISION` 历史 home 路径。暂存范围为 34 份源码/测试/公开文档/Mock 截图，不含私有原始真机材料；`git diff --cached --check` 已通过。TODO、索引、里程碑同步 health 29/32 和 repair 54/65；Preview 默认关闭，旧日期化审计和未完成验收保持原有边界。主工作区与本轮隔离分支分别管理，提交/远端 SHA 由 Git 交付后复核。
