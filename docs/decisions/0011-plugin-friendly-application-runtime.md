# ADR 0011: 插件友好的应用运行时

状态：Accepted。日期：2026-09-29。实施基线：dev@REDACTED_REVISION。

## 决策

采用宿主无关的模块化单体，显式组装服务与类型化扩展契约。暂不引入内部 Cordis 容器、动态安装或插件市场。DSH 外层继续通过 Cordis 注册与清理；MCP、CLI、Viewer 使用相同应用服务，不修改宿主 agent loop。

`LocalDeviceRuntime` 持有设备服务、`WorkbenchApplication`、Agent Coordinator 和 Viewer。设备创建集中到 `createDeviceServices()`；工作台业务创建集中到 `WorkbenchApplication`。Viewer 与 Coordinator 接受共享 application，兼容构造入口仍存在，但委托同一组装实现；只有创建方关闭 application。注入的 application 必须使用同一 MirrorService。

关闭依次停止监听与连接助手、结束 Agent 作业、结束分诊/分享后台任务、suite/run、Store，最后释放设备。每一层缓存关闭 Promise；组件出错时继续其余清理并聚合报告。后台队列等待正在登记的请求，任务状态写入串行化，终态不允许被迟到的 cancelling/progress 覆盖。Worker 终止必须等待完成，才释放证据读租约。监听启动失败及启动中关闭走同一回收路径。

领域模型迁入 `workbench-domain.ts`；原 Store 的类型导出保留。AppClaw 感知与选择器依赖集中在 `workbench-engine-adapter.ts`，这是当前固定引擎的 ABI 接缝，不等于已经实现通用多引擎协议。

## 扩展边界

- 分诊分析器是首个可替换能力：应用启动时接受受信任本地 file URL、ID、版本、JSON 配置及不超过 10 秒的执行预算；`null` 表示禁止新分析，但仍可读取已有报告。
- 分析在 128 MiB Worker 内执行；核心验证结果 schema、事实 ID 和证据引用，并覆盖分析器提供的 verdict/verification，保留执行事实的唯一权威。核心负责准入、取消、证据校验、引用发布和报告原子提交。
- job/report 固定分析器 ID、版本和配置摘要；摘要包含这些身份字段。默认内置规则继续为 rulesVersion 1。自定义模块作者负责随代码变化更新版本；这里不提供第三方代码签名或隔离沙箱。
- 不从 HTTP、MCP、Agent 工具或项目 YAML 接受模块路径；不向分析器传 Store、设备服务、宿主 Context 或持久化写接口。受信任代码依旧具备 Node 能力，Worker 不是安全边界。
- `WorkbenchReferences` v3 接受 `namespace:kind` 消费者，撤销必须匹配消费者 kind/id。模块退出不撤销持久引用。Retention 消费统一快照；旧 suite/comparison/share/baseline/Agent/pin/trash 格式由兼容适配器保守读取，不让新消费者扩展清理器。

## 兼容与回滚

不改变 run/product contract、工具名称/参数、YAML、设备租约或连续媒体路径。v1/v2 引用继续可读；损坏条目或未知版本继续阻止删除。新 job/report 的 analyzer 字段可缺省，以支持已有记录；默认分析器仍识别历史 request digest，防止升级后的相同 requestId 重新分析。

旧版本可能拒读含新字段的报告或 v3 引用，这是保守行为。回滚不得删掉这些记录来强行通过校验，也不得让旧清理器忽略未知引用；应恢复新读取器或经过单独迁移评审。已持久化记录不做批量重写。

## 结果与非目标

公开 `flowassert/application` 无 DSH/Cordis 依赖的嵌入入口。新增算法和新引用消费者无需修改执行内核/Retention。架构守卫测试固定模块方向，生命周期/扩展测试及打包探针覆盖实现。

未实现插件市场、动态热卸载、通用报告插件系统、第二执行引擎、数据库替换、查询性能优化或完整沙箱；这些不属于本次范围。设备支持没有扩大，Mock 和宿主兼容测试不能代替 Android/iPhone 真机验收。
