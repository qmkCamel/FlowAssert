# Workbench 版本与问题报告

修复闭环以 **Preview（默认关闭）** 交付，独立 case/journal 不改原 run/JUnit verdict。旧 application-only 页面登记可读取但不能继续授权导航；须显式改用 v2 页面锚点与容器。停用或回退前取消并排空活跃任务，保留原失败、审批、制品及未知安装状态，不能删 journal 清除围栏。工具隐藏不是全局停用；见[修复兼容与恢复](evidence-guided-repair-operations.md)。

格式与回滚证据原始核对：2026-10-07（迁移前 `dev@REDACTED_REVISION`）；当前源码入口为 FlowAssert `main`。包版本相同不表示构建相同；源码、候选 tarball、公开 Release 和生产支持分别核对，见[安装指南](beta-installation.md)。当前 peer/同包验证固定 DSH `0.2.0-rc.2`。

| 对象 | 当前能力和边界 | 兼容结论 |
| --- | --- | --- |
| 迁移前 `v0.1.0-alpha.1` 包 | 基础 Viewer/MCP/DSH/设备桥接；发布时无本轮 Workbench | 不充当前一支持 Workbench 基线；历史宿主 rc.8 不外推当前 rc.2 |
| 当前源码（包版本 `0.1.0-alpha.2`） | 用例、运行/套件、公共投影、视觉基线、趋势/清理、报告目录和 HTML 分享已有工程实现 | 不等于 alpha.2 tag/资产已发布；跨版本必须附源码/包 SHA，不能据同包样本宣称任意旧版本支持 |
| 原始归档 v1 / product v1 | 旧运行的输入与证据 | 保留原记录有限结果；不自动脱敏，不当作新必需维度已验 |
| 派生归档 v2 / rules 1 | PNG 遮蔽、角色白名单、reportedVerdict/withheld/来源映射 | 派生当前结果不确定/未重验；来源结果单列，不自动批准为通过基线 |
| 原始 runtime 归档 v3 / product v2 | 时间/健康/性能维度与 requiredFeatures | 声明功能必须可解释，未知版本/必需功能拒绝；不得删字段降级为 v1 |
| 派生 runtime 归档 v4 / rules 2 | 来源 runtime 必需功能及公开分项 | 保持未重验，不把派生材料当独立健康证明；未知必需功能拒绝 |
| HTML 阅读文档 v1 / template 1 | ReviewedReportSnapshot 白名单、内嵌 PNG、锚点/details/打印 | 冻结完整预览与下载同字节；无脚本/网络/外链。不是 JSON 归档，不能导入、复跑或充当原始验收 |
| 未知未来契约 | 不能解释为已验证运行 | fail closed；不自动改写原件或用于清理决策 |

当前代码接受 JSON envelope 1/2/3/4；完整条件以 `src/workbench-store.ts`、[runtime 格式表](runtime-assertions.md#版本及证据边界)和[报告指南](report-reading-and-sharing.md)为准，不凭扩展名或单个 version 字段放行。新 HTML job 使用 `contractVersion:1, format:html`；旧未带 format 的分享请求仍返回 JSON。

已验的特定回滚边界：报告候选与上一 dev `REDACTED_REVISION` 的同包探针保持原 JSON/v4读取、拒绝新版 HTML 提交；用例创作另有 `REDACTED_REVISION` 基线探针。源码/原件 hash保持和冻结字节已记录于[实施验证](../openspec/changes/improve-report-reading-and-sharing/implementation-validation.md)。这不关闭 `harden-workbench-adoption` 5.3 的完整升级/回退任务，也不构成任意旧版本兼容承诺。

升级/回退前复制原始数据目录到独立位置，记录 manifest/hash，在副本上只读核对；先下载需要的 HTML，再回滚。保留 cases/revisions、journal、manifest、引用/来源映射，不能靠删目录绕过校验；旧程序不写新版活数据。

## 本机脱敏问题报告

默认不上传原始目录/截图/XML/录像/账号/设备标识/绝对路径或日志。使用显式预览、遮蔽和确认生成派生 JSON 或 HTML，并审查未遮蔽像素及省略范围。HTML 文字采用动作类型白名单模板，私有预期/原始观察会省略；接收者可能仍需另外授权的上下文。文件打开/校验不证明重新验证或真实来源。

文字报告至少附包版本、源码/包 SHA、宿主/Node/OS、Mock或物理平台、公开设备类别、复现步骤、期望/实际、稳定错误类别、退出码/重复性/清理失败，以及 run/job 的匿名映射。可附审查后的 v2/v4 或 HTML 与 hash，不附配置/凭据；安全问题遵循[安全报告渠道](../.github/SECURITY.md)。

试点业务 verifier 需要独立只读真值，prepare/cleanup仅操作本次命名空间。见[HTTP模板](workbench-business-template.md)；缺自研构建、隔离账号和外部授权时，真实采用率、维护收益与跨版本支持保持 pending。
