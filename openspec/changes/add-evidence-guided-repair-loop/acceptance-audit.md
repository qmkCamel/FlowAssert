# 场景级验收核对（2026-10-06）

本表逐项对应本变更四份 delta spec 的 59 个 Scenario。`软件`仅表示当前源码/Mock/故障注入回归，不代表实际 Codex/DSH 宿主、真实 APK/已签名 iOS 包、真机业务或独立参与者验收；`待验`绝不由单测、制品名称或文档代替。可执行的总任务状态以 [tasks.md](tasks.md) 为准。变更尚不能同步主规格或归档。

## workbench-repair-workflow（26）

| Scenario | 当前证据 | 仍需 |
| --- | --- | --- |
| 明确缺失且没有派发 | 软件通过；Android/iPhone 旧定位器及目标消失均 target-not-found、零派发；分别 88/112 份证据重启复读 | 真实旧构建锚点及完整受审闭环；普通缺失事实不授予修复准入 |
| 文本伪造目标缺失 | `workbench-recorded-tap.test.ts` 软件拒绝 | — |
| 写盘失败或者派发后失败 | `workbench-recorded-tap.test.ts` 故障注入拒绝 | 真机副作用核查 |
| 合并 block 与前置 readiness | `workbench-recorded-tap.test.ts` 源步骤映射通过 | — |
| 子流程或循环中的同名步骤 | `workbench-recorded-tap.test.ts` 保守拒绝 | — |
| 没有新事实的旧运行 | `workbench-recorded-tap.test.ts` 不推断缺失 | — |
| 证据不可用 | `workbench-repair-contracts.test.ts`、`repair-safety-corpus.test.ts` 拒绝 | — |
| 动作结果未知 | `workbench-repair-crash.test.ts`、`workbench-recorded-tap.test.ts` 围栏 | 真机副作用核查 |
| 双击发起修复 | `workbench-repair-store.test.ts` requestId 幂等 | — |
| 第二候选 | `workbench-repair-store.test.ts` 预算和世代限制 | — |
| 修改审批后补丁 | `workbench-code-repair.test.ts`、`workbench-repair-contracts.test.ts` 拒绝 | — |
| 撤回项目访问 | `workbench-code-build-install.test.ts`、`repair-tool-visibility.test.ts` 拒绝 | 实际宿主撤权运行 |
| 同文字的危险按钮 | `repair-safety-corpus.test.ts` Mock 安全反例 | 真机正反例 |
| 导航登记缺少页面范围 | `repair-safety-corpus.test.ts`、`workbench-repair-contracts.test.ts` 拒绝 | — |
| 提议修改断言或等待 | `workbench-repair-contracts.test.ts`、`repair-safety-corpus.test.ts` AST 拒绝 | — |
| 已批准定位器复验 | Mock 闭环；v2 页面锚点＋容器归属已实现，Android 修复后 10/10、93 份证据复读通过；iPhone 历史材料重放通过，但最新实时探针因 XcodeOffline 阻塞；未准入真机修复候选 | 真实旧构建、受审真机闭环、可信 reset/cleanup、iPhone 实时复验与独立复核；见 [安全修复记录](safety-fixes-validation.md) |
| 取消后的成功回调 | `workbench-code-repair.test.ts`、`workbench-repair-crash.test.ts` 围栏 | 真机取消副作用 |
| 崩溃后恢复 | `workbench-repair-crash.test.ts` 重启只读 | 真机恢复核查 |
| 空间不足 | `workbench-storage-admission.test.ts`、`workbench-repair-store.test.ts` 预拒绝 | 实际大包容量样本 |
| 引用发布中断 | `workbench-repair-store.test.ts` 保守保护 | — |
| 慢验证及失败 | `tests/e2e/workbench-repair.spec.ts` UI 交互和截图 | 真机长验证时延 |
| 功能未启用 | `repair-tool-visibility.test.ts`、`workbench-repair-contracts.test.ts` 默认关闭 | — |
| 正确标题与同 App 错页 | `workbench-page-scope.test.ts`、`workbench-recorded-tap.test.ts`；Android 正反例通过、iPhone 历史材料重放通过 | iPhone 实时正反例 |
| 首次 recovery 原定位器存在 | `workbench-recovery.test.ts` 验证首次派发前的页面、前台应用、几何与新鲜证据；Android 探针通过 | iPhone 实时复验 |
| 导航目标自我授权 | `workbench-page-scope.test.ts`、`repair-safety-corpus.test.ts` 拒绝目标充当锚点及 application 根授权 | iPhone 实时复验 |
| 审计实现和升级 | `appium-loopback-guard.test.ts` 精确版本/摘要准入；已安装上游工厂的无设备 WDA/MJPEG 双监听探针仅绑定 127.0.0.1，磁盘文件未修改 | iPhone 实时 WDA/MJPEG 复验；升级版本需重新审计，不沿用旧摘要 |

## host-code-repair-handoff（10）

