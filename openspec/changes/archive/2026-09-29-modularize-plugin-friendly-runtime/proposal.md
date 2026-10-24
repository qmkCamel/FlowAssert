## Why

最新 dev 的运行时、Viewer 和 Agent 协调器分别组装业务服务，退出链遗漏分享和分诊任务；新增证据消费者仍需理解存储内部结构。需要在维持可信执行与跨宿主兼容的前提下建立插件友好的模块边界，而非引入动态插件平台。

## What Changes

- 建立共享 Workbench 应用服务容器和设备服务工厂，统一实例所有权；Viewer 保留兼容构造入口，但委托同一组装实现。
- 后台任务支持停止接单、取消/等待、幂等关闭；关闭失败仍执行其余必要清理，最终报告错误。启动失败清理已创建资源。
- 抽离运行领域类型与 AppClaw 感知适配，维持旧类型导出和现有执行行为。
- 统一证据引用读取边界，保留旧记录的保守扫描；支持版本化、命名空间化扩展消费者，其引用不随模块关闭而删除。
- 抽取受信任、启动时选择的分诊分析器契约与 Worker 执行器，固定版本信息、校验输出，核心继续负责证据、任务与报告提交。
- 增加架构边界、生命周期、扩展兼容和跨入口回归测试。

## Capabilities

### New Capabilities

- `plugin-friendly-runtime`: 共享服务组装、生命周期、稳定内核及分析器扩展契约。

### Modified Capabilities

无。现有工具名称、设备支持、执行/结果语义保持兼容，新增能力以独立规范补充。

## Impact

影响 LocalDeviceRuntime、ViewerServer、TestRunCoordinator、Workbench 领域/引用/分诊及 AppClaw 适配代码；不新增依赖，不改 DSH agent loop。Android/iOS 设备边界不变；DSH 兼容基线仍为 0.1.5-rc.2、Cordis 4.0.2。扩展仅接受应用启动时的受信任代码，不开放来自 HTTP/MCP/YAML 的任意模块加载，不将 Worker 声称为安全沙箱。不包含插件市场、热安装、微服务或设备 daemon。
