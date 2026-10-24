# Worker 与引用治理验收

日期：2026-10-01。基线 `REDACTED_REVISION`，分支 `refactor/evidence-runtime-boundaries`。Node 24.19.0 / pnpm 11.7.0 / macOS arm64。真机验收按用户要求暂缓，本轮未操作手机。

## 已覆盖

- 实际退出：comparison、native parser、native executor、triage analyzer、visual、share-image 共用退出所有权；终止拒绝时不提前返回。native 的已接受设备调用也必须排空。
- 单结果/错误/无结果退出/超时/取消、迟到 message/error、幂等 close、监听器清理；三个计算消费者在 rejected terminate 下等待实际 exit，native 同时等待正在进行的 dispatch。
- suite、baseline、Agent、pin、child 均通过统一 ledger；泛化发布/退休故障测试、缺失 ledger、错误 owner、目标集合不一致、新旧 marker 路径。
- pin 重复提交复用身份、退休中断保持保护、再次激活新身份；child 的创建、trash、restore、purge 中断、新 Store owner 恢复及父运行释放。
- 真实 mock suite 的活跃引用、验证后 freeze/退休、媒体移除后幂等重试；Agent 完成后退休/去重/媒体清理；run baseline 的源保护和缺失 ledger 失败关闭。
- Agent 发布失败时执行门取消，终态持久化失败不产生 unhandled rejection，关闭报告错误且保护不丢失。
- 全量复跑发现 suite 在引用发布期间改写 manifest 的竞态；补执行门及延迟 ledger 测试，证明发布前没有步骤执行/manifest 变化，发布失败则取消且不继续后续 case。purge 重试仅报告本次释放 0 字节。

故障注入是可重复的切点/模拟 ENOSPC/可控 Worker，不冒充真实磁盘填满或机器断电。Worker 永远不退出时仍需操作员停止宿主进程；不会提前放弃设备或 Store 所有权。

## 软件门禁

| 项目 | 结果 |
| --- | --- |
| `pnpm check` | 78 文件、686 测试通过；类型与 bundle contract 通过 |
| 浏览器 E2E | 57/57 通过；最终版本完整复跑 |
| build / pack:check | 通过，与 E2E 串行执行 |
| 候选包 application | mock run/triage、child/pin 引用、比较关闭排空与 Store 接管通过；源 manifest 不变 |
| 候选包 MCP | 17 tools、PNG/结构、本地化、YAML hash、flow/suite/cancel/evidence/triage 及信号清理通过 |
| 候选包 DSH | 实测 0.1.5-rc.2；独立干净 profile 的 Native/PTC 注册测试、生命周期、图片/text-only 投影边界通过 |
| 新旧读取器保护探针 | 前次保留的 REDACTED_REVISION 候选继续保护新 pin/child；旧 unpin 导致的元数据不一致在新版失败关闭，重试恢复；child purge 后父运行释放，源 manifest 不变；既有 comparison/share 兼容探针也通过 |
| OpenSpec strict | 36/36 通过 |

浏览器验收使用真实本地 Viewer + mock 设备：引用扫描/确认期间的局部状态、主题/语言可交互、完成刷新，以及失败后保留非空的已有清理结果。已查看截图：[操作等待中](../artifacts/screenshots/governance-retention-progress.png)、[失败保留结果](../artifacts/screenshots/governance-retention-preserved.png)。没有新增 Viewer 产品交互。

最终受测候选包 SHA-256：`61c7593fb948688df31bcaee0dad0b1155652be6c5f334bc0e6e11c24a000b17`。此值标识受测 tarball，之后补入验收与规范归档，不等于未来重新打包的 hash。application/MCP/兼容探针使用解包入口与锁定依赖；DSH 使用隔离临时 profile 安装同一个 tarball，不改变全局 Harness 配置。最初 DSH 探针的旧临时 CLI 路径已失效，换用明确核对版本的现存 rc.2 入口后通过；这不是插件运行失败。

复跑：`node scripts/plugin-runtime-probe.mjs <candidate/application.js>`；`node scripts/builtin-reference-compatibility-probe.mjs <candidate/application.js> <previous/application.js>`；既有 `scripts/evidence-compatibility-probe.mjs` 接收相同参数。MCP/DSH 的完整调用方式沿用[上轮记录](evidence-runtime-boundaries-validation.md)。所有探针只创建临时 mock 数据，不执行真实业务 App 或外部模型请求。

## 剩余边界

这次收口的是 ADR 0013 审计中的 Worker 退出差异与内置引用生产者迁移，不表示全部产品 backlog 完成。保守孤儿引用不自动回收、旧记录不批量转换。真实设备/外部采用/真实模型消费、生产大媒体性能预算与完整多引擎契约仍按各自计划推进。
