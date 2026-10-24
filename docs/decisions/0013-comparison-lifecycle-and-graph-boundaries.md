# ADR 0013: 比较任务关闭与模块依赖守卫

状态：Accepted。日期：2026-09-29。基线：REDACTED_REVISION。延续 ADR 0011/0012，不引入新容器或通用任务调度器。

## 决策

comparison 服务显式持有准入队列、运行 Promise、取消控制器与关闭 Promise。应用关闭先停止新请求，再排空已接收的发布、取消排队及运行任务，最后关闭 suite/run/Store。重复关闭复用同一结果；停止不会撤销任何持久引用。初始化必须取得 Store owner，重启只把未完成报告改为 interrupted，不重跑比较。

比较 Worker 从领域报告编排中独立出来。message/error/exit/abort/timeout 只允许一个结果胜出；成功、失败和取消均等待 Worker 退出再释放读租约。若 terminate 拒绝，继续保留租约直到收到真实 exit，再报告终止错误。若永远不退出，关闭保持等待：不能假装安全释放所有权，此时需操作员终止该宿主进程。写盘失败由任务及关闭路径报告，未落盘终态由重启恢复；后台 drain 不产生无人处理的 Promise rejection。

比较提交和取消使用跨重绘保持的局部 pending 状态。待提交时保留上一份报告，禁用重复操作；取消时显示等待后台退出，主题等无关控件保持可用。轮询的迟到结果不覆盖正在提交/取消的状态。

## 依赖约束

用 TypeScript AST 遍历全部 `src` 模块及 `scripts/workbench-*.mjs` Worker/扩展执行入口，构造静态 import/re-export、literal dynamic import、require 和类型边。禁止 runtime cycle；对领域契约、工作台核心、provider、分析器检查传递可达的反向依赖。类型边不参与运行时环判定，但参与跨层约束。

`workbench-cli` 和 `workbench-managed-job` 是独立运行入口，属于组装层，不伪装为核心服务。`viewer-media-error` 是共享错误契约，不是 HTTP 适配器。非字面量加载仅允许三处精确表达式：固定 DSH message loader、受信任 analyzer file URL、经过快照的扩展 source；新动态加载必须明确评审。守卫不声称追踪任意 eval、反射或生成后 bundle。

本轮守卫暴露的两类实际耦合已移除：ExtensionResult/RunVideo/DispatchRecord 回到领域类型；分诊规则使用独立 content-hash，不再为 hash 导入 Store。旧模块保留类型/hash 重导出以兼容既有调用者。无存储格式或公共工具破坏性变更。

## 验收与边界

见[生命周期审计与验收](../runtime-lifecycle-validation.md)。此决策覆盖比较任务的严格退出契约；审计其他模块不等于它们的每一个终止故障都已通过。内存图像 Worker 的资源回收统一、其他引擎异常终止矩阵、引用迁移与索引优化继续列为后续工作。
