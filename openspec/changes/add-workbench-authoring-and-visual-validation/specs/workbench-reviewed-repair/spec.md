## ADDED Requirements

### Requirement: Evidence-linked repair proposals
修复建议 SHALL 包含原计划摘要、失败证据、原/新定位器与步骤/断言差异；计划已变化时建议失效。系统 MUST 允许无安全建议，不以存在候选推断产品无缺陷。

#### Scenario: Product functionality broken
- **WHEN** 原功能消失且没有符合原断言的候选
- **THEN** 显示无法安全修复，原失败保持，不生成跳过步骤的通过建议

### Requirement: Reviewed changes with immutable lineage
用户确认修复 SHALL 只产生新草稿/计划；删除断言、放宽业务期望、跳过关键步骤或扩大 App/操作范围 MUST 不作为自动修复接受。复跑生成新 runId 并关联修改前计划和失败，不改写原证据或基线。

#### Scenario: Repair masks assertion failure
- **WHEN** 建议包含删除业务断言以通过
- **THEN** 自动接受被拒绝，明确影响；用户独立编辑仍须重新校验和审查

#### Scenario: Locator-only repair approved
- **WHEN** 用户确认定位器替换并请求复跑
- **THEN** 创建新运行执行原要求，历史保留旧失败和已确认 diff

### Requirement: Measured authoring and maintenance value
采用验收 SHALL 记录至少 10 条真实流程、两次 App 构建变更及双端样本的编写/审查/修复总工时，比较手工与辅助方式，目标中位总时间减少至少 30% 且无错误通过增加；不足样本 MUST 标 pending。

#### Scenario: Generation fast but review expensive
- **WHEN** 草稿生成变快但审查返工增加
- **THEN** 按总工时报告真实收益，不只以生成时间宣称维护成本降低
