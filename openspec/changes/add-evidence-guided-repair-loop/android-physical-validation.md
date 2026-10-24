# Android 真机分层验证（2026-10-05）

更新：下文保留 10-05 历史发现；10-06 已实现 v2 页面锚点／容器修复，Android 新探针 10/10、正确页通过且错页零点击，93 份证据复读。完整修复闭环仍未验收。见 [本轮修复记录](safety-fixes-validation.md)。

## 结论与范围

本次 Android 可以独立验证，不抢占 iPhone：使用不同物理设备、独立工作树、loopback Appium `4737`、UiAutomator2 `systemPort=8207`、独立 run/证据根；`MirrorService` 沿用全局按平台与设备身份的 owner claim。没有修改 iPhone 工作树、WDA、Appium 配置或进程，没有执行 `adb kill-server`，没有安装/卸载、清数据、模型调用或提交订单。

执行前 iPhone 聊天 `真机验证` 处于运行中，最近进度为 E2E；执行期间只读状态显示该聊天正常完成。不能据此声称两端真机操作在同一秒并发，但两个宿主任务独立、Android 同设备第二 owner 被拒绝以及本次自有会话清理均已实际验证。

环境：OnePlus 8T / Android 14，Appium **3.2.0**，UiAutomator2 **6.8.0**，已安装合成 App `dev.mobilemirror.fixture`（versionCode 1 / versionName 1.0）。工作树 `docs/repair-verification-design` 基线 `REDACTED_REVISION` 加未提交实现；不是最新 dev 的验收。App 版本信息仅作环境描述，不是候选制品身份核验。

脚本：[repair-android-physical-probe.ts](../../../scripts/repair-android-physical-probe.ts)。只使用专用 Fixture 的 Recovery Lab 导航，无危险业务副作用；重新连接或菜单返回不等于规格要求的可信数据 reset。

## 真实结果

| 场景 | 实际结果 | 设备派发 | 结论 |
| --- | --- | --- | --- |
| 普通导航两次 | `pass / passed`，保留原 `recovery.result` 断言 | 各 1 次 | 普通本地 tap 真实可运行，不等于修复后的两次干净复验 |
| 旧定位器缺失 | `fail / target-not-found` | 0 | 原 XML、解析与终态事实可核验，分流为定位器变化候选 |
| 相似 Search history | 仅准确 ID 的 Search 被点击，原断言通过 | 1 | 不误点相似目标；不是“同文字危险按钮”的全量验收 |
| 相同 ID 两个目标 | `fail / ambiguous-target` | 0 | 拒绝歧义，不伪装为 missing-target |
| 禁用控件 | `inconclusive / blocked` | 0 | 就绪不足，不授予自动维护资格 |
| 目标完全消失 | `fail / target-not-found` | 0 | 保留缺失事实；缺失分类本身不授予修复权限 |
| 错误页面范围 | `inconclusive / blocked` | 0 | 保守拒绝 |
| 正确页面、准确目标语义登记 | **仍为 `inconclusive / blocked`** | 0 | 揭露 Android 页面范围契约兼容缺口，不能宣称正向审批路径通过 |
| 点击成功但预先固定的后置断言失败 | `fail`，分流为产品缺陷候选 | 1 | 不能用导航成功覆盖断言失败；没有修改原运行中的断言 |

另验证：同 Android 设备第二 `MirrorService` 在 owner claim 阶段拒绝；关闭/重开 Workbench 后，10 个运行结论保持，**88 份证据**经原 Store 完整性接口重新读取。自有 Appium 会话与进程清理完成；本次端口与 adb forwarding 在结束后为空。

脚本 `complete=true` 只表示上述 **10 个探针预期**均匹配（含明确拒绝），不表示 OpenSpec 全部验收通过或 `device-verified`。通过的普通导航、安全拒绝与产品功能缺口必须分别解读。

## 已发现的具体阻塞

Android 真机 XML 的根与布局是 `FrameLayout/LinearLayout/ScrollView`；页面标题 `recovery.page` 为 **text 节点**，不是 iOS 风格的 `application` 节点。当前 `repairProjectSchema.page` 只允许 `role=application`，`recordedNavigationTap` 和 `scopedNavigation` 又要求唯一匹配页面以及目标作为其后代，因此即使正确页面有可见、唯一、非敏感目标也拒绝。

最后一轮明确使用 XML 中的准确 Button 文字 `SEARCH`（Android Material 自动大写），排除项目语义登记写成 `Search` 的干扰；仍然拒绝。不能通过移除 scope、伪造 application 节点或宽松文字匹配使修复正例变绿。未登记 scope 的普通 tap 正例只证明采集和本地执行，不授予自动修复准入。

