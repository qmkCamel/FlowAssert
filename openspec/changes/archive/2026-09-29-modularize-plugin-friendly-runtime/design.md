## Context

基线 dev@REDACTED_REVISION。现有 MirrorService 与 Store 的独占、幂等、证据约束继续作为内核；当前装配分散和生命周期遗漏需要先于框架选型修复。

## Goals / Non-Goals

Goals: 所有入口共享一套应用组装；任务关闭后再关闭存储；领域不依赖 Store；新增分诊算法和证据消费者无需修改执行核心/清理器。

Non-Goals: 不实现动态加载、热替换、插件市场、通用调度器，不改变 YAML/工具参数，不替换 AppClaw，不把第三方代码视为安全隔离。

## Decisions

1. `WorkbenchApplication` 为工作台服务唯一装配实现，Runtime 持有并关闭，Viewer/Coordinator 注入同一实例；兼容构造入口委托该实现并明确 owns 标记。设备组装提取至无 HTTP 依赖的工厂。服务保持普通 TypeScript 对象，不传播 Cordis Context。
2. 关闭顺序为阻止新请求、结束 Agent 作业、取消并等待后台分诊/分享、结束 suite/run、关闭 store，最后释放设备。关闭 Promise 缓存；清理失败聚合上报而不跳过后续释放。启动监听失败调用同一路径回滚。
3. 领域类型独立文件，Store 保留类型重导出兼容消费者；内部导入迁移到领域层。AppClaw 感知/选择器集中在适配模块，保持当前 ABI 和行为，不宣称已实现第二个执行引擎。
4. Retention 仅消费引用快照；历史 suite/comparison/share/baseline/Agent 格式扫描移至 legacy adapter，永久引用从统一 References 读取。新扩展使用 v3 命名空间消费者（如 `example:report`），旧 v1/v2 完整兼容，未知版本/损坏条目阻止删除。撤销要求匹配消费者身份；关闭模块不撤销引用。无需冒险重写历史归档。
5. 分诊选择为启动时的受信任 Worker 模块描述符（ID/version/configDigest/file URL），默认分析器保持现有规则，可显式禁用。核心固定描述符、传递复制后的只读快照，限定时间/内存、验证返回 schema 和交叉引用，使用核心投影填充 verdict/verification，分析器不控制事实与持久化。版本信息加入新 job/report 和摘要；旧记录缺失时按旧默认解释。
6. 分诊服务实现 close：立刻拒绝新 start，等待 admission 尾链，取消排队与分析 Worker，等待正在提交的任务完成；直到队列清空才允许 Store 关闭。Worker 终止被等待。HTTP/MCP 不能提供模块路径。

## Risks / Trade-offs

- 异步关闭竞态 → 覆盖 admission、队列、Worker、提交、重复关闭与失败路径；不依赖插件框架默认销毁顺序。
- 新报告附加来源字段旧程序可能拒读 → 只新增记录，不重写历史，回滚保留新记录并明确旧版本 fail-closed；新读取器兼容旧记录。
- 遗留引用格式复杂 → 独立保守适配而非一次性数据迁移，保持所有现有 retention 故障回归。
- 同进程/Worker 受信任代码不是沙箱 → 不开放远端安装，模块由开发者显式组装，未来第三方隔离另立 ADR。

## Migration Plan

先冻结测试与规范，再落地领域/引用边界、应用组装和关闭，最后分析器试点；保持既有 API 并补架构守卫。依次运行 check、E2E、build、pack，并保留运行截图，增加打包分析器与 MCP 探针。真机/DSH 实际宿主可用性与纯软件门禁分别报告。

## Open Questions

无阻塞决策。是否引入 Cordis 内部容器，留给后续多个扩展点的实际装配成本评估，不属于本次交付。
