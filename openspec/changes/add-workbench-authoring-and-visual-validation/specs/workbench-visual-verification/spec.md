## Purpose

为本机移动测试提供显式声明、人工批准和可回溯的确定性视觉断言，记录不可变基线、适用环境及证据，在不同报告入口保持一致结论，并将模型实验与正式验证分离。

## ADDED Requirements

### Requirement: Explicit registered visual assertion
视觉断言 SHALL 仅由新用例显式声明登记的 profile/baseline，通过现有租约和当步截图执行，不另开设备连接。所有声明视觉条件均为 required；未声明保持 not-performed，仍需至少一个结构化 UI 断言。历史截图比较 MUST 不改变原 verdict。

#### Scenario: Legacy flow without visual declaration
- **WHEN** 原 YAML 在新版本执行
- **THEN** 不自动调用视觉或模型，原通过规则和 visual not-performed 保持

#### Scenario: Required profile disabled
- **WHEN** 用例声明视觉检查但对应 capability 未启用或 profile 不存在
- **THEN** 在动作前拒绝用例，不跳过检查后通过

### Requirement: Approved versioned comparable baselines
视觉 profile SHALL 冻结规则版本、区域、mask、阈值、App/平台、尺寸/方向/主题适用范围。基线 MUST 人工批准，保留来源与 revision，不从 failed/recovered/flaky 自动更新；参考图批准不等于测试已通过。

#### Scenario: Image dimensions differ
- **WHEN** 待测截图与批准基线方向或尺寸不兼容
- **THEN** 返回 inconclusive 并显示原因，不自动缩放后声称可比

#### Scenario: Baseline update after failure
- **WHEN** 视觉断言失败
- **THEN** 不自动替换基线；显式批准新 revision 后保留旧 revision 与审批记录

### Requirement: Independent visual result aggregation
系统 SHALL 保留 visual pass/fail/inconclusive 和 evidence refs，完整证据下视觉不满足导致 fail，缺图/超时/不可比导致 inconclusive；已有冲突、污染、其他失败和 recovered 语义不被视觉结果抹去。视觉 pass MUST 不代表后台持久化通过。

#### Scenario: UI passes but visual differs
- **WHEN** 必需视觉检查明确失败且 UI 结构断言通过
- **THEN** 分项分别显示，最终非通过；报告链接区域/配置/原图，不改业务 verifier 事实

### Requirement: Reviewed baseline approval with immutable source identity
基线 SHALL 从已登记参考图或重新校验证据完整的本地干净成功运行产生候选。候选 MUST 显示来源类型、规则/图像摘要、适用范围和预期 revision，有效期最多 10 分钟。批准 MUST 由本机用户在预览后显式发起，提交时重验来源、规则、revision 与引用保护；失败不能产生可执行的部分批准记录。导入/派生/failed/recovered/flaky 材料 MUST NOT 作为成功运行来源。批准参考图不得声称其来源运行已通过。

#### Scenario: Evidence changes after preview
- **WHEN** 用户预览后原图、来源 manifest、规则或当前 revision 发生变化
- **THEN** 批准 SHALL 被拒绝并要求重新预览，旧批准记录和来源材料保留

#### Scenario: Concurrent approval and retention
- **WHEN** 基线批准与清理同一来源材料同时发生
- **THEN** 已批准 revision 与保护引用 SHALL 一起生效，或整个批准失败；清理不得留下引用已失效但仍可执行的基线

#### Scenario: Replayed approval or process interruption
- **WHEN** 同一批准请求重复提交，或批准持久化过程中进程中断后重启
- **THEN** 同一批准 SHALL 至多产生一个 revision；仅完整提交的 revision 可执行，未提交候选失效，历史 revision 不被覆盖

### Requirement: Frozen baseline revisions and explicit comparison scope
已受理运行 SHALL 冻结基线 revision、图像和规则摘要。适用范围 MUST 区分来源构建与允许的目标构建，默认仅源构建；跨构建允许集合变更需重新批准并产生 revision。unknown 构建不能默认为可比。retire 基线不得解除历史消费者的证据保护，普通运行及 Agent 读取不得自动批准或更新基线。

#### Scenario: New revision approved during execution
- **WHEN** 一个运行正在使用 revision 1，用户批准了 revision 2
- **THEN** 已受理运行 SHALL 继续使用 revision 1 并记录其证据，后续运行才可选择新 revision

#### Scenario: Compare a new application build
- **WHEN** 当前构建不在批准的目标构建集合中
- **THEN** 结果 SHALL 为不可比；只有明确批准新的适用范围后，后续运行才可执行该跨构建比较

### Requirement: Bounded cancellable deterministic comparison
每项视觉比较 SHALL 受运行剩余预算和最多 10 秒单项预算共同约束，最多并发一项。参考图 MUST 限于 4 MiB、4096×4096 像素，区域和遮罩各最多 20。比较不能阻塞 Viewer 或状态/取消处理；取消后的迟到结果不得发布为成功。零可比较像素、解码失败、超时及缺失材料 SHALL 返回 inconclusive。

#### Scenario: Comparison times out while history is open
- **WHEN** 大图比较超过预算且用户同时查看历史
- **THEN** 历史和取消 SHALL 保持可用，视觉结果不通过，上一有效结果和已有证据仍可访问

### Requirement: Isolated opt-in model evaluation
OCR/语义视觉实验 SHALL 默认关闭、只读、有请求/图像/时间预算，外发遵守对应历史图片及 App 授权；图片内文字 MUST 不被当工具指令。模型不确定、预算超限和缺证据不得通过。实施 SHALL 保留冻结测试集、误通过/误失败/无法确认、延迟和成本，以及明确 go/no-go 决策。

#### Scenario: Visual prompt injection or denied image sharing
- **WHEN** 图片包含操作指令或其外发权限未批准
- **THEN** 不执行图片指令；无授权时不上传，检查无法完成而非通过

#### Scenario: Experimental backend does not meet gate
- **WHEN** 冻结反例集出现错误通过或预算/授权测试失败
- **THEN** 记录 no-go 并保持功能关闭，不阻塞确定性创作能力交付，也不宣称通用视觉已支持
