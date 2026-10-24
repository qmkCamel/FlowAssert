## 1. T0 依赖与公共契约冻结

- [x] 1.1 核对实施基线 SHA、三个相邻 active change 的接口与共享文件责任，记录可使用的结果投影/refs/lease/owner 版本；不覆盖并发改动。
- [ ] 1.2 固定旧 Diagnostic Context v1、比较工具和 HTTP/CLI golden，新增分诊不得改变旧参数、事实或 verdict。
- [ ] 1.3 定义 TriageReport v1、当前有效性包装、事实/方向/限制/下一步检查严格 schema，以及稳定语义 digest fixtures。
- [x] 1.4 在公共证据/任务契约中增加 triage 所需 v2 kind 与 v1 双读，不伪装既有消费者；覆盖未知版本只读、写入拒绝及旧版清理 fail closed。
- [ ] 1.5 定义受权 summary/evidence 投影与 HTTP/CLI/MCP/DSH schema，固定字段预算、稳定错误码和同源注册清单。
- [x] 1.6 在 ADR 0010 记录分诊派生事实、引用版本和结果边界；确认无 provider/transport 或 Harness loop 变更。

## 2. T1 事实抽取与保守分诊（依赖 1）

- [ ] 2.1 实现结束 run/attempt 的只读输入适配；覆盖无基线、pass、cancelled、recovered、缺比较身份、旧/未来/导入/派生记录。
- [ ] 2.2 实现可选已完成比较消费与 candidate 身份校验，保留 review-only、partial、前序缺口和原 firstDivergence 类型，不重建比较。
- [ ] 2.3 从已有结构化事件、断言、业务/视觉结果与证据状态生成受限事实；在已有生产边界仅补可确认的类型化 code，宽泛 tool-call-failed 和自由文本保持 unknown。
- [ ] 2.4 实现四方向多标签规则、反证/缺口、unknown/not-applicable、稳定排序与最早可检查点；不把恢复成功或哈希完整当作业务正确。
- [ ] 2.5 复用纯选择器/锚点逻辑生成定位器变化假设，覆盖页面未达、重复锚点、遮挡、缺树、文本不可访问和跨构建限制，不调用修复 confirm。
- [ ] 2.6 实现登记 next-check 模板、最多三条建议和处理角色说明；对日志/XML/图片文本中的命令或提示注入保持数据边界。
- [ ] 2.7 增加确定性 golden：同输入/规则/宿主语言产生同语义 digest，证据不足不抹去独立环境事实，UI pass 不覆盖业务 fail。

## 3. T1 有界任务与证据生命周期（依赖 1；可与 2 独立开发）

- [ ] 3.1 实现只读快照/lease 与独立 triage 存储，禁止设备/provider/模型调用；输入元数据、单材料和累计预算有明确拒绝/partial。
- [ ] 3.2 实现一运行两排队、执行/排队超时及有界 worker；覆盖 2,000 步、5,000 事件、64 材料与字节阈值边界和非有限配置。
- [ ] 3.3 实现 requestId/digest 原受理复用和冲突拒绝、持久任务状态、取消与 committing 竞态；中断任务不得自动重放。
- [ ] 3.4 实现短 mutation gate 内输入/owner 重验及报告/保护引用原子发布，临时结果不对外可见；覆盖提交失败、ENOSPC 和旧结果保留。
- [ ] 3.5 实现读取时的当前完整性检查与 stale/unavailable/not-revalidated 包装，保留不可变历史报告，不重写原件或历史 verdict。
- [x] 3.6 实现用户确认 retire、报告 tombstone 与自身引用撤销，保护其他消费者及请求 journal；重复 retire 幂等。
- [ ] 3.7 独立子进程 kill 计算/发布/retire 并重启，覆盖完整提交识别、失效 owner、清理/读取竞态、symlink/路径替换和坏引用索引拒绝。

## 4. T2 Viewer 与人工复核（依赖 2、3）

