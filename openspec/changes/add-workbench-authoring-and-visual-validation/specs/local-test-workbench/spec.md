## MODIFIED Requirements

### Requirement: Native deterministic YAML execution
工作台 SHALL 使用固定 AppClaw 原生解析器与执行器执行受支持的结构化叶子步骤；统一 YAML 上层允许类型参数、注册子流程、有界控制流和可信注册扩展，环境插值、未知命令或自然语言能力 MUST 在设备动作前拒绝。用例 MUST 包含至少一个明确结构化 UI 断言，末尾 done 不得跳过剩余步骤。

显式 recover 包装 SHALL 使用租约内确定性导航步骤和受控候选恢复；默认关闭，不允许任意自然语言步骤，具体权限与预算遵循 bounded-ai-recovery 规格。正常固定步骤不得调用模型。

显式 assertVisual 包装 SHALL 仅引用已登记的 profile/baseline，按 workbench-visual-verification 执行；它属于工作台包装能力而非 AppClaw 上游原生命令，不替代结构化 UI 断言或业务 verifier。模型视觉仅在独立实验开关与权限均满足时可用。

#### Scenario: Unsupported flow
- **WHEN** 用户提交自然语言、未注册代码或不支持的步骤
- **THEN** 返回可读校验错误，设备没有动作。

#### Scenario: Missing visual capability
- **WHEN** 用例声明 assertVisual 但能力关闭、引用不存在或配置非法
- **THEN** 执行动作前明确拒绝，不静默忽略视觉步骤。

### Requirement: Durable evidence and scoped verdict
系统 SHALL 保存 YAML、引擎版本、会话信息、步骤时序、原始截图与页面树以及 SHA-256。最终 pass MUST 要求所有步骤与声明断言通过、声明遮挡条件未命中、必需证据提交成功，并显示实际声明的验证范围。未配置业务 verifier 或视觉检查的维度 MUST 保持 not-performed；声明的必需业务验证、视觉验证和清理必须满足，不能用 UI pass 替代。

实际发生有限 AI 恢复的运行 MUST 保留原 failed step，只有原定断言、声明视觉条件、后续业务验证、清理及证据均通过才标 recovered；recovered 不属于 pass，不能隐藏原定位失败。

Viewer、JSON、JUnit、CLI 和 MCP/DSH 的同次运行输出 SHALL 投影同一持久化领域结果，包含相同的必需分项状态、原因和可用证据引用；适配器 MUST NOT 因缺字段自行推断成功。读取时发现证据损坏 SHALL 显示完整性变化与当前可信状态，同时保留原报告结果。JUnit SHALL 保持每个计划 case 一个 testcase，并把 attempt/视觉 revision/原因与引用放入有界附属信息。未执行视觉、取消、恢复及派生导入不得在任一出口冒充干净通过。

#### Scenario: Missing or conflicting evidence
- **WHEN** 引擎通过但原图缺失、检查点断言不匹配或 blocker 命中
- **THEN** 最终结果分别为 inconclusive、evidence-conflict 或 evidence-contaminated，已有证据保留。

#### Scenario: Declared visual condition not met
- **WHEN** 结构断言通过但必需视觉条件在完整证据下失败或因缺证据无法确认
- **THEN** 分别记录视觉 fail 或 inconclusive，最终不通过，不覆盖已存在的证据冲突/污染或其他失败。

#### Scenario: Historical comparison only
- **WHEN** 用户比较两次历史截图发现差异
- **THEN** 比较只生成只读分析，不新增过去未声明的视觉断言或改写历史判定。

#### Scenario: Visual result across report surfaces
- **WHEN** 同一运行的 UI 通过而必需视觉失败或无法确认
- **THEN** 所有出口 SHALL 分别显示相同的 UI 与视觉状态；前者为失败、后者为无法确认，JUnit 对应 failure/error，CLI 对应非零，不能因报告格式不同变成 pass。

#### Scenario: Cancellation recovery and derived results
- **WHEN** 运行取消、发生导航恢复或读取 v2 reported pass
- **THEN** 各出口 SHALL 分别保留 cancelled、recovered 或 not-revalidated；命令行取消保持 130，恢复默认 CI 非零，v2 当前可信状态 inconclusive。

#### Scenario: Evidence damaged after a completed run
- **WHEN** 同一历史运行的证据在完成后无法通过完整性校验
- **THEN** 各出口 SHALL 一致显示原报告和当前证据不可验证的区别，保留原记录，不重新执行手机动作或用缓存通过状态掩盖材料缺口。
