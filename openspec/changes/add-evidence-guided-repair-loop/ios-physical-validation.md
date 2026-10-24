# iPhone 真机分层验证（2026-10-06）

2026-10-07 更新：新 iPhone 13 场景实时复验已完成，13/13 匹配、114 份登记证据重启复读，实际自有 WDA/MJPEG host forwarding 仅 loopback 且结束后关闭；详见末尾补充和 [本轮对账](../../../docs/physical-validation-2026-10-07.md)。下文 08:06 的 10/12 与 Xcode Offline 是 10-06 历史，保留而不改写；完整修复闭环仍未完成。

## 结论与范围

用户确认重试后，USB、配对、开发者模式与解锁状态已核查；最终 WDA 成功启动。**12 个导航／拒绝探针全部执行，10 个符合预期，2 个失败。** 正确页面标题登记被误拒绝，同 App 错误页面在 application 根范围登记下却发生了点击。失败预期未修改，不能宣称页面安全或真实自动修复闭环验收通过。

工作树：`docs/repair-verification-design@REDACTED_REVISION` 加已有未提交实现，不是最新 dev 的验收。环境：iPhone 16 Plus、iOS 26.2.1、Xcode 26.5、Appium 3.2.0、XCUITest driver 10.19.1；已安装合成 App `dev.mobilemirror.fixture`（MirrorFixture 1.0 / build 1）。App 版本仅描述环境，不是候选制品身份。

脚本：[repair-ios-physical-probe.ts](../../../scripts/repair-ios-physical-probe.ts)。只操作 Recovery Lab 的合成导航，不提交订单、不调用模型、不批准修复、不构建／安装／卸载被测业务 App、不清个人数据。WDA 是自动化工具启动，不是 M3 候选 App 构建安装。使用独立 Appium `4738`、WDA `8118`、MJPEG `9118`；没有结束外部进程或删除他人 claim。

## 真实结果

| 场景 | 预期 | 实际 | 派发次数 | 结论 |
| --- | --- | --- | --- | --- |
| 普通导航 1、2 | pass / passed | 符合 | 各 1 | 普通导航，不是两次干净修复复验 |
| 旧定位器缺失 | fail / target-not-found | 符合，可信未派发事实 | 0 | 定位器变化候选，不等于修复准入 |
| 相似 Search history | 精确 ID 导航通过 | 符合 | 1 | 未误点相似目标，不替代危险同文字验收 |
| 相同 ID 两个目标 | fail / ambiguous-target | 符合 | 0 | 歧义不能当作缺失 |
| 禁用控件 | inconclusive / blocked | 符合 | 0 | 保守拒绝 |
| 目标完全消失 | fail / target-not-found | 符合，可信未派发事实 | 0 | 保留缺失事实 |
| 正确页面标题登记 | pass / passed | **inconclusive / blocked** | 0 | 正向适配缺口，探针失败 |
| 正确页面、application 根登记 | pass / passed | 符合 | 1 | 只证明 App 容器匹配，不证明页面唯一 |
| 同 App 错误页面、相同 application 根登记 | inconclusive / blocked | **pass / passed** | **1** | 页面授权边界缺口，探针失败 |
| 允许目标语义与实际不符 | inconclusive / blocked | 符合 | 0 | 目标语义不符被拒绝 |
| 点击通过但预先固定断言失败 | fail，tap passed | 符合，分流为产品缺陷候选 | 1 | 未用点击成功覆盖断言；故意不存在的断言不是实际业务缺陷证据 |

同设备第二 `MirrorService` 在 owner claim 阶段被拒绝。关闭／重开 Workbench 后，12 个 verdict 保持，**112 份证据**通过原 Store 完整性接口重新读取。报告 `executedAll=true`、`matched=10`、`complete=false`，exitCode=1；执行完不等于全部通过。

自有清理完成；结束后 `4738/8118/9118` 无监听、自有 Appium/xcodebuild 已退出、device-claims 无剩余 JSON。设备互斥只约束 FlowAssert claim，不证明外部 Appium/ADB/WDA 也遵守锁。

## 页面边界缺口

当前 `repairProjectSchema.page` 强制 `role=application`。iOS XML 的应用根名称为 `MirrorFixture`，`recovery.page` 为静态文本标题。标题与 application 角色不匹配，正确页面被拒绝；改登记为应用根虽能匹配唯一容器，但 `Recovery navigation fixture` 与 `Unapproved page` 都属于同一根，目标也都是其后代。**application 唯一不等于当前页面唯一。**

已检查实际截图：错误页点击前明确显示 **Unapproved page**，点击后为 **Search screen ready**，同时有 settled 派发及原断言通过；不是只靠错误字符串推断。正确页面被拒绝后的截图仍显示正确标题和 Search。与 Android 的正页误拒绝应统一处理，但 iOS 另有错页误放行，不能仅修正 Android 角色映射。

TODO：可信项目登记绑定 App 前台身份、平台适配的唯一可见页面锚点、可验证容器和目标归属；事实采集、候选准入、实时派发使用同一契约。补正确页面、同 App 错页、跨容器、重复标题、不可见锚点、危险目标反例。不能移除 scope、把应用根当页面、伪造角色或放宽文字匹配。本轮只验证并记录，没有修改产品授权契约或自动执行修复。

## WDA 启动诊断与网络限制

前六轮均在启动阶段失败，各为 **0 个测试场景**，已清理，不能计入场景通过数。两轮 `usePreinstalledWDA` 60 秒内未启动；上游错误包含“device might be locked”，当前 `classifyWdaStartFailure` 的 `device.*locked` 规则将可能性误分类为信任／开发者模式要求。当时 devicectl 已确认 paired、Developer Mode enabled、passcodeRequired=false，不能断言用户未解锁或未开启开发者模式。TODO：区分明确状态故障与含糊启动超时，避免误导重复配置。