- [x] 4.1 增加失败详情显式入口及中文/英文摘要，展示原 verdict、当前有效性、最多四方向、事实/假设、缺口与建议，不先要求 JSON 或基线。
- [ ] 4.2 增加依据/反证、最早检查步骤、已登记证据回钻；验证 missing/withheld 与不同运行同名文件不会串联。
- [ ] 4.3 接入显式已有比较选择、无基线提示和失配拒绝；新选择生成新报告，不静默创建比较或扫描全部历史。
- [ ] 4.4 实现局部 analyzing/checking/saving、取消、防重、失败保留与完成刷新；按 runId/generation 隔离迟到响应，领域时间不使用渲染时间。
- [x] 4.5 实现人工多标签复核、证据 refs、alias、受限备注和 append-only supersedes；stale digest/revision 拒绝，意见不改变系统结论或自动训练。
- [x] 4.6 增加显式停用报告交互与保护说明；完成后刷新状态，不删除原运行或清理其他引用。
- [ ] 4.7 添加桌面/窄屏、键盘、非颜色分类标识测试；运行中操作历史/主题，验证完成、失败、取消和切换运行，保存并人工检查运行时截图。

## 5. T2 CLI 与 Agent 入口（依赖 2、3；与 4 共享投影）

- [ ] 5.1 增加 triage HTTP start/status/cancel/read/evidence/review/retire handler，复用 loopback/Origin/授权，覆盖未授权对象不可枚举。
- [ ] 5.2 增加 attach-only `test triage start|get|cancel` 及 `--wait`/SIGINT；输出分诊操作状态与原测试结果，不能把分诊退出 0 用作测试通过。
- [x] 5.3 注册 `mobile_mirror_run_triage` 单一只读工具与 MCP/DSH 薄适配；不提供隐式 start、review、retire 或 raw media，不修改旧比较工具。

- [ ] 5.4 核对 Agent 开关、项目/flow/suite、平台/App 和 sharedEvidence；覆盖已知 reportId 越权、推导类别/建议泄密、秘密参数/路径/原文和媒体 URL 外泄。
- [ ] 5.5 增加 Viewer/CLI/MCP/DSH Native/PTC 同权限摘要 golden、新工具计数/帮助/打包注册一致性，保持旧 Diagnostic Context v1 兼容。
- [ ] 5.6 验证只读入口无设备/网络/模型调用、人工复核 Agent 不可写、报告导出只含受限 JSON；字段超预算明确省略而非悄然变成确定结论。

## 6. T2 确定性语料与专项安全门禁（可在 1 后准备；执行依赖 2—5）

- [ ] 6.1 建立至少 60 开发＋60 冻结样本，按 App/页面/故障模板族隔离；六组各至少 10 个冻结样本，注明真实/录制/合成来源。
- [ ] 6.2 为每例记录完整可接受方向、事实/假设、必需证据、限制与禁止结论；两名标注者独立复核分歧，答案与生产加载路径隔离。
- [ ] 6.3 增加无基线、ID 变化/真实删除/页面未达、业务 UI 冲突、模型 abstain/refusal、取消、旧/派生记录、提示注入和 hash 损坏对照。
- [x] 6.4 实现离线可重复评测命令与 JSON/Markdown 报告，统计微平均 precision/recall、组别混淆、abstain/partial、零预测 N/A 和证据可定位性。
- [ ] 6.5 在冻结集验证 precision≥95%、recall≥80% 及安全反例零违反；调过冻结答案必须另建验收集，不用测试数量替代准确率。
- [ ] 6.6 覆盖各预算阈值、取消迟到、任务/报告/引用故障与原件 hash 不变；分诊失败不影响原执行、Viewer 历史或旧比较。

## 7. T3 真机与同包交付（依赖 2—6）

- [ ] 7.1 冻结候选源码、tarball、规则与语料 SHA，在干净数据目录验证旧 run/比较/归档读取，新报告生成/重启/停用及旧版本安全拒绝写入。
- [ ] 7.2 同包验证 standalone Viewer/CLI、MCP、DSH `0.1.5-rc.2` Native/PTC 及权限矩阵；宿主完整生命周期不通过时保持未验，不改 agent loop 绕过。
- [ ] 7.3 Android 登记 App/OS/设备和两构建，完成四方向、无基线、混合/缺证样本及证据重启复验；不可安全注入项标清来源。
- [ ] 7.4 iPhone 执行同等矩阵，区分运行前 WDA 准备失败与已有 run 内环境事件；旧真机记录不替代本候选验收。
- [ ] 7.5 在同一候选 Viewer 实测慢分析/刷新/复核期间无关控件可用、旧结果保留、成功刷新与窄屏回钻；保留并目检截图。
- [x] 7.6 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 和本 change strict 校验，记录真实结果与未验项。

