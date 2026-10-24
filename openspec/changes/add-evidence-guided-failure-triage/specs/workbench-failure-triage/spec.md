## Purpose

将已归档的运行事实和可选历史比较转换为保守、可回钻的失败分诊，帮助非作者区分应检查的方向，明确哪些结论已经有证据、哪些仍是假设以及哪些材料缺失，同时不改变执行结果或对设备产生副作用。

## ADDED Requirements

### Requirement: Single-run first read-only triage
系统 SHALL 接受已结束运行的登记 ID 与可选已完成比较 ID，生成独立派生分诊报告；无基线时仍提供单运行事实。运行中记录 MUST 返回尚未终结，不冻结为最终诊断。分析 MUST NOT 连接设备、调用模型、执行命令、重跑测试或修改原运行、比较和 verdict。

#### Scenario: No successful baseline
- **WHEN** 首次失败运行没有可用成功基线
- **THEN** 报告展示失败阶段、结构化事实和证据缺口，说明定位器变化与首次分歧无法由历史证明，不拒绝全部分诊

#### Scenario: Clean or cancelled run
- **WHEN** 选择正常通过或由用户取消的运行
- **THEN** 报告分别显示无失败待分诊或用户取消，不凭空归为产品缺陷；若有独立清理/取证故障，另列对应事实

### Requirement: Evidence-grounded multi-label routing
报告 SHALL 支持产品行为待核对、定位器变化待核对、环境/依赖故障、证据不足四类处理方向，以及 unknown、不适用和多方向并存；每个方向必须有规则版本、支持事实、反证/限制与来源引用。事实确认与原因确认 MUST 分开；不得输出未经校准的置信百分比或将断言失败直接称为已确认产品根因。

#### Scenario: Business verifier contradicts UI success
- **WHEN** 有完整来源的业务 verifier 明确返回 fail，而 UI 显示提交成功
- **THEN** 同时展示两项事实，推荐核对产品行为/测试数据/业务预期，不把 UI 成功覆盖业务失败，也不自动认定后端根因

#### Scenario: Generic tool error
- **WHEN** 只有 tool-call-failed 或自由错误文字而没有可验证的设备/服务事件
- **THEN** 保留原始事件可回钻并输出 unknown 或证据不足，不仅凭 domain 或字符串推断设备断线、签名错误或定位器变化

#### Scenario: Multiple independent failures
- **WHEN** 存在明确设备断线和截图缺失两项事实
- **THEN** 同时展示环境故障和证据不足，缺图不抹掉已确认断线，断线也不证明缺图之前没有产品异常

### Requirement: Conservative locator and product hypotheses
定位器变化候选 SHALL 以失败步骤的计划/输入/平台/App 身份、页面锚点、原选择器命中情况及唯一非敏感替代锚点为依据；旧树缺失、重复目标、前序导航失败、遮挡或页面身份不明必须降级。跨构建比较保留原 review-only 限制，候选 MUST NOT 自动修改定位器、断言或基线。

#### Scenario: Possible identity change across builds
- **WHEN** 同逻辑步骤的旧 ID 消失、同页面唯一文本/角色锚点出现新 ID，且用户提供了跨构建比较
- **THEN** 报告展示定位器变化假设及新旧依据，并明确跨构建环境差异；只提供查看现有修复入口的建议，不确认为根因或自动应用

#### Scenario: Missing accessibility text
- **WHEN** 图片中可能存在文字但结构树没有对应文本，且没有独立视觉或业务断言证明
- **THEN** 报告标记结构可观察性限制，保留原失败，不把它诊断为产品文字缺失或通过隐式 OCR 改写结果

### Requirement: First inspectable point and deterministic ordering
系统 SHALL 优先展示阻碍判断的证据问题，再显示最早可检查失败点及其他并发事实；比较的首次可确认分歧和最早已观察差异必须原样区分。单运行只称最早已记录失败点；并发/无序事件不得强行生成因果顺序。排序 MUST 不丢弃次要类别或改变执行 verdict。

#### Scenario: Earlier evidence gap
- **WHEN** 第八步出现差异但第五步材料缺失
- **THEN** 摘要显示前序缺口与第八步已观察差异，不声称第八步是全程首次故障或根因

### Requirement: Versioned provenance and present validity
每份报告 SHALL 固定 schema/rules 版本、输入 manifest/比较/已读取证据指纹和生成时间；读取时另行显示当前证据可用性与校验时间。哈希只证明字节完整性，MUST NOT 证明导入材料真实性。旧/未来格式、外部导入、脱敏派生、证据变化或不可访问必须有明确限制，不成为正常通过基线。

#### Scenario: Evidence changes after generation
- **WHEN** 已生成报告对应原材料后来缺失或 hash 不符
- **THEN** 保留历史报告只读快照，当前展示 stale/unavailable，禁止把其历史分类呈现为当前已复验事实

#### Scenario: Derived import reports pass
- **WHEN** 导入的派生报告声明源运行通过
- **THEN** 分诊显示 reported verdict 与 not-revalidated，不将其升级为本地可信通过或用它确证定位器变化

### Requirement: Bounded durable analysis and references
分析 SHALL 有显式时间、字节、步骤、证据、并发及输出预算，并报告截断/超限。相同 requestId 与相同请求返回原受理，不同内容必须冲突；取消、进程退出和重启不自动重放。源材料读取受 lease 保护，报告发布与持久引用必须原子一致，未提交产物不得被当作完成结果。活报告保护所引用源材料；只有本机用户显式停用后才能撤销本报告的保护，且不得影响其他消费者、删除原件或清除原请求受理记录。

#### Scenario: Source cleanup races with report publication
- **WHEN** 报告计算期间发生证据清理或 owner 变化
- **THEN** 清理受有效 lease/引用约束；失效写入者不得提交，报告要么完整发布要么标记 interrupted/stale，不留下伪完成结果

#### Scenario: Restart after interruption
- **WHEN** queued/running 任务执行中宿主退出并重启
- **THEN** 原任务显示 interrupted，不自动恢复分析；完整已提交结果保持可读，显式新请求才开始新的分析

#### Scenario: Retire report without deleting source
- **WHEN** 用户确认停用一份报告，而其源运行同时被视觉基线引用
- **THEN** 系统保留报告摘要/复核和原请求身份，仅撤销该报告自身引用，基线保护仍有效，源材料不得因此被自动删除

### Requirement: Safe bounded next checks
报告 SHALL 为每项方向提供至多三条登记检查建议，标注预期收集的证据、建议处理角色以及是否需用户另行操作。建议 MUST NOT 自动执行设备/业务动作、放宽断言、修改签名、删除数据、请求任意 shell 或发送外部问题报告；正文/图片/XML/人工备注均为不可信数据。

#### Scenario: Signing failure and prompt injection
- **WHEN** 结构化记录指向签名前提失败，且日志内包含要求执行命令或上传凭据的文本
- **THEN** 系统只输出登记的账号/签名检查说明及来源，恶意文本不得改变规则、触发执行或获得额外权限
