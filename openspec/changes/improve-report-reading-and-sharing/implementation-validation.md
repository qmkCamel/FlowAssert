# 报告阅读与分享实施验证（2026-10-06至2026-10-07，Asia/Shanghai）

## 2026-10-07 最新 dev 续验（独立于以下原候选包门禁）

基于远端 `dev@REDACTED_REVISION` 的本地 `test/physical-acceptance-followup`。Safari 26.3.1 本次原生接口可用，file URL 实际打开合成已审查 HTML（57033 bytes，SHA-256 `814641a07c97abc4cf8b34954f59b0c4ae5ee4859436597715b642b556b53fc9`），来源/未复验警示、Option+Tab/Enter 步骤锚点和原生打印预览 5 页已观察；未实际打印、未改偏好/网络、未测 Safari 断网零请求/窄屏。此前 Mac 锁定说明保留为旧尝试，不是当前状态；5.9 仍未完成。

`node scripts/report-runtime-material-probe.mjs <current-lib/application.js> <private-source-list> <private-output>` 本次通过：11 份双端实际归档（9 历史＋2 本轮录像）、2 组子运行、真实 performance pass/fail/inconclusive、临时副本缺图与原结果分离。新增独立 video index 复制校验及新分析页实际解码，不只检查容器头；源 manifest/index 不变。原始视频和 UI 截图只留私有忽略目录，最终 video-ios/video-android 与 scope/缺图截图实际查看，未上传个人内容。首份 iOS 录像含桌面不作为公开材料，先确认 Fixture 后重采通过。旧归档的精确硬件未知不以当前 iPhone 16 Plus / iOS 26.2.1 倒填。完整材料/脱敏接收、可信健康范围与独立用户缺项仍保留，7.1–7.4 不以作者阅读自动完成；详见 [本轮对账](../../../docs/physical-validation-2026-10-07.md)。

本次工程门禁另记在上述对账，不重新赋予下面历史 tarball 的身份或宿主验收。没有外发/真实模型调用、业务两构建/批准 OCR profile、独立用户或生产健康放行；不归档、不发布。本地修改未提交推送，不沿用下面旧 turn 的 push 授权作本次自动写远端。

续验 E2E 识别并确定性复现了早期 manifest 未落盘视图永久停刷的问题。报告刷新改为比较权威摘要的 name/startedAt 身份；合法完成记录、证据缺失投影不因此反复读取。读取期间局部状态、旧结果与步骤搜索保留，完成后刷新，不改执行 verdict/manifest。该补丁沿用 3.5/3.7 的未知/迟到/独立交互要求；软件回归截图明确为 Mock，不挪作真实健康或业务证据。最终门禁结果见本轮对账。

软件实现与工程/安装包验证完成。这个 change 保持 active，不代表真实业务、健康来源或独立用户验收全部完成。任务对账见 tasks.md；需求/样本矩阵见 requirement-test-map.md；用户研究执行包见 user-study-protocol.md。

## 候选和工作区

- 基线 dev：`REDACTED_REVISION`，分支 `feat/report-reading-sharing`，管理 worktree 名 `report-reading-sharing`。
- 实施验收时的候选尚未 commit/push。主目录原有截图和其他 change 未被暂存、覆盖或清理；自身工作区回归产生的既有黄金截图已恢复，新的 report-* 证据保留。
- 交付授权（2026-10-07，Asia/Shanghai）：用户要求提交到 dev 并推送。提交前 `git fetch origin dev` 已恢复成功，远端基线仍为上述 `REDACTED_REVISION`，与已验源码基线无差异；采用正常快进推送，不改写历史。主目录 dev 停在 `REDACTED_REVISION` 且有原有改动，本次保留该目录状态；交付提交与远端 SHA 以 Git 核对结果为准。
- 本次 Git 提交范围为功能代码、测试、开发验证脚本、OpenSpec 与文档。以下生成的 artifacts/reports、report-* 截图及私有真机材料只保留在本机，不加入提交；性能数值、包身份与验证范围在本文提供可评审摘要。
- 候选源码 fingerprint：`6433c02cc41d74aa12d3ccaad715661110eeb9e666b049d1bcee8b0fe589d61c`。算法与 414 个输入文件定义在 `artifacts/reports/report-candidate.json`；它不是 Git commit SHA。包含开发验证脚本，部分脚本不随包发布。
- 唯一最终 tarball：`flowassert-0.1.0-alpha.2.tgz`，1780848 bytes，SHA256 `f6edf4d25d8465f4bed81e7f0d19b593347e43b420b50ca63aeecb67b1662f54`。位于本机临时候选目录 `mobile-report-candidate-final-20261006`。下列包探针与 DSH 使用同一字节的包，安装脚本关闭、离线干净依赖目录，不修改个人 profile。
- Node 24.19.0 / pnpm 11.7.0；开发预览 Harness 精确验证版本 0.1.5-rc.2，不能外推为 rc.8 或其他版本已验。

