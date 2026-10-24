# 插件友好模块架构与扩展指南

本轮落地采用显式组装，不引入新的插件框架。决策见 [ADR 0011](decisions/0011-plugin-friendly-application-runtime.md)，完整方案与任务见 [OpenSpec 归档](../openspec/changes/archive/2026-09-29-modularize-plugin-friendly-runtime/)，行为已同步到主规范。

## 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| LocalDeviceRuntime / device-services | 宿主无关组装、设备唯一实例、入口与关闭顺序 | 业务算法 |
| WorkbenchApplication | 创建并拥有 suite、comparison、triage、share、repair、trends、retention | HTTP/Cordis 协议 |
| Viewer / TestRunCoordinator | HTTP 与 Agent 授权、结果投影；引用共享 application | 重复创建内部业务实例 |
| workbench-domain / contracts | 领域模型、版本化产品语义 | 文件存储 |
| WorkbenchStore / References | 持久化、保护引用、owner/mutation gate/read lease | 扩展算法 |
| workbench-reference-snapshot | 历史格式兼容＋通用引用保护快照 | 调用已卸载的扩展 |
| TriageAnalyzerRunner | 固定描述符、Worker 预算、输出校验 | 决定运行 verdict 或直接提交报告 |
| workbench-engine-adapter | 当前 AppClaw 感知与选择器 ABI 接缝 | 完整多引擎调度 |

## 使用第二个分析器

构建后应用侧可从宿主无关的子路径导入：

```ts
import { Config, LocalDeviceRuntime } from 'flowassert/application'

const runtime = new LocalDeviceRuntime(Config({ viewerPort: 0 } as Config), {
  analyzer: {
    id: 'example.triage',
    version: '1.0.0',
    moduleUrl: new URL('./my-analyzer.mjs', import.meta.url),
    config: { ruleSet: 'review-only' },
    timeoutMs: 5000,
  },
})
try {
  await runtime.listen()
  // HTTP 与 Agent 入口使用 runtime.application 中的同一组服务。
} finally {
  await runtime.close()
}
```

分析器模块导出 `analyzeTriage(run, comparison, locatorEvidence, manifestSha256, config)`，可返回 Promise；返回值遵守导出的 `triageAnalysisSchema` / `TriageAnalysis`。`run` 是 Worker 中的复制快照，修改它不会写回源运行。返回 schema 校验失败、未知证据引用、异常退出或超时会使本次分诊失败；不会改写源运行。返回的 verdict/verification 即使合法，也由核心的源运行投影覆盖。

只允许开发者受信任代码，不接受来自用户界面的路径。描述符、配置摘要在构造时固定；更换实现必须更新版本。`analyzer: null` 禁用新分析但保留历史报告读取。默认分析器无需额外配置。扩展仍在现有分诊结果模型内工作，不支持自定义 UI、模型自动归因或任意新判定语义。

## 新增证据消费者

使用 `WorkbenchReferences.publish()` 发布 v3 记录，`consumerKind` 为如 `example:report` 的命名空间标识，包含 run ID、已验证的 evidence 名、源 manifest hash、consumer ID 与创建时间。必须先持久化保护引用，再让消费者记录可见；异常时宁可多保留保护，不可暴露无保护报告。跨多个写入时使用同一 Store mutation gate 及 `publishUnderMutationGate()`，不得嵌套拿 gate。

退休时先记录持久 tombstone，再在同一 gate 下按 ref/kind/consumer ID 撤销。退出应用或禁用算法都不等于退休。无需向 Retention 注册进程内回调，也不要给 legacy snapshot adapter 新增按消费者扫描逻辑。

## 验证与开发约束

新增扩展至少覆盖：默认/替代/禁用、错误输出、超时、运行中关闭、持久记录兼容和证据保护。新增长任务必须保持局部进度、其他控件可用、失败保留结果。不要把 Viewer 构造或全局 Context 反向注入领域模块。

```sh
pnpm check
pnpm test:e2e --workers=1
pnpm build
pnpm pack:check
pnpm test:application:probe
```

首次新工作树需先 build，部分 HTTP 测试读取 `lib/viewer` 浏览器资源。构建与 E2E 串行执行。`node scripts/plugin-runtime-probe.mjs /absolute/unpacked/package/lib/application.js` 可验证实际解包产物的嵌入入口、默认分析 Worker、源证据不变与关闭结果。
