# 失败分析与跨次比较

更新：2026-09-18。本文描述当前实现、使用边界和结果解释；详细设计见[归档 OpenSpec](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/archive/2026-09-18-add-run-comparison-analysis/design.md)，验收证据见[验收记录](run-comparison-validation.md)。Android 与 iOS Fixture 同等真机矩阵均已验收。

## 核心边界：FlowAssert 整理事实，任意 Agent 解释原因

一次失败运行可能含有几十张 screenshots、XML hierarchy、manifest、日志、断言、业务 verifier 和多个 attempt。若直接把它们全部交给 Codex、Claude 或 GPT，每个 Agent 都要重复完成文件发现、格式理解、case/step 对齐、动态内容过滤、首分歧定位和历史筛选；这既浪费 token/tool calls，也让相同材料在不同 prompt 或模型下得到不一致的前置事实。

本能力的核心不是内置 AI Analyzer，而是把 FlowAssert 已有的领域语义变成确定性、可复核的上下文：

```text
Raw Runs → Run Alignment → Diff Engine → Evidence Reduction
         → Diagnostic Context → Viewer / MCP / Any Agent
```

其中 `Raw Runs` 是原始归档；`Run Alignment` 利用 case、flow、attempt、步骤签名、业务验证、断言、设备/平台及 artifact 关系进行保守对齐；`Diff Engine` 只陈述维度事实；`Evidence Reduction` 找到首个可确认分歧、标记级联差异并去除不必要材料；`Diagnostic Context` 则是 Agent 的紧凑、可回钻入口。任意上层 Agent 可以解释“为什么”，但该解释不回写事实、不改变基线选择和不改变 verdict。

## 怎么使用

1. 用同一个 YAML 和参数至少执行两次。新运行会保存比较身份、计划/输入指纹、步骤签名、控制事件和结构化诊断。
2. 在运行历史打开目标记录，在“与历史运行比较”选择系统推荐的成功基线，或手动选择另一条记录。
3. 点击“开始比较”。设备画面和其他 Viewer 控件仍可使用；比较任务只读本机归档，不连接手机、不调用模型。
4. 查看最早可确认差异、步骤对照、截图/结构/断言/业务/清理/恢复/耗时结果，以及生成的 Diagnostic Context。下载 JSON 可以保存分析规则、输入哈希与证据引用；原始图片和 XML 不包含在 JSON 内。

系统仅自动推荐同用例、同输入、同平台和同 App 的较早 `pass`。环境变化会显示限制；跨平台和人工选择的不同用例属于 review-only。旧记录没有新比较契约时继续正常查看，但不会迁移或猜测身份，需要重新运行。

## 如何理解结果

- `same`：该维度在当前算法和完整证据下相同。
- `different`：观察到差异。截图像素和单次耗时变化本身不是测试失败。
- `not-comparable`：例如跨平台或截图尺寸不同，仍可并排查看。
- `unavailable`：材料缺失、哈希不符、超出预算或格式被拒绝。
- `partial`：部分维度有效，不能表述为完整比较通过。

失败事实分为业务断言、UI 断言、设备/驱动、模型服务、模型决定、策略、证据、清理、取消和 unknown。系统保留多项并发事实，不用错误文本猜测硬件损坏或产品根因。`abstain`、显式 refusal、网络/服务错误和策略拒绝分别处理。

“最早可确认差异”要求此前对齐顺序明确且材料完整；前序缺证时只显示“最早已观察差异”。它是定位入口，不是已证明根因。

## Agent 获得什么，而不是重新读一切

MCP/Agent 首先读取版本化的 `Diagnostic Context`，其中只包含：两侧 run 身份和原 verdict、case/flow/attempt、可比性限制、首分歧、downstream differences、业务/断言/设备等分类事实、环境差异、证据覆盖以及稳定的 `reportRef`/`evidenceRef`。它不包含秘密参数、宿主绝对路径和默认内嵌的 PNG/XML/log。

例如，Agent 可以先得到“step 8 的 tap 已派发，但候选仍停在 ConfirmPage、订单 verifier 未观察到创建；step 9–12 是 downstream，且截图和结构证据完整”，再只回钻 step 8 的 assertion、verifier 和截图。这样既压缩上下文，也让 Agent 的推理可核对；“tap 没生效是后端故障”仍只能是 Agent 的假设，不是比较系统的结论。

同一 logical test 的历史聚合可展示首分歧位置、分类、环境切片、证据覆盖和引用频率，帮助 Agent 判断是否值得优先调查；它不从相关性推导因果。

## 安全和资源边界

接口沿用 Viewer 的 loopback、同源和 mutation Origin 校验，只接受 runId、comparisonId 和已登记 artifactId。原运行 manifest、verdict 与证据保持只读；派生报告位于独立 comparisons 目录。XML 禁止 DTD/外部实体，证据读取校验 SHA-256，图片、XML、步骤、队列和 worker 均有预算。比较 worker 单并发，任务可取消，宿主重启后的运行中任务标记 interrupted，不自动重放。

首期不提供内置通用 AI Analyzer、AI 根因或 AI verdict、自动修复、视觉门禁、视频逐帧比较、多次趋势、统计性能回归或 Allure。MCP 只提供只读、MCP-friendly Diagnostic Context 和受控 evidence drill-down，不是新的设备控制通道。未来 Viewer AI 解读可作为可选便利功能，但只能消费同一 Context，并清楚标为推测。

## 当前验收状态

- 确定性核心、Viewer、DSH/MCP 同源 Context、证据回钻和上层 Agent 只读消费已有自动化覆盖。
- Android Fixture 已完成两次正常运行、故意业务失败、报告与派生产物重启复核。
- iOS Fixture 已完成同等矩阵：两次正常运行、故意业务失败、严格/复核比较、Viewer 截图、Diagnostic Context 与 evidence ref 回钻、报告和派生产物重启复核。
