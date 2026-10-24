## Why

现有步骤耗时、趋势和 provider 错误不能证明被测 App 没有崩溃/ANR，也不能作为关键业务的响应时间验收。需要显式健康覆盖与单次关键路径时间门禁，区分真实违规、采集盲区和基础设施故障。

## What Changes

- 新增 opt-in `runtimeGates` 配置和固定语法 `measure` 块：将声明窗口内的 App 健康事件与端到端时限纳入必需验证分项。
- 在现有 provider/设备所有者边界内增加只读健康采集 seam；声明支持信号、时间覆盖、丢失/延迟与归因事实。无日志不能等于健康。
- 首期推进 Android 崩溃/ANR 采集能力探针及受控接入；iOS 同期做能力探针与诚实的 unsupported/inconclusive 降级，有可靠来源才开放对应信号，不假定双端对称。
- 性能门禁只承诺单次流程的主机观测端到端时限，不提供生产 SLO、FPS/CPU/内存门禁或跨设备可比性保证。
- 扩展版本化结果契约，确保 health/performance 在 Viewer、JSON、JUnit、CLI、MCP/DSH、套件、矩阵和变更验收中一致；旧记录不补写健康通过。

## Capabilities

### New Capabilities

- `workbench-app-health-gates`: App 健康信号能力、窗口覆盖、归因、采集生命周期和判定。
- `workbench-performance-gates`: 有界测量块、单调时钟、截止时间与业务成功端点。
- `workbench-runtime-gate-results`: 新门禁的版本兼容、跨出口投影、安全证据与交互契约。

### Modified Capabilities

无。新增门禁仅对显式选择新契约的运行生效，既有通过条件不被静默改写。

## Impact

- 基线：2026-10-05 核对的 `origin/dev@REDACTED_REVISION`。当前没有完整 App 崩溃/ANR 健康门禁；具体平台信号来源必须由能力探针确认，不能从日志命令存在推断可用。
- 影响 provider capability/collector、运行生命周期与预算、编译器/执行器、版本化结果/分享/验收聚合、诊断/保留治理与 Viewer；不新建设备 daemon、通用调度器或遥测平台。
- Android/iOS 能力逐项声明；OS/driver/provider 组合未验证时默认禁用该信号。原始日志本机私有、最小收集、不可默认分享；无任意 shell、root、全局清日志或终止外部进程权限。
- Provider 边界变化必须更新 `docs/decisions/` 中相关 ADR；保持 DSH 适配层薄、MCP/DSH 仅返回有界状态/引用，不传连续日志/视频。
- 时间断言方案不是前置硬依赖：性能块可先包裹现有 UI 断言和登记子流程。若需以步骤内业务断言作为成功端点，则依赖同级 temporal change 的 `assertBusiness` 子能力，而非其全部真机验收。
