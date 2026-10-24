# 移动测试工作台产品化：三阶段实施总览

建立：2026-09-25；状态说明更新：2026-10-07。方案基线：`dev@REDACTED_REVISION`。性质：**历史三阶段方案，保留当时规划与验收快照**。当前 18 个 active change及逐项进度以[产品TODO](../../PRODUCT_TODO.md)为准，最新报告/运行时能力见[能力表](../capabilities.md)。本文件是三个 OpenSpec change 的导航与依赖说明，不替代各 change 的规范，不代表功能已发布。

## 定位与不变边界

本机移动测试工作台，优先服务可提供稳定 accessibility 标识、测试数据和业务验证接口的自研 Android/iOS 团队。确定性回归为默认，人和 Agent 复用同一执行核心；AI 辅助不得放宽成功标准。

macOS 真机验收先行；其他宿主系统没有证据就不宣称支持。当时方案保留 Appium/MirrorService、固定 AppClaw 2.7.0 与已验 DSH 0.1.5-rc.2 Native/PTC 边界；不升级依赖、不修改 agent loop。云设备、多设备调度、共享 daemon、任意代码 sandbox、自动支付/敏感输入及 Maestro adapter 不在三阶段必选范围。

## 三个变更与交付目标

| 阶段 | OpenSpec | 交付目标 | 必需范围 |
| --- | --- | --- | --- |
| 1 可信采用 | [proposal](../../openspec/changes/harden-workbench-adoption/proposal.md) · [design](../../openspec/changes/harden-workbench-adoption/design.md) · [tasks](../../openspec/changes/harden-workbench-adoption/tasks.md) | 别人能独立安装、执行、定位异常并收尾 | C0 公共契约；A1 环境；A2 job；A3 可靠性；A4 安装/试点 |
| 2 创作维护 | [proposal](../../openspec/changes/add-workbench-authoring-and-visual-validation/proposal.md) · [design](../../openspec/changes/add-workbench-authoring-and-visual-validation/design.md) · [tasks](../../openspec/changes/add-workbench-authoring-and-visual-validation/tasks.md) | 用例容易编写、审查、维护 | B1 草稿；B2 修复；B3a 确定视觉；B3b 实验评测；B4 收益 |
| 3 长期运营 | [proposal](../../openspec/changes/add-workbench-long-term-operations/proposal.md) · [design](../../openspec/changes/add-workbench-long-term-operations/design.md) · [tasks](../../openspec/changes/add-workbench-long-term-operations/tasks.md) | 连续使用后数据、证据与版本仍可管理 | C1 趋势；C2a 分享；C2b 保留；C3 模板；C4 采用 |

B3b 必须交付可复核的评测和 go/no-go；生产 OCR/语义模型上线不是本阶段无条件承诺，no-go 保持关闭。候选构建与正式 Release 分开，tag/发布需要额外明确授权。

## 工作包依赖与并行

“硬前置”指正式集成/启用门槛，不阻止离线设计和测试样本准备。不存在“整个阶段 1 完成才能写阶段 2”的规则。

| 包 | 硬前置 | 可立即开展 | 完成凭证 |
| --- | --- | --- | --- |
| C0 | 当前 dev 实现/规范核对 | 契约、历史 fixtures、结果口径 | 阶段 1 tasks 1.1–1.5 的提交与测试 |
| A1 | C0 | provider 只读采集设计 | 来源字段/隐私/unknown 的双端证据 |
| A2 | C0、现有 owner/协调器 | CLI 生命周期和进程测试设计 | attach/managed-job/取消/退出码矩阵 |
| A3 | 现有能力；新增路径验收依赖 A1/A2 | 故障数据集与现有基准测量 | 设备、故障、30 次基准和失败证据 |
| A4 | 安装验收需 A1/A2/A3 集成 | 招募试点、配置账号/签名、体验观察 | 同包验收、首次体验和真实项目日志 |
| B1 | C0 | 纯 selector-adapter 和界面草稿 | 双端生成→校验→显式运行 |
| B2 | B1、C0 计划身份 | 变更/缺陷样本与差异规则 | 原计划→审查→新运行 lineage |
| B3a | C0、A1 | 区域比较算法与图像 fixtures | 基线批准/不可比/分项判定矩阵 |
| B3b | 在线试验需 C0 与图片权限 | 离线冻结评测集 | go/no-go 与误判/预算报告 |
| B4 | B1/B2、A4 试点资料 | 可测试性指南/工时记录格式 | 10 条流程、两构建、双端维护成本 |
| C1 | C0；可信统计需 A1 | 聚合样本、页面原型 | 分母/尝试/导入/环境/回钻测试 |
| C2a | C0 证据 lineage | 脱敏规则、v2 fixtures | 原件保真/预览/派生包/导入测试 |
| C2b | C0；删除必须先通过引用/lease 测试 | 容量和 dry-run 预览 | 并发/崩溃/恢复/幂等/删除权限测试 |
| C3 | 现有扩展；真实验收需 A4 接口 | 通用模板与错误样本 | 两试点接口正反例与 cleanup |
| C4 | A4；采用 C1/C2/C3 的已验功能 | 升级矩阵、问题指南 | 3 团队 4 周、盲测与升级记录 |