## 实施边界

新增共享展示投影、v1 摘要查询和目录、失败导航/搜索/图片阅读、身份历史与趋势入口、原像素画框遮蔽、白名单 ReviewedReportSnapshot v1 和被动 HTML。结果仍由既有领域投影裁决；不改 agent loop、provider/transport 或现有执行/修复授权。

目录最多 10000 条/每页50；每份 manifest 最多8MiB，4个并发读取，只积累摘要。既有 manifest 内嵌 YAML 随有界 JSON 解码后丢弃，不打开独立 source/图片/XML/录像附件，不宣称附件已验证。原始列表 API 保持原语义，包括其既有启动恢复路径；本次性能不覆盖首次恢复海量大 manifest 的内存峰值。

HTML 无脚本/网络/表单/外链，完全冻结 ID、时间和字节；Viewer 的 CSP 与 HTML 仅允许固定模板的样式 hash，sandbox 不开放脚本或同源权限。JSON 原契约保持。强制审查、source 变更拒绝、10分钟/重启失效、容量 reservation、lease、引用和提交完整性沿用既有 owner。

## 工程门禁

| 实际命令 | 最终结果与范围 |
| --- | --- |
| `pnpm check` | typecheck/contract lint + 108 files / 944 tests passed，软件与 Mock |
| `pnpm test:e2e --workers=2` | 80 passed / 1 skipped；只跳过独立性能测量，下面已另跑通过 |
| `pnpm build` | 113 emitted files；成功 |
| `pnpm pack:check` | dry-run 成功，发布文件包含新 browser projection、模块和使用指南 |
| `pnpm pack --pack-destination <final-candidate-dir>` | 生成上述唯一候选包；收尾修复目录状态后重新打包，下面所有包探针使用最后生成的字节 |
| `REPORT_PERFORMANCE=1 pnpm exec playwright test tests/e2e/report-reading.spec.ts -g '1000-summary' --workers=1` | 30冷/30热测量及 p95 ≤2s 断言通过 |
| `pnpm exec playwright test tests/e2e/report-reading.spec.ts -g 'search delayed' --workers=1` | 650ms 旧搜索不能覆盖新筛选；最终全量也包含此项 |
| `node scripts/report-offline-browser-probe.mjs chrome <reviewed-html>` | 真实安装的 Chrome 断网 file URL/锚点/窄屏/打印通过 |
| `node scripts/report-offline-browser-probe.mjs firefox <reviewed-html>` | Playwright 管理的 Firefox 153 断网阅读通过 |
| `node scripts/report-package-probe.mjs <candidate-entry> <previous-dev-entry>` | v1 query、HTML 固定字节/重启、旧 JSON/v4、未知必需功能拒绝、原件保持、上一 dev 回滚拒新版 HTML/仍读旧 JSON |
| `node scripts/authoring-package-probe.mjs <candidate-entry>` | 包内 Viewer 保存/验证/运行/历史分析/归档/重启；无 pageerror，Mock |
| `node scripts/runtime-gates-package-probe.mjs <candidate-entry>` | 包内 Viewer/CLI/MCP 投影一致；v2 测量重启、旧 v1、v4 未复验；健康 unsupported 在副作用前拒绝，Mock/宿主能力探针 |
| `node scripts/dsh-clean-profile-probe.mjs --dsh <isolated-rc2> --tarball <same-tarball>` | clean profile、20工具、Native/PTC、双 Mock matrix、模型图片目录和纯文本投影边界通过；未调用真实模型 |
| `node scripts/report-archived-material-probe.mjs <candidate> <source> <private-output> [mask-policy]` | iOS/Android 历史真实分辨率 fixture 截图，mask/hash/冻结字节及源保持通过 |
| `node scripts/report-runtime-material-probe.mjs <candidate> <private-source-list> <private-output>` | 9份双平台历史归档、2组子运行对照、runtime真实记录与临时副本缺图展示通过；无新设备执行 |