最终采用已有已签名 WDA 的 `test-without-building`：Products 先复制到本次隔离目录，保留原 SDK 26.5 模板，不修改共享缓存、不注册设备或申请证书。driver 10.19.1 真机 xctestrun 查找未获得 SDK 版本，并将 OS `26.2.1` 规范化为 `26.2`；按设备与规范化 OS 命名复制配置后成功启动。这是测试配置映射，不是重新标注／重建二进制。

**网络限制：** Appium 控制服务实际为 `127.0.0.1:4738`，上游 WDA/MJPEG host forwarding 却为 `*:8118`、`*:9118`。本机依赖 `device-connections-factory` 中 `localServer.listen(this.localport)` 未指定 host，不能宣称全链路 loopback。未测试外部连接或真实业务数据暴露；本轮仅合成 Fixture，结束后转发已关闭。TODO：在受控设备传输边界实现／选用可明确绑定 loopback 的转发，实测 IPv4/IPv6 监听与清理；修复前不能在共享／不可信网络宣称默认传输隐私安全已验收。未修改全局 Appium 依赖或防火墙。

## OpenSpec 对账

整体仍 **48/59**，不新增勾选。

| 任务 | 本次进展／剩余前置 |
| --- | --- |
| 5.3 | 双端普通导航／拒绝已有证据；须修复 iOS 错页误放行与双端正页误拒绝，再补真实旧／新构建、受审闭环、危险同文字反例 |
| 5.4 | 非作者须实际复核时间线，作者自评不可替代 |
| 7.6 | 需实际 Codex／完整 DSH 配置、精确版本及交接／取消／撤权／复验；本地脚本不是宿主验收 |
| 8.2 | 需真实 APK／已签名开发 `.app` 检查器、制品清单、安装证明；已安装 App 版本不可替代 |
| 9.3 | 需 Appium 可信 reset／namespace／cleanup、原构建对照、两次干净候选与冻结回归调度；菜单返回不是数据 reset |
| 9.5 | 依赖实际制品、安装身份与设备复验记录，不能提升普通导航等级 |
| 10.1 | Android 源码→构建→人工摘要审批→安装身份→完整复验依赖上述实现／材料 |
| 10.2 | iPhone 已能运行本探针；仍缺签名候选构建、审批、安装身份、可信 reset 与完整修复闭环，不再把离线作为唯一阻塞 |
| 10.3 | 双端重复 owner 拒绝／正常清理已有证据；真实安装取消／断连／未知恢复／清理失败需安装适配器与安全样本 |
| 10.4 | 需至少 10 真实流程、两次构建变化、双端、3 名非作者；12 合成探针不是该评测集 |
| 11.4 | 维持分层审计，全部前置验收前不主规格同步／归档 |

## 本机证据与复现

最终目录：`artifacts/physical-validation/repair-ios-2026-10-06T08-06-14.640Z/`，含 report、前后 PNG／结构、原 run XML／解析回执／tap fact、隔离 Products 和有界私有日志。原始设备材料已被 `.gitignore` 排除；根 0700、私有日志 0600，不发布设备 ID、Team、capabilities 或原始日志，仓库只保留脚本和脱敏结论。

```sh
MOBILE_MIRROR_CAPABILITIES_PATH=<授权的本机iOS配置绝对路径> \
MOBILE_MIRROR_APPIUM_EXECUTABLE=<Appium绝对路径> \
MOBILE_MIRROR_IOS_WDA_PRODUCTS=<已有签名WDA的Products绝对路径> \
MOBILE_MIRROR_IOS_WDA_XCTESTRUN=<该目录内原始SDK模板文件名> \
MOBILE_MIRROR_IOS_PLATFORM_VERSION=<实际系统版本> \
pnpm exec tsx scripts/repair-ios-physical-probe.ts
```

运行前确认无人占用、独立端口空闲、网络范围限制可接受；不得结束外部进程、清 claim 或操作真实业务 App。owner 冲突时拒绝，不抢占。页面安全失败必须保留非零退出，不能改预期变绿。

## 本轮工程门禁

`pnpm check --maxWorkers=2`（111 文件／931 测试）、`pnpm test:e2e`（66/66）、`pnpm build`、`pnpm pack:check`、最终 `pnpm exec tsc --noEmit` 实际通过；均不覆盖两个真机页面缺口。没有修改 Viewer 实现，已检查实际 Fixture 正确页拒绝及错页点击前后截图。`pnpm dlx @fission-ai/openspec@1.9.0 validate --all --strict --no-interactive` 为 41/41，`git diff --check` 通过；另确认原始报告与私有日志均被 git 忽略。

本轮只新增验证脚本与文档对账，未提交、推送、归档或合入 dev，保留已有实现和截图。
# 2026-10-07 live 续验补充

dev@REDACTED_REVISION 隔离导出代码上的 iPhone 16 Plus / iOS 26.2.1 新运行：13/13 预期匹配，114 份登记证据重启复读，同设备第二 owner 拒绝，自有会话清理完成。正确标题 v2 页面通过；旧 App 根、同 App 错页及错误目标语义均 blocked/not-dispatched、零点击；原后置断言失败仍 fail。真实会话 4738/8118/9118 仅监听 127.0.0.1，结束后均关闭。首次 preinstalled-WDA 启动超时为 0 场景，原件保留；使用已签名制品副本重试成功，不重签、不重装业务 App。

12.6 已完成，完整修复/安装/reset/两构建/独立验收仍 pending。下文 12 场景、10 个预期匹配及离线状态保留为历史，不覆盖为新结果。完整边界见 [本轮对账](../../../docs/physical-validation-2026-10-07.md)。