## 8. T3 非作者诊断收益（工程可先完成，不得模拟参与者）

- [ ] 8.1 招募至少五名非作者/非实现者/非标注者，确认匿名记录与材料授权；不足人数保持 pending。
- [ ] 8.2 冻结 control=`REDACTED_REVISION` 既有 Viewer 与 treatment 候选，准备独立练习例、每人 24 题平衡分配与模板族去重校验，共 120 条任务分配。
- [ ] 8.3 采集从打开详情到回答的端到端耗时、证据 refs、方向/限制、求助与点击；错误/超时/放弃均计失败及 300 秒，不剔除困难样本。
- [ ] 8.4 验证新流程至少 48/60 在五分钟内正确分类并定位证据且成功率不低于 control；有上限耗时中位数下降≥30%，公开分组与失败样本。
- [ ] 8.5 形成脱敏验收报告，分别标注软件、真机、宿主和非作者收益；向 long-term-operations C4 提供引用，不自动完成三团队四周采用任务。

## 9. 文档、发布与归档门禁

- [x] 9.1 更新能力表、使用/排障指南、架构与 ADR，记录四方向不是根因、无基线/权限/导入边界、报告 retire 和回退方法。
- [x] 9.2 记录各里程碑依赖 SHA、未完成项和下一步；实验入口只有 T3 真机及盲测通过后才提升到常规位置，不自动发 Release。
- [ ] 9.3 逐 requirement 对照代码/测试/验收报告，保留既有 active change 未验项；全部必需门槛完成后再申请同步规范与归档。

> 2026-09-26 工程进度：基于 `dev@REDACTED_REVISION` 的隔离 worktree 完成实验纵向链路；本轮尚未合并最新 `dev@REDACTED_REVISION`。规则计算加入有界 worker；报告/保护引用/任务完成态由同一 store mutation gate 发布；复核草稿与错误状态保持、Agent sharedEvidence 投影、离线评测命令已补齐。预算截断导致唯一支持事实不可见时现改为 unknown；pass/cancelled/recovered、派生来源与比较前序缺口有回归。`pnpm check` 554/554、`pnpm test:e2e --workers=1` 55/55、`pnpm build`、`pnpm pack:check`、OpenSpec 1.9.0 strict 校验通过；桌面/窄屏 Mock 截图已目检。候选 tarball SHA256 `91db2a6bbbb13df87a21cc502aa027853ccaa62341d0550ccebba932d549ba9e`：干净安装 Viewer/CLI/MCP 冒烟通过（17 工具），DSH `0.1.5-rc.2` Native/PTC Mock 探针通过。原工作区存在用户未提交改动，未覆盖；E2E 重生的跟踪截图留在隔离 worktree，未提交。仍需全路径超时/容量及独立进程故障矩阵、120 例双人标注冻结语料、双端真机与五名非作者盲测；Mock/宿主探针不能替代这些验收。

> 2026-09-26 `dev@REDACTED_REVISION` 集成候选：沿用开发分支拆分后的原生执行和 Viewer 模块，移入分诊类型化 Appium 事件与面板接线，保留可靠性改动；隔离 worktree `pnpm check` 602/602、`pnpm test:e2e --workers=1` 55/55、`pnpm build`、`pnpm pack:check`、OpenSpec 1.9.0 strict 校验通过，桌面/窄屏分诊截图已目检。集成 tarball SHA256 `fc84289ca029b0a21d89dbdc1345edbb02edfd48d0e00d2327f0a8ee0f955a49`，干净安装 Viewer/CLI/MCP（17 工具）和 DSH `0.1.5-rc.2` Native/PTC Mock 探针通过；最终合并提交另计。本机 `dev` 工作区的既有截图与未跟踪 OpenSpec 草稿不参与合并，不把实验入口转为已验收能力。