全量回归曾因复用Viewer页面而把旧页面的 /api/state 轮询计入离线请求；接收测试改为独立断网context后通过，不忽略接收页请求。新增测试控件ID/计时mock类型的错误已修正。工程日志留在本机 `report-final-*.log` 临时文件；可携带的结果摘要、候选身份、性能和浏览器检查位于 artifacts/reports。敏感真机证据只留在 Git 忽略的 physical-validation，未放进公共包。

安装包 Viewer 探针与其他探针并行时曾在读取运行结果超时；相同包独立重跑通过。进一步检查发现后台每秒轮询可以重复取消超过一秒的同一路由读取，已加读取期间的保护，主动导航仍可取消旧读取。最终 E2E 注入1500ms读取、进行中切换独立目录并返回，验证结果可完成且完成后轮询不再重复读取已结束运行；不把单次并行超时全部归因于这个问题。

新增测试覆盖稳定排序/日期边界/跨页计数/generation、10000与10001边界、超8MiB/坏摘要、无附件读取、身份区别、运行级未支持而非假失败步骤、原记录/当前材料分离、64框/源像素换算、输出黑像素/源hash、注入/外链/文本/PNG预算、过期/变更/冻结字节、零附件 HTML 与旧 JSON min1。HTML 新提交切点分别做独立进程 SIGKILL；另测超时、ENOSPC、取消释放 lease，既有 retention/owner/引用竞争测试仍通过。

## 浏览器与截图

Chromium 151.0.7922.34 为默认软件回归；真实安装 Chrome 154.0.8037.98 使用独立 headless profile；Firefox 153.0 是下载的 Playwright 管理构建。后两者断网打开相同 reviewed HTML，HTTP请求0，Tab/Enter/锚点、390px无溢出和打印媒体通过。Safari 26.3.1 已安装，但 native 接口提示 Mac 锁定/自动解锁失败；已请求用户解锁，尚未收到回复。没有用 WebKit 模拟冒充实际 Safari。

新运行截图已逐张检查：`report-catalog-desktop/narrow`、`report-analysis-desktop/narrow/200-percent`、`report-share-preview`、`report-offline-print`、`report-trends-desktop/narrow`，以及 `report-offline-chrome/firefox-narrow/print`。最终包的 Viewer/运行门禁截图另存为 `report-packaged-viewer.png`、`report-packaged-runtime.png`；旧黄金截图已恢复，最终软件结果摘要见 `artifacts/reports/report-validation.json`。真机历史对照/缺图截图仅在私有输出目录。目录错误/上次成功时间在语言切换后继续保留；不能精确表达时刻边界的趋势不跳到更宽的日期列表。首次预览截图暴露了 CSP 拦截内嵌样式，已改为固定模板 hash，并以 computed background、非白像素和实际截图检查复验；渲染文件与下载仍同字节。

键盘操作、失败导航、焦点返回、画框移动/撤销及200%已测试。13项代表文字的固色背景计算 contrast 最低9.71:1，见 report-text-contrast.json。该测量不覆盖渐变合成、全部非文字控件或原生读屏，不宣称已达到完整 WCAG 合规；独立读屏/用户理解仍待验。

## 性能实测

Apple M2 Pro / Darwin25.3.0 / Chromium151。1000份简单 metadata manifest，共526893bytes，每份0步骤/0附件；store已经初始化。冷样本定义为全新页面导航，未驱逐文件系统缓存，不是冷磁盘或首次 store 恢复。30冷/30热：冷p95 249.71ms，热p95 249.33ms，均满足2s目标。详见 report-performance.json。

