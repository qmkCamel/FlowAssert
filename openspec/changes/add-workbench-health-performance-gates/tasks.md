## 1. 共同契约与架构（离线，先行）

- [x] 1.1 从最新 dev 核对五维结果、验收/分享 schema、Worker v1 与 provider 生命周期，记录基线和与其他 active change 的接口交集。
- [x] 1.2 实现或复用 temporal change 共用的 v2/requiredFeatures 基础；定义 health/performance 状态、reason、证据版本及 legacy/v1/v2 读写 golden，不重复实现基础。
- [x] 1.3 固化 capability、collector/window/drain、measurement schema、预算与错误分类，写 ADR 保持 MirrorService 单一设备所有者及薄宿主适配。

## 2. 测量核心（离线，依赖 1，可与 3 并行）

- [x] 2.1 编译 runtimeGates/measure，拒绝重复 ID、嵌套、未知信号、非法预算和不含断言的路径，计入展开预算并保留源定位。
- [x] 2.2 实现 monotonic 测量及成功证据端点，测试等于阈值、超时、快速功能失败、空分支、循环实例和墙钟漂移。
- [x] 2.3 区分 performance deadline、run deadline、用户取消与 provider/证据故障；测试迟到结果不变绿及未知写入不自动重试。
- [x] 2.4 固化每个 run/attempt/矩阵槽位的输入环境、阈值和 elapsed，测试原失败不被最快一次覆盖。

## 3. 健康采集框架与离线适配（离线主体，依赖 1）

- [x] 3.1 实现 capability 检查、collector ready/observe/tail/stop-drain 生命周期，预留预算并在副作用前拒绝不支持信号。
- [x] 3.2 实现事件规范化及 App/进程世代/设备槽位/窗口归因，用 fixtures 覆盖旧事件、跨 App、PID 复用、重复/乱序和时间映射不确定。
- [x] 3.3 实现 coverage/gap/drop/drain 判定，测试空流但断连、溢出、权限丢失、迟到事件、未知边界和已确认违规并存。
- [x] 3.4 实现显式 App terminate operation ID 的正常退出关联，测试 restart 附近真实 crash 不被屏蔽及 unexpected-exit 不伪装 crash。
- [x] 3.5 实现私有 journal/材料与容量准入/引用租约/保留接线，测试 256 MiB 余量、未知容量、损坏材料及中断恢复。
- [x] 3.6 实现固定 argv/自有进程回收及有界 parser，故障注入取消不退出、事件风暴、双槽位隔离和宿主强杀；不回收外部服务。
- [x] 3.7 编写 Android 只读来源探针及离线解析适配，验证未认可来源默认 unsupported；输出格式/权限/归因/丢失与排空检查报告。
- [x] 3.8 编写 iOS 只读能力探针及明确的 unsupported 路径；crash/hang 独立报告，不把 Android ANR 规则套用到 iOS。

## 4. 结果消费者与隐私（离线，依赖 2、3 稳定契约）

- [x] 4.1 统一最终聚合和共享投影的门禁真值表，验证 required 缺失、确定失败、采集不确定、取消、recovered/flaky、证据冲突和不可用组合。
- [x] 4.2 更新 run/step、JSON/JUnit/CLI/MCP/DSH 读写与版本路由，保证原 v1 golden 和退出码语义。
- [x] 4.3 扩展套件/矩阵/趋势及 change acceptance 必需维度与版本；测试旧 pass 不满足新维度、修订不通过删要求变绿。
- [x] 4.4 更新分享/导入/export envelope 与证据治理，测试 raw logs/路径/设备 ID/凭据不泄漏、派生/外部导入不升级为独立健康证明。

## 5. Viewer 与工程门禁（离线，依赖 4）

- [x] 5.1 展示健康能力/窗口/覆盖缺口和测量端点/阈值/开销口径，接入 user-action-contract 的项目特定 preparing/observing/draining 状态。
- [x] 5.2 E2E 延迟 >=800 ms 时操作历史/主题，验证局部进度、取消排空、失败保留、领域完成时间和排空前不提前变绿；保留并人工检查截图。
- [x] 5.3 联跑 temporal/restart/assertBusiness 的组合或完成确定性接口 fixtures，区分协议验证与真实组合完成，补尾部超时/cleanup 失败场景。
- [x] 5.4 运行 pnpm check 与 pnpm test:e2e，记录基线、命令、输出和本 change 问题修复。
- [x] 5.5 运行 pnpm build 与 pnpm pack:check，完成仓库外安装包/共享入口的 Mock 探针，检查打包包含所需能力且不夹带私有材料。
- [x] 5.6 更新能力表、测试指南、支持信号矩阵及限制，严格校验 OpenSpec；明确 engineering-only 与平台/真实业务未放行项。

