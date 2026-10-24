## Why

现有 UI 断言主要证明一次观测成立，不能直接表达持续稳定、App 重启后的持久性或显式重复提交后的业务唯一性。需要把这些时间相关的验收条件做成有界、可复验的声明，避免把等待结束、重新启动成功或脚本退出码当成业务通过。

## What Changes

- 新增 `assertEventually` 和 `assertStable`：复用结构化元素断言，分别表达截止前成立、整个指定采样窗口持续成立；明确采样不是连续观测。
- 新增显式 `restartApp`，只重启当前授权测试 App、不清数据；通过独立前后断言及业务 verifier 证明持久性。
- 新增步骤内 `assertBusiness`，复用登记的可信、只读 verifier，提供有界最终一致性轮询；提供重启持久性与两次显式提交/业务唯一性模板。
- 保持现有 UI/business/evidence/cleanup 分项，不新建模糊的“时间通过”；缺样、截断、过期或不完整证据不通过。
- 保持自动重试默认关闭与 flaky/recovered 非干净通过语义；本方案不自动重复有副作用动作。

## Capabilities

### New Capabilities

- `workbench-temporal-assertions`: 有界时间断言、显式 App 重启、步骤内业务校验、持久性/幂等性模板及对应证据。

### Modified Capabilities

无。新增语法为显式 opt-in，既有即时断言、套件重试与业务 hook 要求保持不变。

## Impact

- 基线：2026-10-05 核对的 `origin/dev@REDACTED_REVISION`；本机 `dev@REDACTED_REVISION` 尚落后 22 个提交。实施前必须从最新 dev 整合，不以本机旧模块布局作为当前实现。
- 影响编译器、执行器、WorkbenchDevice/MirrorService、可信扩展登记、步骤证据、共享结果投影、用例编辑/历史展示与文档；预期不新增宿主工具或依赖。
- Android/iOS 共享语义，平台/provider 必须显式提供重启及观测能力。Mock、模拟器和真机验收分开记录；不承诺设备重启、卸载重装或跨版本数据迁移。
- 设备变更仍经 MirrorService 的授权、互斥与不确定变更防护；业务查询只调用预登记可信模块，凭据不进入报告。沿用 256 MiB 存储余量和未知容量拒绝策略。
- 与 `add-workbench-health-performance-gates` 可并行编写独立核心模块；共享编译器、schema、projection 和 Viewer 的整合需串行校验。该方案不依赖健康采集器完成。
