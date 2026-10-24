## Why

固定 YAML、可信代码验证及双端真实业务夹具已具备，下一缺口是页面轻微变化导致的定位失败。现在可以验证有限 AI 恢复，但模型不能把业务错误、设备故障或未知写入包装成通过。

## What Changes

- 新增步骤级、默认关闭的恢复包装：只在已证明零设备写入的目标未找到时启用，第一版仅支持导航类 tap。
- 独立规划器只返回候选动作，由同一 run lease 内的执行门禁校验和执行，不引入第二个 Appium/ADB owner。
- 引入结构化失败分类、动作派发日志、不可重放的恢复段、原定后置断言及 recovered 判定；CI 默认非零。
- 本机登记多模态模型配置和截图外发范围，限制请求/动作/时间/token 预算，保存输入材料与结构化输出，不保存隐藏思维链。
- AppClaw/Midscene 用同一组 Fixture App 故障样例对照 PoC 后只选一个 backend；不默认启用它们的整套 Runner。
- Viewer 展示原始失败、模型候选、拒绝原因、恢复动作和最终独立断言。正常固定流程保持零模型请求。
- 默认不做历史兼容：不加 YAML 版本门槛或兼容分支，不自动改写/删除历史证据。

## Capabilities

### New Capabilities
- `bounded-ai-recovery`: 步骤级恢复资格、规划协议、租约执行、预算、取证和结果契约。

### Modified Capabilities
无主规格行为替换。复用 `agent-screen-perception` 的截图授权与 freshness 约束，不扩大其普通 agent action 权限。实施时同步活跃 workbench 规格、ADR 0006，明确 recovered 不属于干净 pass。

## Impact

涉及 workbench-plan/flow/service/device/store/suites/worker、Viewer 和报告消费者；新 recovery-policy/planner/controller 模块及 Fixture App 故障模式。Android/iOS 采用同一契约。模型后端与设备控制分离，DSH 保持薄适配，不修改 Harness agent loop。当前仅交付方案，运行代码不在本轮修改。
