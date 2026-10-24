# 生命周期与模块边界验收

后续状态（2026-10-01）：下表当时记录的其他 Worker 退出差异及剩余内置引用生产者已由 [ADR 0014](decisions/0014-worker-and-builtin-reference-governance.md)实施，见[新验收记录](worker-reference-governance-validation.md)。本文保留 2026-09-29 的历史结论。

日期：2026-09-29。基线 `REDACTED_REVISION`，分支 `refactor/evidence-runtime-boundaries`。Node 24.19.0 / pnpm 11.7.0 / macOS arm64。实现与工程验收不等于真机发布验收。

## 生命周期审计

| 组件 | owner / 关闭链 | 本轮结论 |
| --- | --- | --- |
| comparison | WorkbenchApplication → comparison.close → Worker exit → 读租约/预留释放 | 新补准入串行化、排队取消、运行排空、终止错误和持久化错误汇总；不退休引用 |
| triage | Application → triage.close → accept tail/drain → analyzer | 已有关闭/迟到进度回归；正常路径等待 terminate。拒绝 terminate 时实际退出确认仍需后续统一，不宣称已全覆盖 |
| share jobs | Application → shareJobs.close → submit tail/active finished | 已有关闭期间提交、迟到预览回归；内部图片 Worker 的退出见下项 |
| suite/run | Application → suites.close → workbench.close → Store | 已有停止准入及运行等待；native Worker 正常路径 await terminate；异常终止后的退出确认仍需后续统一 |
| 录像/基线 | workbench → videos.close / baselines.close | 录像终止未完成上传并等待 idle；基线清理待确认 proposal 的租约 |
| 内存图片计算 | visual / share image Worker 接收已复制的图片数据 | 当前仍有 fire-and-forget terminate；不读取用户归档目录，不是此次 comparison 读租约漏洞，但残留 CPU/内存释放仍是明确待办 |
| 业务扩展 | run hooks → 子进程 executeExtension | finally 中 kill、等待 close 和资源登记队列；未在本轮扩展全进程故障矩阵 |
| 宿主资源 | LocalDeviceRuntime → listener / assistant / coordinator / application / device | 保留按依赖顺序清理与错误聚合；比较 Worker 未确认退出时不进入 Store/设备释放 |

这些结论来自代码审计及对应既有/新增测试；不能用“所有生命周期都已统一”概括。

## 新增验证

- 可控 Worker：成功、error、无结果 exit、超时、预先取消、关闭中迟到 message、拒绝 terminate 后延迟 exit；验证监听器清理与单次终止。
- 比较服务：发布切点阻塞时关闭、后续请求拒绝、排队任务取消、重复关闭、读租约退出前保留、退出后释放、持久引用不撤销。
- ENOSPC 式终态写盘失败：错误向 close 传播，资源释放；换新 Store owner 后恢复为 interrupted。恢复写盘再失败会显式报错，不吞掉错误。测试是受控异常，不冒充真实磁盘填满/断电验证。
- 应用链：其他 closer 报错时仍等待 comparison，等待期间第二 Store 无法接管，退出后可接管。真实 Node Worker 被取消后 threadId=-1。
- 依赖图：真实全图 + 间接 barrel/dynamic/require 越界、runtime/type 区分、未解析路径、非字面量加载等反例。
- 浏览器：延迟提交时局部状态与禁用按钮跨主题重绘保留；提交失败保留旧 JSON 报告；延迟取消时进度与禁用按钮保留，主题继续可用。取消 UI 时序使用受控响应，真实 Worker 关闭由后端测试和安装包探针分别验证。
- 浏览器模块回归：取消前已发出的轮询在取消完成后才返回 running，不得覆盖 cancelled 终态；操作 epoch 隔离旧响应。

运行截图：[取消等待中](../artifacts/screenshots/lifecycle-comparison-cancelling.png)、[失败保留原报告](../artifacts/screenshots/lifecycle-comparison-retained.png)。

## 最终门禁

| 门禁 | 本轮结果 |
| --- | --- |
| `pnpm check` | 76 个测试文件、663 个测试通过；类型与 bundle contract 检查通过 |
| `pnpm test:e2e --workers=1` | 57/57 通过，包含取消完成后迟到轮询的确定性浏览器回归 |
| `pnpm build` / `pnpm pack:check` | 通过，与 E2E 串行执行 |
| OpenSpec strict 全量校验 | 35/35 通过 |
| 候选包 application 探针 | mock 执行及分诊通过；比较关闭已排空、读租约释放、关闭后拒绝新请求、新 runtime 可接管 Store、两条源 manifest 不变 |
| MCP | 17 tools；PNG/结构查询、本地化、YAML hash、flow/suite/cancel/triage、信号退出均通过 |
| DSH | 实测版本 **0.1.5-rc.2**；干净 profile 的 native/PTC 生命周期、注册测试及 image/text-only 输入投影边界均通过 |
| 旧版兼容 | 使用 **REDACTED_REVISION** 候选：保护发布、退休、旧读取器保守保留、新版重启恢复、源 manifest 未变均通过；该保守保留断言不适用于已理解退休标识的 REDACTED_REVISION |

验收候选 tarball SHA-256：`76272f8545b785036796b5e4ab4716b4a391acb88a987c1796b6ff7b061b2297`。该值标识受测候选；随后补入验收记录及规范归档，不把它作为未来重新打包后的 hash。application/MCP 使用候选包入口和锁定依赖；DSH 安装到独立临时 profile，不改用户全局配置。命令入口沿用[上轮验收](evidence-runtime-boundaries-validation.md)，application 探针已增加比较关闭与 Store 接管断言。

## 限制与后续

本轮没有真实 Android/iPhone App 操作或外部模型请求，不更新双端真机通过状态。引用剩余生产者迁移、历史查询索引、完整引擎契约继续独立迭代。OpenSpec 归档只表示本轮明确范围的交付，不表示上述审计待办消失。