关键路径：C0 → A1 → B3a/C1；C0 → B1 → B2；C0 → 引用保护 → C2b 删除。A4/C4 的用户与日历时间不能用更多代码并行消除。

## 集成责任与冲突控制

| 共享面 | 集成责任 | 规则 |
| --- | --- | --- |
| Run 类型、兼容 schema、验证聚合 | 核心运行线 | C0 先合并；新分项由同一聚合器判定，禁止 adapter 各判 |
| WorkbenchStore、引用/lease、导入 | 证据线与核心集成人联合 | 小型串行 PR，历史 fixtures 必过；清理不能删 requestId tombstone |
| Viewer 草稿/历史/趋势 | 体验线 | 分模块并行，统一局部进度/状态时间；不复制设备逻辑 |
| local-test-workbench delta | 指定规范集成人 | 阶段 2 修改执行/判定；阶段 3 只改导入，逐 requirement 合并，禁止整文件覆盖 |
| 真机 | 每设备一个验收 owner | 不同设备可并行，同设备预约+claim 串行；没有双设备资源则排队 |

每包可作为独立实现 PR；三个 change 是阶段容器，不要求整阶段一次合并。工程实现可分批启用，但未完成 tasks 不归档。OpenSpec 的 artifact `done` 仅代表方案文件存在，不代表实现任务或外部门槛完成。

## 与既有 active change 的衔接

| 既有 change | 保持原归属的事项 | 新计划如何消费 |
| --- | --- | --- |
| [add-agent-test-run-control](../../openspec/changes/add-agent-test-run-control/tasks.md) | 两宿主真实图片消费的分层证据 | 阶段 1 同包验收引用实际结果，不把附件返回当模型已理解 |
| [add-semantic-agent-actions](../../openspec/changes/add-semantic-agent-actions/tasks.md) | 既有实现的 CI/发布收尾与授权 | 重新核对其中 main/dev 描述与当前交付流程，未核对不代勾；新计划不重复设备工具 |
| [add-workbench-text-input-acceptance](../../openspec/changes/add-workbench-text-input-acceptance/tasks.md) | iOS 第三方 App完整文字场景复验及不可访问内容边界 | B3 提供显式新能力，不篡改旧输入验收为已通过 |
| [add-bounded-ai-recovery](../../openspec/changes/add-bounded-ai-recovery/tasks.md) | backend 对照、未知遮挡、旧 OnePlus 故障 | B3b 不重复实现恢复器；复用合规样本但独立统计视觉验证 |

## 双层验收门槛

所有指标是目标，不是当前测量结果。工程完成和真实采用分别报告，缺外部资料保持 pending，不能以 Mock/Fixture 或演示替代。

| 阶段 | 工程门槛 | 采用门槛 |
| --- | --- | --- |
| 1 | 同包干净安装/兼容、生命周期故障矩阵、100 故意失败样本观察零错误通过、双端各 30 次基准 | 4/5 新用户依赖就绪后 15 分钟首测；两 App 双端共 20 流程，7 天至少 100 次计划运行，非产品故障目标 <1% |
| 2 | 只读草稿、审查修复、新 run、视觉显式启用、历史语义不变、实验 go/no-go | 10 流程、两构建、双端，含审查返工的中位总时间目标减少 ≥30%，无错误通过增加 |
| 3 | 趋势口径、安全导出、引用保护、恢复/删除、v1/v2 和升级回退 | 3 外部团队连续 4 周；盲测至少 80% 失败在 5 分钟内正确分类及定位证据 |