先前把性能与全量 native-worker 门禁并行时，冷p95 2156.89ms/热1784.57ms，未达冷目标，原结果保留在 report-performance-contended.json。独立测量不改变阈值；预算改为4个有界 manifest 后验证以上结果。10000边界及10001拒绝的软件测试通过，不外推为10000份大真实报告的延迟目标。当前不引入缓存/索引（tasks6.5：有依据的不适用），若真实负载持续超目标再单独测量并设计可重建摘要缓存。

## 真实材料的已验与缺口

1. 原始 iOS 2026-09-25失败归档，1290×2796，Appium/自有 fixture-App，源manifest与PNG hash验证，表单URL/订单敏感区遮蔽。此组未记录设备OS，不能从宿主OS补填。
2. Android 2026-10-05失败归档，1080×2400，Appium/自有fixture-App，指定源像素遮蔽及原件保持验证。
3. 2026-10-06 runtime v2 历史双平台归档，5份覆盖performance pass/fail/inconclusive，最新候选展示已记录数值、必需状态和未验范围，导出白名单数字不丢失/不变成健康通过。
4. 2026-10-05双平台各一组parent fail→child pass，源环境记录Android14/OnePlus8T及iOS26.2/iPhone别名；iPhone精确硬件型号仍未核实。两个子运行YAML未改、参数已改，UI明确显示输入变化，未把复验通过当根因证明。
5. 在临时副本移除一份真实登记PNG后，原reportedVerdict=pass保留、材料unavailable/current inconclusive明确显示；源归档不变。该项是受控缺图，不能称原真机归档自然缺失。

各源hash、时间、数值、OS观察元数据和导出hash记录在忽略目录 `report-reading-20261006`、`report-reading-android-20261006`、`report-runtime-materials-20261006`。检查了可用归档的录像元数据，未找到可合法复用的真实设备录像；现有录像解码/近似定位通过的是软件生成材料。没有重新控制手机，也没有证明当前USB故障注入、真实业务或批准的真实健康采集来源。

## OpenSpec 与边界复核

OpenSpec1.14.1已确认当前planningHome与三份delta的绝对路径；三份主规范已同步，原Dedicated navigable run analysis保留。新增/修改的report change、catalog/offline/main analysis strict均通过。长段落细节移到完整scenario，既有与新增规范行为保留。

全库1.14.1 strict：42 passed / 6 failed。另把基线HEAD的openspec只读导出到临时目录，以同一CLI验证为39 passed / 6 failed，六项失败名称一致。其余失败在appium-provider、guided-device-connection-assistant、host-neutral-mcp-adapter、local-mirror-viewer、workbench-authoring-journey及已有improve-workbench-authoring-and-analysis change，包含长度告警和已存在主规范的ADDED冲突。不能把本次4项通过宣传为全库严格通过。旧authoring change与此变更有重叠，后续归档要先核对delta，避免覆盖报告行为；本次没有归档任一未完成验收的change。

## 未完成任务和具体前提

| task | 当前可核实范围 | 仍缺少的前提 |
| --- | --- | --- |
| 5.9 | 真实Chrome、管理Firefox及Chromium的软件断网/键盘/窄屏/打印通过 | 解锁Mac后在实际Safari完成同样检查；headless不替代native读屏/打印UI |
| 7.1 | 双平台真实分辨率历史fixture图、实际子运行、记录OS及受控缺图已验 | 可使用的真实设备录像；iPhone精确型号；完整双平台材料独立接收复核 |
| 7.2 | 真实历史performance/temporal记录展示通过；软件必需health未支持、实际CLI unsupported边界已验 | 可信且批准的真实健康信号对应报告及负例，当前归档未提供；无可信信号不放行 |
| 7.3 | D10协议、材料要求与空白逐人表已准备 | 5名非实现作者及合法完整材料，当前没有参与者/实际时间/成功率 |
| 7.4 | 软件/历史展示暴露问题已修复复验，原件保持 | 上述真实材料/用户研究执行后才有可修订的成效失败项；不能凭作者判断关闭 |

其他清单项均按当前实现与软件证据核对；上述任务保留未勾选。当前没有能通过更多Mock测试替代的外部验收条件。native解锁请求保持待回复，不推断用户已同意/已解锁。用户已授权将代码提交并推送到dev；不发布安装包、不archive，不宣称change全部完成。