## 6. 平台来源放行与真实验收（每项独立前提）

- [x] 6.1 在授权 Android 设备执行来源探针，记录 OS/driver/source 身份与完整性能力；需要设备和测试权限，不能用 parser fixture 替代。
- [ ] 6.2 Android Fixture 验证正常、crash、ANR、重启、跨 App、权限丢失、断线/迟到与取消；只有可证明覆盖的信号才能进入支持矩阵，来源不足时该任务保持未完成。
- [x] 6.3 在授权 iPhone 执行 crash/hang 来源能力探针并记录 unsupported 原因；需要签名/诊断访问，不自动安装 agent 或改系统设置。
- [ ] 6.4 对 iOS 可用信号做受控真机正反例与排空验证；来源不能满足完整性时不开放且保留此放行任务，不能用“实现 unsupported”勾掉真实支持。
- [x] 6.5 Android/iOS 受控 App 的时间门禁正反例及断连/宿主暂停验收；需要相应构建/设备，记录 automation-observed-e2e 开销而非生产 SLO。
- [ ] 6.6 若发布业务端点模板，使用授权 App/后端和批准时限验收 assertBusiness 端点；依赖 temporal 对应子能力，缺少业务材料不阻塞 UI-only 工程交付。
- [x] 6.7 核对全部需求场景与证据，为每项未完成任务记录具体阻塞；工程门禁通过不代替真实信号放行，满足所需验收后再同步主 spec 和归档。

实施基线：origin/dev@REDACTED_REVISION，独立 feat/temporal-runtime-gates 工作树。勾选项对应工程/Mock、明确标注的 Android 真机来源探针与 Android/iOS 合成 Fixture 时间门禁证据，不代表 crash/ANR/hang 真实支持或业务放行；审计已核对全部 delta 场景，未同步主 spec、未归档。每个未完成平台项的具体前提见 [验收审计](../../../docs/runtime-gates-validation.md)。

2026-10-06 真机进展：6.5 的安卓 UI 端点时间正反例、自有宿主暂停和用户确认的 USB 断线均已验证。USB 重试 runtime-gates-2026-10-06T06-14-10-625Z 的计时门禁为 inconclusive / measurement-observation-failed，未把基础设施断连当作 App 超时或通过；证据已复验、会话已回收、设备已重新连接。iOS 部分未验收，6.5 保持未完成，合计 27/32。6.1 已在新安装的 runtime Fixture 重复探针；真实 Appium 下 crash/ANR 必需能力在动作前拒绝，6.2 的完整来源证明仍缺。6.3/6.4 尚缺已授权 live 诊断来源及签名 Fixture；6.6 尚缺真实业务端点与批准时限。不得以这些已推进的部分勾掉整项。

同日 iOS 跟进：runtime-gates-ios-2026-10-06T07-11-06-761Z 的 UI 端点时间正例 7847.14/20000 ms、负例 1008.41/1000 ms，以及宿主暂停均符合预期。runtime-gates-ios-2026-10-06T07-19-21-754Z 实际 USB 断线时计时门禁为 inconclusive / measurement-observation-failed，而非 App 超时或通过；原生证据复验及资源回收完成。6.5 两端完成，最新合计 28/32。6.3 的 live 诊断来源仍缺，真实会话中的静态 unsupported/preflight 拒绝不能替代来源探针；6.4 的签名时间 Fixture 已具备，但 crash/hang 完整来源及受控信号/排空验收仍缺。6.2 和 6.6 的阻塞不变，未归档。

2026-10-07 来源续验：在用户确认已连接并解锁的 iPhone 上，以固定只读 `devicectl device info details/files` 实际读取设备详情和限定 RuntimeFixture 范围的 systemCrashLogs 目录。live JSON envelope 已验证，两项可读；crash 保持 `archive-without-window-completeness`，hang 保持 `verified-hang-source-unavailable`，未开放信号。6.3 完成，合计 29/32。6.2/6.4 仍缺进程世代、窗口游标、丢失检测、时间映射及排空完整来源；用户确认暂时没有真实业务两构建／隔离后端及获批视觉/OCR profile，6.6 保持未完成。原始诊断 JSON 仅存私有忽略目录，未安装 agent、改系统设置或连接模型。见 [本轮对账](../../../docs/physical-validation-2026-10-07.md)。
