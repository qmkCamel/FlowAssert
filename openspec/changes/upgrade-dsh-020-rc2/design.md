## Context

见 proposal.md。基线 origin/dev@REDACTED_REVISION 的二十工具由共享 command/core 实现，DSH 只注册 schema 和投递离散附件。0.2.0 正式版尚无 npm 发布，本次使用可复现的 0.2.0-rc.2；新宿主在加载前检查插件 DSH peers。

## Goals / Non-Goals

**Goals:** 精确宿主依赖和可验证的包安装；消除被类型强制转换遮蔽的来源差异；确认默认 live HMR 及 startup-only 生命周期。

**Non-Goals:** 不追随 alpha，不改 Agent loop、设备 provider、UI 布局或授权范围；不把工程验证扩大为真实模型/真机业务验收。

## Decisions

- DSH 家族精确锁定 0.2.0-rc.2，Cordis/Schemastery 对齐宿主 4.0.4/3.18.4。安装探针从 lockfile package keys 检查整个版本族，拒绝跨系列混装；避免浮动 latest/next 造成子包选择差异。
- 通过公开 MessageSourceMap 声明 mobile-mirror 来源，并使用官方 UserMessage、ImageAttachmentRef、ToolRunContext 和工具定义类型。动态模型消息加载仍支持独立 Viewer/MCP 启动，不强制在核心路径加载 Harness。
- 模型目录使用当前 image-capable deepseek-flash 与 text-only deepseek-v4-pro，确认 omission projection。它只证明宿主能力边界，不发 provider 请求。
- 0.2.0 不读取旧 patchReload 开关。默认 Web profile 保留 live HMR；startup 探针用 argv patch 显式禁用 hmr 行。等待配置生效后测试无重复资源，再发 SIGTERM 等待退出并确认 loopback 端口释放；不把 lifecycle=complete 日志等同于正常退出。
- 同一 tarball 验证 Native/PTC 二十工具、注册测试、历史图片、triage、外部报告授权/撤销、acceptance 和双 Mock 矩阵。使用隔离 DSH_HOME 和 runtime prefix。全局升级只在这些验证后执行，备份用户配置且不启动个人 profile。

## Risks / Trade-offs

- 新工具类型递归推断可能超过 TypeScript 深度 → 动态 schema 边界保留明确类型并由真实 registry 做运行时验证，避免 never 绕过。
- DSH 包新增 runtime peers → 显式补齐开发/宿主闭包并核查精确版本，保持 AppClaw 设备栈 override。
- HMR 错误处理或关闭慢 → 有界等待、保存输出、检查端口；失败不宣称支持。
- 历史文档包含旧基线 → 只改当前入口和规范，新验证单独记录日期，旧证据保留原版本。

## Migration Plan

候选分支通过四项工程门禁、strict OpenSpec、同包独立 CLI/MCP/DSH probes 后成为当前支持候选。备份本机 DSH 配置后更新全局 CLI 并核实版本、配置哈希；失败可重装原 rc.8，备份恢复由用户单独选择。此次不合并 dev、发布包或改个人 profile。