| Scenario | 当前证据 | 仍需 |
| --- | --- | --- |
| 版本不匹配 | `workbench-repair-host.test.ts` schema/能力拒绝 | 实际双宿主版本探针 |
| 双宿主一致性 | MCP/Cordis 共享 schema，`repair-tool-visibility.test.ts` | 实际 Codex 与完整 DSH 交接/取消/撤权/复验 |
| 报告要求读取其他仓库 | `workbench-repair-host.test.ts`、`workbench-code-repair.test.ts` 登记路径拒绝 | — |
| 猜测任务 ID | `workbench-code-repair.test.ts`、`viewer-repair-cases-http.test.ts` 所有者隔离 | 实际宿主越权探针 |
| 工作区存在未提交代码 | `workbench-code-repair.test.ts` 独立 checkout，主工作区 dirty 保留 | — |
| 路径逃逸或修改验证器 | `workbench-repair-host.test.ts`、`workbench-code-repair.test.ts` 恶意 diff 拒绝 | — |
| 命令或日志超限 | `workbench-repair-host.test.ts` 时间/进程树/有界日志 | — |
| 必需沙箱不可用 | `workbench-repair-host.test.ts` fail-closed，`trusted-local` 单列 | 真正 sandbox 若要启用需实现和验收 |
| 旧宿主响应迟到 | `workbench-code-repair.test.ts` 世代、取消围栏 | 实际宿主迟到响应 |
| 尝试自行提交发布 | 无 Agent 批准/发布工具，`repair-tool-visibility.test.ts` | 实际宿主提示注入/操作探针 |

## workbench-repair-verification（12）

| Scenario | 当前证据 | 仍需 |
| --- | --- | --- |
| 间接修改业务期望 | `workbench-code-repair.test.ts` oracle/依赖摘要和保护路径 | 真实业务 oracle 复核 |
| 宿主提交全部通过报告 | `workbench-code-repair.test.ts` 独立命令回执取代宿主声明 | 实际宿主交接 |
| 检查期间源码变化 | `workbench-repair-host.test.ts`、`workbench-code-repair.test.ts` 前后摘要 | — |
| 旧版本已经通过 | `workbench-repair-verification.test.ts` 原失败对照不能复现则不验证 | 真机原构建对照 |
| 第一次通过第二次失败 | `workbench-repair-verification.test.ts` 双干净候选不一致不能通过 | 真机双次复验 |
| 导航恢复但业务错误 | `workbench-repair-verification.test.ts` 冻结断言仍失败 | 真实业务断言 |
| 回归被跳过 | `workbench-repair-verification.test.ts` skipped 拒绝 | 真机冻结回归 |
| 没有手机的软件成功 | `workbench-code-repair.test.ts` 默认 device exitCode 非零 | — |
| 原运行历史 | `workbench-code-repair.test.ts` 原 run verdict 不改 | — |
| 用 Mock 替代真机 | `workbench-code-build-install.test.ts` Mock 安装后仍 inconclusive/software | 真机单列验收 |
| 自动发布验收尝试 | `viewer-repair-cases-http.test.ts` 仅生成候选，不直接发布 | 独立人工确认 |
| 只有合成评估 | `repair-safety-corpus.test.ts` 60 例仅软件层 | 真实材料与 3 名非作者 |

## mobile-build-revalidation（11）

| Scenario | 当前证据 | 仍需 |
| --- | --- | --- |
| 构建后包被替换 | `workbench-repair-build.test.ts`、`workbench-code-build-install.test.ts` 摘要拒绝 | 真实构建包 |
| 目录制品包含逃逸链接 | `workbench-repair-build.test.ts` symlink/特殊文件拒绝 | 真实 `.app` |
| 设备正在测试 | 软件独占/运行组互斥；Android 真机第二 MirrorService 的全局 owner claim 拒绝 | 真机安装与运行互斥、矩阵/外部非 Mirror owner |
| 签名未准备 | 当前没有可信已签名开发 `.app` 检查器，保守阻塞 | Apple 签名材料与授权设备 |
| 设备仍运行旧包 | `mirror-repair-maintenance.test.ts` marker/摘要不匹配拒绝 | 真机安装身份 |
| 平台不能证明制品关系 | `mirror-repair-maintenance.test.ts` version-only 为 unverified | Android/iOS 平台回执 |
| 数据清理失败 | Mock reset 未知围栏；M3 尚无移动端 reset/cleanup 调度 | 可信项目 reset/namespace 与真机副作用回执 |
| 只有 Android 通过 | 分平台任务仍独立 pending，当前不授予 device-verified | 双端真实样本 |
| 安装后回执丢失 | `workbench-install-crash.test.ts` 三个 SIGKILL 切点；`workbench-code-build-install.test.ts` 只读核查不重装 | 真机故障恢复 |
| 同卷重复预留 | `workbench-storage-admission.test.ts` 聚合预约/余量 | 大包实测 |
| 只有假适配器通过 | `workbench-code-build-install.test.ts` Mock 安装仍阻止 device 等级 | 真机完整闭环 |

特别注意：当前 `freezeCodePlan` 已强制有构建登记时冻结独立的移动端 `regressionFlows`，不再把源码 `regressionChecks` 伪装为设备回归；这只完成计划身份，不完成原构建失败对照、安装后两次干净候选复验或可信 reset/cleanup。实际 host、设备与独立验收缺口保持未勾选。

本次 Android 的详细环境、10 个探针、修复前后页面 scope 结果和剩余任务对账见 [真机记录](android-physical-validation.md) 与 [安全修复记录](safety-fixes-validation.md)；探针 complete 不等于修复 device-verified。
