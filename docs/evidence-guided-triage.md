# 证据引导的失败分诊（实验入口）

本功能只读取已结束的本机运行及可选的已完成比较，给出“产品行为待核对、定位器变化待核对、环境或依赖故障、证据不足”四类可并存的检查方向。它不执行设备动作、不调用模型、不做自动根因判定，也不修改原 verdict。没有足够依据时显示 `unknown`；纯通过运行显示 `not-applicable`。比较必须由用户先显式建立，分诊默认只看单次运行。

在 Viewer 运行详情中点击“生成分诊”。可选勾选当前已完成比较。局部状态显示分析/复验进度，历史、刷新、主题等其他操作仍可用；取消和失败保留上一份报告。展开方向卡片可看结构化事件、依据、限制与下一步检查。证据按钮先复验归档材料，损坏时不返回原文件。人工复核是独立 append-only 意见，不会训练规则或改系统结论。显式“停用”只撤销本报告自己的证据保护引用，不清理原运行。

附着到已运行的 loopback Viewer，也可使用：

```sh
flowassert test triage start <run-id> --url http://127.0.0.1:<port> --wait
flowassert test triage get <job-id> --url http://127.0.0.1:<port>
flowassert test triage cancel <job-id> --url http://127.0.0.1:<port>
```

`start` 可传 `--comparison <comparison-id>` 和 `--request-id <uuid>`；同 requestId 同输入返回原受理，冲突输入拒绝。CLI 退出码只表示**分诊操作**是否完成，不能把其 `0` 视为测试通过。测试原结果在报告的 `reportedVerdict`/`effectiveVerdict` 中独立展示。

MCP/DeepSeek Harness 的 `mobile_mirror_run_triage` 只读工具接受已知 `reportId`，可选 `evidenceRef` 只返回受权元数据，不返回图片、原始路径或可绕过授权的 URL。Agent test control、已登记执行/flow 或 suite attempt、项目、平台、App 与 sharedEvidence 均需要满足；报告 ID 不构成授权。Viewer 发起的运行不会因知道 ID 自动变成 Agent 可读。

边界与当前状态：结构化事件才能支撑方向；一般 `tool-call-failed` 或异常消息中的“timeout”不会被直接判为环境故障。原始导入归档的来源真实性不能由 hash 证明；脱敏派生仍为 `not-revalidated`。报告当前有效性在读取时独立复验。规则计算有 worker 内存和超时边界，但输入加载、定位器辅助与独立进程崩溃矩阵尚未完成全路径预算验收。工程回归覆盖规则、持久化、旧引用与 Mock Viewer；此前同一安装包的 Viewer/CLI/MCP 和 DSH `0.1.5-rc.2` Native/PTC 已通过 Mock 冒烟；当前精确 `0.2.0-rc.2` 的合并候选同包结果见[验证记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)，不升级旧真机证据。冻结语料准确率、Android/iPhone 真实 App 和非作者五人诊断收益仍未验收，因此该入口保持实验性质。执行/回退门槛见 [OpenSpec 任务](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-failure-triage/tasks.md)。

回退：若分诊误导排障或分诊服务故障，停止生成新报告并改用原运行详情、证据及既有 Diagnostic Context；原 verdict、运行记录和已完成比较不因分诊停用而改变。若必须退回旧安装包，先保存完整 runs 目录备份并停机，保留分诊报告与 v2 保护引用，切勿手动删除引用/原始证据；旧版清理器应对不认识的引用版本 fail closed。恢复到支持分诊的版本后再按报告逐一审查/停用。此次实验无自动清理或隐式降级迁移。

离线评测工具：`pnpm triage:eval --input corpus.json --json report.json --markdown report.md`。语料为 `{ "schemaVersion": 1, "split": "development" | "holdout", "cases": [...] }`；每例包含 `id/group/app/page/family/origin/run/gold`，可选 `comparison/locatorEvidence`。`gold` 含 `directions/factCodes/requiredEvidence/forbiddenDirections/limitations`。工具输出微平均 precision/recall、各组结果、混淆、abstain/partial、证据定位与失败样本 ID；零预测时 precision 为 N/A。工具本身不是验收结果：当前没有经独立双人标注的 60＋60 冻结语料，不得把合成回归当作准确率证明。