后续应设计并实施**平台适配的可信页面锚点＋容器归属**：绑定 app 前台身份、唯一可见静态页面锚点、可验证容器与目标从属关系；在登记 schema、准入和实时派发处使用同一契约，加入错误页面、跨容器、重复标题和危险目标反例后重新真机验收。这是待实现项，本次只诊断和记录，不变更授权边界。

没有可成功执行旧定位器的真实旧构建，所以不能制造成功 baseline 或产生被准入的漂移修复。当前 Appium provider 仍缺 install/identity/session-rebuild 与可信项目 reset/namespace/cleanup 的完整修复协议；没有实际调用安装或模拟人类摘要批准。

## OpenSpec 对账

整体仍 **48/59**，本次不新增勾选。

| 未完成任务 | 本次可推进内容／仍缺前置 |
| --- | --- |
| 5.3 | 已补 Android 采集、原断言和安全拒绝；仍缺平台页面契约实现、真实旧/新导航构建、受审候选闭环、危险同文案反例与 iOS 对应验收 |
| 5.4 | 需非作者参与者实际复核，不能由当前作者自评替代 |
| 7.6 | 真机连接不解决实际 Codex/完整 DSH 插件交接、撤权、取消和复验安装配置 |
| 8.2 | 本次只使用已安装 APK，未验证构建清单与安装；仍需真实 APK 检查器、iOS 已签名开发制品及安装证据 |
| 9.3 | 仍需 Appium 可信 reset/namespace/cleanup、原构建对照与候选两次干净复验调度实现 |
| 9.5 | 依赖实际制品、安装身份和设备复验记录，不可将本次导航 run 升级为修复结果 |
| 10.1 | Android 可用，设备本身不再缺；源码→构建→人类摘要审批→真实安装身份→干净复验仍缺上述实现/材料 |
| 10.2 | iPhone 由独立任务使用，其现有测试不能代替本修复协议验收；需对应 iOS 签名构建与完整闭环 |
| 10.3 | 同设备 owner 互斥与自有清理已补部分真实证据；安装取消/断连/未知恢复/清理失败仍需真实安装适配器与受审无危险样本 |
| 10.4 | 缺至少 10 个真实流程、两次真实构建变化、双端、3 名非作者；合成导航 10 个探针不是该样本集 |
| 11.4 | 保持场景审计更新；以上前置完成前不同步主规格、不归档 |

## 本机证据与复现

最终证据目录：`artifacts/physical-validation/repair-android-2026-10-05T08-34-43.500Z/`，含 report、前后截图/结构以及原 run XML、解析回执和 tap fact。原始物理设备材料被 `.gitignore` 排除，不直接发布；仓库保存结构化结论和脚本。已检查普通导航通过和正确页面被拒绝的实际截图。

此前首轮未进入 Fixture 前台而停止，随后显式 `MirrorService.manageApp(activate)` 修正探针初始化；另一次因探针把安全 `inconclusive` 一概当作未知副作用而停止。最终仅允许**已有持久 blocked/not-dispatched 事实且零写入**的拒绝继续，真正 unknown/dispatched 均立即停止，不重放。中间报告保留，不计入最终通过数量。

```sh
MOBILE_MIRROR_ANDROID_UDID=<显式授权设备ID> \
MOBILE_MIRROR_APPIUM_EXECUTABLE=<绝对Appium可执行文件路径> \
pnpm exec tsx scripts/repair-android-physical-probe.ts
```

运行前确认两个端口空闲；被占用时用脚本的 `MOBILE_MIRROR_ANDROID_APPIUM_PORT` / `MOBILE_MIRROR_ANDROID_SYSTEM_PORT` 指定不同端口，不结束外部进程。设备被其他 owner 占用则拒绝，不删除 claim 以抢占。

## 本轮工程门禁

在本隔离工作树实际重新执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm check --maxWorkers=2` | 111 文件 / 931 项通过，含类型和契约检查 |
| `pnpm test:e2e` | 66/66 通过；与完整单测串行运行 |
| `pnpm build` | 通过 |
| `pnpm pack:check` | 通过 |
| `pnpm dlx @fission-ai/openspec@1.9.0 validate --all --strict --no-interactive` | 41/41 通过 |
| `git diff --check` | 通过 |

上述软件门禁不覆盖真实 APK 安装、平台页面授权正向路径、数据重置或独立用户验收。未修改 Viewer 实现；保留并检查的是实际 Android Fixture 截图。脚本、文档和之前已有实现均留在原工作树，未 commit/push；E2E 产生的截图仍在本机，未混入远端交付。