所有实现包必须运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 和对应 strict OpenSpec 校验。Viewer 变更保留并人工检查运行截图。慢动作还需实际在运行中操作其他控件，验证局部进度、防重复、失败保留、完成刷新和领域时间；按全局 user-action-contract 执行，不在仓库复制技能全文。

## 方案建立时的启动与资源安排

先实施阶段 1 的 C0。契约验收后，运行线做 A1/A2，体验线做 B1，证据线做 C2a/引用保护；A3 测试准备、A4 试点同时开展。随后 B2/B3a/C1 按包级依赖接入，C2b 在保护完成后才启用。

三名独立交付工程师的示例：第 1 周契约/样本/试点准备，第 2–4 周第一阶段候选并行草稿/分享，第 5–7 周第二阶段并行趋势/保留，第 8–10 周长期使用/兼容集成。仅供排程讨论，不是承诺；外部采用最短观察周期、设备排期及模型实验失败均会影响日期。单人按一主任务加样本/数据积累推进，不同时维护三个大实现分支。

## 当时实施范围（2026-09-26历史快照）

已进入 `harden-workbench-adoption` apply：完成公共契约、Mock/Appium 白名单来源采集、严格执行前拒绝、Viewer/比较展示、attach 兼容的 managed job、进程取消/退出码/报告及软件故障矩阵。2026-09-26 增加 100 个离线故意失败样本，结果为 0/100 错误通过；此数字只描述合成样本，不外推真机风险。这些为本地工作区实现，尚未发布。Android/iPhone 真机采集、故障矩阵、各 30 次基准、两试点、新用户首测和 7 天运行仍保持未完成。

截至 2026-09-26，B1 Inspector 草稿/校验、B2 保守维护建议与受控修复、B3a 显式确定性视觉断言及本机基线审批已有工程实现；跨出口结果投影也已接入运行详情、套件 JUnit、CLI 和 Agent。C1 本机趋势索引与双窗口对照、C2a 有界持久分享任务/人工审批、C2b 引用感知隔离/恢复/逐文件 purge 已有工程实现；清理 move/restore/purge 的关键切点已进行隔离目录子进程 SIGKILL 回归。R0—R6 的历史 tombstone/容量准入、全切点与异常文件矩阵、其余大模块拆分及同包升级验收仍未完成，两个阶段不能整体归档。B3b 模型实验门槛及 C3/C4 真实试点/长期采用仍需独立证据。用户当前没有两款自研 App 构建和三支外部团队试点，因此相应真实采用门槛保持 pending；不因 Mock 通过创建 tag/Release 或进行外部业务写入。

## 方案建立时的验证记录（2026-09-25）

使用本机已有缓存 OpenSpec CLI 1.3.1（未全局安装，未改项目依赖声明）；三个 change 由 CLI scaffold 创建，各有 proposal/design/specs/tasks。阶段一 36 项、阶段二 33 项、阶段三 35 项实施任务，全部未勾选。全量 strict 校验 31 项通过；新增 22 个 Markdown 文件的本地链接检查通过。

| 检查 | 结果 |
| --- | --- |
| OpenSpec 三个 change 单独 strict / 全量 strict | 通过；全量 31/31 |
| git diff --check | 通过 |
| pnpm check | typecheck 与契约检查通过；测试 402 通过、1 失败 |
| pnpm test:e2e | 45 通过、1 失败 |
| pnpm build | 通过 |
| pnpm pack:check | 通过 |

未改动文件中的两个基线问题：

1. [iOS 历史验收文档](../sampleapp-video-yaml-ios-validation-2026-09-24.md)链接未入 Git 的本机材料，本机缺失时触发 public-readiness 的 broken-markdown-link。保留历史说明但移除公共断链的修复已规划到阶段一任务 5.4，不上传私有证据。
2. [归档导入 E2E](../../tests/e2e/workbench.spec.ts)用 URL pathname 直接传文件路径，仓库名含非 ASCII 空格时产生未解码路径并报 ENOENT；正确文件 URL 转换与含特殊字符路径回归已规划到阶段一任务 5.5。

未为使本轮规划测试变绿而修改上述代码/历史文档。E2E 自动重写的 37 张已跟踪截图已还原到测试前版本，本轮保留的 Git 改动仅方案与 TODO 导航；未执行新功能的真机或交互验收。
