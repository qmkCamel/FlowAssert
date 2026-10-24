# 插件友好模块架构验收记录

日期：2026-09-29。实现分支：`refactor/plugin-friendly-modules`，基于 `origin/dev@REDACTED_REVISION`。Node 24.19.0、pnpm 11.7.0。原工作区未快进或覆盖；实现位于独立工作树。

## 验证结果

| 检查 | 本轮结果 |
| --- | --- |
| `pnpm check` | 72 个测试文件、623 项测试通过；包含类型检查和 DSH bundle contract |
| `pnpm test:e2e --workers=1` | 最终代码 55 项通过（2.6 分钟）；串行执行，未与构建共享产物并发 |
| `pnpm build` | ESM、类型声明、浏览器资产、新 application 子路径构建成功 |
| `pnpm pack:check` | 通过，包含 application、默认规则与分析 Worker |
| `pnpm test:application:probe` | 默认分析器、Mock YAML、同一 application、源 manifest 不变、读租约释放与完整关闭通过 |
| 解包 candidate 的 application 探针 | 不依赖 TS 源码；内置分析器生成报告，原 verdict 为 pass，关闭后 listener 不可访问 |
| 解包 candidate 的 MCP 探针 | 17 工具；catalog/flow/suite/cancel/evidence/triage；Viewer 本地化；SIGTERM 资源回收；PNG 390×844；YAML 证据哈希验证通过 |
| DSH clean-profile | 精确 `0.1.5-rc.2`，Native/PTC 均通过；17 工具、注册测试、图片/文本模型投影边界、生命周期通过；patchReload=startup |
| OpenSpec strict validate / diff check | 通过 |

候选 tarball SHA256：`c3033dd6a301817b415d27881bd6e637235369dd661fc4917da3d26369e04aa5`。该 hash 标识本轮本地候选，不是发布版声明。DSH 探针使用已有隔离 rc.2 runtime 和新建临时 profile，没有改动用户全局 rc.8 安装、账户或项目配置。

## 新增回归覆盖

- Runtime/Viewer/Coordinator 共享 application；关闭幂等、错误聚合、失败后继续释放设备；监听启动失败回滚、启动中关闭不残留监听；Agent 终态状态等待最终 journal 落盘，不提前允许消费者按“已完成”开始清理。
- 分诊准入中关闭、正在分析与排队任务取消、等待 Worker 终止和读租约释放；迟到 cancelling 不覆盖终态。
- 第二分析器、冻结 ID/version/configDigest、禁用但历史可读、错误输出、正常退出但无回复、CPU 忙循环超时。
- 分析器不能改写源 verdict/verification；源 manifest 字节不变；升级版本相同 requestId 拒绝冲突；旧报告及旧默认 request digest 兼容。
- 分享准入和转换完成切点取消、迟到预览不发布；保留重启时已提交制品损坏后的 fail-closed 降级。
- v3 命名空间引用在关闭/重启后仍保护证据；消费者身份不匹配不能撤销；未知版本阻止清理。
- 架构守卫：领域/契约不导入 Store 或宿主，内部领域类型不再从 Store 引入，业务实例创建集中，AppClaw 感知依赖经过适配，分析器不获取 Store/设备/Context。

## UI 与排错记录

`user-action-contract` 验证包括：分诊/分享慢操作有局部状态，刷新/历史等无关控件仍可交互；失败保留复核草稿/现有证据；成功刷新结果。桌面与 390px 窄屏分诊截图人工检查通过，结果文字和操作未被截断。

保留截图：[桌面](../artifacts/screenshots/plugin-friendly-runtime-triage-desktop.png) · [窄屏](../artifacts/screenshots/plugin-friendly-runtime-triage-narrow.png)。

初轮新工作树缺少 `lib/viewer` 导致一个 HTTP 静态资源测试失败，构建后解决。新增并发测试发现迟到取消写入覆盖终态，已通过串行状态写与终态保护修复；同时保留完整性验证主动降级为 failed 的合法路径。最终结果只按修复后门禁报告，不把失败运行算作通过。

## 验收边界

本轮是架构与软件工程验收。没有连接 Android/iPhone 真机，没有发送模型请求或执行外部业务；不覆盖设备驱动升级、真机断连/WDA 签名、第三方代码沙箱、插件热卸载或实验分诊算法的产品准确率验收。未引入 Cordis 内部容器；完整多引擎协议、旧引用写入方全部迁移和查询性能优化仍属于独立后续工作。
